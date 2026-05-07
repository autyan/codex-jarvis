use serde::Serialize;
use std::process::Command;

#[derive(Debug, Serialize)]
struct CodexCliInfo {
    found: bool,
    path: Option<String>,
    version: Option<String>,
    error: Option<String>,
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
fn list_profiles() -> Vec<&'static str> {
    vec!["General", "Shell", "Scripts", "systemd User Services"]
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![detect_codex_cli, list_profiles])
        .run(tauri::generate_context!())
        .expect("failed to run Codex Jarvis");
}

