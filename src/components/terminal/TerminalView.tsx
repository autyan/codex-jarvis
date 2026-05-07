import { listen } from "@tauri-apps/api/event";
import { Terminal as XTerm } from "@xterm/xterm";
import type { IDisposable } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState, type MouseEvent } from "react";
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
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | undefined>();

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

  useEffect(() => {
    if (!contextMenu) return;

    function closeMenu() {
      setContextMenu(undefined);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeMenu();
    }

    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

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

  function openContextMenu(event: MouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ x: event.clientX, y: event.clientY });
  }

  async function copySelection() {
    const selection = terminalRef.current?.getSelection() ?? "";
    if (!selection) {
      setContextMenu(undefined);
      return;
    }
    await writeClipboardText(selection);
    terminalRef.current?.focus();
    setContextMenu(undefined);
  }

  async function pasteClipboard() {
    const text = await readClipboardText();
    if (text && terminalIdRef.current) {
      await writeTerminal(terminalIdRef.current, text);
    }
    terminalRef.current?.focus();
    setContextMenu(undefined);
  }

  return (
    <section
      className={`terminal-workspace terminal-${status}`}
      aria-label={`${profile.name} terminal`}
      onContextMenu={openContextMenu}
    >
      <div ref={containerRef} className="xterm-host" />
      {contextMenu ? (
        <div
          className="terminal-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button onClick={() => void copySelection()} disabled={!terminalRef.current?.hasSelection()}>
            Copy
          </button>
          <button onClick={() => void pasteClipboard()} disabled={status !== "running"}>
            Paste
          </button>
        </div>
      ) : null}
    </section>
  );
}

async function readClipboardText() {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return "";
  }
}

async function writeClipboardText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand("copy");
    document.body.removeChild(textArea);
  }
}
