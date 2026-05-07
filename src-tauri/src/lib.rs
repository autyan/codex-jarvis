use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::{BufRead, BufReader},
    io::Write,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, State};

type RunningTasks = Arc<Mutex<HashMap<String, Arc<Mutex<Child>>>>>;

#[derive(Debug, Serialize)]
struct CodexCliInfo {
    found: bool,
    path: Option<String>,
    version: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartDiagnoseTaskRequest {
    task_id: Option<String>,
    profile_id: String,
    prompt: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StartTaskResponse {
    task_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskEvent {
    task_id: String,
    event: &'static str,
    text: Option<String>,
    status: Option<String>,
    exit_code: Option<i32>,
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
    profiles()
}

#[tauri::command]
fn start_diagnose_task(
    app: AppHandle,
    running_tasks: State<'_, RunningTasks>,
    request: StartDiagnoseTaskRequest,
) -> Result<StartTaskResponse, String> {
    let profile = profile_by_id(&request.profile_id)
        .ok_or_else(|| format!("Unknown profile: {}", request.profile_id))?;
    let prompt = request.prompt.trim().to_string();

    if prompt.is_empty() {
        return Err("Prompt cannot be empty".to_string());
    }

    let task_id = request.task_id.unwrap_or_else(new_task_id);
    let registry = running_tasks.inner().clone();
    let app_for_thread = app.clone();
    let task_id_for_thread = task_id.clone();

    thread::spawn(move || {
        emit_task_event(
            &app_for_thread,
            TaskEvent {
                task_id: task_id_for_thread.clone(),
                event: "task_started",
                text: Some(format!("Starting diagnose task with {} profile", profile.name)),
                status: Some("running".to_string()),
                exit_code: None,
            },
        );

        let context = collect_context(&profile);
        emit_task_event(
            &app_for_thread,
            TaskEvent {
                task_id: task_id_for_thread.clone(),
                event: "context_collected",
                text: Some(context.clone()),
                status: Some("context_collected".to_string()),
                exit_code: None,
            },
        );

        let task_prompt = build_diagnose_prompt(&profile, &context, &prompt);
        let cwd = expand_home(profile.cwd);
        let mut command = Command::new("codex");
        command
            .arg("exec")
            .arg(task_prompt)
            .current_dir(cwd)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        match command.spawn() {
            Ok(mut child) => {
                let stdout = child.stdout.take();
                let stderr = child.stderr.take();
                let child = Arc::new(Mutex::new(child));

                if let Ok(mut tasks) = registry.lock() {
                    tasks.insert(task_id_for_thread.clone(), child.clone());
                }

                if let Some(stdout) = stdout {
                    stream_reader(app_for_thread.clone(), task_id_for_thread.clone(), "stdout", stdout);
                }
                if let Some(stderr) = stderr {
                    stream_reader(app_for_thread.clone(), task_id_for_thread.clone(), "stderr", stderr);
                }

                loop {
                    let status = child.lock().ok().and_then(|mut child| child.try_wait().ok()).flatten();

                    if let Some(status) = status {
                        if let Ok(mut tasks) = registry.lock() {
                            tasks.remove(&task_id_for_thread);
                        }
                        emit_task_event(
                            &app_for_thread,
                            TaskEvent {
                                task_id: task_id_for_thread,
                                event: "task_finished",
                                text: Some("Diagnose task finished".to_string()),
                                status: Some("finished".to_string()),
                                exit_code: status.code(),
                            },
                        );
                        break;
                    }

                    thread::sleep(Duration::from_millis(100));
                }
            }
            Err(error) => {
                emit_task_event(
                    &app_for_thread,
                    TaskEvent {
                        task_id: task_id_for_thread,
                        event: "task_failed",
                        text: Some(format!("Failed to start codex exec: {error}")),
                        status: Some("failed".to_string()),
                        exit_code: None,
                    },
                );
            }
        }
    });

    Ok(StartTaskResponse { task_id })
}

#[tauri::command]
fn cancel_task(
    app: AppHandle,
    running_tasks: State<'_, RunningTasks>,
    task_id: String,
) -> Result<(), String> {
    let task = running_tasks
        .lock()
        .map_err(|_| "Task registry is unavailable".to_string())?
        .get(&task_id)
        .cloned();

    if let Some(task) = task {
        task.lock()
            .map_err(|_| "Task process is unavailable".to_string())?
            .kill()
            .map_err(|error| error.to_string())?;
        emit_task_event(
            &app,
            TaskEvent {
                task_id,
                event: "task_cancelled",
                text: Some("Task cancellation requested".to_string()),
                status: Some("cancelled".to_string()),
                exit_code: None,
            },
        );
        Ok(())
    } else {
        Err("Task is not running".to_string())
    }
}

fn profiles() -> Vec<TaskProfile> {
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

fn profile_by_id(profile_id: &str) -> Option<TaskProfile> {
    profiles().into_iter().find(|profile| profile.id == profile_id)
}

fn new_task_id() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    format!("task_{millis}")
}

fn collect_context(profile: &TaskProfile) -> String {
    profile
        .readonly_commands
        .iter()
        .map(|command| {
            let output = Command::new("sh")
                .arg("-lc")
                .arg(command)
                .current_dir(expand_home(profile.cwd))
                .output();

            match output {
                Ok(output) => format!(
                    "$ {command}\n{}{}",
                    String::from_utf8_lossy(&output.stdout),
                    String::from_utf8_lossy(&output.stderr)
                ),
                Err(error) => format!("$ {command}\nfailed: {error}\n"),
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn build_diagnose_prompt(profile: &TaskProfile, context: &str, user_prompt: &str) -> String {
    format!(
        "You are assisting with a read-only Linux workstation maintenance task.\n\n\
Task profile:\n\
- Name: {name}\n\
- Working directory: {cwd}\n\
- Mode: diagnose\n\
- Writes allowed: no\n\
- Forbidden paths:\n{deny_paths}\n\n\
Rules:\n\
1. Do not modify files.\n\
2. Do not run sudo.\n\
3. Do not run destructive commands.\n\
4. Explain findings clearly.\n\
5. If changes are needed, suggest them but do not apply them.\n\n\
Collected context:\n{context}\n\n\
User task:\n{user_prompt}",
        name = profile.name,
        cwd = profile.cwd,
        deny_paths = profile
            .deny_paths
            .iter()
            .map(|path| format!("  - {path}"))
            .collect::<Vec<_>>()
            .join("\n")
    )
}

fn expand_home(path: &str) -> String {
    if let Some(rest) = path.strip_prefix("$HOME") {
        if let Some(home) = std::env::var_os("HOME") {
            return format!("{}{}", home.to_string_lossy(), rest);
        }
    }
    path.to_string()
}

fn stream_reader<R>(app: AppHandle, task_id: String, event: &'static str, reader: R)
where
    R: std::io::Read + Send + 'static,
{
    thread::spawn(move || {
        for line in BufReader::new(reader).lines() {
            if let Ok(line) = line {
                emit_task_event(
                    &app,
                    TaskEvent {
                        task_id: task_id.clone(),
                        event,
                        text: Some(line),
                        status: Some("running".to_string()),
                        exit_code: None,
                    },
                );
            }
        }
    });
}

fn emit_task_event(app: &AppHandle, event: TaskEvent) {
    persist_task_event(&event);
    let _ = app.emit("task://event", event);
}

fn persist_task_event(event: &TaskEvent) {
    let Some(task_dir) = task_data_dir(&event.task_id) else {
        return;
    };
    if fs::create_dir_all(&task_dir).is_err() {
        return;
    }

    let event_line = format!(
        "{} status={} exit_code={:?}\n",
        event.event,
        event.status.as_deref().unwrap_or("unknown"),
        event.exit_code
    );
    append_file(task_dir.join("events.log"), &event_line);

    if let Some(text) = &event.text {
        match event.event {
            "context_collected" => {
                append_file(task_dir.join("context.md"), text);
                append_file(task_dir.join("context.md"), "\n");
            }
            "stdout" => {
                append_file(task_dir.join("stdout.log"), text);
                append_file(task_dir.join("stdout.log"), "\n");
            }
            "stderr" | "task_failed" => {
                append_file(task_dir.join("stderr.log"), text);
                append_file(task_dir.join("stderr.log"), "\n");
            }
            _ => {
                append_file(task_dir.join("system.log"), text);
                append_file(task_dir.join("system.log"), "\n");
            }
        }
    }
}

fn task_data_dir(task_id: &str) -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(PathBuf::from(home).join(".local/share/codex-jarvis/tasks").join(task_id))
}

fn append_file(path: PathBuf, text: &str) {
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = file.write_all(text.as_bytes());
    }
}

pub fn run() {
    tauri::Builder::default()
        .manage(RunningTasks::default())
        .invoke_handler(tauri::generate_handler![
            detect_codex_cli,
            list_profiles,
            start_diagnose_task,
            cancel_task
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Codex Jarvis");
}
