import { listen } from "@tauri-apps/api/event";
import { Terminal as XTerm } from "@xterm/xterm";
import type { IDisposable } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import { closeTerminal, resizeTerminal, startTerminal, writeTerminal } from "../../api/terminal";
import type { TaskProfile } from "../../types/profile";
import type { TerminalEvent } from "../../types/terminal";

type TerminalViewProps = {
  active: boolean;
  profile: TaskProfile;
  onAttachOutput: (output: string) => void;
};

const defaultCols = 100;
const defaultRows = 28;

export function TerminalView({ active, profile, onAttachOutput: _onAttachOutput }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | undefined>(undefined);
  const terminalIdRef = useRef<string | undefined>(undefined);
  const dataSubscriptionRef = useRef<IDisposable | undefined>(undefined);
  const openingRef = useRef(false);
  const [status, setStatus] = useState<"idle" | "starting" | "running" | "closed" | "failed">("idle");

  useEffect(() => {
    let isMounted = true;
    let removeListener: (() => void) | undefined;

    listen<TerminalEvent>("terminal://event", (event) => {
      if (!isMounted) return;
      if (event.payload.terminalId !== terminalIdRef.current) return;
      if (event.payload.event === "terminal_output" && event.payload.data) {
        terminalRef.current?.write(event.payload.data);
      }
      if (event.payload.event === "terminal_closed") {
        setStatus("closed");
      }
    }).then((unsubscribe) => {
      if (!isMounted) {
        unsubscribe();
        return;
      }
      removeListener = unsubscribe;
      void openTerminal();
    });

    return () => {
      isMounted = false;
      removeListener?.();
      dataSubscriptionRef.current?.dispose();
      dataSubscriptionRef.current = undefined;
      if (terminalIdRef.current) {
        void closeTerminal(terminalIdRef.current);
      }
      terminalRef.current?.dispose();
    };
  }, []);

  useEffect(() => {
    if (active) {
      requestAnimationFrame(() => terminalRef.current?.focus());
    }
  }, [active]);

  async function openTerminal() {
    if (terminalRef.current || openingRef.current) return;
    openingRef.current = true;
    setStatus("starting");

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
      fontFamily: '"CaskaydiaMono Nerd Font Mono", "CaskaydiaMono NFM", "Cascadia Code Mono", "Cascadia Mono", "Cascadia Code", "JetBrains Mono", monospace',
      fontSize: 13,
    });

    terminalRef.current = term;
    term.open(containerRef.current!);
    dataSubscriptionRef.current = term.onData((data) => {
      if (terminalIdRef.current) void writeTerminal(terminalIdRef.current, data);
    });

    try {
      const response = await startTerminal({
        profileId: profile.id,
        cols: defaultCols,
        rows: defaultRows,
      });
      terminalIdRef.current = response.terminalId;
      setStatus("running");
      await resizeTerminal(response.terminalId, defaultCols, defaultRows);
      requestAnimationFrame(() => term.focus());
    } catch (error) {
      setStatus("failed");
      term.writeln(`Failed to start terminal: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      openingRef.current = false;
    }
  }

  async function closeCurrentTerminal() {
    if (terminalIdRef.current) {
      await closeTerminal(terminalIdRef.current).catch(() => undefined);
    }
    terminalIdRef.current = undefined;
    dataSubscriptionRef.current?.dispose();
    dataSubscriptionRef.current = undefined;
    setStatus("closed");
    terminalRef.current?.dispose();
    terminalRef.current = undefined;
  }

  return (
    <section className={`terminal-workspace terminal-${status}`} aria-label={`${profile.name} terminal`}>
      <div ref={containerRef} className="xterm-host" />
    </section>
  );
}
