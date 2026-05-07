# Codex System Console — Wireframe V1

> Low-fidelity UI redesign for a Linux desktop Codex system-maintenance console with task runner, lightweight terminal, setup wizard, review flow, and long-session performance safeguards.

## 1. Design Direction

The app should feel like a focused workstation control surface, not an IDE and not a marketing dashboard.

Primary design goals:

- make "what task am I doing?" obvious;
- keep Codex task output, terminal output, context, and diffs visually separate;
- avoid rendering huge histories directly in the main view;
- make safety state visible before and after changes;
- make first-run Codex CLI setup hard to miss but not intrusive after setup.

The main interface should use a stable shell:

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Top Bar                                                                      │
├───────────────┬───────────────────────────────────────────────┬──────────────┤
│ Navigation    │ Main Workspace                                │ Inspector    │
│               │                                               │              │
│ Profiles      │ Task / Terminal / Review / History            │ Context      │
│ Sessions      │                                               │ Changes      │
│ Settings      │                                               │ Safety       │
└───────────────┴───────────────────────────────────────────────┴──────────────┘
```

The main workspace should switch modes through tabs, not by replacing the entire app frame.

---

## 2. First Run Setup

Shown when Codex CLI is not configured or validation failed.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Codex System Console                                             Settings ⚙ │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Codex CLI Setup                                                             │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ Status                                                                 │  │
│  │                                                                        │  │
│  │  Codex CLI: Not configured                                             │  │
│  │  Expected command: codex exec                                           │  │
│  │                                                                        │  │
│  │  [Detect Again]  [Choose Binary...]                                    │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ Install Guidance                                                       │  │
│  │                                                                        │  │
│  │  Suggested command                                                     │  │
│  │  ┌──────────────────────────────────────────────────────────────────┐  │  │
│  │  │ npm install -g @openai/codex                                      │  │  │
│  │  └──────────────────────────────────────────────────────────────────┘  │  │
│  │                                                                        │  │
│  │  [Open Terminal Below]  [Copy Command]                                 │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ Terminal                                                               │  │
│  │                                                                        │  │
│  │  $                                                                     │  │
│  │                                                                        │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│                                                         [Skip] [Validate →]  │
└──────────────────────────────────────────────────────────────────────────────┘
```

Notes:

- setup uses the integrated terminal only as a convenience;
- the app should not auto-install Codex in MVP;
- once configured, this screen becomes available from Settings.

---

## 3. Main App Shell

Default view after setup.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Codex System Console      Shell profile        Codex OK        New Task  ⚙  │
├───────────────┬───────────────────────────────────────────────┬──────────────┤
│ Profiles      │ Tabs                                          │ Inspector    │
│               │ [Task] [Terminal] [Review] [History]          │              │
│  General      ├───────────────────────────────────────────────┤ Safety       │
│  Shell ●      │                                               │              │
│  Scripts      │                                               │ Mode: Patch  │
│  systemd      │                                               │ Snapshots: On│
│               │                                               │ Sudo: Blocked│
│ Sessions      │                                               │              │
│               │                                               │ Context      │
│  Current      │                                               │              │
│  Recent       │                                               │  4 files     │
│  Archived     │                                               │  5 commands  │
│               │                                               │              │
│               │                                               │ Changes      │
│               │                                               │              │
│               │                                               │  None yet    │
└───────────────┴───────────────────────────────────────────────┴──────────────┘
```

Left navigation is for persistent orientation.

Main workspace is for active work.

Right inspector is for safety, context, changed files, and selected details.

---

## 4. Task Runner

Primary workflow for Codex-assisted system tasks.

```text
┌───────────────┬───────────────────────────────────────────────┬──────────────┐
│ Profiles      │ Task                                          │ Inspector    │
│               │ [Task] [Terminal] [Review] [History]          │              │
│  General      ├───────────────────────────────────────────────┤ Profile      │
│  Shell ●      │ Task Profile                                  │              │
│  Scripts      │ ┌───────────────┐ ┌───────────────┐           │ Shell        │
│  systemd      │ │ Shell         │ │ Patch         │           │ cwd: $HOME   │
│               │ └───────────────┘ └───────────────┘           │              │
│ Sessions      │                                               │ Writable     │
│               │ Prompt                                        │              │
│  Current ●    │ ┌───────────────────────────────────────────┐ │ ~/.zshrc     │
│  PATH cleanup │ │ Clean up my zsh PATH configuration         │ │ ~/.profile   │
│  fcitx issue  │ │                                           │ │ ~/.local/bin │
│               │ └───────────────────────────────────────────┘ │              │
│               │                                               │ Denied       │
│               │ [Collect Context] [Run Codex]                 │              │
│               │                                               │ ~/.ssh       │
│               │ Live Output                                   │ /etc         │
│               │ ┌───────────────────────────────────────────┐ │ /usr         │
│               │ │ collecting context...                      │ │              │
│               │ │ running codex exec...                      │ │ Context      │
│               │ │                                            │ │              │
│               │ └───────────────────────────────────────────┘ │ [Preview]    │
└───────────────┴───────────────────────────────────────────────┴──────────────┘
```

Task output should be virtualized or windowed for long sessions.

The live output area should show recent output, with older output loaded on demand.

---

## 5. Terminal

Terminal is a sibling workspace tab, not mixed into Codex task output.

```text
┌───────────────┬───────────────────────────────────────────────┬──────────────┐
│ Profiles      │ Terminal                                      │ Inspector    │
│               │ [Task] [Terminal] [Review] [History]          │              │
│  General      ├───────────────────────────────────────────────┤ Terminal     │
│  Shell ●      │ Terminal Tabs                                 │              │
│  Scripts      │ [Shell: ~] [+]                                │ cwd: $HOME   │
│  systemd      │                                               │ shell: zsh   │
│               │ ┌───────────────────────────────────────────┐ │ profile:    │
│ Sessions      │ │ $ echo $SHELL                              │ │ Shell        │
│               │ │ /usr/bin/zsh                               │ │              │
│  Current ●    │ │ $ echo $PATH                               │ │ Actions      │
│               │ │ /home/alex/.local/bin:/usr/local/bin:...   │ │              │
│               │ │ $                                         │ │ [Attach     │
│               │ │                                           │ │  Output]     │
│               │ └───────────────────────────────────────────┘ │ [Clear]      │
│               │                                               │ [Close]      │
│               │ Search: [                                    ]│              │
└───────────────┴───────────────────────────────────────────────┴──────────────┘
```

Important boundary:

- terminal output is not automatically considered app-reviewed state;
- selected output can be attached to the active task context;
- terminal scrollback should be capped in the browser.

---

## 6. Review Changes

Appears after Patch Mode detects file changes.

```text
┌───────────────┬───────────────────────────────────────────────┬──────────────┐
│ Profiles      │ Review                                        │ Inspector    │
│               │ [Task] [Terminal] [Review] [History]          │              │
│  Shell ●      ├───────────────────────────────────────────────┤ Task         │
│               │ Changed Files                                 │              │
│ Sessions      │ ┌───────────────────────────────────────────┐ │ PATH cleanup │
│               │ │ M  ~/.zshrc                                │ │ status:     │
│  Current ●    │ │ A  ~/.config/environment.d/path.conf        │ │ awaiting    │
│               │ └───────────────────────────────────────────┘ │ review       │
│               │                                               │              │
│               │ Diff                                          │ Safety       │
│               │ ┌───────────────────────────────────────────┐ │              │
│               │ │ --- ~/.zshrc                               │ │ snapshot OK  │
│               │ │ +++ ~/.zshrc                               │ │ rollback OK  │
│               │ │ @@                                         │ │ sudo blocked │
│               │ │ -export PATH=...                            │ │              │
│               │ │ +path=(~/.local/bin $path)                  │ │ Actions      │
│               │ └───────────────────────────────────────────┘ │              │
│               │                                               │ [Accept]     │
│               │ [Open File] [Open Folder]                     │ [Rollback]   │
└───────────────┴───────────────────────────────────────────────┴──────────────┘
```

Diffs should lazy-load by selected file.

For large diffs, show file-level summary first and load the full patch only on selection.

---

## 7. Long-Term Session View

History must stay fast even after many tasks.

```text
┌───────────────┬───────────────────────────────────────────────┬──────────────┐
│ Profiles      │ History                                       │ Inspector    │
│               │ [Task] [Terminal] [Review] [History]          │              │
│ Sessions      ├───────────────────────────────────────────────┤ Summary      │
│               │ Current Session                               │              │
│  Current ●    │ ┌───────────────────────────────────────────┐ │ Goal:        │
│  PATH cleanup │ │ 10:02  Diagnose PATH                       │ │ clean PATH   │
│  fcitx issue  │ │ 10:04  Patch ~/.zshrc                      │ │              │
│  service fix  │ │ 10:06  Review changes                      │ │ Decisions    │
│               │ │ 10:08  Rollback available                  │ │              │
│               │ │ ... Load older events ...                  │ │ use zsh path │
│               │ └───────────────────────────────────────────┘ │ array        │
│               │                                               │              │
│               │ Selected Event                                │ Files        │
│               │ ┌───────────────────────────────────────────┐ │              │
│               │ │ stdout preview or event details            │ │ ~/.zshrc     │
│               │ └───────────────────────────────────────────┘ │ path.conf    │
└───────────────┴───────────────────────────────────────────────┴──────────────┘
```

Implementation requirement:

- task/event list uses virtualization;
- full logs remain on disk;
- event payloads load by page or selected item;
- inspector shows compact session summary.

---

## 8. Settings

```text
┌───────────────┬───────────────────────────────────────────────┬──────────────┐
│ Settings      │ Codex CLI                                     │ Help         │
│               │                                               │              │
│  Codex CLI ●  │ Binary path                                   │ Setup        │
│  Profiles     │ ┌───────────────────────────────────────────┐ │              │
│  Terminal     │ │ /home/alex/.npm-global/bin/codex           │ │ [Run Wizard] │
│  Safety       │ └───────────────────────────────────────────┘ │              │
│  Data         │                                               │ Status       │
│               │ Version                                       │              │
│               │ ┌───────────────────────────────────────────┐ │ Codex OK     │
│               │ │ codex 0.x.x                                │ │              │
│               │ └───────────────────────────────────────────┘ │              │
│               │                                               │              │
│               │ [Validate] [Choose Binary] [Save]             │              │
└───────────────┴───────────────────────────────────────────────┴──────────────┘
```

Terminal settings:

```text
┌───────────────┬───────────────────────────────────────────────┬──────────────┐
│ Settings      │ Terminal                                      │ Help         │
│               │                                               │              │
│  Codex CLI    │ Default shell                                 │ Terminal is  │
│  Profiles     │ ┌───────────────────────────────────────────┐ │ user-driven  │
│  Terminal ●   │ │ /usr/bin/zsh                               │ │ and separate │
│  Safety       │ └───────────────────────────────────────────┘ │ from Patch   │
│  Data         │                                               │ Mode.        │
│               │ Scrollback lines                              │              │
│               │ ┌───────────────────────────────────────────┐ │              │
│               │ │ 5000                                      │ │              │
│               │ └───────────────────────────────────────────┘ │              │
│               │                                               │              │
│               │ [Save]                                        │              │
└───────────────┴───────────────────────────────────────────────┴──────────────┘
```

---

## 9. Icon Direction

The icon should be created as a simple geometric mark.

Suggested concept:

```text
┌─────────────┐
│  terminal   │
│  prompt >   │
│  shield /   │
│  check mark │
└─────────────┘
```

Visual requirements:

- works at small sizes;
- avoids text in the icon;
- avoids OpenAI logo usage;
- has source `assets/icon.svg`;
- exports Linux desktop sizes under `assets/icons/`.

---

## 10. Recommended MVP Screen Order

Build the UI in this order:

1. app shell with profiles, tabs, and inspector;
2. Codex CLI setup wizard;
3. Task Runner;
4. Terminal;
5. Review Changes;
6. History with virtualized events;
7. Settings;
8. icon and packaging polish.

