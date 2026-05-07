export type CodexCliInfo = {
  found: boolean;
  path?: string;
  version?: string;
  error?: string;
};

export type CodexSetupStatus = "idle" | "checking" | "ready" | "missing" | "unavailable";

