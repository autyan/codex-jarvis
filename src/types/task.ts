export type TaskStatus =
  | "idle"
  | "starting"
  | "running"
  | "snapshot_created"
  | "context_collected"
  | "awaiting_review"
  | "finished"
  | "failed"
  | "cancelled";

export type StartDiagnoseTaskRequest = {
  taskId?: string;
  profileId: string;
  prompt: string;
  userMessage?: string;
  attachedContext?: string;
  directExecute?: boolean;
  codexModel?: string;
  codexReasoningEffort?: "low" | "medium" | "high";
};

export type StartPatchTaskRequest = StartDiagnoseTaskRequest;

export type StartTaskResponse = {
  taskId: string;
};

export type TaskEvent = {
  taskId: string;
  event:
    | "task_started"
    | "user_message"
    | "context_collected"
    | "snapshot_created"
    | "stdout"
    | "execution_output"
    | "stderr"
    | "sudo_request"
    | "file_changed"
    | "diff_ready"
    | "rolled_back"
    | "task_finished"
    | "task_failed"
    | "task_cancelled";
  text?: string;
  status?: TaskStatus;
  exitCode?: number;
};

export type TaskLogLine = {
  id: string;
  source: "user" | "assistant" | "system" | "context" | "stdout" | "stderr";
  text: string;
};

export type PersistedTaskEvent = {
  sequence: number;
  taskId: string;
  event: TaskEvent["event"];
  source: TaskLogLine["source"];
  text?: string;
  textPreview?: string;
  payloadPath?: string;
  status?: TaskStatus;
  exitCode?: number;
  createdAt: number;
};

export type TaskEventPage = {
  taskId: string;
  events: PersistedTaskEvent[];
  offset: number;
  limit: number;
  total: number;
};

export type TaskSummary = {
  taskId: string;
  title?: string;
  updatedAt: number;
  eventCount: number;
  latestStatus?: TaskStatus;
  latestPreview?: string;
};

export type PruneSessionsResult = {
  deleted: string[];
  keptLimit: number;
};

export type ChangedFile = {
  path: string;
  status: "created" | "modified" | "deleted";
  beforeHash?: string;
  afterHash?: string;
};

export type ChangedFileContent = {
  path: string;
  content: string;
};

export type RollbackResult = {
  taskId: string;
  restored: string[];
  deleted: string[];
  skipped: string[];
};

export type ApplyReviewResult = {
  taskId: string;
  accepted: string[];
  executionStarted: boolean;
};

export type SudoRequest = {
  requestId: string;
  taskId: string;
  reason: string;
  domain: string;
  risk: string;
  commands: string[];
  createdAt: number;
};

export type SudoDecisionResult = {
  taskId: string;
  requestId: string;
  exitCode?: number;
};
