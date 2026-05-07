export type LinuxDomainId =
  | "user-config"
  | "user-scripts"
  | "user-services"
  | "packages"
  | "toolchains"
  | "system-services"
  | "logs"
  | "storage"
  | "network"
  | "security"
  | "boot-kernel";

export type DomainAccess = "read" | "draft" | "plan";

export type ProfileDomain = {
  domainId: LinuxDomainId;
  access: DomainAccess;
};

export type TaskProfile = {
  id: string;
  name: string;
  description: string;
  platform: "linux";
  domains: ProfileDomain[];
  defaultMode: "diagnose" | "patch" | "suggest_commands";
  cwd: string;
  writeEnabled: boolean;
  snapshotRequired: boolean;
  readPaths: string[];
  writePaths: string[];
  denyPaths: string[];
  readonlyCommands: string[];
};

export function formatTaskMode(mode: TaskProfile["defaultMode"]) {
  if (mode === "suggest_commands") return "Suggest";
  return mode[0].toUpperCase() + mode.slice(1);
}

export function profilePathSummary(profile: TaskProfile) {
  return {
    readable: profile.readPaths.length,
    writable: profile.writePaths.length,
    denied: profile.denyPaths.length,
  };
}

export type PathPolicyGroup = {
  label: string;
  paths: string[];
};
