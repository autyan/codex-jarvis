import {
  CheckCircle2,
  FileDiff,
  History,
  PanelRight,
  Settings,
  ShieldCheck,
  Sparkles,
  Terminal,
} from "lucide-react";
import { useMemo, useState } from "react";
import { profiles } from "./data/profiles";
import type { WorkspaceTab } from "./types/workspace";

const tabs: Array<{ id: WorkspaceTab; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { id: "task", label: "Task", icon: Sparkles },
  { id: "terminal", label: "Terminal", icon: Terminal },
  { id: "review", label: "Review", icon: FileDiff },
  { id: "history", label: "History", icon: History },
];

export function App() {
  const [activeProfileId, setActiveProfileId] = useState("shell");
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("task");
  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0],
    [activeProfileId],
  );

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div>
          <p className="eyebrow">Codex Jarvis</p>
          <h1>System Console</h1>
        </div>
        <div className="top-status">
          <span>
            <CheckCircle2 size={16} />
            Codex pending setup
          </span>
          <button className="icon-button" aria-label="Settings">
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
                <small>{profile.mode}</small>
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
        <Workspace activeTab={activeTab} profileName={activeProfile.name} />
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
              <dd>{activeProfile.mode}</dd>
            </div>
            <div>
              <dt>Snapshots</dt>
              <dd>On</dd>
            </div>
            <div>
              <dt>Sudo</dt>
              <dd>Blocked</dd>
            </div>
          </dl>
        </section>
        <section className="info-card">
          <h2>Profile</h2>
          <p>{activeProfile.description}</p>
          <div className="path-list">
            {activeProfile.paths.map((path) => (
              <code key={path}>{path}</code>
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

function Workspace({ activeTab, profileName }: { activeTab: WorkspaceTab; profileName: string }) {
  if (activeTab === "terminal") {
    return (
      <section className="workspace-panel terminal-panel">
        <div className="section-heading">
          <h2>Terminal</h2>
          <span>{profileName}: $HOME</span>
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
    return (
      <section className="workspace-panel">
        <div className="section-heading">
          <h2>Session History</h2>
          <span>Virtualized event stream placeholder</span>
        </div>
        <div className="event-list">
          <div>Setup project structure</div>
          <div>Drafted system design</div>
          <div>Drafted wireframe</div>
        </div>
      </section>
    );
  }

  return (
    <section className="workspace-panel">
      <div className="section-heading">
        <h2>Task Runner</h2>
        <span>{profileName} profile</span>
      </div>
      <label className="prompt-box">
        <span>Prompt</span>
        <textarea defaultValue="Clean up my zsh PATH configuration" />
      </label>
      <div className="button-row">
        <button>Collect Context</button>
        <button className="primary">Run Codex</button>
      </div>
      <div className="output-box">
        <p>Live Codex output will stream here.</p>
      </div>
    </section>
  );
}

