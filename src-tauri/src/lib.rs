use portable_pty::{native_pty_system, Child as PtyChild, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    codex_cli_path: Option<String>,
    #[serde(default)]
    sudo_flow_enabled: bool,
    #[serde(default)]
    codex_model: Option<String>,
    #[serde(default = "default_codex_reasoning_effort")]
    codex_reasoning_effort: String,
    #[serde(default = "default_session_retention_limit")]
    session_retention_limit: usize,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            codex_cli_path: None,
            sudo_flow_enabled: false,
            codex_model: None,
            codex_reasoning_effort: default_codex_reasoning_effort(),
            session_retention_limit: default_session_retention_limit(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetCodexCliPathRequest {
    path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetCodexModelSettingsRequest {
    codex_model: Option<String>,
    codex_reasoning_effort: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetSessionRetentionLimitRequest {
    limit: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskProfile {
    id: &'static str,
    name: &'static str,
    description: &'static str,
    platform: &'static str,
    domains: Vec<ProfileDomain>,
    default_mode: &'static str,
    cwd: &'static str,
    write_enabled: bool,
    snapshot_required: bool,
    read_paths: Vec<&'static str>,
    write_paths: Vec<&'static str>,
    deny_paths: Vec<&'static str>,
    readonly_commands: Vec<&'static str>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProfileDomain {
    domain_id: &'static str,
    access: &'static str,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartDiagnoseTaskRequest {
    task_id: Option<String>,
    profile_id: String,
    prompt: String,
    user_message: Option<String>,
    attached_context: Option<String>,
    #[serde(default)]
    direct_execute: bool,
    codex_model: Option<String>,
    codex_reasoning_effort: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartPatchTaskRequest {
    task_id: Option<String>,
    profile_id: String,
    prompt: String,
    user_message: Option<String>,
    attached_context: Option<String>,
    #[serde(default)]
    direct_execute: bool,
    codex_model: Option<String>,
    codex_reasoning_effort: Option<String>,
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
    #[serde(default)]
    text: Option<String>,
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
    title: Option<String>,
    updated_at: u128,
    event_count: usize,
    latest_status: Option<String>,
    latest_preview: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PruneSessionsResult {
    deleted: Vec<String>,
    kept_limit: usize,
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
struct ChangedFileContent {
    path: String,
    content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RollbackResult {
    task_id: String,
    restored: Vec<String>,
    deleted: Vec<String>,
    skipped: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApplyReviewResult {
    task_id: String,
    accepted: Vec<String>,
    execution_started: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProposalState {
    task_id: String,
    content: String,
    updated_at: u128,
    source: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionMetadata {
    profile_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartTerminalRequest {
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SudoRequestPayload {
    reason: String,
    domain: String,
    risk: String,
    commands: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PendingSudoRequest {
    request_id: String,
    task_id: String,
    reason: String,
    domain: String,
    risk: String,
    commands: Vec<String>,
    created_at: u128,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SudoAuditRecord {
    request_id: String,
    task_id: String,
    decision: String,
    domain: String,
    risk: String,
    commands: Vec<String>,
    decided_at: u128,
    exit_code: Option<i32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SudoDecisionResult {
    task_id: String,
    request_id: String,
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

#[tauri::command]
fn get_app_settings() -> AppSettings {
    read_app_settings()
}

#[tauri::command]
fn set_sudo_flow_enabled(enabled: bool) -> Result<AppSettings, String> {
    let mut settings = read_app_settings();
    settings.sudo_flow_enabled = enabled;
    write_app_settings(&settings)?;
    Ok(settings)
}

#[tauri::command]
fn set_codex_model_settings(request: SetCodexModelSettingsRequest) -> Result<AppSettings, String> {
    let mut settings = read_app_settings();
    settings.codex_model = request
        .codex_model
        .and_then(|model| normalize_optional_model(&model));
    settings.codex_reasoning_effort = normalize_reasoning_effort(&request.codex_reasoning_effort)
        .ok_or_else(|| "Unsupported Codex reasoning effort".to_string())?;
    write_app_settings(&settings)?;
    Ok(settings)
}

#[tauri::command]
fn set_session_retention_limit(request: SetSessionRetentionLimitRequest) -> Result<AppSettings, String> {
    let mut settings = read_app_settings();
    settings.session_retention_limit = request.limit.clamp(16, 256);
    write_app_settings(&settings)?;
    Ok(settings)
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
    let direct_execute = request.direct_execute;
    let codex_model = request.codex_model;
    let codex_reasoning_effort = configured_reasoning_effort(request.codex_reasoning_effort);
    let user_message = request.user_message.unwrap_or_else(|| prompt.clone());
    let task_id = request.task_id.unwrap_or_else(new_task_id);
    persist_placeholder_title_if_missing(&task_id);
    let task_workspace = ensure_task_workspace(&task_id, &profile)?;
    let codex_cli = configured_codex_cli_path().ok_or_else(|| "Codex CLI path is not configured".to_string())?;
    let registry = running_tasks.inner().clone();
    let app_for_thread = app.clone();
    let task_id_for_thread = task_id.clone();

    thread::spawn(move || {
        let runtime_read_paths = runtime_read_paths(&profile, &task_workspace);
        let runtime_cwd = task_workspace.to_string_lossy().to_string();

        emit_task_event(
            &app_for_thread,
            TaskEvent {
                task_id: task_id_for_thread.clone(),
                event: "user_message",
                text: Some(user_message),
                status: None,
                exit_code: None,
            },
        );

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

        let context = merge_attached_context(collect_context(&profile, &task_workspace), attached_context.as_deref());
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

        let task_prompt = build_diagnose_prompt(
            &profile,
            &runtime_cwd,
            &runtime_read_paths,
            &context,
            &prompt,
            direct_execute,
        );
        let mut command = Command::new(&codex_cli);
        command
            .arg("exec")
            .arg("--skip-git-repo-check")
            .arg("--sandbox")
            .arg("read-only");
        apply_codex_model_options(&mut command, codex_model.as_deref(), &codex_reasoning_effort);
        command
            .arg(task_prompt)
            .current_dir(&task_workspace)
            .stdin(Stdio::null())
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
                        let success = status.success();
                        emit_task_event(
                            &app_for_thread,
                            TaskEvent {
                                task_id: task_id_for_thread,
                                event: if success { "task_finished" } else { "task_failed" },
                                text: Some(if success { "Diagnose task finished" } else { "Diagnose task failed" }.to_string()),
                                status: Some(if success { "finished" } else { "failed" }.to_string()),
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
    let direct_execute = request.direct_execute;
    let codex_model = request.codex_model;
    let codex_reasoning_effort = configured_reasoning_effort(request.codex_reasoning_effort);
    let user_message = request.user_message.unwrap_or_else(|| prompt.clone());
    let task_id = request.task_id.unwrap_or_else(new_task_id);
    persist_placeholder_title_if_missing(&task_id);
    let task_workspace = ensure_task_workspace(&task_id, &profile)?;
    let codex_cli = configured_codex_cli_path().ok_or_else(|| "Codex CLI path is not configured".to_string())?;
    let registry = running_tasks.inner().clone();
    let app_for_thread = app.clone();
    let task_id_for_thread = task_id.clone();

    thread::spawn(move || {
        let runtime_read_paths = runtime_read_paths(&profile, &task_workspace);
        let runtime_write_paths = vec![task_workspace.to_string_lossy().to_string()];
        let runtime_cwd = task_workspace.to_string_lossy().to_string();

        emit_task_event(
            &app_for_thread,
            TaskEvent {
                task_id: task_id_for_thread.clone(),
                event: "user_message",
                text: Some(user_message),
                status: None,
                exit_code: None,
            },
        );

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

        let before_scan = scan_paths(&runtime_write_paths);
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

        let context = merge_attached_context(collect_context(&profile, &task_workspace), attached_context.as_deref());
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

        let task_prompt = build_patch_prompt(
            &profile,
            &runtime_cwd,
            &runtime_read_paths,
            &runtime_write_paths,
            &context,
            &prompt,
            direct_execute,
        );
        let mut command = Command::new(&codex_cli);
        command
            .arg("exec")
            .arg("--skip-git-repo-check")
            .arg("--sandbox")
            .arg("workspace-write");
        for path in &runtime_write_paths {
            command.arg("--add-dir").arg(codex_add_dir_path(path));
        }
        apply_codex_model_options(&mut command, codex_model.as_deref(), &codex_reasoning_effort);
        command
            .arg(task_prompt)
            .current_dir(&task_workspace)
            .stdin(Stdio::null())
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

                        let success = status.success();
                        let after_scan = scan_paths(&runtime_write_paths);
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
                                event: if success { "diff_ready" } else { "task_failed" },
                                text: Some(if success {
                                    format!("{} changed files ready for review", changed_files.len())
                                } else {
                                    "Patch task failed".to_string()
                                }),
                                status: Some(if success { "awaiting_review" } else { "failed" }.to_string()),
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
    let mut page: Vec<PersistedTaskEvent> = events.into_iter().skip(offset).take(limit).collect();
    hydrate_event_texts(&mut page);

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
    let mut summaries = collect_task_summaries()?;
    summaries.truncate(limit);

    Ok(summaries)
}

fn collect_task_summaries() -> Result<Vec<TaskSummary>, String> {
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
            title: read_task_title(&entry.path()),
            updated_at,
            event_count: events.len(),
            latest_status: latest.and_then(|event| event.status.clone()),
            latest_preview: latest.and_then(|event| event.text_preview.clone()),
        });
    }

    summaries.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));

    Ok(summaries)
}

#[tauri::command]
fn prune_sessions(max_unpinned: usize, protected_task_ids: Vec<String>) -> Result<PruneSessionsResult, String> {
    let max_unpinned = max_unpinned.max(1);
    let protected = protected_task_ids.into_iter().collect::<HashSet<_>>();
    let mut summaries = collect_task_summaries()?;
    let mut disposable = summaries
        .drain(..)
        .filter(|task| {
            !protected.contains(&task.task_id)
                && !matches!(
                    task.latest_status.as_deref(),
                    Some("running" | "starting" | "snapshot_created" | "context_collected" | "awaiting_review")
                )
        })
        .collect::<Vec<_>>();

    disposable.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    let delete_count = disposable.len().saturating_sub(max_unpinned);
    let deleted = disposable
        .into_iter()
        .rev()
        .take(delete_count)
        .map(|task| {
            let _ = delete_task_storage(&task.task_id);
            task.task_id
        })
        .collect::<Vec<_>>();

    Ok(PruneSessionsResult {
        deleted,
        kept_limit: max_unpinned,
    })
}

#[tauri::command]
fn delete_task(task_id: String) -> Result<(), String> {
    delete_task_storage(&task_id)
}

fn delete_task_storage(task_id: &str) -> Result<(), String> {
    let task_dir = task_data_dir(&task_id).ok_or_else(|| "Could not resolve task data directory".to_string())?;
    if task_dir.exists() {
        fs::remove_dir_all(task_dir).map_err(|error| error.to_string())?;
    }
    if let Some(workspace_dir) = session_workspace_dir(&task_id) {
        if workspace_dir.exists() {
            fs::remove_dir_all(workspace_dir).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn rename_task(task_id: String, title: String) -> Result<(), String> {
    let compact = title.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.is_empty() {
        return Err("Session name cannot be empty".to_string());
    }
    let Some(task_dir) = task_data_dir(&task_id) else {
        return Err("Could not resolve task data directory".to_string());
    };
    fs::create_dir_all(&task_dir).map_err(|error| error.to_string())?;
    let mut safe_title = compact.chars().take(80).collect::<String>();
    if compact.chars().count() > 80 {
        safe_title.push_str("...");
    }
    fs::write(task_dir.join("title.txt"), safe_title).map_err(|error| error.to_string())
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
fn get_task_proposal(task_id: String) -> Result<Option<ProposalState>, String> {
    read_task_proposal(&task_id)
}

#[tauri::command]
fn read_changed_file(task_id: String, path: String) -> Result<ChangedFileContent, String> {
    let changed_files = list_changed_files(task_id)?;
    let Some(file) = changed_files.iter().find(|file| file.path == path) else {
        return Err("File is not part of this review".to_string());
    };
    if file.status == "deleted" {
        return Err("Deleted files do not have current content".to_string());
    }

    let content = fs::read_to_string(&file.path).map_err(|error| error.to_string())?;
    Ok(ChangedFileContent {
        path: file.path.clone(),
        content,
    })
}

#[tauri::command]
fn apply_task_review(
    app: AppHandle,
    running_tasks: State<'_, RunningTasks>,
    task_id: String,
) -> Result<ApplyReviewResult, String> {
    let Some(task_dir) = task_data_dir(&task_id) else {
        return Err("Task data directory is unavailable".to_string());
    };
    let proposal_state = read_task_proposal(&task_id)?.ok_or_else(|| "No proposal is available to apply".to_string())?;
    let changed_files = list_changed_files(task_id.clone()).unwrap_or_default();
    let task_workspace = session_workspace_dir(&task_id).ok_or_else(|| "Could not resolve task workspace".to_string())?;
    let metadata = read_session_metadata(&task_workspace)?;
    let profile = profile_by_id(&metadata.profile_id)
        .ok_or_else(|| format!("Unknown profile: {}", metadata.profile_id))?;
    let codex_cli = configured_codex_cli_path().ok_or_else(|| "Codex CLI path is not configured".to_string())?;
    let settings = read_app_settings();
    let sudo_flow_enabled = settings.sudo_flow_enabled;
    let codex_model = settings.codex_model.clone();
    let codex_reasoning_effort = normalize_reasoning_effort(&settings.codex_reasoning_effort)
        .unwrap_or_else(default_codex_reasoning_effort);
    if running_tasks
        .lock()
        .map_err(|_| "Task registry is unavailable".to_string())?
        .contains_key(&task_id)
    {
        return Err("Task is already running".to_string());
    }

    let proposal = proposal_state.content;

    let result = ApplyReviewResult {
        task_id: task_id.clone(),
        accepted: if changed_files.is_empty() {
            vec!["current proposal".to_string()]
        } else {
            changed_files.iter().map(|file| file.path.clone()).collect()
        },
        execution_started: true,
    };
    let log = serde_json::to_string_pretty(&result).map_err(|error| error.to_string())?;
    fs::write(task_dir.join("apply.json"), log).map_err(|error| error.to_string())?;
    fs::write(task_dir.join("changed-files.json"), "[]").map_err(|error| error.to_string())?;
    fs::write(task_dir.join("diff.patch"), "").map_err(|error| error.to_string())?;

    emit_task_event(
        &app,
        TaskEvent {
            task_id: task_id.clone(),
            event: "task_started",
            text: Some(format!(
                "Apply started with {} proposal inputs",
                result.accepted.len()
            )),
            status: Some("running".to_string()),
            exit_code: None,
        },
    );

    spawn_apply_execution(
        app.clone(),
        running_tasks.inner().clone(),
        task_id.clone(),
        profile,
        task_workspace,
        codex_cli,
        proposal,
        codex_model,
        codex_reasoning_effort,
        sudo_flow_enabled,
    );

    Ok(result)
}

#[tauri::command]
fn decide_sudo_request(
    app: AppHandle,
    task_id: String,
    request_id: String,
    allow: bool,
    password: Option<String>,
) -> Result<SudoDecisionResult, String> {
    let request = read_pending_sudo_request(&task_id, &request_id)?;

    if !allow {
        write_sudo_audit(&request, "deny", None)?;
        remove_pending_sudo_request(&task_id, &request_id);
        emit_task_event(
            &app,
            TaskEvent {
                task_id: task_id.clone(),
                event: "task_finished",
                text: Some(format!("Sudo request denied: {}", request.reason)),
                status: Some("finished".to_string()),
                exit_code: None,
            },
        );
        return Ok(SudoDecisionResult {
            task_id,
            request_id,
            exit_code: None,
        });
    }

    validate_sudo_request(&request)?;
    write_sudo_audit(&request, "allow_once", None)?;

    emit_task_event(
        &app,
        TaskEvent {
            task_id: task_id.clone(),
            event: "task_started",
            text: Some(format!("Sudo allow-once approved: {}", request.reason)),
            status: Some("running".to_string()),
            exit_code: None,
        },
    );

    let mut final_exit_code = Some(0);
    for command in &request.commands {
        emit_task_event(
            &app,
            TaskEvent {
                task_id: task_id.clone(),
                event: "execution_output",
                text: Some(format!("$ sudo {command}")),
                status: Some("running".to_string()),
                exit_code: None,
            },
        );
        let output = run_approved_sudo_command(command, password.as_deref())?;
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if !stdout.is_empty() {
            emit_task_event(
                &app,
                    TaskEvent {
                        task_id: task_id.clone(),
                        event: "execution_output",
                        text: Some(stdout),
                    status: Some("running".to_string()),
                    exit_code: None,
                },
            );
        }
        if !stderr.is_empty() {
            emit_task_event(
                &app,
                TaskEvent {
                    task_id: task_id.clone(),
                    event: "stderr",
                    text: Some(stderr),
                    status: Some("running".to_string()),
                    exit_code: output.status.code(),
                },
            );
        }
        final_exit_code = output.status.code();
        if !output.status.success() {
            break;
        }
    }

    write_sudo_audit(&request, "executed", final_exit_code)?;
    remove_pending_sudo_request(&task_id, &request_id);
    let success = final_exit_code == Some(0);
    emit_task_event(
        &app,
        TaskEvent {
            task_id: task_id.clone(),
            event: if success { "task_finished" } else { "task_failed" },
            text: Some(if success {
                "Sudo request execution finished".to_string()
            } else {
                "Sudo request execution failed. Review stderr and retry with a valid sudo password if authentication failed.".to_string()
            }),
            status: Some(if success { "finished" } else { "failed" }.to_string()),
            exit_code: final_exit_code,
        },
    );

    Ok(SudoDecisionResult {
        task_id,
        request_id,
        exit_code: final_exit_code,
    })
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
    let default_denied_paths = vec![
        "$HOME/.ssh",
        "$HOME/.gnupg",
        "$HOME/.local/share/keyrings",
        "$HOME/.mozilla",
        "$HOME/.password-store",
        "/etc",
        "/usr",
        "/boot",
        "/var",
        "/root",
        "/proc",
        "/sys",
        "/dev",
        "/run",
    ];

    vec![
        TaskProfile {
            id: "daily-maintenance",
            name: "Daily Maintenance",
            description: "Routine Linux desktop maintenance across user config, scripts, packages, logs, and storage.",
            platform: "linux",
            domains: vec![
                ProfileDomain { domain_id: "user-config", access: "draft" },
                ProfileDomain { domain_id: "user-scripts", access: "draft" },
                ProfileDomain { domain_id: "packages", access: "plan" },
                ProfileDomain { domain_id: "logs", access: "read" },
                ProfileDomain { domain_id: "storage", access: "read" },
            ],
            default_mode: "patch",
            cwd: "$JARVIS_WORKSPACE/daily-maintenance",
            write_enabled: true,
            snapshot_required: true,
            read_paths: vec![
                "$HOME/.zshrc",
                "$HOME/.profile",
                "$HOME/.bashrc",
                "$HOME/.config",
                "$HOME/.local/bin",
                "$JARVIS_WORKSPACE/daily-maintenance",
            ],
            write_paths: vec!["$JARVIS_WORKSPACE/daily-maintenance"],
            deny_paths: default_denied_paths.clone(),
            readonly_commands: vec![
                "cat /etc/os-release",
                "echo $SHELL",
                "echo $PATH",
                "df -h $HOME",
                "journalctl --user -p warning -n 80 --no-pager",
                "command -v dnf >/dev/null && dnf check-update --refresh || true",
                "find . -maxdepth 3 -type f | sort | sed -n '1,120p'",
            ],
        },
        TaskProfile {
            id: "dev-environment",
            name: "Dev Environment",
            description: "Maintain local development shells, toolchains, wrappers, and package manager setup.",
            platform: "linux",
            domains: vec![
                ProfileDomain { domain_id: "user-config", access: "draft" },
                ProfileDomain { domain_id: "user-scripts", access: "draft" },
                ProfileDomain { domain_id: "toolchains", access: "draft" },
                ProfileDomain { domain_id: "packages", access: "plan" },
            ],
            default_mode: "patch",
            cwd: "$JARVIS_WORKSPACE/dev-environment",
            write_enabled: true,
            snapshot_required: true,
            read_paths: vec![
                "$HOME/.zshrc",
                "$HOME/.profile",
                "$HOME/.local/bin",
                "$HOME/.nvm",
                "$HOME/.cargo",
                "$JARVIS_WORKSPACE/dev-environment",
            ],
            write_paths: vec!["$JARVIS_WORKSPACE/dev-environment"],
            deny_paths: default_denied_paths.clone(),
            readonly_commands: vec![
                "echo $PATH",
                "command -v node && node --version || true",
                "command -v pnpm && pnpm --version || true",
                "command -v cargo && cargo --version || true",
                "command -v codex && codex --version || true",
                "find . -maxdepth 3 -type f | sort | sed -n '1,120p'",
            ],
        },
        TaskProfile {
            id: "service-debugging",
            name: "Service Debugging",
            description: "Debug user services with logs, network state, and read-only visibility into system services.",
            platform: "linux",
            domains: vec![
                ProfileDomain { domain_id: "user-services", access: "draft" },
                ProfileDomain { domain_id: "system-services", access: "read" },
                ProfileDomain { domain_id: "logs", access: "read" },
                ProfileDomain { domain_id: "network", access: "read" },
            ],
            default_mode: "patch",
            cwd: "$JARVIS_WORKSPACE/service-debugging",
            write_enabled: true,
            snapshot_required: true,
            read_paths: vec!["$HOME/.config/systemd/user", "$JARVIS_WORKSPACE/service-debugging"],
            write_paths: vec!["$JARVIS_WORKSPACE/service-debugging"],
            deny_paths: default_denied_paths.clone(),
            readonly_commands: vec![
                "systemctl --user list-units --type=service --no-pager",
                "systemctl --user --failed --no-pager",
                "systemctl list-units --type=service --state=failed --no-pager || true",
                "journalctl --user -p warning -n 120 --no-pager",
                "ss -ltnp || true",
            ],
        },
        TaskProfile {
            id: "package-maintenance",
            name: "Package Maintenance",
            description: "Inspect package managers and produce safe install, update, remove, or repair plans.",
            platform: "linux",
            domains: vec![
                ProfileDomain { domain_id: "packages", access: "plan" },
                ProfileDomain { domain_id: "logs", access: "read" },
                ProfileDomain { domain_id: "storage", access: "read" },
            ],
            default_mode: "diagnose",
            cwd: "$JARVIS_WORKSPACE/package-maintenance",
            write_enabled: true,
            snapshot_required: true,
            read_paths: vec!["$JARVIS_WORKSPACE/package-maintenance"],
            write_paths: vec!["$JARVIS_WORKSPACE/package-maintenance"],
            deny_paths: default_denied_paths.clone(),
            readonly_commands: vec![
                "cat /etc/os-release",
                "command -v dnf >/dev/null && dnf repolist || true",
                "command -v rpm >/dev/null && rpm -qa | wc -l || true",
                "command -v flatpak >/dev/null && flatpak list || true",
                "df -h / $HOME",
            ],
        },
        TaskProfile {
            id: "deep-system-review",
            name: "Deep System Review",
            description: "Read-only review of kernel, boot, security, and low-level system state.",
            platform: "linux",
            domains: vec![
                ProfileDomain { domain_id: "boot-kernel", access: "read" },
                ProfileDomain { domain_id: "system-services", access: "read" },
                ProfileDomain { domain_id: "security", access: "read" },
                ProfileDomain { domain_id: "logs", access: "read" },
            ],
            default_mode: "diagnose",
            cwd: "$JARVIS_WORKSPACE/deep-system-review",
            write_enabled: false,
            snapshot_required: false,
            read_paths: vec!["$JARVIS_WORKSPACE/deep-system-review"],
            write_paths: vec![],
            deny_paths: default_denied_paths,
            readonly_commands: vec![
                "uname -a",
                "bootctl status --no-pager || true",
                "lsmod | sed -n '1,120p'",
                "getenforce 2>/dev/null || true",
                "journalctl -p warning -b -n 120 --no-pager || true",
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

fn collect_context(profile: &TaskProfile, cwd: &Path) -> String {
    profile
        .readonly_commands
        .iter()
        .map(|command| {
            let output = Command::new("sh")
                .arg("-lc")
                .arg(command)
                .current_dir(cwd)
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

fn read_session_metadata(task_workspace: &Path) -> Result<SessionMetadata, String> {
    let path = task_workspace.join(".jarvis-session.json");
    let content = fs::read_to_string(&path).map_err(|error| format!("Could not read session metadata: {error}"))?;
    serde_json::from_str(&content).map_err(|error| format!("Could not parse session metadata: {error}"))
}

fn spawn_apply_execution(
    app: AppHandle,
    registry: RunningTasks,
    task_id: String,
    profile: TaskProfile,
    task_workspace: PathBuf,
    codex_cli: String,
    proposal: String,
    codex_model: Option<String>,
    codex_reasoning_effort: String,
    sudo_flow_enabled: bool,
) {
    thread::spawn(move || {
        let runtime_read_paths = runtime_read_paths(&profile, &task_workspace);
        let runtime_write_paths = vec![task_workspace.to_string_lossy().to_string()];
        let runtime_cwd = task_workspace.to_string_lossy().to_string();
        let context = collect_context(&profile, &task_workspace);
        emit_task_event(
            &app,
            TaskEvent {
                task_id: task_id.clone(),
                event: "context_collected",
                text: Some(context.clone()),
                status: Some("context_collected".to_string()),
                exit_code: None,
            },
        );

        let task_prompt = build_apply_prompt(
            &profile,
            &runtime_cwd,
            &runtime_read_paths,
            &runtime_write_paths,
            &context,
            &proposal,
            sudo_flow_enabled,
        );
        let mut command = Command::new(&codex_cli);
        command
            .arg("exec")
            .arg("--skip-git-repo-check")
            .arg("--sandbox")
            .arg("workspace-write");
        for path in &runtime_write_paths {
            command.arg("--add-dir").arg(codex_add_dir_path(path));
        }
        apply_codex_model_options(&mut command, codex_model.as_deref(), &codex_reasoning_effort);
        command
            .arg(task_prompt)
            .current_dir(&task_workspace)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        match command.spawn() {
            Ok(mut child) => {
                let stdout = child.stdout.take();
                let stderr = child.stderr.take();
                let child = Arc::new(Mutex::new(child));

                if let Ok(mut tasks) = registry.lock() {
                    tasks.insert(task_id.clone(), child.clone());
                }

                if let Some(stdout) = stdout {
                    stream_reader(app.clone(), task_id.clone(), "stdout", stdout);
                }
                if let Some(stderr) = stderr {
                    stream_reader(app.clone(), task_id.clone(), "stderr", stderr);
                }

                loop {
                    let status = child.lock().ok().and_then(|mut child| child.try_wait().ok()).flatten();

                    if let Some(status) = status {
                        if let Ok(mut tasks) = registry.lock() {
                            tasks.remove(&task_id);
                        }
                        let success = status.success();
                        emit_task_event(
                            &app,
                            TaskEvent {
                                task_id,
                                event: if success { "task_finished" } else { "task_failed" },
                                text: Some(if success {
                                    "Apply execution finished".to_string()
                                } else {
                                    "Apply execution failed".to_string()
                                }),
                                status: Some(if success { "finished" } else { "failed" }.to_string()),
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
                    &app,
                    TaskEvent {
                        task_id,
                        event: "task_failed",
                        text: Some(format!("Failed to start apply execution: {error}")),
                        status: Some("failed".to_string()),
                        exit_code: None,
                    },
                );
            }
        }
    });
}

fn configured_codex_cli_path() -> Option<String> {
    read_app_settings().codex_cli_path
}

fn default_codex_reasoning_effort() -> String {
    "medium".to_string()
}

fn default_session_retention_limit() -> usize {
    64
}

fn normalize_reasoning_effort(value: &str) -> Option<String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "low" | "medium" | "high" => Some(value.trim().to_ascii_lowercase()),
        _ => None,
    }
}

fn normalize_optional_model(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed == "__cli_default__" {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn configured_reasoning_effort(request_value: Option<String>) -> String {
    request_value
        .as_deref()
        .and_then(normalize_reasoning_effort)
        .or_else(|| normalize_reasoning_effort(&read_app_settings().codex_reasoning_effort))
        .unwrap_or_else(default_codex_reasoning_effort)
}

fn apply_codex_model_options(command: &mut Command, model: Option<&str>, reasoning_effort: &str) {
    if let Some(model) = model.and_then(normalize_optional_model) {
        command.arg("--model").arg(model);
    }
    command
        .arg("-c")
        .arg(format!("model_reasoning_effort=\"{}\"", reasoning_effort));
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

fn build_diagnose_prompt(
    profile: &TaskProfile,
    cwd: &str,
    read_paths: &[String],
    context: &str,
    user_prompt: &str,
    direct_execute: bool,
) -> String {
    let execution_policy = if direct_execute {
        "Direct execute is enabled. You may run safe, read-only, non-privileged commands needed for diagnosis. Do not modify files, do not run sudo, and do not run destructive commands."
    } else {
        "Conversation mode is active: no executing. Do not run shell commands, do not modify files, do not create draft files, and do not apply changes. Answer naturally, using the provided context. If the discussion reaches a concrete decision, provide the proposal only through the Jarvis protocol block described below."
    };

    format!(
        "You are assisting with a read-only Linux workstation maintenance task.\n\n\
Task profile:\n\
- Name: {name}\n\
- Platform: {platform}\n\
- Domains:\n{domains}\n\
- Working directory: {cwd}\n\
- Mode: diagnose\n\
- Writes allowed: no\n\
- Intended readable paths:\n{read_paths}\n\
- Forbidden paths:\n{deny_paths}\n\n\
Execution policy:\n{execution_policy}\n\n\
Jarvis protocol:\n\
If this is the first meaningful turn of the session, also include one machine-readable title line:\n\
JARVIS_SESSION_TITLE: <short 3-8 word title>\n\
The title should summarize the user's maintenance intent, not copy the prompt verbatim.\n\
When a concrete proposal or decision is formed or revised, append one machine-readable proposal block at the very end using this exact shape:\n\
JARVIS_PROPOSAL_BEGIN\n\
## Summary\n\
...\n\
## Domains\n\
...\n\
## Actions\n\
...\n\
## Sudo\n\
...\n\
JARVIS_PROPOSAL_END\n\
Keep the block human-readable markdown. Do not mention this protocol, the title line, or the proposal block in the user-facing answer.\n\n\
Rules:\n\
1. Do not modify files.\n\
2. Do not create markdown drafts or command plan files unless the user explicitly asks for exported files.\n\
3. Do not run sudo.\n\
4. Do not run destructive commands.\n\
5. Explain findings clearly.\n\
6. If changes are needed, suggest them but do not apply them.\n\n\
Collected context:\n{context}\n\n\
User task:\n{user_prompt}",
        name = profile.name,
        platform = profile.platform,
        domains = format_profile_domains(&profile),
        cwd = cwd,
        read_paths = read_paths
            .iter()
            .map(|path| format!("  - {path}"))
            .collect::<Vec<_>>()
            .join("\n"),
        execution_policy = execution_policy,
        deny_paths = profile
            .deny_paths
            .iter()
            .map(|path| format!("  - {path}"))
            .collect::<Vec<_>>()
            .join("\n")
    )
}

fn build_patch_prompt(
    profile: &TaskProfile,
    cwd: &str,
    read_paths: &[String],
    write_paths: &[String],
    context: &str,
    user_prompt: &str,
    direct_execute: bool,
) -> String {
    let execution_policy = if direct_execute {
        "Direct execute is enabled. You may run safe, non-privileged commands and write inside the listed writable paths immediately. Do not run sudo, package install/remove/update commands, service enable/disable commands, destructive file deletion, or boot/kernel/security changes unless the user explicitly provided the exact command and accepted the risk."
    } else {
        "Conversation mode is active: no executing. Do not run shell commands, do not modify files, do not create draft files, and do not apply changes. Answer naturally. If the discussion reaches a concrete decision, provide the proposal only through the Jarvis protocol block described below."
    };

    format!(
        "You are assisting with a Linux workstation maintenance patch task.\n\n\
Task profile:\n\
- Name: {name}\n\
- Platform: {platform}\n\
- Domains:\n{domains}\n\
- Working directory: {cwd}\n\
- Mode: patch\n\
- Intended readable paths:\n{read_paths}\n\
- Writable paths:\n{write_paths}\n\
- Forbidden paths:\n{deny_paths}\n\n\
Execution policy:\n{execution_policy}\n\n\
Jarvis protocol:\n\
If this is the first meaningful turn of the session, also include one machine-readable title line:\n\
JARVIS_SESSION_TITLE: <short 3-8 word title>\n\
The title should summarize the user's maintenance intent, not copy the prompt verbatim.\n\
When a concrete proposal or decision is formed or revised, append one machine-readable proposal block at the very end using this exact shape:\n\
JARVIS_PROPOSAL_BEGIN\n\
## Summary\n\
...\n\
## Domains\n\
...\n\
## Actions\n\
...\n\
## Sudo\n\
...\n\
JARVIS_PROPOSAL_END\n\
Keep the block human-readable markdown and ensure it reflects the latest decision. Do not mention this protocol, the title line, or the proposal block in the user-facing answer.\n\n\
Rules:\n\
1. Modify only writable paths listed above.\n\
2. Do not modify forbidden paths.\n\
3. Do not run sudo.\n\
4. Do not run destructive commands.\n\
5. Do not create markdown drafts or command plan files unless the user explicitly asks for exported files.\n\
6. Prefer minimal changes.\n\
7. Explain every file change.\n\
8. If privileged operations are needed, only suggest commands; do not execute them.\n\n\
Collected context:\n{context}\n\n\
User task:\n{user_prompt}",
        name = profile.name,
        platform = profile.platform,
        domains = format_profile_domains(&profile),
        cwd = cwd,
        read_paths = read_paths
            .iter()
            .map(|path| format!("  - {path}"))
            .collect::<Vec<_>>()
            .join("\n"),
        write_paths = write_paths
            .iter()
            .map(|path| format!("  - {path}"))
            .collect::<Vec<_>>()
            .join("\n"),
        execution_policy = execution_policy,
        deny_paths = profile
            .deny_paths
            .iter()
            .map(|path| format!("  - {path}"))
            .collect::<Vec<_>>()
            .join("\n")
    )
}

fn build_apply_prompt(
    profile: &TaskProfile,
    cwd: &str,
    read_paths: &[String],
    write_paths: &[String],
    context: &str,
    proposal: &str,
    sudo_flow_enabled: bool,
) -> String {
    let sudo_policy = if sudo_flow_enabled {
        "Sudo flow is enabled. If the reviewed proposal requires a privileged operation, do not run sudo yourself. Instead output exactly one line beginning with `SUDO_REQUEST_JSON: ` followed by compact JSON with keys `reason`, `domain`, `risk`, and `commands`. Commands must omit the leading sudo. Example: SUDO_REQUEST_JSON: {\"reason\":\"Install OpenJDK\",\"domain\":\"packages\",\"risk\":\"package-install\",\"commands\":[\"dnf install java-25-openjdk-devel\"]}. After emitting a sudo request, stop."
    } else {
        "Sudo flow is disabled. Do not run sudo and do not emit SUDO_REQUEST_JSON. If privileged work is needed, report the exact manual command."
    };
    format!(
        "You are applying an approved Codex Jarvis proposal for a Linux workstation maintenance task.\n\n\
Task profile:\n\
- Name: {name}\n\
- Platform: {platform}\n\
- Domains:\n{domains}\n\
- Working directory: {cwd}\n\
- Mode: apply reviewed proposal\n\
- Intended readable paths:\n{read_paths}\n\
- Writable paths:\n{write_paths}\n\
- Forbidden paths:\n{deny_paths}\n\n\
Execution policy:\n\
The user has clicked Apply. Execute the reviewed proposal now where it is allowed by the profile/domain boundary. You may run safe, non-privileged commands and write only inside the listed writable paths. Do not run sudo, package install/remove/update commands, service enable/disable commands, destructive file deletion, or boot/kernel/security changes unless the reviewed proposal contains the exact command and the profile domain allows direct execution. If an operation is outside the boundary, do not execute it; report the exact command or manual step needed.\n\n\
Sudo policy:\n{sudo_policy}\n\n\
Rules:\n\
1. Treat the reviewed proposal below as the source of truth.\n\
2. Respect the profile domains and forbidden paths.\n\
3. Modify only writable paths listed above.\n\
4. Do not run sudo.\n\
5. Do not execute package, service, boot, kernel, or security changes unless they are explicitly allowed by the profile boundary.\n\
6. Report what you executed and what remains manual.\n\n\
Collected context:\n{context}\n\n\
Reviewed proposal:\n{proposal}",
        name = profile.name,
        platform = profile.platform,
        domains = format_profile_domains(profile),
        cwd = cwd,
        read_paths = read_paths
            .iter()
            .map(|path| format!("  - {path}"))
            .collect::<Vec<_>>()
            .join("\n"),
        write_paths = write_paths
            .iter()
            .map(|path| format!("  - {path}"))
            .collect::<Vec<_>>()
            .join("\n"),
        deny_paths = profile
            .deny_paths
            .iter()
            .map(|path| format!("  - {path}"))
            .collect::<Vec<_>>()
            .join("\n"),
        context = context,
        proposal = proposal,
        sudo_policy = sudo_policy,
    )
}

fn format_profile_domains(profile: &TaskProfile) -> String {
    profile
        .domains
        .iter()
        .map(|domain| format!("  - {}: {}", domain.domain_id, domain.access))
        .collect::<Vec<_>>()
        .join("\n")
}

fn expand_home(path: &str) -> String {
    if let Some(rest) = path.strip_prefix("$JARVIS_WORKSPACE") {
        if let Some(workspace) = workspace_data_dir() {
            return format!("{}{}", workspace.to_string_lossy(), rest);
        }
    }
    if let Some(rest) = path.strip_prefix("$HOME") {
        if let Some(home) = std::env::var_os("HOME") {
            return format!("{}{}", home.to_string_lossy(), rest);
        }
    }
    path.to_string()
}

fn codex_add_dir_path(path: &str) -> String {
    let expanded = PathBuf::from(expand_home(path));
    if expanded.is_file() {
        expanded
            .parent()
            .map(|parent| parent.to_string_lossy().to_string())
            .unwrap_or_else(|| expanded.to_string_lossy().to_string())
    } else {
        expanded.to_string_lossy().to_string()
    }
}

fn stream_reader<R>(app: AppHandle, task_id: String, event: &'static str, reader: R)
where
    R: std::io::Read + Send + 'static,
{
    thread::spawn(move || {
        let mut proposal_block: Option<Vec<String>> = None;
        for line in BufReader::new(reader).lines() {
            if let Ok(line) = line {
                if event == "stdout" {
                    if let Some(lines) = proposal_block.as_mut() {
                        if let Some((before_end, _)) = line.split_once("JARVIS_PROPOSAL_END") {
                            lines.push(before_end.to_string());
                            if let Some(proposal) = proposal_from_content(&task_id, &lines.join("\n")) {
                                persist_task_proposal(&proposal);
                                emit_task_event(
                                    &app,
                                    TaskEvent {
                                        task_id: task_id.clone(),
                                        event: "proposal_updated",
                                        text: Some(proposal.content),
                                        status: Some("awaiting_review".to_string()),
                                        exit_code: None,
                                    },
                                );
                            }
                            proposal_block = None;
                        } else {
                            lines.push(line);
                        }
                        continue;
                    }
                    if let Some(title) = parse_session_title_line(&line) {
                        persist_task_title_from_codex(&task_id, &title);
                        emit_task_event(
                            &app,
                            TaskEvent {
                                task_id: task_id.clone(),
                                event: "title_updated",
                                text: Some(title),
                                status: Some("running".to_string()),
                                exit_code: None,
                            },
                        );
                        continue;
                    }
                    if let Some((_, after_begin)) = line.split_once("JARVIS_PROPOSAL_BEGIN") {
                        if let Some((content, _)) = after_begin.split_once("JARVIS_PROPOSAL_END") {
                            if let Some(proposal) = proposal_from_content(&task_id, content) {
                                persist_task_proposal(&proposal);
                                emit_task_event(
                                    &app,
                                    TaskEvent {
                                        task_id: task_id.clone(),
                                        event: "proposal_updated",
                                        text: Some(proposal.content),
                                        status: Some("awaiting_review".to_string()),
                                        exit_code: None,
                                    },
                                );
                            }
                        } else {
                            proposal_block = Some(vec![after_begin.to_string()]);
                        }
                        continue;
                    }
                    if let Some(request) = parse_sudo_request_line(&task_id, &line) {
                        persist_pending_sudo_request(&request);
                        let text = serde_json::to_string(&request).unwrap_or_else(|_| line.clone());
                        emit_task_event(
                            &app,
                            TaskEvent {
                                task_id: task_id.clone(),
                                event: "sudo_request",
                                text: Some(text),
                                status: Some("awaiting_review".to_string()),
                                exit_code: None,
                            },
                        );
                        continue;
                    }
                    if let Some(proposal) = parse_proposal_line(&task_id, &line) {
                        persist_task_proposal(&proposal);
                        emit_task_event(
                            &app,
                            TaskEvent {
                                task_id: task_id.clone(),
                                event: "proposal_updated",
                                text: Some(proposal.content),
                                status: Some("awaiting_review".to_string()),
                                exit_code: None,
                            },
                        );
                        continue;
                    }
                }
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

fn parse_sudo_request_line(task_id: &str, line: &str) -> Option<PendingSudoRequest> {
    let payload = line.trim().strip_prefix("SUDO_REQUEST_JSON:")?.trim();
    let request = serde_json::from_str::<SudoRequestPayload>(payload).ok()?;
    if request.commands.is_empty() {
        return None;
    }
    Some(PendingSudoRequest {
        request_id: format!("sudo_{}", now_millis()),
        task_id: task_id.to_string(),
        reason: request.reason,
        domain: request.domain,
        risk: request.risk,
        commands: request.commands,
        created_at: now_millis(),
    })
}

fn parse_session_title_line(line: &str) -> Option<String> {
    let title = line.trim().strip_prefix("JARVIS_SESSION_TITLE:")?.trim();
    sanitize_session_title(title)
}

fn parse_proposal_line(task_id: &str, line: &str) -> Option<ProposalState> {
    let trimmed = line.trim();
    let content = if let Some(payload) = trimmed.strip_prefix("JARVIS_PROPOSAL:") {
        payload.trim().to_string()
    } else if trimmed.contains("JARVIS_PROPOSAL_BEGIN") && trimmed.contains("JARVIS_PROPOSAL_END") {
        trimmed
            .split_once("JARVIS_PROPOSAL_BEGIN")?
            .1
            .split_once("JARVIS_PROPOSAL_END")?
            .0
            .trim()
            .to_string()
    } else {
        return None;
    };
    if content.is_empty() {
        return None;
    }
    proposal_from_content(task_id, &content)
}

fn proposal_from_content(task_id: &str, content: &str) -> Option<ProposalState> {
    let content = content.trim().to_string();
    if content.is_empty() {
        return None;
    }
    Some(ProposalState {
        task_id: task_id.to_string(),
        content,
        updated_at: now_millis(),
        source: "codex".to_string(),
    })
}

fn persist_task_proposal(proposal: &ProposalState) {
    let Some(task_dir) = task_data_dir(&proposal.task_id) else {
        return;
    };
    let _ = fs::create_dir_all(&task_dir);
    if let Ok(content) = serde_json::to_string_pretty(proposal) {
        let _ = fs::write(task_dir.join("proposal.json"), content);
    }
    let _ = fs::write(task_dir.join("proposal.md"), &proposal.content);
}

fn read_task_proposal(task_id: &str) -> Result<Option<ProposalState>, String> {
    let Some(task_dir) = task_data_dir(task_id) else {
        return Ok(None);
    };
    let path = task_dir.join("proposal.json");
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&content)
        .map(Some)
        .map_err(|error| error.to_string())
}

fn persist_pending_sudo_request(request: &PendingSudoRequest) {
    let Some(task_dir) = task_data_dir(&request.task_id) else {
        return;
    };
    let dir = task_dir.join("sudo-requests");
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    if let Ok(content) = serde_json::to_string_pretty(request) {
        let _ = fs::write(dir.join(format!("{}.json", request.request_id)), content);
    }
}

fn read_pending_sudo_request(task_id: &str, request_id: &str) -> Result<PendingSudoRequest, String> {
    let path = sudo_request_path(task_id, request_id)?;
    let content = fs::read_to_string(path).map_err(|error| format!("Could not read sudo request: {error}"))?;
    serde_json::from_str(&content).map_err(|error| format!("Could not parse sudo request: {error}"))
}

fn remove_pending_sudo_request(task_id: &str, request_id: &str) {
    if let Ok(path) = sudo_request_path(task_id, request_id) {
        let _ = fs::remove_file(path);
    }
}

fn sudo_request_path(task_id: &str, request_id: &str) -> Result<PathBuf, String> {
    let task_dir = task_data_dir(task_id).ok_or_else(|| "Could not resolve task data directory".to_string())?;
    Ok(task_dir.join("sudo-requests").join(format!("{request_id}.json")))
}

fn write_sudo_audit(request: &PendingSudoRequest, decision: &str, exit_code: Option<i32>) -> Result<(), String> {
    let task_dir = task_data_dir(&request.task_id).ok_or_else(|| "Could not resolve task data directory".to_string())?;
    let dir = task_dir.join("sudo-audit");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let record = SudoAuditRecord {
        request_id: request.request_id.clone(),
        task_id: request.task_id.clone(),
        decision: decision.to_string(),
        domain: request.domain.clone(),
        risk: request.risk.clone(),
        commands: request.commands.clone(),
        decided_at: now_millis(),
        exit_code,
    };
    let content = serde_json::to_string_pretty(&record).map_err(|error| error.to_string())?;
    fs::write(dir.join(format!("{}_{}.json", request.request_id, decision)), content).map_err(|error| error.to_string())
}

fn validate_sudo_request(request: &PendingSudoRequest) -> Result<(), String> {
    if request.commands.is_empty() {
        return Err("Sudo request has no commands".to_string());
    }
    for command in &request.commands {
        validate_sudo_command(&request.domain, command)?;
    }
    Ok(())
}

fn validate_sudo_command(domain: &str, command: &str) -> Result<(), String> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return Err("Empty sudo command".to_string());
    }
    if trimmed.starts_with("sudo ") || trimmed.contains('\n') {
        return Err("Sudo commands must omit sudo and stay on one line".to_string());
    }
    let blocked = [";", "&&", "||", "|", ">", "<", "$(", "`"];
    if blocked.iter().any(|token| trimmed.contains(token)) {
        return Err(format!("Sudo command contains unsupported shell syntax: {trimmed}"));
    }
    let parts = trimmed.split_whitespace().collect::<Vec<_>>();
    match parts.as_slice() {
        ["dnf", action, rest @ ..]
            if domain == "packages" && matches!(*action, "install" | "remove" | "upgrade") && !rest.is_empty() =>
        {
            Ok(())
        }
        ["systemctl", action, rest @ ..]
            if matches!(domain, "user-services" | "system-services")
                && matches!(*action, "status" | "restart")
                && !rest.is_empty() =>
        {
            Ok(())
        }
        _ => Err(format!("Sudo command is outside the current allowlist: {trimmed}")),
    }
}

fn run_approved_sudo_command(command: &str, password: Option<&str>) -> Result<std::process::Output, String> {
    let parts = command.split_whitespace().collect::<Vec<_>>();
    let mut sudo = Command::new("sudo");
    if password.is_some() {
        sudo.arg("-S").arg("-p").arg("");
        sudo.stdin(Stdio::piped());
    } else {
        sudo.arg("-n");
        sudo.stdin(Stdio::null());
    }
    for part in parts {
        sudo.arg(part);
    }
    sudo.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = sudo.spawn().map_err(|error| error.to_string())?;
    if let Some(password) = password {
        if let Some(stdin) = child.stdin.as_mut() {
            stdin
                .write_all(password.as_bytes())
                .and_then(|_| stdin.write_all(b"\n"))
                .map_err(|error| error.to_string())?;
        }
    }

    child.wait_with_output().map_err(|error| error.to_string())
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
        text: None,
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
            "stdout" | "execution_output" => {
                append_file(task_dir.join("stdout.log"), text);
                append_file(task_dir.join("stdout.log"), "\n");
            }
            "proposal_updated" => {
                append_file(task_dir.join("proposal-events.log"), text);
                append_file(task_dir.join("proposal-events.log"), "\n");
            }
            "title_updated" => {
                append_file(task_dir.join("system.log"), text);
                append_file(task_dir.join("system.log"), "\n");
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
    Some(app_data_dir()?.join("tasks"))
}

fn workspace_data_dir() -> Option<PathBuf> {
    Some(app_data_dir()?.join("workspace"))
}

fn session_workspaces_dir() -> Option<PathBuf> {
    Some(workspace_data_dir()?.join("sessions"))
}

fn session_workspace_dir(task_id: &str) -> Option<PathBuf> {
    Some(session_workspaces_dir()?.join(task_id))
}

fn app_data_dir() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(PathBuf::from(home).join(".local/share/codex-jarvis"))
}

fn ensure_app_workspace() -> Result<(), String> {
    let data_dir = app_data_dir().ok_or_else(|| "HOME is not set".to_string())?;
    let workspace_dir = workspace_data_dir().ok_or_else(|| "HOME is not set".to_string())?;
    fs::create_dir_all(data_dir.join("tasks")).map_err(|error| error.to_string())?;
    fs::create_dir_all(data_dir.join("snapshots")).map_err(|error| error.to_string())?;
    fs::create_dir_all(data_dir.join("terminal")).map_err(|error| error.to_string())?;
    fs::create_dir_all(&workspace_dir).map_err(|error| error.to_string())?;
    fs::create_dir_all(workspace_dir.join("sessions")).map_err(|error| error.to_string())?;
    fs::create_dir_all(workspace_dir.join("daily-maintenance")).map_err(|error| error.to_string())?;
    fs::create_dir_all(workspace_dir.join("dev-environment")).map_err(|error| error.to_string())?;
    fs::create_dir_all(workspace_dir.join("service-debugging")).map_err(|error| error.to_string())?;
    fs::create_dir_all(workspace_dir.join("package-maintenance")).map_err(|error| error.to_string())?;
    fs::create_dir_all(workspace_dir.join("deep-system-review")).map_err(|error| error.to_string())?;

    if !workspace_dir.join(".git").exists() {
        let _ = Command::new("git")
            .arg("init")
            .arg("--quiet")
            .current_dir(&workspace_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }

    Ok(())
}

fn ensure_task_workspace(task_id: &str, profile: &TaskProfile) -> Result<PathBuf, String> {
    let workspace_dir = session_workspace_dir(task_id).ok_or_else(|| "Could not resolve task workspace".to_string())?;
    fs::create_dir_all(&workspace_dir).map_err(|error| error.to_string())?;

    let metadata = serde_json::json!({
        "taskId": task_id,
        "profileId": profile.id,
        "profileName": profile.name,
        "platform": profile.platform,
        "domains": profile.domains,
        "createdAt": now_millis(),
    });
    let metadata_path = workspace_dir.join(".jarvis-session.json");
    if !metadata_path.exists() {
        if let Ok(content) = serde_json::to_string_pretty(&metadata) {
            let _ = fs::write(metadata_path, content);
        }
    }

    Ok(workspace_dir)
}

fn runtime_read_paths(profile: &TaskProfile, task_workspace: &Path) -> Vec<String> {
    let mut paths = profile
        .read_paths
        .iter()
        .map(|path| expand_home(path))
        .collect::<Vec<_>>();
    paths.push(task_workspace.to_string_lossy().to_string());
    paths
}

fn persist_placeholder_title_if_missing(task_id: &str) {
    let Some(task_dir) = task_data_dir(task_id) else {
        return;
    };
    let _ = fs::create_dir_all(&task_dir);
    let title_path = task_dir.join("title.txt");
    if title_path.exists() {
        return;
    }
    let _ = fs::write(title_path, "Untitled maintenance task");
}

fn read_task_title(task_dir: &Path) -> Option<String> {
    fs::read_to_string(task_dir.join("title.txt"))
        .ok()
        .map(|title| title.trim().to_string())
        .filter(|title| !title.is_empty())
}

fn persist_task_title_from_codex(task_id: &str, title: &str) {
    let Some(title) = sanitize_session_title(title) else {
        return;
    };
    let Some(task_dir) = task_data_dir(task_id) else {
        return;
    };
    let _ = fs::create_dir_all(&task_dir);
    let _ = fs::write(task_dir.join("title.txt"), title);
}

fn sanitize_session_title(title: &str) -> Option<String> {
    let compact = title.split_whitespace().collect::<Vec<_>>().join(" ");
    let compact = compact.trim_matches(['"', '\'', '`', '#', ':', '-']).trim();
    if compact.is_empty() {
        return None;
    }
    let mut title = compact.chars().take(48).collect::<String>();
    if compact.chars().count() > 48 {
        title.push_str("...");
    }
    Some(title)
}

fn append_file(path: PathBuf, text: &str) {
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = file.write_all(text.as_bytes());
    }
}

fn scan_paths(paths: &[String]) -> HashMap<String, FileState> {
    let mut files = HashMap::new();
    for path in paths {
        collect_file_states(PathBuf::from(path), &mut files);
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

fn hydrate_event_texts(events: &mut [PersistedTaskEvent]) {
    for event in events {
        if event.text.is_some() {
            continue;
        }
        let Some(payload_path) = &event.payload_path else {
            continue;
        };
        if matches!(event.source.as_str(), "user" | "assistant" | "stdout" | "stderr") {
            event.text = fs::read_to_string(payload_path).ok();
        }
    }
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

fn event_source(event: &str) -> &'static str {
    match event {
        "user_message" => "user",
        "context_collected" => "context",
        "stdout" => "assistant",
        "execution_output" => "stdout",
        "proposal_updated" => "system",
        "title_updated" => "system",
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
        .setup(|_| {
            ensure_app_workspace()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            detect_codex_cli,
            set_codex_cli_path,
            get_app_settings,
            set_sudo_flow_enabled,
            set_codex_model_settings,
            set_session_retention_limit,
            list_profiles,
            start_diagnose_task,
            start_patch_task,
            cancel_task,
            delete_task,
            rename_task,
            list_task_events,
            list_recent_tasks,
            prune_sessions,
            list_changed_files,
            get_task_diff,
            get_task_proposal,
            read_changed_file,
            apply_task_review,
            decide_sudo_request,
            rollback_task,
            start_terminal,
            write_terminal,
            resize_terminal,
            close_terminal
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Codex Jarvis");
}
