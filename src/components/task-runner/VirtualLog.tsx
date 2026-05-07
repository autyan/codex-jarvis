import { useLayoutEffect, useMemo, useRef } from "react";
import type { TaskLogLine } from "../../types/task";

type VirtualLogProps = {
  logs: TaskLogLine[];
  hasOlder?: boolean;
  isLoadingOlder?: boolean;
  onLoadOlder?: () => void;
};

const conversationSources = new Set<TaskLogLine["source"]>(["user", "assistant"]);

export function VirtualLog({ logs, hasOlder, isLoadingOlder, onLoadOlder }: VirtualLogProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const pendingScrollHeightRef = useRef<number | undefined>(undefined);
  const conversationLogs = useMemo(() => mergeConversationLogs(logs.filter((log) => conversationSources.has(log.source))), [logs]);

  useLayoutEffect(() => {
    const root = parentRef.current;
    const previousScrollHeight = pendingScrollHeightRef.current;
    if (!root || previousScrollHeight === undefined || isLoadingOlder) return;

    root.scrollTop += root.scrollHeight - previousScrollHeight;
    pendingScrollHeightRef.current = undefined;
  }, [conversationLogs.length, isLoadingOlder]);

  function loadOlderFromScroll() {
    const root = parentRef.current;
    if (!root || !hasOlder || isLoadingOlder) return;
    pendingScrollHeightRef.current = root.scrollHeight;
    onLoadOlder?.();
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
              <article key={line.id} className={`chat-message role-${line.source}`}>
                <span>{line.source === "user" ? "You" : "Codex"}</span>
                <pre>{line.text}</pre>
              </article>
            ))}
          </div>
        </>
      ) : (
        <p>Codex is preparing a response...</p>
      )}
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
