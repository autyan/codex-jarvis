import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, FileDiff, RefreshCw, RotateCcw, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { applyTaskReview, getTaskDiff, listChangedFiles, readChangedFile, rollbackTask } from "../../api/tasks";
import type { ApplyReviewResult, RollbackResult } from "../../types/task";

type ReviewViewProps = {
  taskId?: string;
  sessionName?: string;
  onClose: () => void;
};

export function ReviewView({ taskId, sessionName, onClose }: ReviewViewProps) {
  const [applyResult, setApplyResult] = useState<ApplyReviewResult>();
  const [applyError, setApplyError] = useState<string>();
  const [isApplying, setIsApplying] = useState(false);
  const [rollbackResult, setRollbackResult] = useState<RollbackResult>();
  const [rollbackError, setRollbackError] = useState<string>();
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string>();
  const [showRawDiff, setShowRawDiff] = useState(false);
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
  const changedFiles = changedFilesQuery.data ?? [];
  const selectedFile = changedFiles.find((file) => file.path === selectedPath) ?? changedFiles[0];
  const selectedIsMarkdown = Boolean(selectedFile && isMarkdownFile(selectedFile.path));
  const fileContentQuery = useQuery({
    queryKey: ["changed-file-content", taskId, selectedFile?.path],
    queryFn: () => readChangedFile(taskId ?? "", selectedFile?.path ?? ""),
    enabled: Boolean(taskId && selectedFile && selectedIsMarkdown && selectedFile.status !== "deleted"),
  });
  const selectedDiff = useMemo(
    () => (selectedFile ? extractFileDiff(diffQuery.data ?? "", selectedFile.path) : (diffQuery.data ?? "")),
    [diffQuery.data, selectedFile],
  );

  useEffect(() => {
    if (!changedFiles.length) {
      setSelectedPath(undefined);
      return;
    }
    if (!selectedPath || !changedFiles.some((file) => file.path === selectedPath)) {
      setSelectedPath(changedFiles[0].path);
    }
  }, [changedFiles, selectedPath]);

  function refresh() {
    void changedFilesQuery.refetch();
    void diffQuery.refetch();
    void fileContentQuery.refetch();
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
      setSelectedPath(undefined);
    } catch (error) {
      setRollbackError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRollingBack(false);
    }
  }

  async function handleApply() {
    if (!taskId) return;
    setIsApplying(true);
    setApplyError(undefined);
    try {
      const result = await applyTaskReview(taskId);
      setApplyResult(result);
      await changedFilesQuery.refetch();
      await diffQuery.refetch();
      setSelectedPath(undefined);
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsApplying(false);
    }
  }

  if (!taskId) {
    return (
      <section className="workspace-panel">
        <div className="section-heading">
          <h2>Review Changes</h2>
          <span>Awaiting patch task</span>
        </div>
        <button className="review-action" onClick={onClose}>
          <X size={14} />
          Close
        </button>
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
        <div className="review-title-block">
          <h2>{sessionName ?? "Review Changes"}</h2>
          <span>Task ID: {taskId}</span>
        </div>
        <div className="review-toolbar">
          <button className="review-action" onClick={refresh} disabled={changedFilesQuery.isFetching || diffQuery.isFetching}>
            <RefreshCw size={14} />
            Refresh
          </button>
          <button className="review-action apply-review-action" onClick={handleApply} disabled={isApplying || changedFiles.length === 0}>
            <CheckCircle2 size={14} />
            Apply
          </button>
          <button className="review-action rollback-action" onClick={handleRollback} disabled={isRollingBack}>
            <RotateCcw size={14} />
            Rollback
          </button>
          <button className="review-action" onClick={onClose}>
            <X size={14} />
            Close
          </button>
        </div>
      </div>

      {applyResult ? (
        <div className="review-banner">
          <strong>{applyResult.executionStarted ? "Apply started" : "Apply complete"}</strong>
          <span>sent {applyResult.accepted.length} reviewed files to Codex</span>
        </div>
      ) : null}
      {applyError ? <div className="review-banner error">{applyError}</div> : null}
      {rollbackResult ? (
        <div className="review-banner">
          <strong>Rollback complete</strong>
          <span>
            restored {rollbackResult.restored.length}, deleted {rollbackResult.deleted.length}, skipped{" "}
            {rollbackResult.skipped.length}
          </span>
        </div>
      ) : null}
      {rollbackError ? <div className="review-banner error">{rollbackError}</div> : null}

      <div className="review-layout">
        <aside className="changed-files">
          <h3>Changed Files</h3>
          {changedFiles.map((file) => (
            <button
              key={file.path}
              className={`changed-file status-${file.status}${file.path === selectedFile?.path ? " active" : ""}`}
              onClick={() => setSelectedPath(file.path)}
            >
              <strong>{file.status}</strong>
              <span>{file.path}</span>
            </button>
          ))}
          {changedFilesQuery.data?.length === 0 ? <p>No changed files detected yet.</p> : null}
        </aside>

        <section className="review-content">
          <div className="review-content-header">
            <div>
              <h3>{selectedFile ? basename(selectedFile.path) : "Diff"}</h3>
              {selectedFile ? <span>{selectedIsMarkdown ? "Markdown preview" : "Raw diff"}</span> : null}
            </div>
            {selectedIsMarkdown ? (
              <button className="review-action compact" onClick={() => setShowRawDiff((current) => !current)}>
                {showRawDiff ? "Preview" : "Raw diff"}
              </button>
            ) : null}
          </div>
          {selectedIsMarkdown && !showRawDiff && selectedFile?.status !== "deleted" ? (
            <MarkdownPreview
              content={fileContentQuery.data?.content ?? markdownFromAddedDiff(selectedDiff) ?? ""}
              isLoading={fileContentQuery.isLoading}
            />
          ) : (
            <pre className="diff-viewer">{selectedDiff || diffQuery.data || "No diff available yet."}</pre>
          )}
        </section>
      </div>
    </section>
  );
}

function isMarkdownFile(path: string) {
  return /\.md(?:own)?$/i.test(path);
}

function basename(path: string) {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function extractFileDiff(diff: string, path: string) {
  if (!diff.trim()) return "";
  const sections = diff.split(/\n(?=# )/g);
  const section = sections.find((entry) => entry.startsWith(`# ${path}\n`) || entry.startsWith(`\n# ${path}\n`));
  return section?.trimStart() ?? diff;
}

function markdownFromAddedDiff(diff: string) {
  const addedLines = diff
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1));
  return addedLines.length ? addedLines.join("\n") : undefined;
}

function MarkdownPreview({ content, isLoading }: { content: string; isLoading: boolean }) {
  if (isLoading) return <div className="markdown-preview muted">Loading markdown...</div>;
  if (!content.trim()) return <div className="markdown-preview muted">No markdown content available.</div>;

  return <div className="markdown-preview">{renderMarkdown(content)}</div>;
}

function renderMarkdown(content: string) {
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let code: string[] = [];
  let inCode = false;
  let codeLang = "";

  function flushParagraph(index: number) {
    if (!paragraph.length) return;
    blocks.push(<p key={`p-${index}`}>{renderInline(paragraph.join(" "))}</p>);
    paragraph = [];
  }

  function flushList(index: number) {
    if (!list.length) return;
    blocks.push(
      <ul key={`ul-${index}`}>
        {list.map((item, itemIndex) => (
          <li key={`${item}-${itemIndex}`}>{renderInline(item)}</li>
        ))}
      </ul>,
    );
    list = [];
  }

  content.split(/\r?\n/).forEach((line, index) => {
    const codeFence = line.match(/^```(\w+)?\s*$/);
    if (codeFence) {
      if (inCode) {
        blocks.push(
          <pre key={`code-${index}`} className="markdown-code">
            {codeLang ? <span>{codeLang}</span> : null}
            <code>{code.join("\n")}</code>
          </pre>,
        );
        code = [];
        codeLang = "";
        inCode = false;
      } else {
        flushParagraph(index);
        flushList(index);
        inCode = true;
        codeLang = codeFence[1] ?? "";
      }
      return;
    }

    if (inCode) {
      code.push(line);
      return;
    }

    if (!line.trim()) {
      flushParagraph(index);
      flushList(index);
      return;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph(index);
      flushList(index);
      const level = heading[1].length;
      blocks.push(renderHeading(`h-${index}`, level, heading[2]));
      return;
    }

    const item = line.match(/^\s*[-*]\s+(.+)$/);
    if (item) {
      flushParagraph(index);
      list.push(item[1]);
      return;
    }

    flushList(index);
    paragraph.push(line.trim());
  });

  if (inCode) {
    blocks.push(
      <pre key="code-last" className="markdown-code">
        {codeLang ? <span>{codeLang}</span> : null}
        <code>{code.join("\n")}</code>
      </pre>,
    );
  }
  flushParagraph(content.length);
  flushList(content.length);

  return blocks;
}

function renderInline(text: string) {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const value = match[0];
    if (value.startsWith("`")) {
      nodes.push(<code key={`${value}-${match.index}`}>{value.slice(1, -1)}</code>);
    } else {
      nodes.push(<strong key={`${value}-${match.index}`}>{value.slice(2, -2)}</strong>);
    }
    lastIndex = match.index + value.length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function renderHeading(key: string, level: number, text: string) {
  if (level === 1) return <h2 key={key}>{renderInline(text)}</h2>;
  if (level === 2) return <h3 key={key}>{renderInline(text)}</h3>;
  if (level === 3) return <h4 key={key}>{renderInline(text)}</h4>;
  return <h5 key={key}>{renderInline(text)}</h5>;
}
