import { AlertCircle, CheckCircle2, FileDiff, Pencil, Pin, PinOff, Settings, Terminal, Trash2, UserRound } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getCurrentWindow, type Window as TauriWindow } from "@tauri-apps/api/window";
import { lazy, Suspense, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { detectCodexCli, getAppSettings, setCodexModelSettings, setSudoFlowEnabled } from "./api/codex";
import { decideSudoRequest, deleteTask, listChangedFiles, listRecentTasks, renameTask } from "./api/tasks";
import { ReviewView } from "./components/review/ReviewView";
import { SettingsView } from "./components/settings/SettingsView";
import { SetupWizard } from "./components/setup/SetupWizard";
import { TaskRunner } from "./components/task-runner/TaskRunner";
import { linuxDomainLabels, profiles } from "./data/profiles";
import type { AppSettings, CodexReasoningEffort, CodexSetupStatus } from "./types/codex";
import type { TaskProfile } from "./types/profile";
import type { SudoRequest, TaskSummary } from "./types/task";

const TerminalView = lazy(() =>
  import("./components/terminal/TerminalView").then((module) => ({ default: module.TerminalView })),
);

export function App() {
  const queryClient = useQueryClient();
  const [activeProfileId, setActiveProfileId] = useState("daily-maintenance");
  const [activeTaskId, setActiveTaskId] = useState<string>();
  const [attachedTerminalOutput, setAttachedTerminalOutput] = useState<string>();
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalMounted, setTerminalMounted] = useState(false);
  const [terminalWidth, setTerminalWidth] = useState(360);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profilesOpen, setProfilesOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [pendingSudoRequest, setPendingSudoRequest] = useState<SudoRequest>();
  const [setupOpen, setSetupOpen] = useState(true);
  const [pinnedTaskIds, setPinnedTaskIds] = useState<string[]>([]);
  const codexQuery = useQuery({
    queryKey: ["codex-cli"],
    queryFn: detectCodexCli,
  });
  const recentTasksQuery = useQuery({
    queryKey: ["recent-tasks", "sidebar"],
    queryFn: () => listRecentTasks(30),
    refetchInterval: 5000,
  });
  const appSettingsQuery = useQuery({
    queryKey: ["app-settings"],
    queryFn: getAppSettings,
  });
  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0],
    [activeProfileId],
  );
  const setupStatus: CodexSetupStatus = codexQuery.isFetching
    ? "checking"
    : codexQuery.data?.found
      ? "ready"
      : codexQuery.data
        ? "missing"
        : "idle";
  const codexReady = setupStatus === "ready";
  const pinnedTasks = (recentTasksQuery.data ?? []).filter((task) => pinnedTaskIds.includes(task.taskId));
  const recentTasks = (recentTasksQuery.data ?? []).filter((task) => !pinnedTaskIds.includes(task.taskId));
  const allTasks = recentTasksQuery.data ?? [];
  const activeTask = allTasks.find((task) => task.taskId === activeTaskId);
  const activeChangedFilesQuery = useQuery({
    queryKey: ["changed-files", activeTaskId, "activity"],
    queryFn: () => (activeTaskId ? listChangedFiles(activeTaskId) : []),
    enabled: Boolean(activeTaskId),
    refetchInterval: activeTask?.latestStatus === "awaiting_review" ? 1500 : 5000,
  });
  const hasReviewableProposal = (activeChangedFilesQuery.data?.length ?? 0) > 0;

  useEffect(() => {
    function disableDefaultContextMenu(event: globalThis.MouseEvent) {
      event.preventDefault();
    }

    document.addEventListener("contextmenu", disableDefaultContextMenu, { capture: true });
    return () => document.removeEventListener("contextmenu", disableDefaultContextMenu, { capture: true });
  }, []);

  function togglePin(taskId: string) {
    setPinnedTaskIds((current) =>
      current.includes(taskId) ? current.filter((id) => id !== taskId) : [...current, taskId],
    );
  }

  async function handleDeleteTask(taskId: string) {
    const deletingActiveTask = activeTaskId === taskId;
    await deleteTask(taskId);
    setPinnedTaskIds((current) => current.filter((id) => id !== taskId));
    setActiveTaskId((current) => (current === taskId ? undefined : current));
    queryClient.removeQueries({ queryKey: ["task-events", taskId] });
    if (deletingActiveTask) {
      setAttachedTerminalOutput(undefined);
    }
    void recentTasksQuery.refetch();
  }

  async function handleRenameTask(task: TaskSummary) {
    const nextTitle = window.prompt("Rename session", task.title ?? task.taskId);
    if (nextTitle === null) return;
    const trimmedTitle = nextTitle.trim();
    if (!trimmedTitle) return;
    await renameTask(task.taskId, trimmedTitle);
    await recentTasksQuery.refetch();
  }

  async function handleSetSudoFlow(enabled: boolean) {
    queryClient.setQueryData<AppSettings>(["app-settings"], (current) =>
      current ? { ...current, sudoFlowEnabled: enabled } : { sudoFlowEnabled: enabled, codexReasoningEffort: "medium" },
    );
    try {
      const settings = await setSudoFlowEnabled(enabled);
      queryClient.setQueryData(["app-settings"], settings);
    } catch {
      void appSettingsQuery.refetch();
    }
  }

  async function handleSetCodexModel(codexModel: string | undefined, codexReasoningEffort: CodexReasoningEffort) {
    queryClient.setQueryData<AppSettings>(["app-settings"], (current) => ({
      codexCliPath: current?.codexCliPath,
      sudoFlowEnabled: current?.sudoFlowEnabled ?? false,
      codexModel,
      codexReasoningEffort,
    }));
    try {
      const settings = await setCodexModelSettings({ codexModel, codexReasoningEffort });
      queryClient.setQueryData(["app-settings"], settings);
    } catch {
      void appSettingsQuery.refetch();
    }
  }

  async function handleSudoDecision(allow: boolean, password?: string) {
    if (!pendingSudoRequest) return;
    const request = pendingSudoRequest;
    setPendingSudoRequest(undefined);
    await decideSudoRequest(request.taskId, request.requestId, allow, password);
    void recentTasksQuery.refetch();
  }

  function startTerminalResize(event: MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = terminalWidth;

    function handleMove(moveEvent: globalThis.MouseEvent) {
      const maxWidth = Math.max(220, window.innerWidth - 220 - 200);
      const nextWidth = startWidth - (moveEvent.clientX - startX);
      setTerminalWidth(Math.min(maxWidth, Math.max(220, nextWidth)));
    }

    function handleUp() {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    }

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }

  function startWindowDrag(event: MouseEvent<HTMLElement>) {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button")) return;
    void getCurrentWindow().startDragging();
  }

  function toggleWindowMaximize() {
    void getCurrentWindow().toggleMaximize();
  }

  return (
    <div
      className={terminalOpen ? "app-shell terminal-open" : "app-shell"}
      style={terminalOpen ? { gridTemplateColumns: `220px minmax(200px, 1fr) ${terminalWidth}px` } : undefined}
    >
      <header className="top-bar" onMouseDown={startWindowDrag} onDoubleClick={toggleWindowMaximize}>
        <div className="title-drag-region">
          <h1>Codex Jarvis</h1>
        </div>
        <div className="top-status">
          <button className="status-pill" onClick={() => !codexReady && setSetupOpen(true)}>
            {codexReady ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            {codexReady ? "Codex ready" : "Setup required"}
          </button>
          <button className="icon-button" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
            <Settings size={18} />
          </button>
          <WindowControls />
        </div>
      </header>

      <aside className="sidebar sessions-sidebar">
        <div className="sidebar-heading">
          <h2>Sessions</h2>
          <button className="mini-button" onClick={() => setActiveTaskId(undefined)}>New</button>
        </div>
        <SessionGroup
          title="Pinned"
          tasks={pinnedTasks}
          activeTaskId={activeTaskId}
          pinnedTaskIds={pinnedTaskIds}
          onSelect={setActiveTaskId}
          onTogglePin={togglePin}
          onDelete={handleDeleteTask}
          onRename={handleRenameTask}
          emptyLabel="No pinned sessions"
        />
        <SessionGroup
          title="Recent"
          tasks={recentTasks}
          activeTaskId={activeTaskId}
          pinnedTaskIds={pinnedTaskIds}
          onSelect={setActiveTaskId}
          onTogglePin={togglePin}
          onDelete={handleDeleteTask}
          onRename={handleRenameTask}
          emptyLabel="No sessions yet"
        />
      </aside>

      <main className="workspace">
        {codexReady ? (
          <TaskRunner
            profile={activeProfile}
            selectedTaskId={activeTaskId}
            selectedTaskTitle={activeTask?.title}
            settings={appSettingsQuery.data}
            onTaskStarted={(taskId) => setActiveTaskId(taskId)}
            onOpenReview={() => setReviewOpen(true)}
            onSudoRequest={setPendingSudoRequest}
            attachedContext={attachedTerminalOutput}
            onClearAttachedContext={() => setAttachedTerminalOutput(undefined)}
          />
        ) : (
          <section className="workspace-panel unavailable-panel">
            <AlertCircle size={22} />
            <h2>Codex Jarvis is not ready</h2>
            <p>Configure a usable Codex CLI path before starting tasks.</p>
            <button className="primary" onClick={() => setSetupOpen(true)}>Open setup</button>
          </section>
        )}
      </main>

      <aside className={terminalOpen ? "terminal-dock open" : "terminal-dock"}>
        {terminalMounted ? (
          <div className={terminalOpen ? "terminal-session active" : "terminal-session hidden"}>
            <div className="terminal-resizer" onMouseDown={startTerminalResize} />
            <Suspense fallback={<section className="workspace-panel">Loading terminal...</section>}>
              <TerminalView active={terminalOpen} profile={activeProfile} onAttachOutput={setAttachedTerminalOutput} />
            </Suspense>
          </div>
        ) : null}
        {!terminalOpen ? (
          <button
            className="terminal-rail"
            onClick={() => {
              setTerminalMounted(true);
              setTerminalOpen(true);
            }}
            aria-label="Open terminal"
          >
            <Terminal size={18} />
          </button>
        ) : null}
      </aside>

      <footer className="bottom-activity">
        <button onClick={() => setProfilesOpen(true)}>
          <UserRound size={16} />
          Profile: {activeProfile.name}
        </button>
        <button onClick={() => hasReviewableProposal && setReviewOpen(true)} disabled={!hasReviewableProposal}>
          <FileDiff size={16} />
          Review
        </button>
        <button
          className={terminalOpen ? "active" : ""}
          onClick={() => {
            setTerminalMounted(true);
            setTerminalOpen((open) => !open);
          }}
        >
          <Terminal size={16} />
          Terminal
        </button>
        <button onClick={() => setSettingsOpen(true)}>
          <Settings size={16} />
          Settings
        </button>
      </footer>

      {!codexReady && setupOpen ? (
        <Modal title="Setup Codex Jarvis" onClose={() => setSetupOpen(false)}>
          <SetupWizard info={codexQuery.data} status={setupStatus} onDetect={() => void codexQuery.refetch()} />
        </Modal>
      ) : null}

      {settingsOpen ? (
        <Modal title="Settings" onClose={() => setSettingsOpen(false)}>
          <SettingsView
            codexInfo={codexQuery.data}
            profile={activeProfile}
            settings={appSettingsQuery.data}
            onSetSudoFlow={handleSetSudoFlow}
            onSetCodexModel={handleSetCodexModel}
          />
        </Modal>
      ) : null}

      {profilesOpen ? (
        <Modal title="Profiles" onClose={() => setProfilesOpen(false)}>
          <ProfilePicker activeProfile={activeProfile} onSelect={setActiveProfileId} />
        </Modal>
      ) : null}

      {reviewOpen ? (
        <Modal title="Review" onClose={() => setReviewOpen(false)}>
          <ReviewView taskId={activeTaskId} sessionName={activeTask?.title} onClose={() => setReviewOpen(false)} />
        </Modal>
      ) : null}

      {pendingSudoRequest ? (
        <Modal title="Sudo Authorization" onClose={() => setPendingSudoRequest(undefined)}>
          <SudoAuthorizationDialog
            request={pendingSudoRequest}
            onDeny={() => void handleSudoDecision(false)}
            onAllow={(password) => void handleSudoDecision(true, password)}
          />
        </Modal>
      ) : null}
    </div>
  );
}

function SudoAuthorizationDialog({
  request,
  onDeny,
  onAllow,
}: {
  request: SudoRequest;
  onDeny: () => void;
  onAllow: (password?: string) => void;
}) {
  const [password, setPassword] = useState("");

  return (
    <section className="sudo-dialog">
      <div className="review-banner">
        <strong>Codex requests sudo</strong>
        <span>Approve only if these commands match the reviewed proposal.</span>
      </div>
      <dl>
        <div>
          <dt>Reason</dt>
          <dd>{request.reason}</dd>
        </div>
        <div>
          <dt>Domain</dt>
          <dd>{request.domain}</dd>
        </div>
        <div>
          <dt>Risk</dt>
          <dd>{request.risk}</dd>
        </div>
      </dl>
      <div className="sudo-command-list">
        {request.commands.map((command) => (
          <code key={command}>sudo {command}</code>
        ))}
      </div>
      <label className="sudo-password-field">
        <span>Sudo password</span>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoFocus
          autoComplete="current-password"
          placeholder="Leave empty to use an existing sudo timestamp"
        />
      </label>
      <p className="sudo-password-note">
        The password is sent only for this approval attempt and is not stored in settings, logs, or audit records.
      </p>
      <div className="button-row">
        <button className="secondary-action danger-action" onClick={onDeny}>Deny</button>
        <button className="primary" onClick={() => onAllow(password.trim() ? password : undefined)}>Allow once</button>
      </div>
    </section>
  );
}

function WindowControls() {
  const appWindow: TauriWindow = getCurrentWindow();

  return (
    <div className="window-controls">
      <button aria-label="Minimize" onMouseDown={(event) => event.stopPropagation()} onClick={() => void appWindow.minimize()}>−</button>
      <button aria-label="Maximize" onMouseDown={(event) => event.stopPropagation()} onClick={() => void appWindow.toggleMaximize()}>□</button>
      <button aria-label="Close" onMouseDown={(event) => event.stopPropagation()} onClick={() => void appWindow.close()}>×</button>
    </div>
  );
}

function SessionGroup({
  title,
  tasks,
  activeTaskId,
  pinnedTaskIds,
  onSelect,
  onTogglePin,
  onDelete,
  onRename,
  emptyLabel,
}: {
  title: string;
  tasks: TaskSummary[];
  activeTaskId?: string;
  pinnedTaskIds: string[];
  onSelect: (taskId: string) => void;
  onTogglePin: (taskId: string) => void;
  onDelete: (taskId: string) => void;
  onRename: (task: TaskSummary) => void;
  emptyLabel: string;
}) {
  return (
    <section>
      <h2>{title}</h2>
      <nav className="nav-list compact">
        {tasks.map((task) => (
          <button
            key={task.taskId}
            className={task.taskId === activeTaskId ? "nav-item active session-item" : "nav-item session-item"}
            aria-current={task.taskId === activeTaskId ? "page" : undefined}
            onClick={() => onSelect(task.taskId)}
          >
            <span className="session-copy">
              <span>{task.title ?? task.taskId}</span>
              <small>{task.latestStatus ?? `${task.eventCount} events`}</small>
            </span>
            <span className="session-actions">
              <span
                className="rename-control"
                role="button"
                tabIndex={0}
                title="Rename session"
                onClick={(event) => {
                  event.stopPropagation();
                  onRename(task);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    onRename(task);
                  }
                }}
              >
                <Pencil size={14} />
              </span>
              <span
                className="pin-control"
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation();
                  onTogglePin(task.taskId);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    onTogglePin(task.taskId);
                  }
                }}
              >
                {pinnedTaskIds.includes(task.taskId) ? <PinOff size={14} /> : <Pin size={14} />}
              </span>
              <span
                className="delete-control"
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(task.taskId);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    onDelete(task.taskId);
                  }
                }}
              >
                <Trash2 size={14} />
              </span>
            </span>
          </button>
        ))}
        {!tasks.length ? <button className="nav-item muted">{emptyLabel}</button> : null}
      </nav>
    </section>
  );
}

function ProfilePicker({
  activeProfile,
  onSelect,
}: {
  activeProfile: TaskProfile;
  onSelect: (profileId: string) => void;
}) {
  return (
    <div className="profile-picker">
      {profiles.map((profile) => (
        <button
          key={profile.id}
          className={profile.id === activeProfile.id ? "profile-option active" : "profile-option"}
          onClick={() => onSelect(profile.id)}
        >
          <strong>{profile.name}</strong>
          <span>{profile.description}</span>
          <small>{profile.writeEnabled ? "Proposal drafts enabled" : "Read-only proposals"}</small>
          <small>
            Linux · {profile.domains.map((domain) => linuxDomainLabels[domain.domainId]).join(", ")}
          </small>
        </button>
      ))}
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <section className="modal-panel">
        <header className="modal-header">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close">×</button>
        </header>
        {children}
      </section>
    </div>
  );
}
