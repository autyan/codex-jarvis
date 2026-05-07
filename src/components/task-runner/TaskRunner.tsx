import { listen } from "@tauri-apps/api/event";
import { useQuery } from "@tanstack/react-query";
import { Ban, CheckCircle2, ChevronDown, ChevronRight, FileDiff, Gauge, Info, ScrollText, Send, ShieldAlert, TerminalSquare } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cancelTask, getTaskProposal, listChangedFiles, listTaskEvents, startDiagnoseTask, startPatchTask } from "../../api/tasks";
import type { AppSettings } from "../../types/codex";
import type { TaskProfile } from "../../types/profile";
import type { PersistedTaskEvent, SudoRequest, TaskEvent, TaskLogLine, TaskStatus } from "../../types/task";
import { VirtualLog } from "./VirtualLog";

type TaskRunnerProps = {
  profile: TaskProfile;
  selectedTaskId?: string;
  selectedTaskTitle?: string;
  settings?: AppSettings;
  onTaskStarted: (taskId: string) => void;
  onOpenReview: () => void;
  onSudoRequest: (request: SudoRequest) => void;
  attachedContext?: string;
  onClearAttachedContext: () => void;
};

const defaultPrompt = "";
const eventWindowSize = 120;
type ToolTab = "proposal" | "changes" | "context" | "token" | "execution";

export function TaskRunner({
  profile,
  selectedTaskId,
  selectedTaskTitle,
  settings,
  onTaskStarted,
  onOpenReview,
  onSudoRequest,
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
  const [activeTool, setActiveTool] = useState<ToolTab>("proposal");
  const [contextSnapshots, setContextSnapshots] = useState<ContextSnapshot[]>([]);
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
  const { data: proposalState, refetch: refetchProposal } = useQuery({
    queryKey: ["task-proposal", taskId],
    queryFn: () => (taskId ? getTaskProposal(taskId) : null),
    enabled: Boolean(taskId),
    refetchInterval: isActive ? 2000 : false,
  });
  const canApplyProposal = Boolean(proposalState?.content) && !isActive;
  const displayTitle = taskId ? (selectedTaskTitle ?? "Conversation") : "New Conversation";
  const hasOlderEvents = eventOffset > 0;
  const toolLogs = useMemo(() => logs.filter((log) => log.source !== "user" && log.source !== "assistant"), [logs]);
  const chatLogs = useMemo(() => logs.filter((log) => log.source === "user" || log.source === "assistant"), [logs]);
  const tokenEstimate = useMemo(() => estimateTokenUsage(chatLogs, attachedContext), [attachedContext, chatLogs]);
  const sessionTokenEstimate = useMemo(() => estimateSessionTokens(chatLogs, contextSnapshots), [chatLogs, contextSnapshots]);
  const executionItems = useMemo(() => buildExecutionTimeline(toolLogs), [toolLogs]);

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
      if (payload.event === "proposal_updated") {
        void refetchProposal();
      }
      if (payload.event === "sudo_request" && payload.text) {
        try {
          onSudoRequest(JSON.parse(payload.text) as SudoRequest);
        } catch {
          // Keep malformed sudo requests in the normal log; the backend also stores the raw event.
        }
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
  }, [onSudoRequest, refetchChangedFiles, refetchProposal]);

  useEffect(() => {
    if (!selectedTaskId) {
      activeTaskIdRef.current = undefined;
      setTaskId(undefined);
      setStatus("idle");
      setLogs([]);
      setEventOffset(0);
      setContextSnapshots([]);
      setPrompt(readPromptDraft(undefined));
      return;
    }
    setPrompt(readPromptDraft(selectedTaskId));
    setContextSnapshots([]);
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
      const nextContextSnapshot = buildContextSnapshot({
        attachedContext,
        chatLogs,
        message,
        model: settings?.codexModel,
        effort: settings?.codexReasoningEffort ?? "medium",
      });
      setContextSnapshots((current) => [...current.slice(-20), nextContextSnapshot]);
      const request = {
        taskId: nextTaskId,
        profileId: profile.id,
        prompt: buildProposalPrompt(message, profile.writeEnabled, directExecute),
        userMessage: prompt,
        attachedContext,
        directExecute,
        codexModel: settings?.codexModel,
        codexReasoningEffort: settings?.codexReasoningEffort ?? "medium",
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
    <section className="workspace-panel task-runner chat-workspace">
      <div className="chat-main">
        <div className="section-heading">
          <div>
            <h2>{displayTitle}</h2>
            <span>{taskId ?? `${profile.name} profile`}</span>
          </div>
          <div className="task-status-group">
            {isActive ? <WorkingTicker status={status} /> : null}
            <div className={`task-status status-${status}`}>{statusLabel}</div>
          </div>
        </div>

        <VirtualLog
          logs={logs}
          hasOlder={hasOlderEvents}
          isLoadingOlder={isLoadingOlder}
          onLoadOlder={loadOlderEvents}
        />

        <div className="composer-panel">
          {attachedContext ? (
            <div className="attached-context">
              <strong>Attached terminal output</strong>
              <span>{attachedContext.slice(0, 180)}</span>
              <button onClick={onClearAttachedContext}>Clear</button>
            </div>
          ) : null}

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

          <div className="composer-actions">
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
            <div className="button-row">
              <button className="secondary-action" onClick={handleCancel} disabled={!canCancel}>
                <Ban size={16} />
                Cancel
              </button>
              <button className="primary action-with-icon" onClick={handleStart} disabled={!canRun}>
                <Send size={16} />
                Send
              </button>
            </div>
          </div>
        </div>
      </div>

      <TaskSideTools
        activeTool={activeTool}
        onSelectTool={setActiveTool}
        canApplyProposal={canApplyProposal}
        changedFiles={changedFiles ?? []}
        directExecute={directExecute}
        isActive={isActive}
        onOpenReview={onOpenReview}
        profile={profile}
        settings={settings}
        statusLabel={statusLabel}
        taskId={taskId}
        toolLogs={toolLogs}
        executionItems={executionItems}
        tokenEstimate={tokenEstimate}
        sessionTokenEstimate={sessionTokenEstimate}
        attachedContext={attachedContext}
        proposal={proposalState?.content}
        contextSnapshots={contextSnapshots}
      />
    </section>
  );
}

function WorkingTicker({ status }: { status: TaskStatus }) {
  const messages = useMemo(() => workingMessages(status), [status]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % messages.length);
    }, 1400);
    return () => window.clearInterval(timer);
  }, [messages]);

  return (
    <div className="working-ticker" aria-live="polite">
      <span>{messages[index]}</span>
    </div>
  );
}

function TaskSideTools({
  activeTool,
  onSelectTool,
  canApplyProposal,
  changedFiles,
  directExecute,
  isActive,
  onOpenReview,
  profile,
  settings,
  statusLabel,
  taskId,
  toolLogs,
  executionItems,
  tokenEstimate,
  sessionTokenEstimate,
  attachedContext,
  proposal,
  contextSnapshots,
}: {
  activeTool: ToolTab;
  onSelectTool: (tool: ToolTab) => void;
  canApplyProposal: boolean;
  changedFiles: Awaited<ReturnType<typeof listChangedFiles>>;
  directExecute: boolean;
  isActive: boolean;
  onOpenReview: () => void;
  profile: TaskProfile;
  settings?: AppSettings;
  statusLabel: string;
  taskId?: string;
  toolLogs: TaskLogLine[];
  executionItems: ExecutionTimelineItem[];
  tokenEstimate: { label: string; approximateTokens: number; chatMessages: number };
  sessionTokenEstimate: { label: string; approximateTokens: number };
  attachedContext?: string;
  proposal?: string;
  contextSnapshots: ContextSnapshot[];
}) {
  const latestContext = contextSnapshots.at(-1);
  return (
    <aside className="task-side-tools">
      <div className="inspector-title">
        <strong>Tools</strong>
        <span>{isActive ? "running" : "ready"}</span>
      </div>

      <InspectorSection
        active={activeTool === "proposal"}
        icon={<ScrollText size={15} />}
        title="Proposal"
        status={proposal ? "ready" : "none"}
        onToggle={() => onSelectTool(activeTool === "proposal" ? "changes" : "proposal")}
      >
        {proposal ? <pre className="proposal-preview">{proposal}</pre> : <p>Decision draft evolves in chat. Apply only when it is ready.</p>}
        <dl className="compact-dl">
          <div>
            <dt>Status</dt>
            <dd>{proposal ? "Reviewable" : "No proposal"}</dd>
          </div>
          <div>
            <dt>Execution</dt>
            <dd>{directExecute ? "Direct" : "Apply required"}</dd>
          </div>
        </dl>
        <div className="tool-action-row">
          <button className="tool-primary-action" onClick={onOpenReview} disabled={!canApplyProposal || isActive}>
            <CheckCircle2 size={14} />
            Review / Apply
          </button>
        </div>
      </InspectorSection>

      <InspectorSection
        active={activeTool === "changes"}
        icon={<FileDiff size={15} />}
        title="Changes"
        status={`${changedFiles.length} files`}
        onToggle={() => onSelectTool(activeTool === "changes" ? "proposal" : "changes")}
      >
        <dl className="compact-dl">
          <div>
            <dt>Snapshot</dt>
            <dd>{changedFiles.length ? "captured" : "pending"}</dd>
          </div>
          <div>
            <dt>Rollback</dt>
            <dd>{changedFiles.length ? "available" : "none"}</dd>
          </div>
        </dl>
        <div className="tool-list">
          {changedFiles.slice(0, 8).map((file) => (
            <span key={file.path}>{file.status}: {file.path}</span>
          ))}
          {!changedFiles.length ? <span>No changed files.</span> : null}
        </div>
      </InspectorSection>

      <InspectorSection
        active={activeTool === "execution"}
        icon={<TerminalSquare size={15} />}
        title="Execution"
        status={statusLabel}
        onToggle={() => onSelectTool(activeTool === "execution" ? "proposal" : "execution")}
      >
        <dl className="compact-dl">
          <div>
            <dt>Tool events</dt>
            <dd>{toolLogs.length}</dd>
          </div>
          <div>
            <dt>Sudo</dt>
            <dd>controlled flow</dd>
          </div>
        </dl>
        <div className="execution-timeline">
          {executionItems.slice(-80).map((item) => (
            <article key={item.id} className={`timeline-item tone-${item.tone}`}>
              <div>
                <strong>{item.title}</strong>
                <span>{item.meta}</span>
              </div>
              {item.body ? <pre>{item.body}</pre> : null}
            </article>
          ))}
          {!executionItems.length ? <p>No tool events.</p> : null}
        </div>
      </InspectorSection>

      <InspectorSection
        active={activeTool === "context"}
        icon={<Info size={15} />}
        title="Context"
        status={attachedContext ? "terminal attached" : "chat only"}
        onToggle={() => onSelectTool(activeTool === "context" ? "proposal" : "context")}
      >
        <dl className="compact-dl">
          <div>
            <dt>Session</dt>
            <dd>{taskId ?? "New conversation"}</dd>
          </div>
          <div>
            <dt>Profile</dt>
            <dd>{profile.name}</dd>
          </div>
          <div>
            <dt>Chat window</dt>
            <dd>Recent 24 messages</dd>
          </div>
          <div>
            <dt>Terminal</dt>
            <dd>{attachedContext ? "selection attached" : "none"}</dd>
          </div>
        </dl>
        {latestContext ? (
          <div className="context-snapshot">
            <strong>Last send</strong>
            <span>{latestContext.chatMessages} chat msgs · {latestContext.approximateTokens} tokens · {latestContext.attachedContext ? "terminal attached" : "no terminal"}</span>
            <pre>{latestContext.preview}</pre>
          </div>
        ) : (
          <p>No prompt has been sent in this window.</p>
        )}
        {attachedContext ? (
          <div className="context-snapshot">
            <strong>Terminal selection</strong>
            <span>{attachedContext.length} chars attached to the next send</span>
            <pre>{attachedContext}</pre>
          </div>
        ) : null}
      </InspectorSection>

      <InspectorSection
        active={activeTool === "token"}
        icon={<Gauge size={15} />}
        title="Token"
        status={tokenEstimate.label}
        onToggle={() => onSelectTool(activeTool === "token" ? "proposal" : "token")}
      >
        <dl className="compact-dl">
          <div>
            <dt>Approx</dt>
            <dd>{tokenEstimate.approximateTokens}</dd>
          </div>
          <div>
            <dt>Session</dt>
            <dd>{sessionTokenEstimate.label} · {sessionTokenEstimate.approximateTokens}</dd>
          </div>
          <div>
            <dt>Messages</dt>
            <dd>{tokenEstimate.chatMessages}</dd>
          </div>
          <div>
            <dt>Model</dt>
            <dd>{settings?.codexModel ?? "CLI default"}</dd>
          </div>
          <div>
            <dt>Effort</dt>
            <dd>{settings?.codexReasoningEffort ?? "medium"}</dd>
          </div>
        </dl>
      </InspectorSection>
    </aside>
  );
}

type ExecutionTimelineItem = {
  id: string;
  title: string;
  meta: string;
  body?: string;
  tone: "normal" | "danger" | "success" | "muted";
};

type ContextSnapshot = {
  approximateTokens: number;
  attachedContext: boolean;
  chatMessages: number;
  effort: string;
  model: string;
  preview: string;
  createdAt: number;
};

function InspectorSection({
  active,
  children,
  icon,
  onToggle,
  status,
  title,
}: {
  active: boolean;
  children: ReactNode;
  icon: ReactNode;
  onToggle: () => void;
  status: string;
  title: string;
}) {
  return (
    <section className={active ? "inspector-section open" : "inspector-section"}>
      <button className="inspector-section-header" onClick={onToggle}>
        <span className="inspector-section-title">
          {active ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {icon}
          <strong>{title}</strong>
        </span>
        <span className="inspector-section-status">{status}</span>
      </button>
      {active ? <div className="inspector-section-body">{children}</div> : null}
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

function workingMessages(status: TaskStatus) {
  if (status === "context_collected") {
    return ["Reading context", "Checking profile boundaries", "Preparing response"];
  }
  if (status === "snapshot_created") {
    return ["Capturing snapshot", "Watching proposal files", "Preparing diff"];
  }
  if (status === "starting") {
    return ["Starting Codex", "Opening session context", "Preparing tools"];
  }
  return ["Codex is working", "Inspecting workspace", "Updating side tools", "Streaming response"];
}

function estimateTokenUsage(chatLogs: TaskLogLine[], attachedContext?: string) {
  const textSize =
    chatLogs.slice(-24).reduce((total, log) => total + log.text.length, 0) + (attachedContext?.length ?? 0);
  const approximateTokens = Math.ceil(textSize / 4);
  const label = approximateTokens < 2500 ? "small" : approximateTokens < 8000 ? "medium" : "large";
  return {
    approximateTokens,
    chatMessages: chatLogs.length,
    label,
  };
}

function estimateSessionTokens(chatLogs: TaskLogLine[], snapshots: ContextSnapshot[]) {
  const chatTokens = Math.ceil(chatLogs.reduce((total, log) => total + log.text.length, 0) / 4);
  const promptTokens = snapshots.reduce((total, snapshot) => total + snapshot.approximateTokens, 0);
  const approximateTokens = chatTokens + promptTokens;
  const label = approximateTokens < 10000 ? "small" : approximateTokens < 40000 ? "medium" : "large";
  return { approximateTokens, label };
}

function buildContextSnapshot({
  attachedContext,
  chatLogs,
  effort,
  message,
  model,
}: {
  attachedContext?: string;
  chatLogs: TaskLogLine[];
  effort: string;
  message: string;
  model?: string;
}) {
  const textSize = message.length + (attachedContext?.length ?? 0);
  return {
    approximateTokens: Math.ceil(textSize / 4),
    attachedContext: Boolean(attachedContext),
    chatMessages: Math.min(chatLogs.length, 24),
    createdAt: Date.now(),
    effort,
    model: model ?? "CLI default",
    preview: compactTranscriptText(message),
  };
}

function buildExecutionTimeline(toolLogs: TaskLogLine[]): ExecutionTimelineItem[] {
  return toolLogs.map((log) => {
    const text = log.text.trim();
    if (log.source === "stderr") {
      return {
        id: log.id,
        title: "Error output",
        meta: "stderr",
        body: text,
        tone: "danger",
      };
    }
    if (log.source === "stdout" && text.startsWith("$ sudo ")) {
      return {
        id: log.id,
        title: "Privileged command",
        meta: "sudo",
        body: text,
        tone: "danger",
      };
    }
    if (log.source === "stdout") {
      return {
        id: log.id,
        title: "Command output",
        meta: "stdout",
        body: text,
        tone: "normal",
      };
    }
    if (log.source === "context") {
      return {
        id: log.id,
        title: "Context collected",
        meta: "Jarvis",
        body: summarizeTimelineText(text),
        tone: "muted",
      };
    }
    return {
      id: log.id,
      title: timelineSystemTitle(text),
      meta: log.source,
      body: text,
      tone: text.toLowerCase().includes("finished") || text.toLowerCase().includes("complete") ? "success" : "muted",
    };
  });
}

function timelineSystemTitle(text: string) {
  if (text.toLowerCase().includes("sudo")) return "Sudo decision";
  if (text.toLowerCase().includes("snapshot")) return "Snapshot";
  if (text.toLowerCase().includes("proposal")) return "Proposal";
  if (text.toLowerCase().includes("apply")) return "Apply";
  return "Jarvis event";
}

function summarizeTimelineText(text: string) {
  const limit = 420;
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n[truncated]`;
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
    .filter((log) => log.source === "user" || log.source === "assistant")
    .slice(-24)
    .map((log) => `[${log.source}] ${compactTranscriptText(log.text)}`)
    .join("\n");

  return `Continue this Codex Jarvis conversation using the recent transcript as context.\n\nRecent transcript:\n${transcript}\n\nUser message:\n${message}`;
}

function compactTranscriptText(text: string) {
  const limit = 3000;
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n[truncated]`;
}

function logSource(event: TaskEvent["event"]): TaskLogLine["source"] {
  if (event === "user_message") return "user";
  if (event === "context_collected") return "context";
  if (event === "stdout") return "assistant";
  if (event === "execution_output") return "stdout";
  if (event === "proposal_updated") return "system";
  if (event === "title_updated") return "system";
  if (event === "stderr" || event === "task_failed") return "stderr";
  return "system";
}
