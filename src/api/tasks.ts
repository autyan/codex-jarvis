import { invoke } from "@tauri-apps/api/core";
import type { StartDiagnoseTaskRequest, StartTaskResponse, TaskEventPage, TaskSummary } from "../types/task";

export function startDiagnoseTask(request: StartDiagnoseTaskRequest) {
  return invoke<StartTaskResponse>("start_diagnose_task", { request });
}

export function cancelTask(taskId: string) {
  return invoke<void>("cancel_task", { taskId });
}

export function listTaskEvents(taskId: string, offset = 0, limit = 200) {
  return invoke<TaskEventPage>("list_task_events", { taskId, offset, limit });
}

export function listRecentTasks(limit = 30) {
  return invoke<TaskSummary[]>("list_recent_tasks", { limit });
}
