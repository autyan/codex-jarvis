import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { RefreshCw } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { listRecentTasks, listTaskEvents } from "../../api/tasks";

type HistoryViewProps = {
  selectedTaskId?: string;
  onSelectTask: (taskId: string) => void;
};

export function HistoryView({ selectedTaskId, onSelectTask }: HistoryViewProps) {
  const [localSelectedTaskId, setLocalSelectedTaskId] = useState<string>();
  const tasksQuery = useQuery({
    queryKey: ["recent-tasks"],
    queryFn: () => listRecentTasks(50),
  });
  const selectedTask = selectedTaskId ?? localSelectedTaskId ?? tasksQuery.data?.[0]?.taskId;
  const eventsQuery = useQuery({
    queryKey: ["task-events", selectedTask],
    queryFn: () => (selectedTask ? listTaskEvents(selectedTask, 0, 500) : undefined),
    enabled: Boolean(selectedTask),
  });
  const events = useMemo(() => eventsQuery.data?.events ?? [], [eventsQuery.data?.events]);
  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72,
    overscan: 10,
  });

  return (
    <section className="workspace-panel history-view">
      <div className="section-heading">
        <div>
          <h2>Session History</h2>
          <span>Recent persisted task events</span>
        </div>
        <button className="secondary-action" onClick={() => void tasksQuery.refetch()}>
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      <div className="history-layout">
        <aside className="history-task-list">
          {(tasksQuery.data ?? []).map((task) => (
            <button
              key={task.taskId}
              className={task.taskId === selectedTask ? "history-task active" : "history-task"}
              onClick={() => {
                setLocalSelectedTaskId(task.taskId);
                onSelectTask(task.taskId);
              }}
            >
              <strong>{task.taskId}</strong>
              <span>{task.latestStatus ?? "unknown"} · {task.eventCount} events</span>
              {task.latestPreview ? <small>{task.latestPreview}</small> : null}
            </button>
          ))}
          {!tasksQuery.data?.length ? <p>No task history yet.</p> : null}
        </aside>

        <div ref={parentRef} className="history-events">
          <div className="virtual-log-inner" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
            {rowVirtualizer.getVirtualItems().map((virtualItem) => {
              const event = events[virtualItem.index];
              return (
                <article
                  key={`${event.taskId}-${event.sequence}`}
                  ref={rowVirtualizer.measureElement}
                  data-index={virtualItem.index}
                  className={`history-event source-${event.source}`}
                  style={{ transform: `translateY(${virtualItem.start}px)` }}
                >
                  <div>
                    <strong>{event.event}</strong>
                    <span>#{event.sequence}</span>
                  </div>
                  <p>{event.textPreview ?? event.payloadPath ?? "No preview"}</p>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
