import { invoke } from "@tauri-apps/api/core";
import type { StartTerminalRequest, StartTerminalResponse } from "../types/terminal";

export function startTerminal(request: StartTerminalRequest) {
  return invoke<StartTerminalResponse>("start_terminal", { request });
}

export function writeTerminal(terminalId: string, data: string) {
  return invoke<void>("write_terminal", { terminalId, data });
}

export function resizeTerminal(terminalId: string, cols: number, rows: number) {
  return invoke<void>("resize_terminal", { terminalId, cols, rows });
}

export function closeTerminal(terminalId: string) {
  return invoke<void>("close_terminal", { terminalId });
}

