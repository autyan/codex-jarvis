import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";
import type { TaskLogLine } from "../../types/task";

type VirtualLogProps = {
  logs: TaskLogLine[];
};

export function VirtualLog({ logs }: VirtualLogProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: logs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72,
    overscan: 8,
  });

  if (!logs.length) {
    return (
      <div className="output-box task-output">
        <p>Start a conversation with Codex. Recent messages load here and remain scrollable.</p>
      </div>
    );
  }

  return (
    <div ref={parentRef} className="output-box task-output virtual-log" aria-live="polite">
      <div
        className="virtual-log-inner"
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualItem) => {
          const line = logs[virtualItem.index];
          return (
            <div
              key={line.id}
              className={`log-line source-${line.source}`}
              ref={rowVirtualizer.measureElement}
              data-index={virtualItem.index}
              style={{
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <span>{line.source}</span>
              <pre>{line.text}</pre>
            </div>
          );
        })}
      </div>
    </div>
  );
}
