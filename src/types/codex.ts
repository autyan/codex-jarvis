export type CodexCliInfo = {
  found: boolean;
  path?: string;
  version?: string;
  error?: string;
};

export type SetCodexCliPathRequest = {
  path: string;
};

export type CodexReasoningEffort = "low" | "medium" | "high";

export type AppSettings = {
  codexCliPath?: string;
  sudoFlowEnabled: boolean;
  codexModel?: string;
  codexReasoningEffort: CodexReasoningEffort;
  sessionRetentionLimit: number;
};

export type SetCodexModelSettingsRequest = {
  codexModel?: string;
  codexReasoningEffort: CodexReasoningEffort;
};

export type CodexSetupStatus = "idle" | "checking" | "ready" | "missing" | "unavailable";
