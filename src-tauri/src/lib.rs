use portable_pty::{native_pty_system, Child as PtyChild, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::{BufRead, BufReader},
    io::Write,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, State};

type RunningTasks = Arc<Mutex<HashMap<String, Arc<Mutex<Child>>>>>;
type TerminalSessions = Arc<Mutex<HashMap<String, TerminalSession>>>;

struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn PtyChild + Send + Sync>,
}

#[derive(Debug, Serialize)]
struct CodexCliInfo {
    found: bool,
    path: Option<String>,
    version: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    codex_cli_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetCodexCliPathRequest {
    path: String,
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
    attached_context: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartPatchTaskRequest {
    task_id: Option<String>,
    profile_id: String,
    prompt: String,
    attached_context: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedTaskEvent {
    sequence: u64,
    task_id: String,
    event: String,
    source: String,
    text_preview: Option<String>,
    payload_path: Option<String>,
    status: Option<String>,
    exit_code: Option<i32>,
    created_at: u128,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskEventPage {
    task_id: String,
    events: Vec<PersistedTaskEvent>,
    offset: usize,
    limit: usize,
    total: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskSummary {
    task_id: String,
    updated_at: u128,
    event_count: usize,
    latest_status: Option<String>,
    latest_preview: Option<String>,
}

#[derive(Debug, Clone)]
struct FileState {
    hash: u64,
}

#[derive(Debug, Clone)]
struct SnapshotEntry {
    before_path: PathBuf,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChangedFile {
    path: String,
    status: String,
    before_hash: Option<String>,
    after_hash: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RollbackResult {
    task_id: String,
    restored: Vec<String>,
    deleted: Vec<String>,
    skipped: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartTerminalRequest {
    profile_id: Option<String>,
    cwd: Option<String>,
    shell_path: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StartTerminalResponse {
    terminal_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalEvent {
    terminal_id: String,
    event: &'static str,
    data: Option<String>,
    exit_code: Option<i32>,
}

#[tauri::command]
fn detect_codex_cli() -> CodexCliInfo {
    let Some(path) = configured_codex_cli_path() else {
        return CodexCliInfo {
            found: false,
            path: None,
            version: None,
            error: Some("No Codex CLI path configured".to_string()),
        };
    };

    validate_codex_cli_path(&path)
}

#[tauri::command]
fn set_codex_cli_path(request: SetCodexCliPathRequest) -> Result<CodexCliInfo, String> {
    let path = normalize_executable_path(&request.path)?;
    let info = validate_codex_cli_path(&path);
    if !info.found {
        return Err(info.error.unwrap_or_else(|| "Codex CLI validation failed".to_string()));
    }

    let mut settings = read_app_settings();
    settings.codex_cli_path = Some(path);
    write_app_settings(&settings)?;
    Ok(info)
}

fn validate_codex_cli_path(path: &str) -> CodexCliInfo {
    match Command::new(path).arg("--version").output() {
        Ok(output) if output.status.success() => CodexCliInfo {
            found: true,
            path: Some(path.to_string()),
            version: Some(String::from_utf8_lossy(&output.stdout).trim().to_string()),
            error: None,
        },
        Ok(output) => CodexCliInfo {
            found: false,
            path: Some(path.to_string()),
            version: None,
            error: Some(String::from_utf8_lossy(&output.stderr).trim().to_string()),
        },
        Err(error) => CodexCliInfo {
            found: false,
            path: Some(path.to_string()),
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

    let attached_context = request.attached_context;
    let task_id = request.task_id.unwrap_or_else(new_task_id);
    let codex_cli = configured_codex_cli_path().ok_or_else(|| "Codex CLI path is not configured".to_string())?;
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

        let context = merge_attached_context(collect_context(&profile), attached_context.as_deref());
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
        let mut command = Command::new(&codex_cli);
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
fn start_patch_task(
    app: AppHandle,
    running_tasks: State<'_, RunningTasks>,
    request: StartPatchTaskRequest,
) -> Result<StartTaskResponse, String> {
    let profile = profile_by_id(&request.profile_id)
        .ok_or_else(|| format!("Unknown profile: {}", request.profile_id))?;
    let prompt = request.prompt.trim().to_string();

    if prompt.is_empty() {
        return Err("Prompt cannot be empty".to_string());
    }
    if !profile.write_enabled {
        return Err(format!("Profile {} does not allow writes", profile.name));
    }

    let attached_context = request.attached_context;
    let task_id = request.task_id.unwrap_or_else(new_task_id);
    let codex_cli = configured_codex_cli_path().ok_or_else(|| "Codex CLI path is not configured".to_string())?;
    let registry = running_tasks.inner().clone();
    let app_for_thread = app.clone();
    let task_id_for_thread = task_id.clone();

    thread::spawn(move || {
        emit_task_event(
            &app_for_thread,
            TaskEvent {
                task_id: task_id_for_thread.clone(),
                event: "task_started",
                text: Some(format!("Starting patch task with {} profile", profile.name)),
                status: Some("running".to_string()),
                exit_code: None,
            },
        );

        let before_scan = scan_write_paths(&profile);
        let snapshot = create_before_snapshot(&task_id_for_thread, &before_scan);
        emit_task_event(
            &app_for_thread,
            TaskEvent {
                task_id: task_id_for_thread.clone(),
                event: "snapshot_created",
                text: Some(format!("Captured {} writable files before patch", before_scan.len())),
                status: Some("snapshot_created".to_string()),
                exit_code: None,
            },
        );

        let context = merge_attached_context(collect_context(&profile), attached_context.as_deref());
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

        let task_prompt = build_patch_prompt(&profile, &context, &prompt);
        let cwd = expand_home(profile.cwd);
        let mut command = Command::new(&codex_cli);
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

                        let after_scan = scan_write_paths(&profile);
                        let changed_files = detect_changed_files(&before_scan, &after_scan);
                        persist_changed_files(&task_id_for_thread, &changed_files);
                        let diff = generate_task_diff(&snapshot, &changed_files);
                        persist_task_diff(&task_id_for_thread, &diff);

                        for file in &changed_files {
                            emit_task_event(
                                &app_for_thread,
                                TaskEvent {
                                    task_id: task_id_for_thread.clone(),
                                    event: "file_changed",
                                    text: Some(format!("{} {}", file.status, file.path)),
                                    status: Some("awaiting_review".to_string()),
                                    exit_code: None,
                                },
                            );
                        }

                        emit_task_event(
                            &app_for_thread,
                            TaskEvent {
                                task_id: task_id_for_thread.clone(),
                                event: "diff_ready",
                                text: Some(format!("{} changed files ready for review", changed_files.len())),
                                status: Some("awaiting_review".to_string()),
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

#[tauri::command]
fn list_task_events(task_id: String, offset: usize, limit: usize) -> Result<TaskEventPage, String> {
    let events = read_persisted_events(&task_id)?;
    let total = events.len();
    let page = events.into_iter().skip(offset).take(limit).collect();

    Ok(TaskEventPage {
        task_id,
        events: page,
        offset,
        limit,
        total,
    })
}

#[tauri::command]
fn list_recent_tasks(limit: usize) -> Result<Vec<TaskSummary>, String> {
    let Some(tasks_dir) = tasks_data_dir() else {
        return Ok(Vec::new());
    };
    if !tasks_dir.exists() {
        return Ok(Vec::new());
    }

    let mut summaries = Vec::new();
    let entries = fs::read_dir(tasks_dir).map_err(|error| error.to_string())?;

    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() {
            continue;
        }

        let task_id = entry.file_name().to_string_lossy().to_string();
        let events = read_persisted_events(&task_id).unwrap_or_default();
        let latest = events.last();
        let updated_at = latest.map(|event| event.created_at).unwrap_or_default();

        summaries.push(TaskSummary {
            task_id,
            updated_at,
            event_count: events.len(),
            latest_status: latest.and_then(|event| event.status.clone()),
            latest_preview: latest.and_then(|event| event.text_preview.clone()),
        });
    }

    summaries.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    summaries.truncate(limit);

    Ok(summaries)
}

#[tauri::command]
fn list_changed_files(task_id: String) -> Result<Vec<ChangedFile>, String> {
    let Some(task_dir) = task_data_dir(&task_id) else {
        return Ok(Vec::new());
    };
    let path = task_dir.join("changed-files.json");
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&content).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_task_diff(task_id: String) -> Result<String, String> {
    let Some(task_dir) = task_data_dir(&task_id) else {
        return Ok(String::new());
    };
    let path = task_dir.join("diff.patch");
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(path).map_err(|error| error.to_string())
}

#[tauri::command]
fn rollback_task(app: AppHandle, task_id: String) -> Result<RollbackResult, String> {
    let changed_files = list_changed_files(task_id.clone())?;
    let Some(task_dir) = task_data_dir(&task_id) else {
        return Err("Task data directory is unavailable".to_string());
    };

    let mut result = RollbackResult {
        task_id: task_id.clone(),
        restored: Vec::new(),
        deleted: Vec::new(),
        skipped: Vec::new(),
    };

    for file in changed_files {
        let path = PathBuf::from(&file.path);
        match file.status.as_str() {
            "created" => {
                if path.exists() {
                    match fs::remove_file(&path) {
                        Ok(()) => result.deleted.push(file.path.clone()),
                        Err(error) => result.skipped.push(format!("{}: {}", file.path, error)),
                    }
                }
            }
            "modified" => {
                if has_post_task_change(&file) {
                    result.skipped.push(format!("{}: changed after task", file.path));
                    continue;
                }
                let snapshot_path = task_dir.join("snapshots/before").join(safe_snapshot_name(&file.path));
                match fs::copy(&snapshot_path, &path) {
                    Ok(_) => result.restored.push(file.path.clone()),
                    Err(error) => result.skipped.push(format!("{}: {}", file.path, error)),
                }
            }
            "deleted" => {
                let snapshot_path = task_dir.join("snapshots/before").join(safe_snapshot_name(&file.path));
                if let Some(parent) = path.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                match fs::copy(&snapshot_path, &path) {
                    Ok(_) => result.restored.push(file.path.clone()),
                    Err(error) => result.skipped.push(format!("{}: {}", file.path, error)),
                }
            }
            _ => result.skipped.push(format!("{}: unknown status {}", file.path, file.status)),
        }
    }

    let log = serde_json::to_string_pretty(&result).map_err(|error| error.to_string())?;
    fs::write(task_dir.join("rollback.json"), log).map_err(|error| error.to_string())?;
    fs::write(task_dir.join("changed-files.json"), "[]").map_err(|error| error.to_string())?;
    fs::write(task_dir.join("diff.patch"), "").map_err(|error| error.to_string())?;

    emit_task_event(
        &app,
        TaskEvent {
            task_id,
            event: "rolled_back",
            text: Some(format!(
                "Rollback restored {} files, deleted {} files, skipped {} files",
                result.restored.len(),
                result.deleted.len(),
                result.skipped.len()
            )),
            status: Some("rolled_back".to_string()),
            exit_code: None,
        },
    );

    Ok(result)
}

#[tauri::command]
fn start_terminal(
    app: AppHandle,
    terminal_sessions: State<'_, TerminalSessions>,
    request: StartTerminalRequest,
) -> Result<StartTerminalResponse, String> {
    let terminal_id = new_terminal_id();
    let shell = request
        .shell_path
        .or_else(|| std::env::var("SHELL").ok())
        .unwrap_or_else(|| "/bin/sh".to_string());
    let cwd = request
        .cwd
        .or_else(|| {
            request
                .profile_id
                .as_deref()
                .and_then(profile_by_id)
                .map(|profile| expand_home(profile.cwd))
        })
        .unwrap_or_else(|| std::env::var("HOME").unwrap_or_else(|_| "/".to_string()));
    let cols = request.cols.unwrap_or(96);
    let rows = request.rows.unwrap_or(28);
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| error.to_string())?;

    let mut command = CommandBuilder::new(&shell);
    if shell.ends_with("bash") || shell.ends_with("zsh") || shell.ends_with("fish") || shell.ends_with("sh") {
        command.arg("-i");
    }
    command.cwd(cwd);
    let child = pair.slave.spawn_command(command).map_err(|error| error.to_string())?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|error| error.to_string())?;
    let writer = pair.master.take_writer().map_err(|error| error.to_string())?;
    let session = TerminalSession {
        master: pair.master,
        writer,
        child,
    };

    terminal_sessions
        .lock()
        .map_err(|_| "Terminal registry is unavailable".to_string())?
        .insert(terminal_id.clone(), session);
    let terminal_registry = terminal_sessions.inner().clone();

    emit_terminal_event(
        &app,
        TerminalEvent {
            terminal_id: terminal_id.clone(),
            event: "terminal_started",
            data: None,
            exit_code: None,
        },
    );

    let app_for_thread = app.clone();
    let terminal_id_for_thread = terminal_id.clone();
    thread::spawn(move || {
        let mut buffer = [0_u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(size) => emit_terminal_event(
                    &app_for_thread,
                    TerminalEvent {
                        terminal_id: terminal_id_for_thread.clone(),
                        event: "terminal_output",
                        data: Some(String::from_utf8_lossy(&buffer[..size]).to_string()),
                        exit_code: None,
                    },
                ),
                Err(_) => break,
            }
        }
        if let Ok(mut sessions) = terminal_registry.lock() {
            sessions.remove(&terminal_id_for_thread);
        }
        emit_terminal_event(
            &app_for_thread,
            TerminalEvent {
                terminal_id: terminal_id_for_thread,
                event: "terminal_closed",
                data: None,
                exit_code: None,
            },
        );
    });

    Ok(StartTerminalResponse { terminal_id })
}

#[tauri::command]
fn write_terminal(
    terminal_sessions: State<'_, TerminalSessions>,
    terminal_id: String,
    data: String,
) -> Result<(), String> {
    let mut sessions = terminal_sessions
        .lock()
        .map_err(|_| "Terminal registry is unavailable".to_string())?;
    let session = sessions
        .get_mut(&terminal_id)
        .ok_or_else(|| "Terminal session not found".to_string())?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn resize_terminal(
    terminal_sessions: State<'_, TerminalSessions>,
    terminal_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = terminal_sessions
        .lock()
        .map_err(|_| "Terminal registry is unavailable".to_string())?;
    let session = sessions
        .get(&terminal_id)
        .ok_or_else(|| "Terminal session not found".to_string())?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn close_terminal(
    terminal_sessions: State<'_, TerminalSessions>,
    terminal_id: String,
) -> Result<(), String> {
    let mut sessions = terminal_sessions
        .lock()
        .map_err(|_| "Terminal registry is unavailable".to_string())?;
    let mut session = sessions
        .remove(&terminal_id)
        .ok_or_else(|| "Terminal session not found".to_string())?;
    session.child.kill().map_err(|error| error.to_string())
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

fn new_terminal_id() -> String {
    format!("terminal_{}", now_millis())
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

fn merge_attached_context(context: String, attached_context: Option<&str>) -> String {
    let Some(attached_context) = attached_context else {
        return context;
    };
    if attached_context.trim().is_empty() {
        return context;
    }
    format!("{context}\n\nAttached terminal output:\n{attached_context}")
}

fn configured_codex_cli_path() -> Option<String> {
    read_app_settings().codex_cli_path
}

fn read_app_settings() -> AppSettings {
    let Some(path) = app_settings_path() else {
        return AppSettings::default();
    };
    let Ok(content) = fs::read_to_string(path) else {
        return AppSettings::default();
    };
    serde_json::from_str(&content).unwrap_or_default()
}

fn write_app_settings(settings: &AppSettings) -> Result<(), String> {
    let path = app_settings_path().ok_or_else(|| "Could not resolve settings path".to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let content = serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())
}

fn app_settings_path() -> Option<PathBuf> {
    let config_home = std::env::var("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|_| std::env::var("HOME").map(|home| PathBuf::from(home).join(".config")))
        .ok()?;
    Some(config_home.join("codex-jarvis/settings.json"))
}

fn normalize_executable_path(path: &str) -> Result<String, String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("Codex CLI path cannot be empty".to_string());
    }

    let expanded = if path == "~" {
        std::env::var("HOME").map_err(|_| "HOME is not set".to_string())?
    } else if let Some(rest) = path.strip_prefix("~/") {
        let home = std::env::var("HOME").map_err(|_| "HOME is not set".to_string())?;
        PathBuf::from(home).join(rest).to_string_lossy().to_string()
    } else {
        path.to_string()
    };

    if expanded.contains('/') {
        let candidate = Path::new(&expanded);
        if !candidate.exists() {
            return Err(format!("Codex CLI path does not exist: {expanded}"));
        }
        if !candidate.is_file() {
            return Err(format!("Codex CLI path is not a file: {expanded}"));
        }
    }

    Ok(expanded)
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

fn build_patch_prompt(profile: &TaskProfile, context: &str, user_prompt: &str) -> String {
    format!(
        "You are assisting with a Linux workstation maintenance patch task.\n\n\
Task profile:\n\
- Name: {name}\n\
- Working directory: {cwd}\n\
- Mode: patch\n\
- Writable paths:\n{write_paths}\n\
- Forbidden paths:\n{deny_paths}\n\n\
Rules:\n\
1. Modify only writable paths listed above.\n\
2. Do not modify forbidden paths.\n\
3. Do not run sudo.\n\
4. Do not run destructive commands.\n\
5. Prefer minimal changes.\n\
6. Explain every file change.\n\
7. If privileged operations are needed, only suggest commands; do not execute them.\n\n\
Collected context:\n{context}\n\n\
User task:\n{user_prompt}",
        name = profile.name,
        cwd = profile.cwd,
        write_paths = profile
            .write_paths
            .iter()
            .map(|path| format!("  - {path}"))
            .collect::<Vec<_>>()
            .join("\n"),
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

fn emit_terminal_event(app: &AppHandle, event: TerminalEvent) {
    let _ = app.emit("terminal://event", event);
}

fn persist_task_event(event: &TaskEvent) {
    let Some(task_dir) = task_data_dir(&event.task_id) else {
        return;
    };
    if fs::create_dir_all(&task_dir).is_err() {
        return;
    }

    let sequence = next_event_sequence(&task_dir);
    let created_at = now_millis();
    let source = event_source(event.event);
    let payload_path = persist_payload(&task_dir, event, sequence);
    let text_preview = event.text.as_ref().map(|text| preview_text(text, 240));
    let persisted = PersistedTaskEvent {
        sequence,
        task_id: event.task_id.clone(),
        event: event.event.to_string(),
        source: source.to_string(),
        text_preview,
        payload_path,
        status: event.status.clone(),
        exit_code: event.exit_code,
        created_at,
    };

    if let Ok(line) = serde_json::to_string(&persisted) {
        append_file(task_dir.join("events.jsonl"), &line);
        append_file(task_dir.join("events.jsonl"), "\n");
    }

    let event_line = format!("{} status={} exit_code={:?}\n", event.event, event.status.as_deref().unwrap_or("unknown"), event.exit_code);
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
    Some(tasks_data_dir()?.join(task_id))
}

fn tasks_data_dir() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(PathBuf::from(home).join(".local/share/codex-jarvis/tasks"))
}

fn append_file(path: PathBuf, text: &str) {
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = file.write_all(text.as_bytes());
    }
}

fn scan_write_paths(profile: &TaskProfile) -> HashMap<String, FileState> {
    let mut files = HashMap::new();
    for path in &profile.write_paths {
        collect_file_states(PathBuf::from(expand_home(path)), &mut files);
    }
    files
}

fn collect_file_states(path: PathBuf, files: &mut HashMap<String, FileState>) {
    if path.is_file() {
        if let Ok(content) = fs::read(&path) {
            files.insert(
                path.to_string_lossy().to_string(),
                FileState {
                    hash: stable_hash(&content),
                },
            );
        }
        return;
    }

    let Ok(entries) = fs::read_dir(path) else {
        return;
    };
    for entry in entries.flatten() {
        collect_file_states(entry.path(), files);
    }
}

fn create_before_snapshot(task_id: &str, before_scan: &HashMap<String, FileState>) -> HashMap<String, SnapshotEntry> {
    let mut snapshots = HashMap::new();
    let Some(task_dir) = task_data_dir(task_id) else {
        return snapshots;
    };
    let before_dir = task_dir.join("snapshots/before");
    let _ = fs::create_dir_all(&before_dir);

    for path in before_scan.keys() {
        let source = PathBuf::from(path);
        let target = before_dir.join(safe_snapshot_name(path));
        if fs::copy(&source, &target).is_ok() {
            snapshots.insert(path.clone(), SnapshotEntry { before_path: target });
        }
    }

    snapshots
}

fn detect_changed_files(
    before: &HashMap<String, FileState>,
    after: &HashMap<String, FileState>,
) -> Vec<ChangedFile> {
    let mut changed = Vec::new();

    for (path, before_state) in before {
        match after.get(path) {
            Some(after_state) if after_state.hash != before_state.hash => changed.push(ChangedFile {
                path: path.clone(),
                status: "modified".to_string(),
                before_hash: Some(before_state.hash.to_string()),
                after_hash: Some(after_state.hash.to_string()),
            }),
            None => changed.push(ChangedFile {
                path: path.clone(),
                status: "deleted".to_string(),
                before_hash: Some(before_state.hash.to_string()),
                after_hash: None,
            }),
            _ => {}
        }
    }

    for (path, after_state) in after {
        if !before.contains_key(path) {
            changed.push(ChangedFile {
                path: path.clone(),
                status: "created".to_string(),
                before_hash: None,
                after_hash: Some(after_state.hash.to_string()),
            });
        }
    }

    changed.sort_by(|left, right| left.path.cmp(&right.path));
    changed
}

fn generate_task_diff(snapshots: &HashMap<String, SnapshotEntry>, changed_files: &[ChangedFile]) -> String {
    let mut patch = String::new();

    for file in changed_files {
        let old_path = snapshots
            .get(&file.path)
            .map(|snapshot| snapshot.before_path.to_string_lossy().to_string())
            .unwrap_or_else(|| "/dev/null".to_string());
        let new_path = if file.status == "deleted" {
            "/dev/null".to_string()
        } else {
            file.path.clone()
        };

        match Command::new("diff").arg("-u").arg(&old_path).arg(&new_path).output() {
            Ok(output) => {
                patch.push_str(&format!("\n# {}\n", file.path));
                patch.push_str(&String::from_utf8_lossy(&output.stdout));
                patch.push_str(&String::from_utf8_lossy(&output.stderr));
            }
            Err(error) => {
                patch.push_str(&format!("\n# {}\nfailed to generate diff: {}\n", file.path, error));
            }
        }
    }

    patch
}

fn persist_changed_files(task_id: &str, changed_files: &[ChangedFile]) {
    let Some(task_dir) = task_data_dir(task_id) else {
        return;
    };
    let _ = fs::create_dir_all(&task_dir);
    if let Ok(content) = serde_json::to_string_pretty(changed_files) {
        let _ = fs::write(task_dir.join("changed-files.json"), content);
    }
}

fn persist_task_diff(task_id: &str, diff: &str) {
    let Some(task_dir) = task_data_dir(task_id) else {
        return;
    };
    let _ = fs::create_dir_all(&task_dir);
    let _ = fs::write(task_dir.join("diff.patch"), diff);
}

fn safe_snapshot_name(path: &str) -> String {
    path.chars()
        .map(|character| match character {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => character,
        })
        .collect()
}

fn stable_hash(content: &[u8]) -> u64 {
    let mut hash = 14695981039346656037u64;
    for byte in content {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(1099511628211);
    }
    hash
}

fn has_post_task_change(file: &ChangedFile) -> bool {
    let Some(after_hash) = &file.after_hash else {
        return false;
    };
    let Ok(content) = fs::read(&file.path) else {
        return false;
    };
    stable_hash(&content).to_string() != *after_hash
}

fn next_event_sequence(task_dir: &std::path::Path) -> u64 {
    fs::read_to_string(task_dir.join("events.jsonl"))
        .map(|content| content.lines().count() as u64)
        .unwrap_or_default()
}

fn persist_payload(task_dir: &std::path::Path, event: &TaskEvent, sequence: u64) -> Option<String> {
    let text = event.text.as_ref()?;
    let payload_dir = task_dir.join("payloads");
    fs::create_dir_all(&payload_dir).ok()?;
    let file_name = format!("{sequence:08}_{}.txt", event.event);
    let path = payload_dir.join(file_name);
    fs::write(&path, text).ok()?;
    Some(path.to_string_lossy().to_string())
}

fn read_persisted_events(task_id: &str) -> Result<Vec<PersistedTaskEvent>, String> {
    let Some(task_dir) = task_data_dir(task_id) else {
        return Ok(Vec::new());
    };
    let events_path = task_dir.join("events.jsonl");
    if !events_path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(events_path).map_err(|error| error.to_string())?;
    Ok(content
        .lines()
        .filter_map(|line| serde_json::from_str::<PersistedTaskEvent>(line).ok())
        .collect())
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

fn event_source(event: &str) -> &'static str {
    match event {
        "context_collected" => "context",
        "stdout" => "stdout",
        "stderr" | "task_failed" => "stderr",
        _ => "system",
    }
}

fn preview_text(text: &str, limit: usize) -> String {
    let mut preview = text.chars().take(limit).collect::<String>();
    if text.chars().count() > limit {
        preview.push_str("...");
    }
    preview
}

pub fn run() {
    tauri::Builder::default()
        .manage(RunningTasks::default())
        .manage(TerminalSessions::default())
        .invoke_handler(tauri::generate_handler![
            detect_codex_cli,
            set_codex_cli_path,
            list_profiles,
            start_diagnose_task,
            start_patch_task,
            cancel_task,
            list_task_events,
            list_recent_tasks,
            list_changed_files,
            get_task_diff,
            rollback_task,
            start_terminal,
            write_terminal,
            resize_terminal,
            close_terminal
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Codex Jarvis");
}
