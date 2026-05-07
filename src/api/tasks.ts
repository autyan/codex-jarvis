import { invoke } from "@tauri-apps/api/core";
import type {
  ApplyReviewResult,
  ChangedFile,
  ChangedFileContent,
  PruneSessionsResult,
  RollbackResult,
  StartDiagnoseTaskRequest,
  StartPatchTaskRequest,
  StartTaskResponse,
  SudoDecisionResult,
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

export function renameTask(taskId: string, title: string) {
  return invoke<void>("rename_task", { taskId, title });
}

export function listTaskEvents(taskId: string, offset = 0, limit = 200) {
  return invoke<TaskEventPage>("list_task_events", { taskId, offset, limit });
}

export function listRecentTasks(limit = 30) {
  return invoke<TaskSummary[]>("list_recent_tasks", { limit });
}

export function pruneSessions(maxUnpinned = 64, protectedTaskIds: string[] = []) {
  return invoke<PruneSessionsResult>("prune_sessions", { maxUnpinned, protectedTaskIds });
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

export function applyTaskReview(taskId: string) {
  return invoke<ApplyReviewResult>("apply_task_review", { taskId });
}

export function decideSudoRequest(taskId: string, requestId: string, allow: boolean, password?: string) {
  return invoke<SudoDecisionResult>("decide_sudo_request", { taskId, requestId, allow, password });
}

export function rollbackTask(taskId: string) {
  return invoke<RollbackResult>("rollback_task", { taskId });
}
