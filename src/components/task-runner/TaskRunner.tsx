import { listen } from "@tauri-apps/api/event";
import { useQuery } from "@tanstack/react-query";
import { Ban, CheckCircle2, ChevronDown, ChevronRight, FileDiff, Gauge, Info, ScrollText, Send, ShieldAlert, TerminalSquare } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { cancelTask, getConversationWindow, getTaskProposal, listChangedFiles, listTaskEvents, startDiagnoseTask, startPatchTask } from "../../api/tasks";
import type { AppSettings } from "../../types/codex";
import type { TaskProfile } from "../../types/profile";
import type { ConversationMessage, PersistedTaskEvent, SudoRequest, TaskEvent, TaskLogLine, TaskStatus } from "../../types/task";
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
const initialEventPageSize = 160;
const maxCachedSessionWindows = 8;
type ToolTab = "proposal" | "changes" | "context" | "token" | "execution";
type SessionViewCache = {
  beforeCursor?: number;
  contextSnapshots: ContextSnapshot[];
  hasOlder: boolean;
  logs: TaskLogLine[];
  messages: ConversationMessage[];
  status: TaskStatus;
};

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
  const [conversationMessages, setConversationMessages] = useState<ConversationMessage[]>([]);
  const [beforeCursor, setBeforeCursor] = useState<number>();
  const [hasOlderConversation, setHasOlderConversation] = useState(false);
  const [directExecute, setDirectExecute] = useState(false);
  const [eventOffset, setEventOffset] = useState(0);
  const [isInitialLoading, setIsInitialLoading] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [sessionOpenVersion, setSessionOpenVersion] = useState(0);
  const [activeTool, setActiveTool] = useState<ToolTab>("proposal");
  const [contextSnapshots, setContextSnapshots] = useState<ContextSnapshot[]>([]);
  const [composerMenu, setComposerMenu] = useState<{ x: number; y: number }>();
  const activeTaskIdRef = useRef<string | undefined>(undefined);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const sessionCacheRef = useRef<Map<string, SessionViewCache>>(new Map());
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
  const toolLogs = useMemo(() => logs.filter((log) => log.source !== "user" && log.source !== "assistant"), [logs]);
  const chatLogs = useMemo(() => conversationMessagesToLogs(conversationMessages), [conversationMessages]);
  const tokenEstimate = useMemo(() => estimateTokenUsage(chatLogs, attachedContext), [attachedContext, chatLogs]);
  const sessionTokenEstimate = useMemo(() => estimateSessionTokens(chatLogs, contextSnapshots), [chatLogs, contextSnapshots]);
  const executionItems = useMemo(() => buildExecutionTimeline(toolLogs), [toolLogs]);

  const loadLatestEvents = useCallback(async (nextTaskId: string, options?: { background?: boolean }) => {
    try {
      const firstPage = await listTaskEvents(nextTaskId, 0, 1);
      const offset = Math.max(0, firstPage.total - initialEventPageSize);
      const page = await listTaskEvents(nextTaskId, offset, initialEventPageSize);
      const conversation = await getConversationWindow(nextTaskId, undefined, 12, 20_000);

      if (activeTaskIdRef.current !== nextTaskId) return;

      const nextLogs = eventsToLogs(page.events);
      const nextStatus = [...page.events].reverse().find((event) => event.status)?.status ?? "idle";
      const cached = sessionCacheRef.current.get(nextTaskId);
      const mergedLogs = options?.background && cached ? mergeLogWindows(nextLogs, cached.logs) : nextLogs;
      const mergedMessages = options?.background && cached
        ? mergeConversationMessages(conversation.messages, cached.messages)
        : conversation.messages;
      rememberSessionViewCache(sessionCacheRef.current, nextTaskId, {
        beforeCursor: conversation.beforeCursor,
        contextSnapshots: cached?.contextSnapshots ?? [],
        hasOlder: conversation.hasOlder,
        logs: mergedLogs,
        messages: mergedMessages,
        status: nextStatus,
      });

      activeTaskIdRef.current = nextTaskId;
      setTaskId(nextTaskId);
      setEventOffset(offset);
      setBeforeCursor(conversation.beforeCursor);
      setHasOlderConversation(conversation.hasOlder);
      setStatus(nextStatus);
      setLogs(mergedLogs);
      setConversationMessages(mergedMessages);
    } finally {
      if (!options?.background && activeTaskIdRef.current === nextTaskId) {
        setIsInitialLoading(false);
      }
    }
  }, []);

  const loadOlderEvents = useCallback(async () => {
    if (!taskId || !hasOlderConversation || beforeCursor === undefined || isLoadingOlder) return;
    setIsLoadingOlder(true);
    try {
      const page = await getConversationWindow(taskId, beforeCursor, 18, 30_000);
      setBeforeCursor(page.beforeCursor);
      setHasOlderConversation(page.hasOlder);
      setConversationMessages((currentMessages) => mergeConversationMessages(page.messages, currentMessages));
    } finally {
      setIsLoadingOlder(false);
    }
  }, [beforeCursor, hasOlderConversation, isLoadingOlder, taskId]);

  useEffect(() => {
    let isMounted = true;
    let removeListener: (() => void) | undefined;

    listen<TaskEvent>("task://event", (event) => {
      const payload = event.payload;
      const cached = sessionCacheRef.current.get(payload.taskId);
      if (cached) {
        rememberSessionViewCache(sessionCacheRef.current, payload.taskId, {
          ...cached,
          logs: payload.text ? appendEventLog(cached.logs, payload) : cached.logs,
          messages: payload.text ? appendConversationEvent(cached.messages, payload) : cached.messages,
          status: payload.status ?? cached.status,
        });
      }

      if (!isMounted || payload.taskId !== activeTaskIdRef.current) return;

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
        setLogs((currentLogs) => appendEventLog(currentLogs, payload));
        setConversationMessages((currentMessages) => appendConversationEvent(currentMessages, payload));
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
      setConversationMessages([]);
      setBeforeCursor(undefined);
      setHasOlderConversation(false);
      setEventOffset(0);
      setIsInitialLoading(false);
      setContextSnapshots([]);
      setPrompt(readPromptDraft(undefined));
      return;
    }
    activeTaskIdRef.current = selectedTaskId;
    setTaskId(selectedTaskId);
    setSessionOpenVersion((version) => version + 1);
    setPrompt(readPromptDraft(selectedTaskId));
    const cached = sessionCacheRef.current.get(selectedTaskId);
    if (cached) {
      rememberSessionViewCache(sessionCacheRef.current, selectedTaskId, cached);
      setStatus(cached.status);
      setLogs(cached.logs);
      setConversationMessages(cached.messages);
      setBeforeCursor(cached.beforeCursor);
      setHasOlderConversation(cached.hasOlder);
      setEventOffset(0);
      setContextSnapshots(cached.contextSnapshots);
      setIsInitialLoading(false);
      void loadLatestEvents(selectedTaskId, { background: true });
      return;
    }
    setStatus("idle");
    setLogs([]);
    setConversationMessages([]);
    setBeforeCursor(undefined);
    setHasOlderConversation(false);
    setEventOffset(0);
    setContextSnapshots([]);
    setIsInitialLoading(true);
    void loadLatestEvents(selectedTaskId);
  }, [loadLatestEvents, selectedTaskId]);

  useEffect(() => {
    if (!taskId) return;
    rememberSessionViewCache(sessionCacheRef.current, taskId, {
      beforeCursor,
      contextSnapshots,
      hasOlder: hasOlderConversation,
      logs,
      messages: conversationMessages,
      status,
    });
  }, [beforeCursor, contextSnapshots, conversationMessages, hasOlderConversation, logs, status, taskId]);

  useEffect(() => {
    if (!composerMenu) return;

    function closeMenu() {
      setComposerMenu(undefined);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeMenu();
    }

    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [composerMenu]);

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
    setConversationMessages((currentMessages) => [
      ...currentMessages,
      {
        id: `local-user-${Date.now()}`,
        role: "user" as const,
        text: prompt,
        startSequence: Number.MAX_SAFE_INTEGER,
        endSequence: Number.MAX_SAFE_INTEGER,
      },
    ]);

    try {
      const message = buildConversationPrompt(prompt, chatLogs, Boolean(taskId));
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
        prompt: message,
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

  function openComposerMenu(event: MouseEvent<HTMLTextAreaElement>) {
    event.preventDefault();
    event.stopPropagation();
    promptRef.current = event.currentTarget;
    setComposerMenu({ x: event.clientX, y: event.clientY });
  }

  async function copyPromptSelection() {
    const textarea = promptRef.current;
    if (!textarea) return;
    const selection = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
    if (selection) await writeClipboardText(selection);
    textarea.focus();
    setComposerMenu(undefined);
  }

  async function pasteIntoPrompt() {
    const textarea = promptRef.current;
    if (!textarea) return;
    const text = await readClipboardText();
    if (!text) {
      textarea.focus();
      setComposerMenu(undefined);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const nextPrompt = `${prompt.slice(0, start)}${text}${prompt.slice(end)}`;
    setPrompt(nextPrompt);
    writePromptDraft(taskId, nextPrompt);
    requestAnimationFrame(() => {
      const cursor = start + text.length;
      textarea.focus();
      textarea.setSelectionRange(cursor, cursor);
    });
    setComposerMenu(undefined);
  }

  const hasPromptSelection = Boolean(
    promptRef.current && promptRef.current.selectionEnd > promptRef.current.selectionStart,
  );

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
          messages={conversationMessages}
          hasOlder={hasOlderConversation}
          isInitialLoading={isInitialLoading}
          isLoadingOlder={isLoadingOlder}
          onLoadOlder={loadOlderEvents}
          scrollToLatestKey={taskId ? `${taskId}:${sessionOpenVersion}` : undefined}
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
              ref={promptRef}
              placeholder="Ask Codex to inspect, explain, change, or continue this workspace..."
              value={prompt}
              onContextMenu={openComposerMenu}
              onChange={(event) => {
                const nextPrompt = event.target.value;
                setPrompt(nextPrompt);
                writePromptDraft(taskId, nextPrompt);
              }}
            />
          </label>
          {composerMenu ? (
            <div
              className="terminal-context-menu composer-context-menu"
              style={{ left: composerMenu.x, top: composerMenu.y }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <button onClick={() => void copyPromptSelection()} disabled={!hasPromptSelection}>
                Copy
              </button>
              <button onClick={() => void pasteIntoPrompt()}>
                Paste
              </button>
            </div>
          ) : null}

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

function appendEventLog(currentLogs: TaskLogLine[], payload: TaskEvent) {
  if (!payload.text) return currentLogs;
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
      text: payload.text,
    },
  ];
}

function appendConversationEvent(currentMessages: ConversationMessage[], payload: TaskEvent): ConversationMessage[] {
  if (!payload.text) return currentMessages;
  if (payload.event === "user_message") {
    if (currentMessages.some((message) => message.role === "user" && message.text === payload.text)) {
      return currentMessages;
    }
    return [
      ...currentMessages,
      {
        id: `live-user-${Date.now()}`,
        role: "user" as const,
        text: payload.text,
        startSequence: Number.MAX_SAFE_INTEGER,
        endSequence: Number.MAX_SAFE_INTEGER,
      },
    ];
  }
  if (payload.event !== "stdout") return currentMessages;

  const previous = currentMessages.at(-1);
  if (previous?.role === "assistant") {
    return [
      ...currentMessages.slice(0, -1),
      {
        ...previous,
        text: `${previous.text.trimEnd()}\n${payload.text.trimStart()}`.trim(),
      },
    ];
  }
  return [
    ...currentMessages,
    {
      id: `live-assistant-${Date.now()}`,
      role: "assistant" as const,
      text: payload.text,
      startSequence: Number.MAX_SAFE_INTEGER,
      endSequence: Number.MAX_SAFE_INTEGER,
    },
  ];
}

function conversationMessagesToLogs(messages: ConversationMessage[]) {
  return messages.map<TaskLogLine>((message) => ({
    id: message.id,
    source: message.role,
    text: message.text,
  }));
}

function mergeConversationMessages(olderMessages: ConversationMessage[], currentMessages: ConversationMessage[]) {
  const seen = new Set(olderMessages.map((message) => message.id));
  return [...olderMessages, ...currentMessages.filter((message) => !seen.has(message.id))];
}

function rememberSessionViewCache(cache: Map<string, SessionViewCache>, taskId: string, value: SessionViewCache) {
  cache.delete(taskId);
  cache.set(taskId, value);

  while (cache.size > maxCachedSessionWindows) {
    const oldestTaskId = cache.keys().next().value;
    if (!oldestTaskId) return;
    cache.delete(oldestTaskId);
  }
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

async function readClipboardText() {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return "";
  }
}

async function writeClipboardText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand("copy");
    document.body.removeChild(textArea);
  }
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
