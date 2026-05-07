export type TaskMode = "diagnose" | "patch" | "suggest_commands";

export type TaskStatus = "idle" | "starting" | "running" | "context_collected" | "finished" | "failed" | "cancelled";

export type StartDiagnoseTaskRequest = {
  taskId?: string;
  profileId: string;
  prompt: string;
};

export type StartTaskResponse = {
  taskId: string;
};

export type TaskEvent = {
  taskId: string;
  event:
    | "task_started"
    | "context_collected"
    | "stdout"
    | "stderr"
    | "task_finished"
    | "task_failed"
    | "task_cancelled";
  text?: string;
  status?: TaskStatus;
  exitCode?: number;
};

export type TaskLogLine = {
  id: string;
  source: "system" | "context" | "stdout" | "stderr";
  text: string;
};
