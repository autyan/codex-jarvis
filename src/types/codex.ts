export type CodexCliInfo = {
  found: boolean;
  path?: string;
  version?: string;
  error?: string;
};

export type SetCodexCliPathRequest = {
  path: string;
};

export type AppSettings = {
  codexCliPath?: string;
  sudoFlowEnabled: boolean;
};

export type CodexSetupStatus = "idle" | "checking" | "ready" | "missing" | "unavailable";
