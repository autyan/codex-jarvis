use serde::Serialize;
use std::process::Command;

#[derive(Debug, Serialize)]
struct CodexCliInfo {
    found: bool,
    path: Option<String>,
    version: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskProfile {
    id: &'static str,
    name: &'static str,
    description: &'static str,
    default_mode: &'static str,
    cwd: &'static str,
    write_enabled: bool,
    snapshot_required: bool,
    read_paths: Vec<&'static str>,
    write_paths: Vec<&'static str>,
    deny_paths: Vec<&'static str>,
    readonly_commands: Vec<&'static str>,
}

#[tauri::command]
fn detect_codex_cli() -> CodexCliInfo {
    match Command::new("codex").arg("--version").output() {
        Ok(output) if output.status.success() => CodexCliInfo {
            found: true,
            path: Some("codex".to_string()),
            version: Some(String::from_utf8_lossy(&output.stdout).trim().to_string()),
            error: None,
        },
        Ok(output) => CodexCliInfo {
            found: false,
            path: None,
            version: None,
            error: Some(String::from_utf8_lossy(&output.stderr).trim().to_string()),
        },
        Err(error) => CodexCliInfo {
            found: false,
            path: None,
            version: None,
            error: Some(error.to_string()),
        },
    }
}

#[tauri::command]
fn list_profiles() -> Vec<TaskProfile> {
    vec![
        TaskProfile {
            id: "general",
            name: "General",
            description: "Read-only workstation diagnostics and general context collection.",
            default_mode: "diagnose",
            cwd: "$HOME",
            write_enabled: false,
            snapshot_required: false,
            read_paths: vec!["$HOME", "$HOME/.config"],
            write_paths: vec![],
            deny_paths: vec![
                "$HOME/.ssh",
                "$HOME/.gnupg",
                "$HOME/.local/share/keyrings",
                "$HOME/.mozilla",
                "$HOME/.password-store",
                "/etc",
                "/usr",
                "/boot",
                "/var/lib",
                "/var/log",
                "/root",
                "/proc",
                "/sys",
                "/dev",
                "/run",
            ],
            readonly_commands: vec![
                "cat /etc/os-release",
                "uname -a",
                "echo $SHELL",
                "echo $XDG_SESSION_TYPE",
            ],
        },
        TaskProfile {
            id: "shell",
            name: "Shell",
            description: "Shell configuration, aliases, PATH, and environment variables.",
            default_mode: "patch",
            cwd: "$HOME",
            write_enabled: true,
            snapshot_required: true,
            read_paths: vec![
                "$HOME/.zshrc",
                "$HOME/.profile",
                "$HOME/.config/environment.d",
                "$HOME/.local/bin",
            ],
            write_paths: vec![
                "$HOME/.zshrc",
                "$HOME/.profile",
                "$HOME/.config/environment.d",
                "$HOME/.local/bin",
            ],
            deny_paths: vec![
                "$HOME/.ssh",
                "$HOME/.gnupg",
                "$HOME/.local/share/keyrings",
                "$HOME/.mozilla",
                "$HOME/.password-store",
                "/etc",
                "/usr",
                "/boot",
                "/var",
            ],
            readonly_commands: vec![
                "echo $SHELL",
                "echo $PATH",
                "ls -la $HOME",
                "ls -la $HOME/.config/environment.d",
            ],
        },
        TaskProfile {
            id: "scripts",
            name: "Scripts",
            description: "Personal scripts and user-owned automation under local paths.",
            default_mode: "patch",
            cwd: "$HOME",
            write_enabled: true,
            snapshot_required: true,
            read_paths: vec!["$HOME/.local/bin", "$HOME/Scripts"],
            write_paths: vec!["$HOME/.local/bin", "$HOME/Scripts"],
            deny_paths: vec![
                "$HOME/.ssh",
                "$HOME/.gnupg",
                "$HOME/.local/share/keyrings",
                "/etc",
                "/usr",
                "/boot",
                "/var",
            ],
            readonly_commands: vec!["ls -la $HOME/.local/bin", "ls -la $HOME/Scripts"],
        },
        TaskProfile {
            id: "systemd-user",
            name: "systemd User",
            description: "User-level systemd service diagnostics and unit files.",
            default_mode: "patch",
            cwd: "$HOME/.config/systemd/user",
            write_enabled: true,
            snapshot_required: true,
            read_paths: vec!["$HOME/.config/systemd/user"],
            write_paths: vec!["$HOME/.config/systemd/user"],
            deny_paths: vec![
                "$HOME/.ssh",
                "$HOME/.gnupg",
                "$HOME/.local/share/keyrings",
                "/etc",
                "/usr",
                "/boot",
                "/var",
            ],
            readonly_commands: vec![
                "systemctl --user list-units --type=service",
                "systemctl --user --failed",
                "journalctl --user -p warning -n 100 --no-pager",
            ],
        },
    ]
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![detect_codex_cli, list_profiles])
        .run(tauri::generate_context!())
        .expect("failed to run Codex Jarvis");
}
