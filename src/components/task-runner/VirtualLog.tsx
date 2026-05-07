import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { ConversationMessage } from "../../types/task";

type VirtualLogProps = {
  messages: ConversationMessage[];
  hasOlder?: boolean;
  isInitialLoading?: boolean;
  isLoadingOlder?: boolean;
  onLoadOlder?: () => void;
  scrollToLatestKey?: string;
};

export function VirtualLog({
  messages,
  hasOlder,
  isInitialLoading,
  isLoadingOlder,
  onLoadOlder,
  scrollToLatestKey,
}: VirtualLogProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const pendingAnchorRef = useRef<{ id: string; offset: number } | undefined>(undefined);
  const lastScrollToLatestKeyRef = useRef<string | undefined>(undefined);
  const [messageMenu, setMessageMenu] = useState<{ x: number; y: number; text: string; label: string }>();
  const messageCount = messages.length;

  useLayoutEffect(() => {
    const root = parentRef.current;
    const anchor = pendingAnchorRef.current;
    if (!root || !anchor || isLoadingOlder) return;
    const element = root.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(anchor.id)}"]`);
    if (!element) return;

    root.scrollTop += element.getBoundingClientRect().top - root.getBoundingClientRect().top - anchor.offset;
    pendingAnchorRef.current = undefined;
  }, [messageCount, isLoadingOlder]);

  useLayoutEffect(() => {
    const root = parentRef.current;
    if (!root || !scrollToLatestKey || lastScrollToLatestKeyRef.current === scrollToLatestKey || isLoadingOlder) return;
    root.scrollTop = root.scrollHeight;
    lastScrollToLatestKeyRef.current = scrollToLatestKey;
  }, [isLoadingOlder, messageCount, scrollToLatestKey]);

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
    pendingAnchorRef.current = findTopAnchor(root);
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

  if (!messages.length) {
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
      {messages.length ? (
        <>
          {isLoadingOlder ? <div className="history-window-status">Loading older messages...</div> : null}
          <div className="chat-log-flow">
            {messages.map((message) => (
              <article
                key={message.id}
                className={`chat-message role-${message.role === "user" ? "user" : "assistant"}`}
                data-message-id={message.id}
                onContextMenu={(event) => openMessageMenu(event, message.text)}
              >
                <span>{message.role === "user" ? "You" : "Codex"}</span>
                <pre>{message.text}</pre>
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

function findTopAnchor(root: HTMLElement) {
  const rootTop = root.getBoundingClientRect().top;
  const elements = Array.from(root.querySelectorAll<HTMLElement>("[data-message-id]"));
  const element = elements.find((candidate) => candidate.getBoundingClientRect().bottom >= rootTop) ?? elements[0];
  if (!element) return undefined;
  return {
    id: element.dataset.messageId ?? "",
    offset: element.getBoundingClientRect().top - rootTop,
  };
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
