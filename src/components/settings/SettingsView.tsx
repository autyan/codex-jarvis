import { Database, History, MonitorCog, SlidersHorizontal, ShieldCheck, Terminal, Wrench } from "lucide-react";
import { useMemo, useState } from "react";
import { linuxDomainLabels } from "../../data/profiles";
import type { AppSettings, CodexCliInfo, CodexReasoningEffort } from "../../types/codex";
import type { TaskProfile } from "../../types/profile";

type SettingsViewProps = {
  codexInfo?: CodexCliInfo;
  profile: TaskProfile;
  settings?: AppSettings;
  onSetSudoFlow: (enabled: boolean) => void;
  onSetCodexModel: (codexModel: string | undefined, codexReasoningEffort: CodexReasoningEffort) => void;
};

export function SettingsView({ codexInfo, profile, settings, onSetSudoFlow, onSetCodexModel }: SettingsViewProps) {
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const profileJson = useMemo(() => JSON.stringify(profile, null, 2), [profile]);
  const [profileDraft, setProfileDraft] = useState(profileJson);

  return (
    <section className="settings-view">
      <div className="section-heading">
        <div>
          <h2>Configuration Map</h2>
          <span>Read-only preview of the settings surface</span>
        </div>
      </div>

      <div className="settings-grid">
        <section className="settings-card settings-card-wide">
          <h3>
            <SlidersHorizontal size={16} />
            Profiles
          </h3>
          <dl>
            <div>
              <dt>Current profile</dt>
              <dd>{profile.name}</dd>
            </div>
            <div>
              <dt>Platform</dt>
              <dd>Linux</dd>
            </div>
            <div>
              <dt>Domains</dt>
              <dd>{profile.domains.map((domain) => `${linuxDomainLabels[domain.domainId]}:${domain.access}`).join(", ")}</dd>
            </div>
          </dl>
          <div className="settings-actions">
            <button
              className="profile-edit-button"
              onClick={() => {
                setProfileDraft(profileJson);
                setProfileEditorOpen((open) => !open);
              }}
            >
              {profileEditorOpen ? "Close editor" : "Edit profile"}
            </button>
          </div>
          {profileEditorOpen ? (
            <div className="profile-editor">
              <label>
                <span>Profile JSON</span>
                <textarea value={profileDraft} onChange={(event) => setProfileDraft(event.target.value)} />
              </label>
              <div className="settings-actions">
                <button className="secondary-action" onClick={() => setProfileDraft(profileJson)}>
                  Reset
                </button>
                <button className="secondary-action" disabled>
                  Save profile
                </button>
              </div>
            </div>
          ) : null}
        </section>

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
              <dt>Path policy</dt>
              <dd>Explicit path preferred, PATH fallback</dd>
            </div>
            <div>
              <dt>Version</dt>
              <dd>{codexInfo?.version ?? "Unknown"}</dd>
            </div>
            <div>
              <dt>Model</dt>
              <dd>{settings?.codexModel ?? "CLI default"}</dd>
            </div>
            <div>
              <dt>Reasoning effort</dt>
              <dd>{settings?.codexReasoningEffort ?? "medium"}</dd>
            </div>
          </dl>
          <div className="settings-form-grid">
            <label>
              <span>Model</span>
              <select
                value={settings?.codexModel ?? "__cli_default__"}
                onChange={(event) =>
                  onSetCodexModel(
                    event.target.value === "__cli_default__" ? undefined : event.target.value,
                    settings?.codexReasoningEffort ?? "medium",
                  )
                }
              >
                <option value="__cli_default__">CLI default</option>
                <option value="gpt-5.5">gpt-5.5</option>
                <option value="gpt-5.4">gpt-5.4</option>
                <option value="gpt-5.4-mini">gpt-5.4-mini</option>
              </select>
            </label>
            <label>
              <span>Effort</span>
              <select
                value={settings?.codexReasoningEffort ?? "medium"}
                onChange={(event) =>
                  onSetCodexModel(settings?.codexModel, event.target.value as CodexReasoningEffort)
                }
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
          </div>
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
              <dt>Lifecycle</dt>
              <dd>Auto-start on panel open</dd>
            </div>
            <div>
              <dt>Scrollback</dt>
              <dd>5000 lines</dd>
            </div>
            <div>
              <dt>Context attach</dt>
              <dd>Selection to current task</dd>
            </div>
            <div>
              <dt>Default cwd</dt>
              <dd>$HOME</dd>
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
              <dd>{settings?.sudoFlowEnabled ? "Flow enabled, approval required" : "Flow disabled"}</dd>
            </div>
            <div>
              <dt>Snapshots</dt>
              <dd>{profile.snapshotRequired ? "Required" : "Not required"}</dd>
            </div>
            <div>
              <dt>Rollback</dt>
              <dd>Available for patch tasks</dd>
            </div>
            <div>
              <dt>Write policy</dt>
              <dd>{profile.writeEnabled ? "Profile-scoped writes" : "Read-only profile"}</dd>
            </div>
          </dl>
          <div className="settings-actions">
            <button
              className={settings?.sudoFlowEnabled ? "secondary-action active-setting" : "secondary-action"}
              onClick={() => onSetSudoFlow(!settings?.sudoFlowEnabled)}
            >
              {settings?.sudoFlowEnabled ? "Disable sudo flow" : "Enable sudo flow"}
            </button>
          </div>
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
              <dt>Platform</dt>
              <dd>Linux only</dd>
            </div>
            <div>
              <dt>Profiles</dt>
              <dd>Editable profile surface enabled</dd>
            </div>
            <div>
              <dt>Changed files</dt>
              <dd>Snapshot diff per patch task</dd>
            </div>
            <div>
              <dt>Rollback logs</dt>
              <dd>Stored with task metadata</dd>
            </div>
          </dl>
        </section>

        <section className="settings-card">
          <h3>
            <History size={16} />
            Task Window
          </h3>
          <dl>
            <div>
              <dt>Default load</dt>
              <dd>Recent task events only</dd>
            </div>
            <div>
              <dt>Scrolling</dt>
              <dd>Virtualized long transcript</dd>
            </div>
            <div>
              <dt>Dedicated History page</dt>
              <dd>Removed from primary navigation</dd>
            </div>
          </dl>
        </section>

        <section className="settings-card">
          <h3>
            <Database size={16} />
            Interface
          </h3>
          <dl>
            <div>
              <dt>Sessions rail</dt>
              <dd>Pinned and recent sessions</dd>
            </div>
            <div>
              <dt>Activity bar</dt>
              <dd>Profiles, Review, Terminal, Settings</dd>
            </div>
            <div>
              <dt>Current domains</dt>
              <dd>{profile.domains.map((domain) => `${linuxDomainLabels[domain.domainId]}:${domain.access}`).join(", ")}</dd>
            </div>
            <div>
              <dt>Settings editing</dt>
              <dd>Only profile editor is exposed</dd>
            </div>
          </dl>
        </section>
      </div>
    </section>
  );
}
