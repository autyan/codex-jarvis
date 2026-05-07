import { invoke } from "@tauri-apps/api/core";
import type { StartDiagnoseTaskRequest, StartTaskResponse } from "../types/task";

export function startDiagnoseTask(request: StartDiagnoseTaskRequest) {
  return invoke<StartTaskResponse>("start_diagnose_task", { request });
}

export function cancelTask(taskId: string) {
  return invoke<void>("cancel_task", { taskId });
}

