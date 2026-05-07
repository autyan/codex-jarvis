import {
  AlertCircle,
  CheckCircle2,
  FileDiff,
  History,
  PanelRight,
  Settings,
  ShieldCheck,
  Sparkles,
  Terminal,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { detectCodexCli } from "./api/codex";
import { HistoryView } from "./components/history/HistoryView";
import { SetupWizard } from "./components/setup/SetupWizard";
import { TaskRunner } from "./components/task-runner/TaskRunner";
import { profiles } from "./data/profiles";
import type { CodexSetupStatus } from "./types/codex";
import { formatTaskMode, profilePathSummary, type PathPolicyGroup, type TaskProfile } from "./types/profile";
import type { WorkspaceTab } from "./types/workspace";

const tabs: Array<{ id: WorkspaceTab; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { id: "setup", label: "Setup", icon: Settings },
  { id: "task", label: "Task", icon: Sparkles },
  { id: "terminal", label: "Terminal", icon: Terminal },
  { id: "review", label: "Review", icon: FileDiff },
  { id: "history", label: "History", icon: History },
];

export function App() {
  const [activeProfileId, setActiveProfileId] = useState("shell");
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("setup");
  const codexQuery = useQuery({
    queryKey: ["codex-cli"],
    queryFn: detectCodexCli,
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

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div>
          <p className="eyebrow">Codex Jarvis</p>
          <h1>System Console</h1>
        </div>
        <div className="top-status">
          <span className={setupStatus === "ready" ? "status-ready" : "status-warning"}>
            {setupStatus === "ready" ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            {setupStatus === "ready" ? "Codex ready" : "Codex setup needed"}
          </span>
          <button className="icon-button" aria-label="Settings" onClick={() => setActiveTab("setup")}>
            <Settings size={18} />
          </button>
        </div>
      </header>

      <aside className="sidebar">
        <section>
          <h2>Profiles</h2>
          <nav className="nav-list">
            {profiles.map((profile) => (
              <button
                key={profile.id}
                className={profile.id === activeProfile.id ? "nav-item active" : "nav-item"}
                onClick={() => setActiveProfileId(profile.id)}
              >
                <span>{profile.name}</span>
                <small>{formatTaskMode(profile.defaultMode)}</small>
              </button>
            ))}
          </nav>
        </section>

        <section>
          <h2>Sessions</h2>
          <nav className="nav-list compact">
            <button className="nav-item active">Current</button>
            <button className="nav-item">PATH cleanup</button>
            <button className="nav-item">fcitx issue</button>
          </nav>
        </section>
      </aside>

      <main className="workspace">
        <div className="tab-bar">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                className={tab.id === activeTab ? "tab active" : "tab"}
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}
        </div>
        <Workspace
          activeTab={activeTab}
          profile={activeProfile}
          setupStatus={setupStatus}
          codexInfo={codexQuery.data}
          onDetectCodex={() => void codexQuery.refetch()}
        />
      </main>

      <aside className="inspector">
        <div className="panel-title">
          <PanelRight size={16} />
          Inspector
        </div>
        <section className="info-card">
          <h2>Safety</h2>
          <dl>
            <div>
              <dt>Mode</dt>
              <dd>{formatTaskMode(activeProfile.defaultMode)}</dd>
            </div>
            <div>
              <dt>Snapshots</dt>
              <dd>{activeProfile.snapshotRequired ? "On" : "Off"}</dd>
            </div>
            <div>
              <dt>Sudo</dt>
              <dd>Blocked</dd>
            </div>
          </dl>
        </section>
        <section className="info-card">
          <h2>Codex CLI</h2>
          <p>{setupStatus === "ready" ? codexQuery.data?.version : codexQuery.data?.error || "Setup pending"}</p>
        </section>
        <section className="info-card">
          <h2>Profile</h2>
          <p>{activeProfile.description}</p>
          <dl className="compact-dl">
            <div>
              <dt>cwd</dt>
              <dd>{activeProfile.cwd}</dd>
            </div>
            <div>
              <dt>Writes</dt>
              <dd>{activeProfile.writeEnabled ? "Enabled" : "Disabled"}</dd>
            </div>
          </dl>
        </section>
        <PolicySummary profile={activeProfile} />
        <section className="info-card">
          <h2>Context Commands</h2>
          <div className="path-list">
            {activeProfile.readonlyCommands.map((command) => (
              <code key={command}>{command}</code>
            ))}
          </div>
        </section>
        <section className="info-card">
          <h2>Changes</h2>
          <p>No file changes detected yet.</p>
        </section>
      </aside>
    </div>
  );
}

function PolicySummary({ profile }: { profile: TaskProfile }) {
  const summary = profilePathSummary(profile);
  const groups: PathPolicyGroup[] = [
    { label: `Readable (${summary.readable})`, paths: profile.readPaths },
    { label: `Writable (${summary.writable})`, paths: profile.writePaths },
    { label: `Denied (${summary.denied})`, paths: profile.denyPaths },
  ];

  return (
    <section className="info-card">
      <h2>Path Policy</h2>
      <div className="policy-groups">
        {groups.map((group) => (
          <details key={group.label}>
            <summary>{group.label}</summary>
            <div className="path-list">
              {group.paths.length ? group.paths.map((path) => <code key={path}>{path}</code>) : <span>None</span>}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

function Workspace({
  activeTab,
  profile,
  setupStatus,
  codexInfo,
  onDetectCodex,
}: {
  activeTab: WorkspaceTab;
  profile: TaskProfile;
  setupStatus: CodexSetupStatus;
  codexInfo?: Parameters<typeof SetupWizard>[0]["info"];
  onDetectCodex: () => void;
}) {
  if (activeTab === "setup") {
    return <SetupWizard info={codexInfo} status={setupStatus} onDetect={onDetectCodex} />;
  }

  if (activeTab === "terminal") {
    return (
      <section className="workspace-panel terminal-panel">
        <div className="section-heading">
          <h2>Terminal</h2>
          <span>{profile.name}: {profile.cwd}</span>
        </div>
        <pre>{`$ echo $SHELL
/usr/bin/zsh
$ echo $PATH
/home/autyan/.local/bin:/usr/local/bin:/usr/bin
$ `}</pre>
      </section>
    );
  }

  if (activeTab === "review") {
    return (
      <section className="workspace-panel">
        <div className="section-heading">
          <h2>Review Changes</h2>
          <span>Awaiting patch task</span>
        </div>
        <div className="empty-state">
          <ShieldCheck size={32} />
          <p>Run a patch task to review changed files, diffs, and rollback options.</p>
        </div>
      </section>
    );
  }

  if (activeTab === "history") {
    return <HistoryView />;
  }

  return <TaskRunner profile={profile} />;
}
