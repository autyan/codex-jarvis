# Codex Jarvis Implementation Stages

This project lands directly on `main` in small, reviewable commits. Each stage should leave the app in a buildable state and should have a concrete validation command.

## Stage 0 — Project Foundation

Status: complete

Goal:

- establish the public repository and baseline Tauri + React project shell.

Delivered:

- Tauri 2 skeleton;
- React + TypeScript + Vite frontend;
- Tailwind CSS styling;
- pnpm lockfile and package manager pin;
- Rust toolchain pin;
- README, MIT license, system design, wireframe, and icon assets.

Validation:

```bash
pnpm install --frozen-lockfile
pnpm run build
```

## Stage 1 — Codex CLI Setup

Status: complete

Goal:

- make the first-run experience explicit and verify whether Codex CLI is available.

Deliverables:

- setup wizard screen;
- Codex CLI detection through Tauri command;
- visible binary path, version, and error state;
- settings entry point for rerunning setup;
- clear guidance when Codex CLI is missing.

Validation:

```bash
pnpm run build
pnpm exec tauri dev
```

## Stage 2 — Profiles and Safety Policy

Status: complete

Goal:

- turn profile definitions into a shared domain model used by UI and backend.

Deliverables:

- built-in profiles: General, Shell, Scripts, systemd User Services;
- read, write, and deny path policies;
- default cwd per profile;
- mode defaults;
- inspector rendering from structured policy;
- backend profile listing command.

Validation:

```bash
pnpm run build
cargo check
```

## Stage 3 — Diagnose Task Runner

Status: complete

Goal:

- support read-only Codex-assisted diagnostics without file writes.

Deliverables:

- task composer;
- context collection preview;
- `codex exec` process launch;
- stdout/stderr streaming;
- cancellation;
- task status transitions;
- logs persisted under the app data directory.

Validation:

```bash
pnpm run build
pnpm exec tauri dev
```

## Stage 4 — Long-Session Event Store

Status: complete

Goal:

- prevent long-running sessions from making the UI slow.

Deliverables:

- task event table;
- append-only event files for large payloads;
- virtualized output/history lists;
- bounded live output buffers;
- "load older output" behavior;
- compact session summary model.

Validation:

```bash
pnpm run build
cargo test
```

## Stage 5 — Patch Mode Snapshots and Diff Review

Status: complete

Goal:

- allow scoped user-level file changes with visible review.

Deliverables:

- before snapshots for writable paths;
- changed-file scan after task execution;
- after snapshots;
- unified diff generation;
- Review tab with changed files and lazy-loaded diffs;
- open file/folder actions.

Validation:

```bash
pnpm run build
cargo test
```

## Stage 6 — Rollback

Status: complete

Goal:

- make patch tasks reversible outside Git repositories.

Deliverables:

- restore modified files from before snapshots;
- delete newly created files when safe;
- detect post-task edits before rollback;
- rollback log;
- task status updates.

Validation:

```bash
pnpm run build
cargo test
```

## Stage 7 — Lightweight Terminal

Goal:

- provide a user-driven shell for task-adjacent command interaction.

Deliverables:

- PTY-backed terminal sessions;
- xterm.js terminal panel;
- profile-aware default cwd;
- resize and close handling;
- capped browser scrollback;
- attach selected output to active task context.

Validation:

```bash
pnpm run build
pnpm exec tauri dev
```

## Stage 8 — History, Settings, and Packaging Polish

Goal:

- make the app useful over repeated maintenance sessions.

Deliverables:

- recent tasks and sessions;
- settings for Codex CLI, terminal, profiles, data directory, and safety paths;
- AppImage/RPM/deb packaging;
- final icon polish and Linux desktop metadata.

Validation:

```bash
pnpm run build
pnpm exec tauri build
```
