import { AlertCircle, CheckCircle2, FileDiff, Pin, PinOff, Settings, Terminal, UserRound } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getCurrentWindow, type Window as TauriWindow } from "@tauri-apps/api/window";
import { lazy, Suspense, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { detectCodexCli } from "./api/codex";
import { listRecentTasks } from "./api/tasks";
import { ReviewView } from "./components/review/ReviewView";
import { SettingsView } from "./components/settings/SettingsView";
import { SetupWizard } from "./components/setup/SetupWizard";
import { TaskRunner } from "./components/task-runner/TaskRunner";
import { profiles } from "./data/profiles";
import type { CodexSetupStatus } from "./types/codex";
import { formatTaskMode, type TaskProfile } from "./types/profile";
import type { TaskSummary } from "./types/task";

const TerminalView = lazy(() =>
  import("./components/terminal/TerminalView").then((module) => ({ default: module.TerminalView })),
);

export function App() {
  const [activeProfileId, setActiveProfileId] = useState("shell");
  const [activeTaskId, setActiveTaskId] = useState<string>();
  const [attachedTerminalOutput, setAttachedTerminalOutput] = useState<string>();
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalMounted, setTerminalMounted] = useState(false);
  const [terminalWidth, setTerminalWidth] = useState(360);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profilesOpen, setProfilesOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
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

  function togglePin(taskId: string) {
    setPinnedTaskIds((current) =>
      current.includes(taskId) ? current.filter((id) => id !== taskId) : [...current, taskId],
    );
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
          emptyLabel="No pinned sessions"
        />
        <SessionGroup
          title="Recent"
          tasks={recentTasks}
          activeTaskId={activeTaskId}
          pinnedTaskIds={pinnedTaskIds}
          onSelect={setActiveTaskId}
          onTogglePin={togglePin}
          emptyLabel="No sessions yet"
        />
      </aside>

      <main className="workspace">
        {codexReady ? (
          <TaskRunner
            profile={activeProfile}
            selectedTaskId={activeTaskId}
            onTaskStarted={(taskId) => setActiveTaskId(taskId)}
            onOpenTerminal={() => {
              setTerminalMounted(true);
              setTerminalOpen(true);
            }}
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
        <button onClick={() => setReviewOpen(true)}>
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
          <SettingsView codexInfo={codexQuery.data} profile={activeProfile} />
        </Modal>
      ) : null}

      {profilesOpen ? (
        <Modal title="Profiles" onClose={() => setProfilesOpen(false)}>
          <ProfilePicker activeProfile={activeProfile} onSelect={setActiveProfileId} />
        </Modal>
      ) : null}

      {reviewOpen ? (
        <Modal title="Review" onClose={() => setReviewOpen(false)}>
          <ReviewView taskId={activeTaskId} />
        </Modal>
      ) : null}
    </div>
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
  emptyLabel,
}: {
  title: string;
  tasks: TaskSummary[];
  activeTaskId?: string;
  pinnedTaskIds: string[];
  onSelect: (taskId: string) => void;
  onTogglePin: (taskId: string) => void;
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
            onClick={() => onSelect(task.taskId)}
          >
            <span>{task.taskId}</span>
            <small>{task.latestStatus ?? `${task.eventCount} events`}</small>
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
          <small>{formatTaskMode(profile.defaultMode)} · {profile.writeEnabled ? "writes enabled" : "read only"}</small>
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
