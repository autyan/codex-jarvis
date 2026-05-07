import { useQuery } from "@tanstack/react-query";
import { FileDiff, RefreshCw } from "lucide-react";
import { getTaskDiff, listChangedFiles } from "../../api/tasks";

type ReviewViewProps = {
  taskId?: string;
};

export function ReviewView({ taskId }: ReviewViewProps) {
  const changedFilesQuery = useQuery({
    queryKey: ["changed-files", taskId],
    queryFn: () => (taskId ? listChangedFiles(taskId) : []),
    enabled: Boolean(taskId),
  });
  const diffQuery = useQuery({
    queryKey: ["task-diff", taskId],
    queryFn: () => (taskId ? getTaskDiff(taskId) : ""),
    enabled: Boolean(taskId),
  });

  function refresh() {
    void changedFilesQuery.refetch();
    void diffQuery.refetch();
  }

  if (!taskId) {
    return (
      <section className="workspace-panel">
        <div className="section-heading">
          <h2>Review Changes</h2>
          <span>Awaiting patch task</span>
        </div>
        <div className="empty-state">
          <FileDiff size={32} />
          <p>Run a patch task to review changed files, diffs, and rollback options.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="workspace-panel review-view">
      <div className="section-heading">
        <div>
          <h2>Review Changes</h2>
          <span>{taskId}</span>
        </div>
        <button className="secondary-action" onClick={refresh}>
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      <div className="review-layout">
        <aside className="changed-files">
          <h3>Changed Files</h3>
          {(changedFilesQuery.data ?? []).map((file) => (
            <div key={file.path} className={`changed-file status-${file.status}`}>
              <strong>{file.status}</strong>
              <span>{file.path}</span>
            </div>
          ))}
          {changedFilesQuery.data?.length === 0 ? <p>No changed files detected yet.</p> : null}
        </aside>

        <pre className="diff-viewer">{diffQuery.data || "No diff available yet."}</pre>
      </div>
    </section>
  );
}

