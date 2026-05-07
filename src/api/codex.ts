import { invoke } from "@tauri-apps/api/core";
import type { CodexCliInfo, SetCodexCliPathRequest } from "../types/codex";

export async function detectCodexCli(): Promise<CodexCliInfo> {
  try {
    return await invoke<CodexCliInfo>("detect_codex_cli");
  } catch (error) {
    return {
      found: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function setCodexCliPath(request: SetCodexCliPathRequest): Promise<CodexCliInfo> {
  return invoke<CodexCliInfo>("set_codex_cli_path", { request });
}
