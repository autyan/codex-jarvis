import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { TaskLogLine } from "../../types/task";

type VirtualLogProps = {
  logs: TaskLogLine[];
  hasOlder?: boolean;
  isInitialLoading?: boolean;
  isLoadingOlder?: boolean;
  onLoadOlder?: () => void;
};

const conversationSources = new Set<TaskLogLine["source"]>(["user", "assistant"]);

export function VirtualLog({ logs, hasOlder, isInitialLoading, isLoadingOlder, onLoadOlder }: VirtualLogProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const pendingScrollHeightRef = useRef<number | undefined>(undefined);
  const [messageMenu, setMessageMenu] = useState<{ x: number; y: number; text: string; label: string }>();
  const conversationLogs = useMemo(() => mergeConversationLogs(logs.filter((log) => conversationSources.has(log.source))), [logs]);

  useLayoutEffect(() => {
    const root = parentRef.current;
    const previousScrollHeight = pendingScrollHeightRef.current;
    if (!root || previousScrollHeight === undefined || isLoadingOlder) return;

    root.scrollTop += root.scrollHeight - previousScrollHeight;
    pendingScrollHeightRef.current = undefined;
  }, [conversationLogs.length, isLoadingOlder]);

  useEffect(() => {
    if (!messageMenu) return;

    function closeMenu() {
      setMessageMenu(undefined);
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
  }, [messageMenu]);

  function loadOlderFromScroll() {
    const root = parentRef.current;
    if (!root || !hasOlder || isLoadingOlder) return;
    pendingScrollHeightRef.current = root.scrollHeight;
    onLoadOlder?.();
  }

  function openMessageMenu(event: MouseEvent<HTMLElement>, fallbackText?: string) {
    event.preventDefault();
    event.stopPropagation();
    const selectedText = window.getSelection()?.toString() ?? "";
    const text = selectedText.trim() ? selectedText : (fallbackText ?? "");
    setMessageMenu({
      x: event.clientX,
      y: event.clientY,
      text,
      label: selectedText.trim() ? "Copy selection" : "Copy message",
    });
  }

  async function copyMessageMenuText() {
    if (!messageMenu?.text) return;
    await writeClipboardText(messageMenu.text);
    setMessageMenu(undefined);
  }

  if (isInitialLoading) {
    return (
      <div className="output-box task-output chat-output initial-history-loading" aria-live="polite">
        <div className="loading-card">
          <span>Loading conversation...</span>
          <small>Preparing the recent message window</small>
        </div>
      </div>
    );
  }

  if (!logs.length) {
    return (
      <div className="output-box task-output chat-output">
        <p>Start a conversation with Codex. Recent messages load here and remain scrollable.</p>
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className="output-box task-output chat-output"
      aria-live="polite"
      onContextMenu={(event) => openMessageMenu(event)}
      onScroll={(event) => {
        if (event.currentTarget.scrollTop < 48 && hasOlder && !isLoadingOlder) {
          loadOlderFromScroll();
        }
      }}
    >
      {conversationLogs.length ? (
        <>
          {isLoadingOlder ? <div className="history-window-status">Loading older messages...</div> : null}
          <div className="chat-log-flow">
            {conversationLogs.map((line) => (
              <article
                key={line.id}
                className={`chat-message role-${line.source}`}
                onContextMenu={(event) => openMessageMenu(event, line.text)}
              >
                <span>{line.source === "user" ? "You" : "Codex"}</span>
                <pre>{line.text}</pre>
              </article>
            ))}
          </div>
        </>
      ) : (
        <p>Codex is preparing a response...</p>
      )}
      {messageMenu ? (
        <div
          className="terminal-context-menu message-context-menu"
          style={{ left: messageMenu.x, top: messageMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button onClick={() => void copyMessageMenuText()} disabled={!messageMenu.text}>
            {messageMenu.label}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function mergeConversationLogs(logs: TaskLogLine[]) {
  return logs.reduce<TaskLogLine[]>((merged, log) => {
    const previous = merged.at(-1);
    if (previous?.source === log.source) {
      previous.text = `${previous.text.trimEnd()}\n\n${log.text.trimStart()}`;
      previous.id = `${previous.id}-${log.id}`;
      return merged;
    }
    merged.push({ ...log });
    return merged;
  }, []);
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
