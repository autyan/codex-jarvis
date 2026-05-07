# Codex Jarvis

Codex Jarvis is a Linux desktop control panel for Codex CLI.

Unlike IDE integrations that assume a project directory, this app is designed for local workstation maintenance tasks: shell configuration, dotfiles, scripts, systemd user services, and safe user-level system changes.

## Goals

- Start Codex-assisted tasks without choosing a project directory first.
- Provide task profiles for common workstation maintenance contexts.
- Collect visible, profile-scoped system context before a task runs.
- Run Codex CLI through a controlled desktop workflow.
- Show live task output without letting long sessions freeze the UI.
- Snapshot files before patch tasks, show diffs, and support rollback.
- Include a lightweight terminal for direct user-driven shell interaction.
- Provide a first-run Codex CLI setup wizard.

## MVP Scope

The first usable version targets:

- Fedora KDE / Fedora Workstation;
- user-level system maintenance;
- Codex CLI detection and setup;
- Linux-only domain model with built-in profiles: Daily Maintenance, Dev Environment, Service Debugging, Package Maintenance, Deep System Review;
- Diagnose, Patch, and Suggested Commands modes;
- PTY-backed terminal panel;
- task history with virtualized long-session output;
- diff review and rollback.

The MVP does not execute privileged commands, edit `/etc`, install packages, or act as a full terminal emulator replacement.

## Tech Stack

- Tauri 2
- React
- TypeScript
- Vite
- Tailwind CSS
- Zustand
- TanStack Query
- xterm.js
- CodeMirror 6
- SQLite through the Tauri backend

## Development

Prerequisites:

- Node.js 22+
- pnpm 10.33.4
- system Rust toolchain with Cargo
- Codex CLI for end-to-end local validation
- Fedora Tauri build dependencies:

```bash
sudo dnf install -y rust cargo rustfmt dbus-devel webkit2gtk4.1-devel libappindicator-gtk3-devel librsvg2-devel
```

Install dependencies:

```bash
pnpm install
```

Run the frontend only:

```bash
pnpm run dev
```

Run the Tauri app:

```bash
pnpm run tauri dev
```

Build the frontend:

```bash
pnpm run build
```

## Design Docs

- [System design](./SYSTEM_DESIGN_codex_system_console.md)
- [Wireframe V1](./WIREFRAME_codex_system_console.md)

## License

MIT
