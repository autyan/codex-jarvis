import { AlertCircle, CheckCircle2, Copy, RefreshCw, Terminal } from "lucide-react";
import { useMemo } from "react";
import type { CodexCliInfo, CodexSetupStatus } from "../../types/codex";

type SetupWizardProps = {
  info?: CodexCliInfo;
  status: CodexSetupStatus;
  onDetect: () => void;
};

const installCommand = "npm install -g @openai/codex";

export function SetupWizard({ info, status, onDetect }: SetupWizardProps) {
  const title = useMemo(() => {
    if (status === "checking") return "Checking Codex CLI";
    if (status === "ready") return "Codex CLI Ready";
    if (status === "missing") return "Codex CLI Not Found";
    return "Codex CLI Setup";
  }, [status]);

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
          <strong>{status === "ready" ? "Codex CLI is available" : "Codex CLI needs setup"}</strong>
          <p>
            {status === "ready"
              ? "The app can invoke Codex through the configured command."
              : "Install Codex CLI or choose a binary path before running tasks."}
          </p>
        </div>
      </div>

      <div className="setup-grid">
        <div className="setup-card">
          <h3>Detected Binary</h3>
          <dl>
            <div>
              <dt>Path</dt>
              <dd>{info?.path ?? "Not detected"}</dd>
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

        <div className="setup-card">
          <h3>Install Guidance</h3>
          <p>Run this manually in a terminal if Codex CLI is missing.</p>
          <code className="command-block">{installCommand}</code>
          <div className="button-row">
            <button className="secondary-action">
              <Copy size={16} />
              Copy
            </button>
            <button className="secondary-action">
              <Terminal size={16} />
              Open Terminal
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

