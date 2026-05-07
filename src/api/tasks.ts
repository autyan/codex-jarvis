import { invoke } from "@tauri-apps/api/core";
import type {
  ChangedFile,
  ChangedFileContent,
  RollbackResult,
  StartDiagnoseTaskRequest,
  StartPatchTaskRequest,
  StartTaskResponse,
  TaskEventPage,
  TaskSummary,
} from "../types/task";

export function startDiagnoseTask(request: StartDiagnoseTaskRequest) {
  return invoke<StartTaskResponse>("start_diagnose_task", { request });
}

export function startPatchTask(request: StartPatchTaskRequest) {
  return invoke<StartTaskResponse>("start_patch_task", { request });
}

export function cancelTask(taskId: string) {
  return invoke<void>("cancel_task", { taskId });
}

export function deleteTask(taskId: string) {
  return invoke<void>("delete_task", { taskId });
}

export function listTaskEvents(taskId: string, offset = 0, limit = 200) {
  return invoke<TaskEventPage>("list_task_events", { taskId, offset, limit });
}

export function listRecentTasks(limit = 30) {
  return invoke<TaskSummary[]>("list_recent_tasks", { limit });
}

export function listChangedFiles(taskId: string) {
  return invoke<ChangedFile[]>("list_changed_files", { taskId });
}

export function getTaskDiff(taskId: string) {
  return invoke<string>("get_task_diff", { taskId });
}

export function readChangedFile(taskId: string, path: string) {
  return invoke<ChangedFileContent>("read_changed_file", { taskId, path });
}

export function rollbackTask(taskId: string) {
  return invoke<RollbackResult>("rollback_task", { taskId });
}
