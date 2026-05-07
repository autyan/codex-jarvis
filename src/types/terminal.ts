export type StartTerminalRequest = {
  profileId?: string;
  cwd?: string;
  shellPath?: string;
  cols?: number;
  rows?: number;
};

export type StartTerminalResponse = {
  terminalId: string;
};

export type TerminalEvent = {
  terminalId: string;
  event: "terminal_started" | "terminal_output" | "terminal_closed" | "terminal_failed";
  data?: string;
  exitCode?: number;
};

