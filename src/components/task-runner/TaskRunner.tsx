import { listen } from "@tauri-apps/api/event";
import { useQuery } from "@tanstack/react-query";
import { Ban, Plus, Send, Terminal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cancelTask, listTaskEvents, startDiagnoseTask, startPatchTask } from "../../api/tasks";
import type { TaskProfile } from "../../types/profile";
import type { TaskEvent, TaskLogLine, TaskMode, TaskStatus } from "../../types/task";
import { VirtualLog } from "./VirtualLog";

type TaskRunnerProps = {
  profile: TaskProfile;
  selectedTaskId?: string;
  onTaskStarted: (taskId: string) => void;
  onOpenTerminal: () => void;
  attachedContext?: string;
  onClearAttachedContext: () => void;
};

const defaultPrompt = "";

export function TaskRunner({
  profile,
  selectedTaskId,
  onTaskStarted,
  onOpenTerminal,
  attachedContext,
  onClearAttachedContext,
}: TaskRunnerProps) {
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [mode, setMode] = useState<TaskMode>("diagnose");
  const [taskId, setTaskId] = useState<string>();
  const [status, setStatus] = useState<TaskStatus>("idle");
  const [logs, setLogs] = useState<TaskLogLine[]>([]);
  const activeTaskIdRef = useRef<string | undefined>(undefined);
  const selectedEventsQuery = useQuery({
    queryKey: ["task-events", selectedTaskId, "workspace"],
    queryFn: async () => {
      if (!selectedTaskId) return undefined;
      const windowSize = 500;
      const firstPage = await listTaskEvents(selectedTaskId, 0, 1);
      return listTaskEvents(selectedTaskId, Math.max(0, firstPage.total - windowSize), windowSize);
    },
    enabled: Boolean(selectedTaskId) && selectedTaskId !== activeTaskIdRef.current,
  });
  const isActive = status === "starting" || status === "running" || status === "snapshot_created" || status === "context_collected";
  const canRun = prompt.trim().length > 0 && !isActive;
  const canCancel = Boolean(taskId) && isActive;

  useEffect(() => {
    let isMounted = true;
    let removeListener: (() => void) | undefined;

    listen<TaskEvent>("task://event", (event) => {
      if (!isMounted || event.payload.taskId !== activeTaskIdRef.current) return;

      const payload = event.payload;
      if (payload.status) setStatus(payload.status);

      if (payload.text) {
        setLogs((currentLogs) => [
          ...currentLogs.slice(-5000),
          {
            id: `${payload.event}-${currentLogs.length}-${Date.now()}`,
            source: logSource(payload.event),
            text: payload.text ?? "",
          },
        ]);
      }
    }).then((unsubscribe) => {
      removeListener = unsubscribe;
    });

    return () => {
      isMounted = false;
      removeListener?.();
    };
  }, []);

  useEffect(() => {
    const events = selectedEventsQuery.data?.events;
    if (!selectedTaskId) {
      activeTaskIdRef.current = undefined;
      setTaskId(undefined);
      setStatus("idle");
      setLogs([]);
      setPrompt(defaultPrompt);
      return;
    }
    if (!selectedTaskId || !events || selectedTaskId === activeTaskIdRef.current) return;

    activeTaskIdRef.current = selectedTaskId;
    setTaskId(selectedTaskId);
    setStatus([...events].reverse().find((event) => event.status)?.status ?? "idle");
    setLogs(
      events.map((event) => ({
        id: `${event.taskId}-${event.sequence}`,
        source: event.source,
        text: event.textPreview ?? event.payloadPath ?? event.event,
      })),
    );
  }, [selectedEventsQuery.data?.events, selectedTaskId]);

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
        prompt: message,
        attachedContext,
      };
      const response = mode === "patch" ? await startPatchTask(request) : await startDiagnoseTask(request);
      setTaskId(response.taskId);
      setStatus("running");
      setPrompt("");
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

  function resetTask() {
    activeTaskIdRef.current = undefined;
    setTaskId(undefined);
    setStatus("idle");
    setLogs([]);
  }

  return (
    <section className="workspace-panel task-runner">
      <div className="section-heading">
        <div>
          <h2>{taskId ? "Conversation" : "New Conversation"}</h2>
          <span>{taskId ?? `${profile.name} profile`}</span>
        </div>
        <div className={`task-status status-${status}`}>{statusLabel}</div>
      </div>

      <label className="prompt-box">
        <span>Message</span>
        <textarea
          placeholder="Ask Codex to inspect, explain, change, or continue this workspace..."
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
        />
      </label>

      <div className="mode-selector" aria-label="Execution mode">
        <button className={mode === "diagnose" ? "active" : ""} onClick={() => setMode("diagnose")}>
          Read-only
        </button>
        <button
          className={mode === "patch" ? "active" : ""}
          onClick={() => setMode("patch")}
          disabled={!profile.writeEnabled}
        >
          Patch
        </button>
      </div>

      {attachedContext ? (
        <div className="attached-context">
          <strong>Attached terminal output</strong>
          <span>{attachedContext.slice(0, 180)}</span>
          <button onClick={onClearAttachedContext}>Clear</button>
        </div>
      ) : null}

      <div className="button-row">
        <button className="secondary-action" onClick={onOpenTerminal}>
          <Terminal size={16} />
          Terminal
        </button>
        <button className="secondary-action" onClick={resetTask} disabled={isActive}>
          <Plus size={16} />
          New
        </button>
        <button className="secondary-action" onClick={handleCancel} disabled={!canCancel}>
          <Ban size={16} />
          Cancel
        </button>
        <button className="primary action-with-icon" onClick={handleStart} disabled={!canRun}>
          <Send size={16} />
          Send
        </button>
      </div>

      <VirtualLog logs={logs} />
    </section>
  );
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
  if (event === "context_collected") return "context";
  if (event === "stdout") return "assistant";
  if (event === "stderr" || event === "task_failed") return "stderr";
  return "system";
}
