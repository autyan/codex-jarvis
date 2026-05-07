import type { TaskProfile } from "../types/profile";

export const profiles: TaskProfile[] = [
  {
    id: "general",
    name: "General",
    mode: "Diagnose",
    description: "Read-only workstation diagnostics and general context collection.",
    paths: ["$HOME", "$HOME/.config"],
  },
  {
    id: "shell",
    name: "Shell",
    mode: "Patch",
    description: "Shell configuration, aliases, PATH, and environment variables.",
    paths: ["$HOME/.zshrc", "$HOME/.profile", "$HOME/.config/environment.d"],
  },
  {
    id: "scripts",
    name: "Scripts",
    mode: "Patch",
    description: "Personal scripts and user-owned automation under local paths.",
    paths: ["$HOME/.local/bin", "$HOME/Scripts"],
  },
  {
    id: "systemd-user",
    name: "systemd User",
    mode: "Patch",
    description: "User-level systemd service diagnostics and unit files.",
    paths: ["$HOME/.config/systemd/user"],
  },
];

