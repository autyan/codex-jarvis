import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef } from "react";
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
  const sentinelRef = useRef<HTMLDivElement>(null);
  const conversationLogs = useMemo(() => mergeConversationLogs(logs.filter((log) => conversationSources.has(log.source))), [logs]);
  const detailLogs = useMemo(() => logs.filter((log) => !conversationSources.has(log.source)), [logs]);
  const rowVirtualizer = useVirtualizer({
    count: conversationLogs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 96,
    overscan: 8,
  });

  useEffect(() => {
    const root = parentRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel || !hasOlder) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !isLoadingOlder) {
          onLoadOlder?.();
        }
      },
      {
        root,
        rootMargin: "96px 0px 0px 0px",
        threshold: 0,
      },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasOlder, isLoadingOlder, onLoadOlder]);

  if (!logs.length) {
    return (
      <div className="output-box task-output chat-output">
        <p>Start a conversation with Codex. Recent messages load here and remain scrollable.</p>
      </div>
    );
  }

  return (
    <div className="conversation-stack">
      <div
        ref={parentRef}
        className="output-box task-output chat-output"
        aria-live="polite"
        onScroll={(event) => {
          if (event.currentTarget.scrollTop < 48 && hasOlder && !isLoadingOlder) {
            onLoadOlder?.();
          }
        }}
      >
        {conversationLogs.length ? (
          <>
            <div ref={sentinelRef} className="history-window-sentinel" aria-hidden="true" />
            {isLoadingOlder ? <div className="history-window-status">Loading older messages...</div> : null}
            <div
              className="virtual-log-inner"
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualItem) => {
                const line = conversationLogs[virtualItem.index];
                return (
                  <article
                    key={line.id}
                    className={`chat-message role-${line.source}`}
                    ref={rowVirtualizer.measureElement}
                    data-index={virtualItem.index}
                    style={{
                      transform: `translateY(${virtualItem.start}px)`,
                    }}
                  >
                    <span>{line.source === "user" ? "You" : "Codex"}</span>
                    <pre>{line.text}</pre>
                  </article>
                );
              })}
            </div>
          </>
        ) : (
          <p>Codex is preparing a response...</p>
        )}
      </div>

      {detailLogs.length ? (
        <details className="execution-details">
          <summary>Execution details ({detailLogs.length})</summary>
          <div className="execution-log">
            {detailLogs.map((line) => (
              <div key={line.id} className={`log-line source-${line.source}`}>
                <span>{line.source}</span>
                <pre>{line.text}</pre>
              </div>
            ))}
          </div>
        </details>
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
