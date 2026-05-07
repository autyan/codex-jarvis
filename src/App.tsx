import { AlertCircle, CheckCircle2, FileDiff, Pin, PinOff, Settings, Terminal, UserRound } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useMemo, useState, type ReactNode } from "react";
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

  return (
    <div className={terminalOpen ? "app-shell terminal-open" : "app-shell"}>
      <header className="top-bar">
        <div>
          <p className="eyebrow">Codex Jarvis</p>
          <h1>Task Workspace</h1>
        </div>
        <div className="top-status">
          <button className="status-pill" onClick={() => !codexReady && setSetupOpen(true)}>
            {codexReady ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            {codexReady ? "Codex ready" : "Setup required"}
          </button>
          <button className="icon-button" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
            <Settings size={18} />
          </button>
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
            onOpenTerminal={() => setTerminalOpen(true)}
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
        {terminalOpen ? (
          <Suspense fallback={<section className="workspace-panel">Loading terminal...</section>}>
            <TerminalView profile={activeProfile} onAttachOutput={setAttachedTerminalOutput} />
          </Suspense>
        ) : (
          <button className="terminal-rail" onClick={() => setTerminalOpen(true)} aria-label="Open terminal">
            <Terminal size={18} />
          </button>
        )}
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
        <button className={terminalOpen ? "active" : ""} onClick={() => setTerminalOpen((open) => !open)}>
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
