import { listen } from "@tauri-apps/api/event";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Power, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { closeTerminal, resizeTerminal, startTerminal, writeTerminal } from "../../api/terminal";
import type { TaskProfile } from "../../types/profile";
import type { TerminalEvent } from "../../types/terminal";

type TerminalViewProps = {
  profile: TaskProfile;
  onAttachOutput: (output: string) => void;
};

const defaultCols = 100;
const defaultRows = 28;

export function TerminalView({ profile, onAttachOutput }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | undefined>(undefined);
  const terminalIdRef = useRef<string | undefined>(undefined);
  const [terminalId, setTerminalId] = useState<string>();
  const [status, setStatus] = useState<"idle" | "starting" | "running" | "closed" | "failed">("idle");
  const [error, setError] = useState<string>();

  useEffect(() => {
    void openTerminal();

    return () => {
      if (terminalIdRef.current) {
        void closeTerminal(terminalIdRef.current);
      }
      terminalRef.current?.dispose();
    };
  }, []);

  async function openTerminal() {
    if (terminalRef.current || status === "starting") return;
    setStatus("starting");
    setError(undefined);

    const term = new XTerm({
      cols: defaultCols,
      rows: defaultRows,
      cursorBlink: true,
      convertEol: true,
      scrollback: 5000,
      theme: {
        background: "#141a18",
        foreground: "#dce7e2",
        cursor: "#d8b24a",
        selectionBackground: "#34524b",
      },
      fontFamily: '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
      fontSize: 13,
    });

    terminalRef.current = term;
    term.open(containerRef.current!);
    term.focus();
    term.onData((data) => {
      if (terminalIdRef.current) void writeTerminal(terminalIdRef.current, data);
    });

    try {
      const response = await startTerminal({
        profileId: profile.id,
        cols: defaultCols,
        rows: defaultRows,
      });
      terminalIdRef.current = response.terminalId;
      setTerminalId(response.terminalId);
      setStatus("running");
      await resizeTerminal(response.terminalId, defaultCols, defaultRows);

      const unsubscribe = await listen<TerminalEvent>("terminal://event", (event) => {
        if (event.payload.terminalId !== response.terminalId) return;
        if (event.payload.event === "terminal_output" && event.payload.data) {
          term.write(event.payload.data);
        }
        if (event.payload.event === "terminal_closed") {
          setStatus("closed");
          unsubscribe();
        }
      });
    } catch (error) {
      setStatus("failed");
      setError(error instanceof Error ? error.message : String(error));
      term.writeln(`Failed to start terminal: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function closeCurrentTerminal() {
    if (terminalIdRef.current) {
      await closeTerminal(terminalIdRef.current).catch(() => undefined);
    }
    terminalIdRef.current = undefined;
    setTerminalId(undefined);
    setStatus("closed");
    terminalRef.current?.dispose();
    terminalRef.current = undefined;
  }

  async function resetTerminal() {
    await closeCurrentTerminal();
    setStatus("idle");
    setError(undefined);
  }

  function attachSelection() {
    const selection = terminalRef.current?.getSelection();
    if (selection?.trim()) {
      onAttachOutput(selection);
    }
  }

  return (
    <section className="workspace-panel terminal-workspace">
      <div className="section-heading">
        <div>
          <h2>Terminal</h2>
          <span>{profile.name}: {profile.cwd}</span>
        </div>
        <div className="button-row">
          <button className="secondary-action" onClick={openTerminal} disabled={status === "running" || status === "starting"}>
            <Power size={16} />
            Start
          </button>
          <button className="secondary-action" onClick={resetTerminal}>
            <RotateCcw size={16} />
            Reset
          </button>
          <button className="secondary-action" onClick={attachSelection} disabled={!terminalId}>
            Attach Selection
          </button>
          <button className="secondary-action" onClick={closeCurrentTerminal} disabled={!terminalId}>
            <X size={16} />
            Close
          </button>
        </div>
      </div>

      <div className="terminal-meta">
        <span>Status: {status}</span>
        {terminalId ? <span>{terminalId}</span> : null}
        {error ? <span className="terminal-error">{error}</span> : null}
      </div>

      <div ref={containerRef} className="xterm-host" />
    </section>
  );
}
