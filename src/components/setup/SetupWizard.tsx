import { AlertCircle, CheckCircle2, RefreshCw, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { setCodexCliPath } from "../../api/codex";
import type { CodexCliInfo, CodexSetupStatus } from "../../types/codex";

type SetupWizardProps = {
  info?: CodexCliInfo;
  status: CodexSetupStatus;
  onDetect: () => void;
};

export function SetupWizard({ info, status, onDetect }: SetupWizardProps) {
  const [path, setPath] = useState(info?.path ?? "");
  const [saveError, setSaveError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const title = useMemo(() => {
    if (status === "checking") return "Checking Codex CLI";
    if (status === "ready") return "Codex CLI Ready";
    if (status === "missing") return "Codex CLI Not Found";
    return "Codex CLI Setup";
  }, [status]);

  useEffect(() => {
    setPath(info?.path ?? "");
  }, [info?.path]);

  async function handleSave() {
    setSaving(true);
    setSaveError(undefined);
    try {
      await setCodexCliPath({ path });
      onDetect();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="setup-view">
      <div className="setup-header">
        <div>
          <p className="eyebrow">First Run</p>
          <h2>{title}</h2>
        </div>
        <button className="secondary-action" onClick={onDetect} disabled={status === "checking"}>
          <RefreshCw size={16} />
          Detect
        </button>
      </div>

      <div className={status === "ready" ? "setup-status ready" : "setup-status"}>
        {status === "ready" ? <CheckCircle2 size={22} /> : <AlertCircle size={22} />}
        <div>
          <strong>{status === "ready" ? "Codex CLI is available" : "Codex CLI path required"}</strong>
          <p>
            {status === "ready"
              ? "Jarvis will invoke Codex through the saved executable path."
              : "Provide a path to a Codex CLI executable or wrapper before running tasks."}
          </p>
        </div>
      </div>

      <div className="setup-grid">
        <div className="setup-card">
          <h3>Codex CLI Path</h3>
          <p>Jarvis does not install or assume a specific Codex CLI distribution. Provide the executable path you want Jarvis to use.</p>
          <label className="setup-field">
            <span>Executable path</span>
            <input
              placeholder="~/.local/bin/codex-jarvis-cli"
              value={path}
              onChange={(event) => setPath(event.target.value)}
            />
          </label>
          {saveError ? <p className="setup-error">{saveError}</p> : null}
          <div className="button-row">
            <button className="primary action-with-icon" onClick={handleSave} disabled={saving || !path.trim()}>
              <Save size={16} />
              Save and verify
            </button>
          </div>
        </div>

        <div className="setup-card">
          <h3>Current Configuration</h3>
          <dl>
            <div>
              <dt>Path</dt>
              <dd>{info?.path ?? "Not configured"}</dd>
            </div>
            <div>
              <dt>Version</dt>
              <dd>{info?.version || "Unknown"}</dd>
            </div>
            <div>
              <dt>Error</dt>
              <dd>{info?.error || "None"}</dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}
