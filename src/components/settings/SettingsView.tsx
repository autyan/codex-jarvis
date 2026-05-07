import { MonitorCog, ShieldCheck, Terminal, Wrench } from "lucide-react";
import type { CodexCliInfo } from "../../types/codex";
import type { TaskProfile } from "../../types/profile";

type SettingsViewProps = {
  codexInfo?: CodexCliInfo;
  profile: TaskProfile;
};

export function SettingsView({ codexInfo, profile }: SettingsViewProps) {
  return (
    <section className="workspace-panel settings-view">
      <div className="section-heading">
        <div>
          <h2>Settings</h2>
          <span>Local workstation configuration</span>
        </div>
      </div>

      <div className="settings-grid">
        <section className="settings-card">
          <h3>
            <Wrench size={16} />
            Codex CLI
          </h3>
          <dl>
            <div>
              <dt>Status</dt>
              <dd>{codexInfo?.found ? "Ready" : "Not configured"}</dd>
            </div>
            <div>
              <dt>Path</dt>
              <dd>{codexInfo?.path ?? "codex"}</dd>
            </div>
            <div>
              <dt>Version</dt>
              <dd>{codexInfo?.version ?? "Unknown"}</dd>
            </div>
          </dl>
        </section>

        <section className="settings-card">
          <h3>
            <Terminal size={16} />
            Terminal
          </h3>
          <dl>
            <div>
              <dt>Shell</dt>
              <dd>$SHELL</dd>
            </div>
            <div>
              <dt>Scrollback</dt>
              <dd>5000 lines</dd>
            </div>
            <div>
              <dt>Default cwd</dt>
              <dd>{profile.cwd}</dd>
            </div>
          </dl>
        </section>

        <section className="settings-card">
          <h3>
            <ShieldCheck size={16} />
            Safety
          </h3>
          <dl>
            <div>
              <dt>Sudo</dt>
              <dd>Blocked by app workflows</dd>
            </div>
            <div>
              <dt>Snapshots</dt>
              <dd>{profile.snapshotRequired ? "Required" : "Not required"}</dd>
            </div>
            <div>
              <dt>Rollback</dt>
              <dd>Available for patch tasks</dd>
            </div>
          </dl>
        </section>

        <section className="settings-card">
          <h3>
            <MonitorCog size={16} />
            Data
          </h3>
          <dl>
            <div>
              <dt>Task data</dt>
              <dd>~/.local/share/codex-jarvis/tasks</dd>
            </div>
            <div>
              <dt>Profiles</dt>
              <dd>Built in</dd>
            </div>
          </dl>
        </section>
      </div>
    </section>
  );
}
