import { useQuery } from "@tanstack/react-query";
import { FileDiff, RefreshCw, RotateCcw } from "lucide-react";
import { useState } from "react";
import { getTaskDiff, listChangedFiles, rollbackTask } from "../../api/tasks";
import type { RollbackResult } from "../../types/task";

type ReviewViewProps = {
  taskId?: string;
};

export function ReviewView({ taskId }: ReviewViewProps) {
  const [rollbackResult, setRollbackResult] = useState<RollbackResult>();
  const [rollbackError, setRollbackError] = useState<string>();
  const [isRollingBack, setIsRollingBack] = useState(false);
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

  async function handleRollback() {
    if (!taskId) return;
    setIsRollingBack(true);
    setRollbackError(undefined);
    try {
      const result = await rollbackTask(taskId);
      setRollbackResult(result);
      await changedFilesQuery.refetch();
      await diffQuery.refetch();
    } catch (error) {
      setRollbackError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRollingBack(false);
    }
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
        <button className="secondary-action danger-action" onClick={handleRollback} disabled={isRollingBack}>
          <RotateCcw size={16} />
          Rollback
        </button>
      </div>

      {rollbackResult ? (
        <div className="rollback-banner">
          <strong>Rollback complete</strong>
          <span>
            restored {rollbackResult.restored.length}, deleted {rollbackResult.deleted.length}, skipped{" "}
            {rollbackResult.skipped.length}
          </span>
        </div>
      ) : null}
      {rollbackError ? <div className="rollback-banner error">{rollbackError}</div> : null}

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
