import { listen } from "@tauri-apps/api/event";
import { useQuery } from "@tanstack/react-query";
import { Ban, CheckCircle2, Send, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cancelTask, listChangedFiles, listTaskEvents, startDiagnoseTask, startPatchTask } from "../../api/tasks";
import type { TaskProfile } from "../../types/profile";
import type { PersistedTaskEvent, TaskEvent, TaskLogLine, TaskStatus } from "../../types/task";
import { VirtualLog } from "./VirtualLog";

type TaskRunnerProps = {
  profile: TaskProfile;
  selectedTaskId?: string;
  selectedTaskTitle?: string;
  onTaskStarted: (taskId: string) => void;
  onOpenReview: () => void;
  attachedContext?: string;
  onClearAttachedContext: () => void;
};

const defaultPrompt = "";
const eventWindowSize = 120;

export function TaskRunner({
  profile,
  selectedTaskId,
  selectedTaskTitle,
  onTaskStarted,
  onOpenReview,
  attachedContext,
  onClearAttachedContext,
}: TaskRunnerProps) {
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [taskId, setTaskId] = useState<string>();
  const [status, setStatus] = useState<TaskStatus>("idle");
  const [logs, setLogs] = useState<TaskLogLine[]>([]);
  const [directExecute, setDirectExecute] = useState(false);
  const [eventOffset, setEventOffset] = useState(0);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const activeTaskIdRef = useRef<string | undefined>(undefined);
  const isActive = status === "starting" || status === "running" || status === "snapshot_created" || status === "context_collected";
  const canRun = prompt.trim().length > 0 && !isActive;
  const canCancel = Boolean(taskId) && isActive;
  const { data: changedFiles, refetch: refetchChangedFiles } = useQuery({
    queryKey: ["changed-files", taskId, "runner"],
    queryFn: () => (taskId ? listChangedFiles(taskId) : []),
    enabled: Boolean(taskId),
    refetchInterval: status === "awaiting_review" ? 1500 : false,
  });
  const canApplyProposal = (changedFiles?.length ?? 0) > 0 && !isActive;
  const displayTitle = taskId ? (selectedTaskTitle ?? "Conversation") : "New Conversation";
  const hasOlderEvents = eventOffset > 0;

  const loadLatestEvents = useCallback(async (nextTaskId: string) => {
    const firstPage = await listTaskEvents(nextTaskId, 0, 1);
    const offset = Math.max(0, firstPage.total - eventWindowSize);
    const page = await listTaskEvents(nextTaskId, offset, eventWindowSize);
    activeTaskIdRef.current = nextTaskId;
    setTaskId(nextTaskId);
    setEventOffset(page.offset);
    setStatus([...page.events].reverse().find((event) => event.status)?.status ?? "idle");
    setLogs(eventsToLogs(page.events));
  }, []);

  const loadOlderEvents = useCallback(async () => {
    if (!taskId || !hasOlderEvents || isLoadingOlder) return;
    setIsLoadingOlder(true);
    try {
      const nextOffset = Math.max(0, eventOffset - eventWindowSize);
      const limit = eventOffset - nextOffset;
      const page = await listTaskEvents(taskId, nextOffset, limit);
      setEventOffset(page.offset);
      setLogs((currentLogs) => mergeLogWindows(eventsToLogs(page.events), currentLogs));
    } finally {
      setIsLoadingOlder(false);
    }
  }, [eventOffset, hasOlderEvents, isLoadingOlder, taskId]);

  useEffect(() => {
    let isMounted = true;
    let removeListener: (() => void) | undefined;

    listen<TaskEvent>("task://event", (event) => {
      if (!isMounted || event.payload.taskId !== activeTaskIdRef.current) return;

      const payload = event.payload;
      if (payload.status) setStatus(payload.status);
      if (payload.event === "file_changed" || payload.event === "diff_ready" || payload.event === "rolled_back") {
        void refetchChangedFiles();
      }

      if (payload.text) {
        setLogs((currentLogs) => {
          if (
            payload.event === "user_message" &&
            currentLogs.some((log) => log.source === "user" && log.text === payload.text)
          ) {
            return currentLogs;
          }
          return [
            ...currentLogs.slice(-5000),
            {
              id: `${payload.event}-${currentLogs.length}-${Date.now()}`,
              source: logSource(payload.event),
              text: payload.text ?? "",
            },
          ];
        });
      }
    }).then((unsubscribe) => {
      removeListener = unsubscribe;
    });

    return () => {
      isMounted = false;
      removeListener?.();
    };
  }, [refetchChangedFiles]);

  useEffect(() => {
    if (!selectedTaskId) {
      activeTaskIdRef.current = undefined;
      setTaskId(undefined);
      setStatus("idle");
      setLogs([]);
      setEventOffset(0);
      setPrompt(readPromptDraft(undefined));
      return;
    }
    setPrompt(readPromptDraft(selectedTaskId));
    void loadLatestEvents(selectedTaskId);
  }, [loadLatestEvents, selectedTaskId]);

  const statusLabel = useMemo(() => {
    if (status === "context_collected") return "Context collected";
    if (status === "snapshot_created") return "Snapshot created";
    if (status === "awaiting_review") return "Awaiting review";
    return status[0].toUpperCase() + status.slice(1);
  }, [status]);

  async function handleStart() {
    const nextTaskId = taskId ?? `task_${Date.now()}`;
    activeTaskIdRef.current = nextTaskId;
    setTaskId(nextTaskId);
    onTaskStarted(nextTaskId);
    setStatus("starting");
    setLogs((currentLogs) => [
      ...currentLogs,
      {
        id: `user-${Date.now()}`,
        source: "user",
        text: prompt,
      },
      {
        id: `local-start-${Date.now()}`,
        source: "system",
        text: "Sending message to Codex...",
      },
    ]);

    try {
      const message = buildConversationPrompt(prompt, logs, Boolean(taskId));
      const request = {
        taskId: nextTaskId,
        profileId: profile.id,
        prompt: buildProposalPrompt(message, profile.writeEnabled, directExecute),
        userMessage: prompt,
        attachedContext,
        directExecute,
      };
      const response = profile.writeEnabled ? await startPatchTask(request) : await startDiagnoseTask(request);
      setTaskId(response.taskId);
      setStatus("running");
      setPrompt("");
      clearPromptDraft(nextTaskId);
      if (!taskId) clearPromptDraft(undefined);
    } catch (error) {
      setStatus("failed");
      setLogs((currentLogs) => [
        ...currentLogs,
        {
          id: "local-error",
          source: "stderr",
          text: error instanceof Error ? error.message : String(error),
        },
      ]);
    }
  }

  async function handleCancel() {
    if (!taskId) return;
    try {
      await cancelTask(taskId);
      setStatus("cancelled");
    } catch (error) {
      setLogs((currentLogs) => [
        ...currentLogs,
        {
          id: `cancel-error-${Date.now()}`,
          source: "stderr",
          text: error instanceof Error ? error.message : String(error),
        },
      ]);
    }
  }

  return (
    <section className="workspace-panel task-runner">
      <div className="section-heading">
        <div>
          <h2>{displayTitle}</h2>
          <span>{taskId ?? `${profile.name} profile`}</span>
        </div>
        <div className={`task-status status-${status}`}>{statusLabel}</div>
      </div>

      <label className="prompt-box">
        <span>Message</span>
        <textarea
          placeholder="Ask Codex to inspect, explain, change, or continue this workspace..."
          value={prompt}
          onChange={(event) => {
            const nextPrompt = event.target.value;
            setPrompt(nextPrompt);
            writePromptDraft(taskId, nextPrompt);
          }}
        />
      </label>

      {attachedContext ? (
        <div className="attached-context">
          <strong>Attached terminal output</strong>
          <span>{attachedContext.slice(0, 180)}</span>
          <button onClick={onClearAttachedContext}>Clear</button>
        </div>
      ) : null}

      <label className={directExecute ? "direct-execute-toggle active" : "direct-execute-toggle"}>
        <input
          type="checkbox"
          checked={directExecute}
          onChange={(event) => setDirectExecute(event.target.checked)}
          disabled={isActive}
        />
        <ShieldAlert size={16} />
        <span>Direct execute</span>
      </label>

      {directExecute ? (
        <div className="risk-warning">
          Direct execute can run non-privileged commands immediately in this session. Keep it off unless you are ready
          for Codex to act without first shaping a proposal.
        </div>
      ) : (
        <div className="proposal-hint">
          Proposal keeps evolving as you continue the conversation. Use Apply only when the current proposal is ready.
        </div>
      )}

      <div className="button-row">
        <button className="secondary-action" onClick={handleCancel} disabled={!canCancel}>
          <Ban size={16} />
          Cancel
        </button>
        <button className="secondary-action apply-action" onClick={onOpenReview} disabled={!canApplyProposal}>
          <CheckCircle2 size={16} />
          Review / Apply proposal
        </button>
        <button className="primary action-with-icon" onClick={handleStart} disabled={!canRun}>
          <Send size={16} />
          Send
        </button>
      </div>

      <VirtualLog
        logs={logs}
        hasOlder={hasOlderEvents}
        isLoadingOlder={isLoadingOlder}
        onLoadOlder={loadOlderEvents}
      />
    </section>
  );
}

function eventsToLogs(events: Awaited<ReturnType<typeof listTaskEvents>>["events"]) {
  return events.map((event: PersistedTaskEvent) => ({
    id: `${event.taskId}-${event.sequence}`,
    source: event.source,
    text: event.text ?? event.textPreview ?? event.payloadPath ?? event.event,
  }));
}

function mergeLogWindows(olderLogs: TaskLogLine[], currentLogs: TaskLogLine[]) {
  const seen = new Set(olderLogs.map((log) => log.id));
  return [...olderLogs, ...currentLogs.filter((log) => !seen.has(log.id))];
}

function promptDraftKey(taskId?: string) {
  return `codex-jarvis:prompt-draft:${taskId ?? "new"}`;
}

function readPromptDraft(taskId?: string) {
  return localStorage.getItem(promptDraftKey(taskId)) ?? defaultPrompt;
}

function writePromptDraft(taskId: string | undefined, value: string) {
  if (value.trim()) {
    localStorage.setItem(promptDraftKey(taskId), value);
  } else {
    clearPromptDraft(taskId);
  }
}

function clearPromptDraft(taskId?: string) {
  localStorage.removeItem(promptDraftKey(taskId));
}

function buildProposalPrompt(message: string, canWriteDrafts: boolean, directExecute: boolean) {
  const proposalInstruction = directExecute
    ? "Direct execute is enabled for this turn. Execute safe, non-privileged commands when needed instead of only drafting a proposal. Keep all file writes inside the current session workspace unless the app explicitly allows more."
    : canWriteDrafts
      ? "The proposal is allowed to evolve over multiple messages. If the conversation reaches a concrete decision, update the current proposal automatically. Use files in the current session workspace for file drafts. For privileged or risky system operations, write a command plan instead of executing it."
      : "The proposal is allowed to evolve over multiple messages. If the conversation reaches a concrete decision, update the command plan in your response. Do not write files.";

  return `${proposalInstruction}\n\nUser message:\n${message}`;
}

function buildConversationPrompt(message: string, logs: TaskLogLine[], isContinuation: boolean) {
  if (!isContinuation || !logs.length) return message;

  const transcript = logs
    .filter((log) => log.source === "user" || log.source === "assistant" || log.source === "stdout")
    .slice(-40)
    .map((log) => `[${log.source}] ${log.text}`)
    .join("\n");

  return `Continue this Codex Jarvis conversation using the recent transcript as context.\n\nRecent transcript:\n${transcript}\n\nUser message:\n${message}`;
}

function logSource(event: TaskEvent["event"]): TaskLogLine["source"] {
  if (event === "user_message") return "user";
  if (event === "context_collected") return "context";
  if (event === "stdout") return "assistant";
  if (event === "stderr" || event === "task_failed") return "stderr";
  return "system";
}
