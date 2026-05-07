# Codex Linux System Console — System Design

> A Linux desktop control panel for Codex CLI, focused on system configuration, dotfiles, scripts, services, and safe local changes without requiring a project workspace.

## 1. Background

Codex CLI and Codex IDE integrations are naturally project-oriented: they assume that the user is working inside a repository or an explicit workspace directory.

This is suitable for software development, but inconvenient for Linux workstation maintenance tasks such as:

- adjusting shell configuration;
- managing `~/.config`;
- writing or updating personal scripts;
- diagnosing systemd user services;
- reviewing `dnf`, `rpm`, or `flatpak` state;
- fixing desktop environment issues;
- making safe local configuration changes outside a Git repository.

This project provides a Linux desktop GUI on top of Codex CLI, optimized for **system-level personal workstation tasks** rather than repository-bound development.

The application should not replace VS Code, Cursor, or Codex IDE integrations. Its value is in handling **non-project local system work** safely and visibly.

---

## 2. Product Positioning

### 2.1 One-sentence positioning

A Linux desktop system-maintenance console powered by Codex CLI, providing safe task execution, scoped filesystem access, diff review, rollback, and task history without requiring the user to select a project directory.

### 2.2 Target user

Primary user:

- Linux desktop user;
- developer or power user;
- comfortable with terminal commands;
- wants AI assistance for system configuration and local automation;
- does not want every task to be modeled as a software project.

Initial target environment:

- Fedora KDE / Fedora Workstation;
- Wayland or X11;
- user-level system maintenance;
- no privileged background daemon in MVP.

### 2.3 Non-goals

The MVP is **not**:

- a full IDE;
- a VS Code replacement;
- a full terminal emulator replacement;
- a generic multi-agent orchestration platform;
- a remote server management tool;
- a root-level system automation daemon;
- a package manager frontend;
- a replacement for Codex CLI internals.

The application may include a lightweight terminal for task-adjacent command interaction, but it should not try to compete with mature terminal emulators such as Konsole, GNOME Terminal, WezTerm, Alacritty, or Kitty.

---

## 3. Core Design Principle

The user should not need to choose a directory first.

Instead of asking:

```text
Which project do you want to open?
```

The application asks:

```text
What kind of system task do you want to perform?
```

The application internally resolves:

- working directory;
- readable paths;
- writable paths;
- denied paths;
- command policy;
- context collection;
- snapshot strategy;
- rollback strategy.

This is the key product difference from IDE-based Codex usage.

---

## 4. Recommended Technology Stack

### 4.1 Desktop framework

```text
Tauri 2
```

Reasons:

- better Linux desktop fit than Electron for a small utility;
- lower memory footprint;
- strong Rust backend integration;
- suitable for process control and filesystem operations;
- supports RPM, AppImage, deb, and other Linux packaging formats.

### 4.2 Frontend

```text
React
TypeScript
Vite
Tailwind CSS
shadcn/ui
Zustand
TanStack Query
xterm.js
CodeMirror 6
```

Responsibilities:

- profile selection;
- task input;
- Codex output display;
- lightweight terminal display;
- context panel;
- diff review;
- task history;
- settings UI.

### 4.3 Backend

```text
Rust
Tauri commands
tokio
tokio::process
serde
sqlx + SQLite
walkdir
ignore
similar
directories
notify optional
```

Responsibilities:

- start and manage Codex CLI processes;
- start and manage user shell PTY sessions;
- enforce command and path policy;
- collect system context;
- snapshot files;
- detect changed files;
- generate diffs;
- rollback changes;
- persist task/session metadata;
- invoke system tools such as `git`, `xdg-open`, `gio`, `systemctl`, `journalctl`.

### 4.4 Local storage

```text
SQLite for metadata
Filesystem for logs, snapshots, patches
```

Recommended data directory:

```text
~/.local/share/codex-system-console/
```

Recommended config directory:

```text
~/.config/codex-system-console/
```

---

## 5. High-Level Architecture

```text
┌──────────────────────────────────────────────┐
│ Frontend                                     │
│ React / TypeScript / Tailwind / shadcn       │
│                                              │
│ - Profile selector                           │
│ - Task composer                              │
│ - Output viewer                              │
│ - Context viewer                             │
│ - Diff viewer                                │
│ - Rollback UI                                │
│ - Settings UI                                │
└───────────────────────┬──────────────────────┘
                        │ Tauri commands/events
                        ▼
┌──────────────────────────────────────────────┐
│ Application Service Layer                    │
│                                              │
│ - Task service                               │
│ - Profile service                            │
│ - Context service                            │
│ - Snapshot service                           │
│ - Diff service                               │
│ - Permission service                         │
│ - Settings service                           │
└───────────────────────┬──────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────┐
│ Adapter Layer                                │
│                                              │
│ - Codex CLI adapter                          │
│ - Git adapter                                │
│ - Shell command adapter                      │
│ - Systemd adapter                            │
│ - Package state adapter                      │
└───────────────────────┬──────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────┐
│ System Layer                                 │
│                                              │
│ - Filesystem                                 │
│ - Local shell                                │
│ - Codex CLI                                  │
│ - SQLite                                     │
│ - systemctl / journalctl / dnf / rpm         │
└──────────────────────────────────────────────┘
```

---

## 6. Main Concepts

## 6.1 Task Profile

A task profile describes a system maintenance context.

Examples:

- General;
- Fedora System;
- KDE / Plasma;
- Shell;
- Scripts;
- systemd User Services;
- Packages;
- Custom.

A profile defines:

- display name;
- default working directory;
- readable paths;
- writable paths;
- denied paths;
- allowed readonly commands;
- denied commands;
- context collection commands;
- whether write operations are allowed;
- whether snapshots are required.

### Example profile

```toml
[profiles.shell]
name = "Shell"
description = "Shell configuration, aliases, PATH, environment variables"
cwd = "$HOME"
write_enabled = true
snapshot_required = true

read_paths = [
  "$HOME/.bashrc",
  "$HOME/.zshrc",
  "$HOME/.profile",
  "$HOME/.config/environment.d",
  "$HOME/.local/bin",
  "$HOME/Scripts"
]

write_paths = [
  "$HOME/.bashrc",
  "$HOME/.zshrc",
  "$HOME/.profile",
  "$HOME/.config/environment.d",
  "$HOME/.local/bin",
  "$HOME/Scripts"
]

deny_paths = [
  "$HOME/.ssh",
  "$HOME/.gnupg",
  "$HOME/.local/share/keyrings",
  "$HOME/.config/google-chrome",
  "$HOME/.config/microsoft-edge",
  "/etc",
  "/usr",
  "/boot",
  "/var"
]

readonly_commands = [
  "uname -a",
  "cat /etc/os-release",
  "echo $SHELL",
  "echo $PATH",
  "ls -la $HOME",
  "ls -la $HOME/.config/environment.d"
]

deny_commands = [
  "sudo",
  "su",
  "rm -rf",
  "dd",
  "mkfs",
  "mount",
  "umount",
  "chmod -R",
  "chown -R"
]
```

---

## 6.2 Task

A task is one Codex-driven unit of work.

A task contains:

- user prompt;
- selected profile;
- resolved working directory;
- collected context;
- Codex command;
- stdout/stderr logs;
- changed files;
- diff snapshot;
- status;
- exit code;
- rollback state.

Statuses:

```text
pending
collecting_context
running
awaiting_review
applied
rolled_back
failed
cancelled
```

---

## 6.3 Session

A session groups related tasks.

For example:

```text
Session: Fix Fedora Chinese input environment
  Task 1: Diagnose current fcitx5 environment
  Task 2: Propose environment.d changes
  Task 3: Apply config patch
  Task 4: Validate after restart
```

Sessions are useful for history and continuity, but they should not be required to start a quick task.

---

## 7. Execution Modes

## 7.1 Diagnose Mode

Read-only.

Purpose:

- inspect current system state;
- collect relevant context;
- ask Codex to explain or propose a plan;
- do not modify files.

Allowed operations:

- read allowlisted files;
- run allowlisted readonly commands;
- call Codex CLI with context;
- save output and task history.

Disallowed operations:

- file writes;
- destructive commands;
- privileged commands;
- package installation/removal;
- service modification.

Typical examples:

```text
"Why does my VS Code not receive Chinese input under Wayland?"
"Check whether my shell PATH is configured cleanly."
"Analyze why this systemd user service fails."
```

---

## 7.2 Patch Mode

Controlled write mode.

Purpose:

- allow Codex to modify user-owned configuration files and scripts;
- always create pre-change snapshots;
- always show diff before final acceptance.

Allowed operations:

- write files under profile write allowlist;
- generate or modify scripts;
- edit user-level systemd unit files;
- run validation commands if allowed.

Disallowed operations by default:

- writing `/etc`;
- running `sudo`;
- modifying system packages;
- destructive filesystem operations;
- modifying secret directories.

Typical examples:

```text
"Clean up my zsh configuration."
"Create a restart-after-suspend script under ~/Scripts."
"Write a systemd user service for this script."
```

---

## 7.3 Command Suggestion Mode

For privileged or risky operations.

Codex may suggest commands, but the application does not execute them.

Examples:

```bash
sudo dnf upgrade
sudo systemctl restart bluetooth
sudo cp ./foo.service /etc/systemd/system/
```

The UI should render these as suggested commands with copy buttons, not as executable actions.

---

## 8. Codex CLI Integration

## 8.1 Basic approach

The application uses Codex CLI as an external executable.

The app should not depend on Codex internal implementation details.

The Codex adapter should encapsulate:

- executable discovery;
- version detection;
- command construction;
- environment variables;
- working directory;
- stdout/stderr streaming;
- process cancellation;
- exit code handling.

## 8.2 Executable discovery

Lookup order:

```text
1. User-configured Codex binary path
2. PATH lookup: codex
3. Common npm global binary locations
4. Error with setup guidance
```

The application should expose:

```text
Settings → Codex CLI → Binary path
Settings → Codex CLI → Version check
```

## 8.3 Recommended MVP invocation

Use non-interactive execution:

```bash
codex exec "<task prompt>"
```

The backend should set:

- `cwd`;
- environment variables;
- inherited user shell environment where appropriate;
- controlled task prompt;
- optional sandbox/approval flags if supported by the installed Codex CLI version.

## 8.4 Prompt construction

The application should wrap the user's prompt with system-maintenance context.

Example prompt template:

```text
You are assisting with a Linux workstation maintenance task.

Task profile:
- Name: Shell
- Working directory: /home/alex
- Write mode: patch
- Writable paths:
  - /home/alex/.zshrc
  - /home/alex/.config/environment.d
  - /home/alex/Scripts
- Forbidden paths:
  - /home/alex/.ssh
  - /home/alex/.gnupg
  - /etc
  - /usr
  - /boot
  - /var

Rules:
1. Do not modify forbidden paths.
2. Do not run sudo.
3. Do not run destructive commands.
4. Prefer minimal changes.
5. Explain every file change.
6. After changes, provide validation commands.
7. If privileged operations are needed, only suggest commands; do not execute them.

Collected context:
<insert collected context>

User task:
<insert user prompt>
```

## 8.5 Codex CLI setup wizard

The application should provide a first-run setup wizard and keep it available from Settings.

Wizard steps:

1. detect whether `codex` is available on `PATH`;
2. detect common npm global binary locations;
3. allow the user to choose a custom Codex binary path;
4. display detected version and executable path;
5. run a harmless validation check;
6. explain how this app invokes `codex exec`;
7. save the validated configuration.

If Codex CLI is missing, the wizard should show setup guidance instead of failing silently.

The wizard should not install packages automatically in MVP. It can suggest commands for the user to run in the integrated terminal.

---

## 9. Filesystem Safety Model

## 9.1 Path policy

Every profile defines:

- read allowlist;
- write allowlist;
- deny list.

Deny list always wins.

Path resolution rules:

1. expand variables such as `$HOME`;
2. canonicalize paths;
3. resolve symlinks where possible;
4. reject paths escaping allowed directories;
5. reject paths inside denied directories.

## 9.2 Default denied paths

Recommended global deny list:

```text
$HOME/.ssh
$HOME/.gnupg
$HOME/.local/share/keyrings
$HOME/.config/google-chrome
$HOME/.config/chromium
$HOME/.config/microsoft-edge
$HOME/.mozilla
$HOME/.password-store
/etc
/usr
/boot
/var/lib
/var/log
/root
/proc
/sys
/dev
/run
```

## 9.3 Write policy

MVP write policy:

- writes are allowed only under profile write paths;
- every write-mode task must create snapshots;
- changed files must be shown before acceptance;
- rollback must be available;
- symbolic links require explicit handling.

## 9.4 Secret handling

The app must not automatically collect or send:

- private keys;
- tokens;
- browser profiles;
- keyrings;
- password stores;
- `.env` files unless explicitly allowlisted;
- SSH config unless user explicitly enables it.

---

## 10. Snapshot and Rollback

## 10.1 Why snapshots are required

System maintenance tasks often happen outside Git repositories.

Without Git, the app must provide its own safety layer:

- detect changed files;
- show diffs;
- restore previous content;
- preserve task history.

## 10.2 Snapshot directory layout

```text
~/.local/share/codex-system-console/
  tasks/
    <task-id>/
      manifest.json
      stdout.log
      stderr.log
      codex-command.json
      context.md
      diff.patch
      before/
        home/
          alex/
            .zshrc
      after/
        home/
          alex/
            .zshrc
```

## 10.3 Manifest example

```json
{
  "task_id": "task_20260507_001",
  "profile": "shell",
  "mode": "patch",
  "cwd": "/home/alex",
  "started_at": "2026-05-07T10:00:00+09:00",
  "finished_at": "2026-05-07T10:02:30+09:00",
  "changed_files": [
    {
      "path": "/home/alex/.zshrc",
      "before_sha256": "abc",
      "after_sha256": "def",
      "status": "modified"
    }
  ],
  "rollback_available": true
}
```

## 10.4 Snapshot flow

```text
1. Resolve profile policy
2. Collect initial file state from writable paths
3. Save before snapshot
4. Run Codex
5. Scan writable paths again
6. Save after snapshot for changed files
7. Generate unified diff
8. Show review UI
9. User accepts, rolls back, or opens files manually
```

## 10.5 Rollback behavior

Rollback should:

- restore modified files from before snapshot;
- delete newly created files if they were created by the task;
- avoid deleting files that changed after the task unless user confirms;
- create a rollback log entry.

---

## 11. Command Safety Model

## 11.1 Command categories

```text
Readonly:
- uname
- cat
- ls
- find
- grep
- rpm -qa
- dnf repolist
- flatpak list
- systemctl --user status
- journalctl --user

User-level write:
- mkdir under allowlisted paths
- touch under allowlisted paths
- chmod on allowlisted scripts
- systemctl --user daemon-reload
- systemctl --user restart <allowlisted unit>

Privileged:
- sudo
- su
- pkexec
- systemctl without --user
- dnf install/remove/upgrade
- mount/umount
- editing /etc

Dangerous:
- rm -rf
- dd
- mkfs
- wipefs
- chmod -R /
- chown -R /
```

## 11.2 MVP policy

MVP should not try to perfectly sandbox arbitrary shell commands.

Instead:

- Codex runs under the current user;
- profile prompt forbids dangerous behavior;
- app-level execution helpers only expose allowlisted commands;
- privileged commands are suggestion-only;
- user reviews diffs before accepting changes.

A stronger sandbox can be added later.

---

## 12. Lightweight Terminal

## 12.1 Purpose

The application should include a lightweight terminal panel for direct command interaction.

The terminal exists to support system maintenance workflows, not to replace the user's primary terminal emulator.

Typical uses:

- quickly run validation commands suggested by Codex;
- inspect files or service status without leaving the app;
- run Codex CLI setup commands during onboarding;
- compare manual command output with Codex task output;
- continue task-adjacent shell work in the same visual context.

## 12.2 Terminal scope

MVP terminal capability:

- interactive shell through a PTY;
- use the user's default shell;
- working directory follows the selected task profile by default;
- support copy, paste, clear, search, and command history navigation through the shell;
- support multiple terminal tabs only if implementation remains simple;
- display command output with `xterm.js`;
- resize PTY when the panel size changes;
- terminate the shell cleanly when the tab is closed.

MVP terminal exclusions:

- no terminal multiplexing replacement;
- no SSH manager;
- no root shell launcher;
- no sudo automation;
- no package-manager frontend behavior;
- no AI agent control inside arbitrary shell sessions unless routed through explicit task modes.

## 12.3 Terminal safety

The terminal is an explicit user-driven shell, so it cannot be governed as strictly as profile-scoped Codex tasks.

The UI should still make safety boundaries clear:

- terminal tabs should show current working directory and profile;
- terminal sessions should not be treated as reviewed Codex changes;
- terminal commands should not automatically become task history unless attached by the user;
- terminal output can be manually attached to a task as context;
- privileged commands may be typed by the user, but the app should not generate or auto-run them.

For MVP, the terminal should be separated conceptually from Patch Mode:

- Patch Mode: app-managed snapshots, diffs, rollback.
- Terminal: user-managed shell interaction.

## 12.4 Backend implementation

Recommended Rust crates:

```text
portable-pty
tokio
tauri event streaming
```

Terminal backend responsibilities:

- create PTY sessions;
- spawn the user's shell;
- stream PTY output to the frontend;
- receive frontend input and write to PTY;
- resize PTY;
- close sessions;
- persist optional terminal session metadata.

---

## 13. Long-Term Task Sessions and UI Performance

## 13.1 Problem

Long-running maintenance sessions may produce large volumes of:

- Codex messages;
- stdout/stderr output;
- terminal output;
- context snapshots;
- diffs;
- file lists;
- task history entries.

The UI must not keep every full message, log line, and diff in active React state. Otherwise long-term task sessions will eventually make the interface slow or unresponsive.

## 13.2 Design principle

The frontend should display a windowed view of large data, while the backend remains the source of truth.

Store complete history on disk and in SQLite, but load only the visible slice into the UI.

## 13.3 Required strategies

For MVP:

- stream logs incrementally;
- append logs to files instead of storing full logs in memory;
- keep only the latest visible output window in frontend state;
- use virtualized lists for task history, logs, changed files, and long message timelines;
- paginate older task events;
- lazy-load full diffs only when a file is selected;
- cap live terminal scrollback in the browser;
- persist full stdout/stderr under the task directory;
- provide explicit "load older output" behavior for long sessions.

Recommended frontend libraries:

```text
@tanstack/react-virtual
xterm.js scrollback limits
TanStack Query infinite queries
```

## 13.4 Task event storage

Long-term sessions should store event records separately from task summary records.

Recommended additional table:

```sql
CREATE TABLE task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload_path TEXT,
  payload_preview TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_task_events_task_sequence
ON task_events(task_id, sequence);
```

Large event payloads should be written to files and referenced by `payload_path`.

## 13.5 Summaries for continuity

For long-term task sessions, the app should maintain compact session summaries:

- latest task goal;
- important decisions;
- files changed;
- commands suggested;
- validation status;
- open questions.

These summaries are for UI continuity and future prompt construction. They do not replace raw logs, snapshots, or diffs.

---

## 14. Context Collection

## 14.1 Purpose

Codex performs better when it receives relevant system context.

The application should collect context based on selected profile.

## 14.2 Context visibility

All collected context must be visible to the user in the UI.

The app should provide:

```text
Context panel
- Files included
- Commands executed
- Output included
- Excluded sensitive paths
```

## 14.3 Example context commands

### General Linux

```bash
cat /etc/os-release
uname -a
echo $SHELL
echo $XDG_SESSION_TYPE
echo $XDG_CURRENT_DESKTOP
```

### Fedora packages

```bash
dnf repolist
rpm -qa | sort | head -n 200
flatpak list
```

### systemd user services

```bash
systemctl --user list-units --type=service
systemctl --user --failed
journalctl --user -p warning -n 100 --no-pager
```

### Shell

```bash
echo $SHELL
echo $PATH
ls -la "$HOME"
ls -la "$HOME/.config/environment.d"
```

---

## 15. Database Design

## 15.1 Tables

### profiles

```sql
CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  config_toml TEXT NOT NULL,
  built_in INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### sessions

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  profile_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### tasks

```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  profile_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  prompt TEXT NOT NULL,
  cwd TEXT NOT NULL,
  status TEXT NOT NULL,
  exit_code INTEGER,
  stdout_path TEXT,
  stderr_path TEXT,
  context_path TEXT,
  diff_path TEXT,
  manifest_path TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### task_files

```sql
CREATE TABLE task_files (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  path TEXT NOT NULL,
  status TEXT NOT NULL,
  before_sha256 TEXT,
  after_sha256 TEXT,
  created_at TEXT NOT NULL
);
```

### task_events

```sql
CREATE TABLE task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload_path TEXT,
  payload_preview TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_task_events_task_sequence
ON task_events(task_id, sequence);
```

### terminal_sessions

```sql
CREATE TABLE terminal_sessions (
  id TEXT PRIMARY KEY,
  profile_id TEXT,
  cwd TEXT NOT NULL,
  shell_path TEXT NOT NULL,
  title TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT
);
```

### settings

```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

---

## 16. UI Design

## 16.1 Main layout

Three-column layout:

```text
┌────────────────┬─────────────────────────────┬──────────────────────┐
│ Profiles       │ Task Runner / Terminal      │ Context / Changes    │
│                │                             │                      │
│ General        │ Prompt input                │ Collected context    │
│ Fedora System  │                             │ Changed files        │
│ KDE / Plasma   │ Codex output / shell        │ Diff viewer          │
│ Shell          │                             │ Rollback actions     │
│ Scripts        │ Status / logs               │ Suggested commands   │
│ systemd        │                             │                      │
│ Packages       │                             │                      │
└────────────────┴─────────────────────────────┴──────────────────────┘
```

## 16.2 Primary screens

### Home

- select profile;
- recent tasks;
- quick prompt input.

### Task Runner

- prompt composer;
- mode selector: Diagnose / Patch / Suggest Commands;
- live output;
- cancel button.

### Terminal

- lightweight shell panel;
- profile-aware default working directory;
- copy, paste, clear, and search;
- attach selected terminal output to a task as context;
- show clear distinction between terminal output and Codex task output.

### Review Changes

- changed files list;
- unified diff;
- accept/keep changes;
- rollback;
- open file;
- open containing folder.

### Task History

- sessions;
- tasks;
- status;
- changed files;
- logs;
- diff patches.

### Settings

- Codex CLI binary path;
- Codex version check;
- Codex CLI setup wizard;
- default profile;
- data directory;
- custom profiles;
- sensitive path deny list.

### First-run Setup

- detect whether Codex CLI is installed;
- show current Codex binary path and version;
- guide the user through installation options;
- validate that `codex exec` works;
- configure default shell and terminal behavior;
- explain MVP safety rules around sudo, snapshots, diffs, and rollback.

### Branding and Icon

- application icon should be part of the MVP polish scope;
- icon should visually communicate "Codex + Linux workstation control";
- it should remain legible at 16px, 32px, 64px, and 256px;
- provide source SVG plus generated PNG sizes for Linux desktop packaging;
- avoid using OpenAI trademarks or logos unless explicit usage permission is available.

---

## 17. Tauri Command API Draft

Frontend calls backend through Tauri commands.

### 17.1 Profile commands

```ts
type Profile = {
  id: string;
  name: string;
  description?: string;
  cwd: string;
  writeEnabled: boolean;
  snapshotRequired: boolean;
};

async function listProfiles(): Promise<Profile[]>;
async function getProfile(id: string): Promise<Profile>;
async function saveCustomProfile(profile: Profile): Promise<void>;
```

### 17.2 Task commands

```ts
type TaskMode = "diagnose" | "patch" | "suggest_commands";

type StartTaskRequest = {
  profileId: string;
  mode: TaskMode;
  prompt: string;
  sessionId?: string;
};

type StartTaskResponse = {
  taskId: string;
};

async function startTask(req: StartTaskRequest): Promise<StartTaskResponse>;
async function cancelTask(taskId: string): Promise<void>;
async function getTask(taskId: string): Promise<Task>;
async function listRecentTasks(limit: number): Promise<Task[]>;
```

### 17.3 Review commands

```ts
async function getTaskDiff(taskId: string): Promise<string>;
async function listChangedFiles(taskId: string): Promise<ChangedFile[]>;
async function rollbackTask(taskId: string): Promise<void>;
async function openFile(path: string): Promise<void>;
async function openFolder(path: string): Promise<void>;
```

### 17.4 Codex commands

```ts
async function detectCodexCli(): Promise<CodexCliInfo>;
async function validateCodexCli(path?: string): Promise<CodexCliInfo>;
async function saveCodexCliPath(path: string): Promise<void>;

type CodexCliInfo = {
  found: boolean;
  path?: string;
  version?: string;
  error?: string;
};
```

### 17.5 Terminal commands

```ts
type StartTerminalRequest = {
  profileId?: string;
  cwd?: string;
  shellPath?: string;
};

type StartTerminalResponse = {
  terminalId: string;
};

async function startTerminal(req: StartTerminalRequest): Promise<StartTerminalResponse>;
async function writeTerminal(terminalId: string, data: string): Promise<void>;
async function resizeTerminal(terminalId: string, cols: number, rows: number): Promise<void>;
async function closeTerminal(terminalId: string): Promise<void>;
```

---

## 18. Event Streaming

Backend should emit task events to frontend.

```ts
type TaskEvent =
  | { type: "task_started"; taskId: string }
  | { type: "context_collected"; taskId: string; contextPath: string }
  | { type: "stdout"; taskId: string; text: string }
  | { type: "stderr"; taskId: string; text: string }
  | { type: "file_changed"; taskId: string; path: string }
  | { type: "diff_ready"; taskId: string; diffPath: string }
  | { type: "task_finished"; taskId: string; exitCode: number }
  | { type: "task_failed"; taskId: string; error: string }
  | { type: "task_cancelled"; taskId: string };
```

Terminal events should be separate from task events:

```ts
type TerminalEvent =
  | { type: "terminal_started"; terminalId: string }
  | { type: "terminal_output"; terminalId: string; data: string }
  | { type: "terminal_closed"; terminalId: string; exitCode?: number }
  | { type: "terminal_failed"; terminalId: string; error: string };
```

Frontend subscribes and updates:

- live Codex and terminal output;
- task status;
- changed files;
- diff panel.

---

## 19. MVP Scope

## 19.1 MVP features

The first usable version should include:

1. detect Codex CLI;
2. Codex CLI setup wizard;
3. built-in task profiles;
4. no-project task start;
5. diagnose mode;
6. patch mode for user-level files;
7. live stdout/stderr display;
8. lightweight terminal panel;
9. long-session log virtualization and lazy loading;
10. file snapshot before running patch tasks;
11. changed file detection;
12. unified diff display;
13. rollback;
14. task history;
15. open file/folder actions;
16. application icon suitable for Linux desktop packaging.

## 19.2 Built-in profiles for MVP

Start with only four profiles:

```text
General
Shell
Scripts
systemd User Services
```

Avoid starting with package management or KDE/Plasma automation, because those can quickly become too broad.

## 19.3 MVP explicitly excludes

- sudo execution;
- direct package installation/removal;
- editing `/etc`;
- background daemon;
- remote hosts;
- cloud sync;
- plugin system;
- multi-agent execution;
- full terminal emulator replacement.

---

## 20. Development Milestones

## Milestone 0 — Repository setup

Deliverables:

- Tauri 2 + React + TypeScript project;
- Tailwind + shadcn/ui;
- SQLite initialization;
- basic app shell;
- initial app icon source and generated Linux icon sizes.

## Milestone 1 — Codex CLI detection and setup wizard

Deliverables:

- detect `codex` from PATH;
- show version;
- allow custom binary path;
- show setup error if missing;
- provide first-run setup wizard;
- validate `codex exec` with a harmless command or dry-run style check when supported;
- persist Codex CLI settings.

## Milestone 2 — Profiles and task runner

Deliverables:

- built-in profiles;
- prompt input;
- `codex exec` process spawn;
- stdout/stderr streaming;
- cancel running task.

## Milestone 3 — Lightweight terminal

Deliverables:

- PTY-backed terminal sessions;
- xterm.js frontend panel;
- profile-aware default cwd;
- copy, paste, clear, search;
- terminal resize and close handling;
- optional attach-output-to-task action.

## Milestone 4 — Context collection

Deliverables:

- profile-based context collection;
- context preview panel;
- context saved per task;
- sensitive path exclusion.

## Milestone 5 — Snapshot and diff

Deliverables:

- before snapshot;
- after scan;
- changed file detection;
- unified diff generation;
- changed files panel.

## Milestone 6 — Rollback

Deliverables:

- restore modified files;
- remove created files if safe;
- rollback status;
- rollback log.

## Milestone 7 — Long-session performance

Deliverables:

- task event persistence;
- virtualized task history and output views;
- lazy-loaded diffs;
- bounded live log buffers;
- full logs persisted to files;
- compact session summaries.

## Milestone 8 — History and polish

Deliverables:

- recent tasks;
- session grouping;
- open file/folder actions;
- settings page;
- AppImage/RPM packaging.

---

## 21. Important Implementation Notes

## 21.1 Do not trust prompt-level safety alone

The prompt can tell Codex not to run dangerous commands, but the application should still maintain its own guardrails:

- deny sensitive paths;
- snapshot files;
- show diffs;
- never execute sudo in MVP;
- never silently modify system-level files.

## 21.2 Keep the Codex adapter isolated

Codex CLI behavior may change.

Keep all Codex-specific assumptions in one module:

```text
src-tauri/src/adapters/codex.rs
```

Do not scatter Codex command construction across the codebase.

## 21.3 Prefer explicit logs

Every task should be inspectable later.

Store:

- prompt;
- profile;
- resolved policy;
- context;
- command;
- stdout;
- stderr;
- diff;
- changed files;
- rollback result.

## 21.4 Start without a heavy sandbox

A full sandbox is hard.

For MVP, use:

- user-level process execution;
- profile allowlists;
- denied paths;
- no sudo execution;
- snapshot/review/rollback.

Later, evaluate stronger isolation:

- bubblewrap;
- firejail;
- temporary working copies;
- containerized execution.

---

## 22. Suggested Repository Structure

```text
codex-system-console/
  README.md
  SYSTEM_DESIGN.md
  package.json
  assets/
    icon.svg
    icons/
  src/
    main.tsx
    App.tsx
    components/
      layout/
      profiles/
      task-runner/
      terminal/
      diff/
      history/
      setup/
      settings/
    stores/
      taskStore.ts
      profileStore.ts
      terminalStore.ts
    api/
      tauri.ts
    types/
      task.ts
      profile.ts
      terminal.ts
  src-tauri/
    Cargo.toml
    tauri.conf.json
    src/
      main.rs
      commands/
        mod.rs
        profiles.rs
        tasks.rs
        codex.rs
        terminal.rs
        review.rs
        settings.rs
      services/
        mod.rs
        task_service.rs
        profile_service.rs
        context_service.rs
        snapshot_service.rs
        diff_service.rs
        permission_service.rs
        terminal_service.rs
        setup_service.rs
        settings_service.rs
      adapters/
        mod.rs
        codex.rs
        git.rs
        shell.rs
        pty.rs
        systemd.rs
      storage/
        mod.rs
        db.rs
        migrations.rs
      domain/
        mod.rs
        task.rs
        profile.rs
        policy.rs
        snapshot.rs
      utils/
        paths.rs
        hashing.rs
        time.rs
```

---

## 23. Naming Ideas

Possible project names:

```text
codex-system-console
codex-linux-console
codex-workstation
codex-control
codex-local
codex-sysdesk
```

Recommended initial repository name:

```text
codex-system-console
```

It communicates the intent better than a generic “Codex Linux Client”.

---

## 24. Initial README Summary

```markdown
# Codex System Console

Codex System Console is a Linux desktop control panel for Codex CLI.

Unlike IDE integrations that assume a project directory, this app is designed for local workstation maintenance tasks: shell configuration, dotfiles, scripts, systemd user services, and safe user-level system changes.

It provides:

- no-project task execution;
- task profiles;
- lightweight terminal;
- Codex CLI setup wizard;
- context collection;
- live Codex output;
- long-session performance safeguards;
- file snapshots;
- diff review;
- rollback;
- task history.

The app does not execute privileged commands in the MVP. When root-level actions are needed, it presents suggested commands for the user to review and run manually.
```

---

## 25. First Implementation Target

The first development target should be:

```text
User opens app
→ setup wizard verifies Codex CLI
→ selects "Shell" profile
→ enters "Clean up my zsh PATH configuration"
→ app collects shell context
→ app runs codex exec
→ app shows live output
→ app detects ~/.zshrc change
→ app shows diff
→ user accepts or rolls back
```

If this path works cleanly, the product concept is validated.

The terminal validation path should be:

```text
User opens Terminal panel
→ terminal starts in the Shell profile cwd
→ user runs echo $SHELL and echo $PATH
→ terminal output remains responsive
→ user can attach selected output to a Codex task as context
```
