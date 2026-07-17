use chrono::Utc;
use regex::Regex;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex as StdMutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command};
use tokio::sync::{oneshot, Mutex};
use uuid::Uuid;

#[cfg(target_os = "windows")]
use calen_stock_process_tree::StockProcessTree;

const DEFAULT_TIMEOUT_MS: u64 = 45_000;
const MIN_TIMEOUT_MS: u64 = 1_000;
const MAX_TIMEOUT_MS: u64 = 180_000;
const MAX_STDERR_LINES: usize = 80;
const MAX_UNMATCHED_RESPONSES: usize = 20;
const MAX_CONSECUTIVE_FAILURES: u8 = 2;
const STOCK_SETTINGS_DB: &str = "stock-settings.sqlite3";
const STOCK_KEYRING_SERVICE: &str = "Calen Stock Research";
const KEYED_PROVIDERS: &[&str] = &["zzshare", "tushare", "tickflow", "fuyao"];
// Keep this list limited to adapters that both exist in the sidecar and read a
// provider key at runtime. Providers remain disabled by default; this allow-list
// only permits Credential Manager reads after the user explicitly enables one.
const IMPLEMENTED_KEYED_PROVIDERS: &[&str] = &["zzshare", "tushare", "tickflow", "fuyao"];

#[derive(Debug)]
struct StockProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: Lines<BufReader<ChildStdout>>,
    root: PathBuf,
    process_tree: Arc<StockProcessTree>,
    stderr_task: Option<tauri::async_runtime::JoinHandle<()>>,
}

#[cfg(not(target_os = "windows"))]
#[derive(Debug)]
struct StockProcessTree;

#[cfg(not(target_os = "windows"))]
impl StockProcessTree {
    fn attach(_process_id: u32) -> Result<Self, String> {
        Ok(Self)
    }

    fn terminate(&self) -> Result<(), String> {
        Ok(())
    }
}

#[derive(Default)]
struct StockManagerState {
    process: Option<StockProcess>,
    consecutive_failures: u8,
    last_failure: Option<StockRuntimeFailure>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StockRuntimeFailure {
    stage: String,
    occurred_at: String,
    process_id: Option<u32>,
    exit_code: Option<i32>,
    first_error: String,
    restart_error: Option<String>,
    stderr_tail: Vec<String>,
    sidecar_root: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StockRuntimeStatus {
    available: bool,
    running: bool,
    disabled_after_failures: bool,
    consecutive_failures: u8,
    sidecar_root: Option<String>,
    stderr_tail: Vec<String>,
    last_failure: Option<StockRuntimeFailure>,
    message: Option<String>,
}

#[derive(Default)]
pub struct StockResearchManager {
    state: Mutex<StockManagerState>,
    cancellations: StdMutex<HashMap<String, oneshot::Sender<()>>>,
    stderr_tail: Arc<StdMutex<VecDeque<String>>>,
    diagnostic_secrets: Arc<StdMutex<Vec<String>>>,
    active_process_tree: StdMutex<Option<Arc<StockProcessTree>>>,
}

#[derive(Debug)]
enum RequestFailure {
    Cancelled,
    Timeout,
    Transport {
        stage: &'static str,
        message: String,
    },
    Sidecar(String),
}

impl RequestFailure {
    fn transport(stage: &'static str, message: impl Into<String>) -> Self {
        Self::Transport {
            stage,
            message: message.into(),
        }
    }

    fn message(&self) -> String {
        match self {
            Self::Cancelled => "股票研究请求已取消".to_string(),
            Self::Timeout => "股票研究请求超时，sidecar 已停止并将在下次请求时重启".to_string(),
            Self::Transport { message, .. } => message.clone(),
            Self::Sidecar(message) => message.clone(),
        }
    }

    fn stage(&self) -> Option<&'static str> {
        match self {
            Self::Transport { stage, .. } => Some(stage),
            Self::Timeout => Some("timeout"),
            Self::Cancelled | Self::Sidecar(_) => None,
        }
    }

    fn invalidates_process(&self) -> bool {
        matches!(self, Self::Timeout | Self::Transport { .. })
    }

    fn triggers_auto_restart(&self) -> bool {
        matches!(self, Self::Transport { .. })
    }
}

#[derive(Debug)]
struct StockSpawnFailure {
    stage: &'static str,
    message: String,
    process_id: Option<u32>,
    exit_code: Option<i32>,
    stderr_tail: Vec<String>,
    sidecar_root: Option<String>,
}

impl StockSpawnFailure {
    fn launch(message: impl Into<String>) -> Self {
        Self {
            stage: "launch",
            message: message.into(),
            process_id: None,
            exit_code: None,
            stderr_tail: Vec::new(),
            sidecar_root: None,
        }
    }
}

impl StockResearchManager {
    fn capture_stderr_tail(&self, stderr: ChildStderr) -> tauri::async_runtime::JoinHandle<()> {
        let tail = Arc::clone(&self.stderr_tail);
        let secrets = Arc::clone(&self.diagnostic_secrets);
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let sanitized = secrets
                    .lock()
                    .map(|values| sanitize_diagnostic_text_with_secrets(&line, &values))
                    .unwrap_or_else(|_| sanitize_diagnostic_text(&line));
                if let Ok(mut values) = tail.lock() {
                    values.push_back(sanitized);
                    while values.len() > MAX_STDERR_LINES {
                        values.pop_front();
                    }
                }
            }
        })
    }

    fn clear_stderr_tail(&self) {
        if let Ok(mut tail) = self.stderr_tail.lock() {
            tail.clear();
        }
    }

    fn set_diagnostic_secrets<'a>(&self, values: impl Iterator<Item = &'a String>) {
        if let Ok(mut secrets) = self.diagnostic_secrets.lock() {
            *secrets = values.filter(|value| !value.is_empty()).cloned().collect();
        }
    }

    fn clear_diagnostic_secrets(&self) {
        if let Ok(mut secrets) = self.diagnostic_secrets.lock() {
            secrets.clear();
        }
    }

    async fn cleanup_failed_spawn(
        &self,
        child: &mut Child,
        stderr_task: &mut Option<tauri::async_runtime::JoinHandle<()>>,
        process_tree: Option<&Arc<StockProcessTree>>,
    ) -> Option<i32> {
        if let Some(process_tree) = process_tree {
            let _ = process_tree.terminate();
        }
        if child.try_wait().ok().flatten().is_none() {
            let _ = child.kill().await;
        }
        let exit_code = child.wait().await.ok().and_then(|status| status.code());
        finish_stderr_task(stderr_task).await;
        self.clear_diagnostic_secrets();
        exit_code
    }

    fn stderr_snapshot(&self) -> Vec<String> {
        self.stderr_tail
            .lock()
            .map(|tail| tail.iter().cloned().collect())
            .unwrap_or_default()
    }

    fn runtime_failure_from_spawn(error: &StockSpawnFailure) -> StockRuntimeFailure {
        StockRuntimeFailure {
            stage: error.stage.to_string(),
            occurred_at: Utc::now().to_rfc3339(),
            process_id: error.process_id,
            exit_code: error.exit_code,
            first_error: sanitize_diagnostic_text(&error.message),
            restart_error: None,
            stderr_tail: error.stderr_tail.clone(),
            sidecar_root: error.sidecar_root.clone(),
        }
    }

    fn disabled_message(state: &StockManagerState) -> String {
        if let Some(failure) = state.last_failure.as_ref() {
            let mut message = failure.first_error.clone();
            if let Some(restart_error) = failure.restart_error.as_deref() {
                message.push_str("；自动重启失败：");
                message.push_str(restart_error);
            }
            message.push_str("；股票 sidecar 已暂停自动重启，请在数据源页面手动重启");
            return message;
        }
        "股票 sidecar 连续失败，已暂停自动重启；请在数据源页面手动重启".to_string()
    }

    pub async fn call(
        &self,
        app: &AppHandle,
        method: &str,
        mut params: Value,
    ) -> Result<Value, String> {
        let request_id = request_id_from_params(&params);
        if let Value::Object(object) = &mut params {
            object
                .entry("requestId".to_string())
                .or_insert_with(|| Value::String(request_id.clone()));
        }
        let settings = load_stock_settings()?;
        if settings.get("enabled").and_then(Value::as_bool) == Some(false) {
            return Err("股票研究服务已在数据源设置中关闭".to_string());
        }
        let configured_timeout = settings
            .get("timeoutMs")
            .and_then(Value::as_u64)
            .unwrap_or(DEFAULT_TIMEOUT_MS);
        let timeout_ms = timeout_from_params(&params, configured_timeout);
        let (cancel_tx, cancel_rx) = oneshot::channel();
        self.cancellations
            .lock()
            .map_err(|_| "股票请求取消表已损坏".to_string())?
            .insert(request_id.clone(), cancel_tx);

        let result = self
            .call_locked(app, method, params, &request_id, timeout_ms, cancel_rx)
            .await;

        if let Ok(mut cancellations) = self.cancellations.lock() {
            cancellations.remove(&request_id);
        }
        result.map_err(|failure| failure.message())
    }

    async fn call_locked(
        &self,
        app: &AppHandle,
        method: &str,
        params: Value,
        request_id: &str,
        timeout_ms: u64,
        cancel_rx: oneshot::Receiver<()>,
    ) -> Result<Value, RequestFailure> {
        self.call_locked_with_spawns(
            method,
            params,
            request_id,
            timeout_ms,
            cancel_rx,
            self.spawn(app),
            self.spawn(app),
        )
        .await
    }

    async fn call_locked_with_spawns<F, R>(
        &self,
        method: &str,
        params: Value,
        request_id: &str,
        timeout_ms: u64,
        mut cancel_rx: oneshot::Receiver<()>,
        spawn: F,
        replacement_spawn: R,
    ) -> Result<Value, RequestFailure>
    where
        F: std::future::Future<Output = Result<StockProcess, StockSpawnFailure>>,
        R: std::future::Future<Output = Result<StockProcess, StockSpawnFailure>>,
    {
        let mut state = self.state.lock().await;
        if state.consecutive_failures >= MAX_CONSECUTIVE_FAILURES {
            return Err(RequestFailure::transport(
                "launch",
                Self::disabled_message(&state),
            ));
        }

        let mut replacement_spawn = Some(replacement_spawn);
        let mut started_with_replacement = false;
        if state.process.is_none() {
            match spawn.await {
                Ok(process) => state.process = Some(process),
                Err(error) => {
                    state.consecutive_failures = state.consecutive_failures.saturating_add(1);
                    state.last_failure = Some(Self::runtime_failure_from_spawn(&error));
                    if state.consecutive_failures < MAX_CONSECUTIVE_FAILURES {
                        match replacement_spawn
                            .take()
                            .expect("replacement spawn is available")
                            .await
                        {
                            Ok(process) => {
                                state.process = Some(process);
                                started_with_replacement = true;
                            }
                            Err(restart_error) => {
                                state.consecutive_failures =
                                    state.consecutive_failures.saturating_add(1);
                                if let Some(failure) = state.last_failure.as_mut() {
                                    failure.restart_error =
                                        Some(format_spawn_failure(&restart_error));
                                }
                            }
                        }
                    }
                    if state.process.is_none() {
                        return Err(RequestFailure::transport(
                            error.stage,
                            Self::disabled_message(&state),
                        ));
                    }
                }
            }
        }

        let envelope = json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "method": method,
            "params": params,
        });
        let encoded = serde_json::to_vec(&envelope).map_err(|error| {
            RequestFailure::transport("protocol", format!("序列化股票请求失败：{error}"))
        })?;

        let outcome = request_once(
            state
                .process
                .as_mut()
                .ok_or_else(|| RequestFailure::transport("launch", "股票 sidecar 未启动"))?,
            &encoded,
            request_id,
            timeout_ms,
            &mut cancel_rx,
        )
        .await;

        match outcome {
            Ok(value) => {
                state.consecutive_failures = 0;
                Ok(value)
            }
            Err(failure) => {
                if !failure.triggers_auto_restart() {
                    match &failure {
                        RequestFailure::Timeout => {
                            if let Some(runtime_failure) =
                                self.capture_running_failure(&mut state, &failure).await
                            {
                                if started_with_replacement {
                                    if let Some(existing) = state.last_failure.as_mut() {
                                        existing.restart_error =
                                            Some(format_runtime_failure(&runtime_failure));
                                    }
                                } else {
                                    state.last_failure = Some(runtime_failure);
                                }
                            }
                        }
                        RequestFailure::Cancelled => {
                            self.fail_running_process(&mut state, &failure).await;
                        }
                        RequestFailure::Sidecar(_) => {
                            state.consecutive_failures = 0;
                        }
                        RequestFailure::Transport { .. } => unreachable!(),
                    }
                    return Err(failure);
                }

                let first_error = failure.message();
                if let Some(runtime_failure) =
                    self.capture_running_failure(&mut state, &failure).await
                {
                    if started_with_replacement {
                        if let Some(existing) = state.last_failure.as_mut() {
                            existing.restart_error = Some(format_runtime_failure(&runtime_failure));
                        }
                    } else {
                        state.last_failure = Some(runtime_failure);
                    }
                }
                state.consecutive_failures = state.consecutive_failures.saturating_add(1);

                if started_with_replacement
                    || state.consecutive_failures >= MAX_CONSECUTIVE_FAILURES
                    || !is_read_only_stock_method(method)
                {
                    return Err(RequestFailure::transport(
                        failure.stage().unwrap_or("transport"),
                        if started_with_replacement {
                            Self::disabled_message(&state)
                        } else {
                            first_error
                        },
                    ));
                }

                let replacement = replacement_spawn
                    .take()
                    .expect("replacement spawn is available")
                    .await;
                let process = match replacement {
                    Ok(process) => process,
                    Err(restart_error) => {
                        state.consecutive_failures = state.consecutive_failures.saturating_add(1);
                        if let Some(runtime_failure) = state.last_failure.as_mut() {
                            runtime_failure.restart_error =
                                Some(format_spawn_failure(&restart_error));
                        }
                        return Err(RequestFailure::transport(
                            failure.stage().unwrap_or("transport"),
                            Self::disabled_message(&state),
                        ));
                    }
                };
                state.process = Some(process);

                let retry = request_once(
                    state.process.as_mut().expect("replacement process is set"),
                    &encoded,
                    request_id,
                    timeout_ms,
                    &mut cancel_rx,
                )
                .await;
                match retry {
                    Ok(value) => {
                        state.consecutive_failures = 0;
                        Ok(value)
                    }
                    Err(retry_failure) if retry_failure.triggers_auto_restart() => {
                        let retry_message = retry_failure.message();
                        if let Some(retry_runtime) = self
                            .capture_running_failure(&mut state, &retry_failure)
                            .await
                        {
                            if let Some(runtime_failure) = state.last_failure.as_mut() {
                                runtime_failure.restart_error =
                                    Some(format_runtime_failure(&retry_runtime));
                            }
                        }
                        state.consecutive_failures = state.consecutive_failures.saturating_add(1);
                        Err(RequestFailure::transport(
                            retry_failure.stage().unwrap_or("transport"),
                            format!("{first_error}；自动重启后重试失败：{retry_message}"),
                        ))
                    }
                    Err(retry_failure @ RequestFailure::Timeout) => {
                        if let Some(retry_runtime) = self
                            .capture_running_failure(&mut state, &retry_failure)
                            .await
                        {
                            if let Some(runtime_failure) = state.last_failure.as_mut() {
                                runtime_failure.restart_error =
                                    Some(format_runtime_failure(&retry_runtime));
                            }
                        }
                        Err(retry_failure)
                    }
                    Err(retry_failure) => {
                        self.fail_running_process(&mut state, &retry_failure).await;
                        if matches!(&retry_failure, RequestFailure::Sidecar(_)) {
                            state.consecutive_failures = 0;
                        }
                        Err(retry_failure)
                    }
                }
            }
        }
    }

    async fn fail_running_process(&self, state: &mut StockManagerState, failure: &RequestFailure) {
        if failure.invalidates_process() || matches!(failure, RequestFailure::Cancelled) {
            if let Some(mut process) = state.process.take() {
                let process_tree = Arc::clone(&process.process_tree);
                let _ = terminate_stock_process(&mut process).await;
                finish_stderr_capture(&mut process).await;
                self.clear_diagnostic_secrets();
                self.clear_active_process_tree(&process_tree);
            }
        }
    }

    async fn capture_running_failure(
        &self,
        state: &mut StockManagerState,
        failure: &RequestFailure,
    ) -> Option<StockRuntimeFailure> {
        let mut process = state.process.take()?;
        let process_id = process.child.id();
        let root = process.root.to_string_lossy().into_owned();
        let process_tree = Arc::clone(&process.process_tree);
        let exit_code = observe_or_terminate_stock_process(&mut process).await;
        finish_stderr_capture(&mut process).await;
        self.clear_diagnostic_secrets();
        self.clear_active_process_tree(&process_tree);
        Some(StockRuntimeFailure {
            stage: failure.stage().unwrap_or("transport").to_string(),
            occurred_at: Utc::now().to_rfc3339(),
            process_id,
            exit_code,
            first_error: sanitize_diagnostic_text(&failure.message()),
            restart_error: None,
            stderr_tail: self.stderr_snapshot(),
            sidecar_root: Some(root),
        })
    }

    async fn spawn(&self, app: &AppHandle) -> Result<StockProcess, StockSpawnFailure> {
        let launch = resolve_sidecar_launch(app).map_err(StockSpawnFailure::launch)?;
        self.clear_stderr_tail();
        let mut command = Command::new(&launch.program);
        command
            .args(&launch.args)
            .current_dir(&launch.root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .env(
                "CALEN_STOCK_DATA_DIR",
                stock_data_dir()
                    .map_err(StockSpawnFailure::launch)?
                    .as_os_str(),
            );
        let settings = load_stock_settings().map_err(StockSpawnFailure::launch)?;
        command.env(
            "CALEN_STOCK_SETTINGS",
            serde_json::to_string(&settings).map_err(|error| {
                StockSpawnFailure::launch(format!("序列化股票设置失败：{error}"))
            })?,
        );
        command.env_remove("CALEN_STOCK_PROVIDER_KEYS");
        let provider_keys = load_provider_keys(&settings).map_err(StockSpawnFailure::launch)?;
        if !provider_keys.is_empty() {
            let serialized_provider_keys =
                serde_json::to_string(&provider_keys).map_err(|error| {
                    StockSpawnFailure::launch(format!("序列化股票 Provider Key 失败：{error}"))
                })?;
            command.env("CALEN_STOCK_PROVIDER_KEYS", serialized_provider_keys);
        }
        self.set_diagnostic_secrets(provider_keys.values());

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.as_std_mut().creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                self.clear_diagnostic_secrets();
                return Err(StockSpawnFailure {
                    stage: "launch",
                    message: format!(
                        "启动股票 sidecar 失败（{}）：{error}",
                        launch.program.display()
                    ),
                    process_id: None,
                    exit_code: None,
                    stderr_tail: Vec::new(),
                    sidecar_root: Some(launch.root.to_string_lossy().into_owned()),
                });
            }
        };
        let mut stderr_task = child
            .stderr
            .take()
            .map(|stderr| self.capture_stderr_tail(stderr));
        let process_id = match child.id() {
            Some(process_id) => process_id,
            None => {
                let exit_code = self
                    .cleanup_failed_spawn(&mut child, &mut stderr_task, None)
                    .await;
                return Err(StockSpawnFailure {
                    stage: "launch",
                    message: "股票 sidecar 启动后没有进程 ID".to_string(),
                    process_id: None,
                    exit_code,
                    stderr_tail: self.stderr_snapshot(),
                    sidecar_root: Some(launch.root.to_string_lossy().into_owned()),
                });
            }
        };
        let process_tree = match StockProcessTree::attach(process_id) {
            Ok(process_tree) => Arc::new(process_tree),
            Err(error) => {
                let exit_code = self
                    .cleanup_failed_spawn(&mut child, &mut stderr_task, None)
                    .await;
                return Err(StockSpawnFailure {
                    stage: "attach",
                    message: error,
                    process_id: Some(process_id),
                    exit_code,
                    stderr_tail: self.stderr_snapshot(),
                    sidecar_root: Some(launch.root.to_string_lossy().into_owned()),
                });
            }
        };
        let stdin = match child.stdin.take() {
            Some(stdin) => stdin,
            None => {
                let exit_code = self
                    .cleanup_failed_spawn(&mut child, &mut stderr_task, Some(&process_tree))
                    .await;
                return Err(StockSpawnFailure {
                    stage: "launch",
                    message: "股票 sidecar 未提供 stdin".to_string(),
                    process_id: Some(process_id),
                    exit_code,
                    stderr_tail: self.stderr_snapshot(),
                    sidecar_root: Some(launch.root.to_string_lossy().into_owned()),
                });
            }
        };
        let stdout = match child.stdout.take() {
            Some(stdout) => stdout,
            None => {
                let exit_code = self
                    .cleanup_failed_spawn(&mut child, &mut stderr_task, Some(&process_tree))
                    .await;
                return Err(StockSpawnFailure {
                    stage: "launch",
                    message: "股票 sidecar 未提供 stdout".to_string(),
                    process_id: Some(process_id),
                    exit_code,
                    stderr_tail: self.stderr_snapshot(),
                    sidecar_root: Some(launch.root.to_string_lossy().into_owned()),
                });
            }
        };

        if let Err(error) = self.set_active_process_tree(Arc::clone(&process_tree)) {
            let exit_code = self
                .cleanup_failed_spawn(&mut child, &mut stderr_task, Some(&process_tree))
                .await;
            return Err(StockSpawnFailure {
                stage: "attach",
                message: error,
                process_id: Some(process_id),
                exit_code,
                stderr_tail: self.stderr_snapshot(),
                sidecar_root: Some(launch.root.to_string_lossy().into_owned()),
            });
        }
        Ok(StockProcess {
            child,
            stdin,
            stdout: BufReader::new(stdout).lines(),
            root: launch.root,
            process_tree,
            stderr_task: stderr_task.take(),
        })
    }

    fn set_active_process_tree(&self, process_tree: Arc<StockProcessTree>) -> Result<(), String> {
        *self
            .active_process_tree
            .lock()
            .map_err(|_| "股票 sidecar 进程树状态已损坏".to_string())? = Some(process_tree);
        Ok(())
    }

    fn clear_active_process_tree(&self, process_tree: &Arc<StockProcessTree>) {
        if let Ok(mut active) = self.active_process_tree.lock() {
            if active
                .as_ref()
                .is_some_and(|current| Arc::ptr_eq(current, process_tree))
            {
                active.take();
            }
        }
    }

    pub fn shutdown_cleanup(&self) {
        if let Ok(active) = self.active_process_tree.lock() {
            if let Some(process_tree) = active.as_ref() {
                let _ = process_tree.terminate();
            }
        }
    }

    pub fn cancel(&self, request_id: &str) -> bool {
        self.cancellations
            .lock()
            .ok()
            .and_then(|mut cancellations| cancellations.remove(request_id))
            .is_some_and(|sender| sender.send(()).is_ok())
    }

    pub async fn stop(&self) -> Result<(), String> {
        let mut state = self.state.lock().await;
        if let Some(mut process) = state.process.take() {
            let process_tree = Arc::clone(&process.process_tree);
            let result = terminate_stock_process(&mut process).await;
            finish_stderr_capture(&mut process).await;
            self.clear_diagnostic_secrets();
            self.clear_active_process_tree(&process_tree);
            result?;
        } else if let Ok(mut active) = self.active_process_tree.lock() {
            active.take();
        }
        self.clear_diagnostic_secrets();
        Ok(())
    }

    pub async fn restart(&self) -> Result<(), String> {
        self.stop().await?;
        let mut state = self.state.lock().await;
        state.consecutive_failures = 0;
        state.last_failure = None;
        self.clear_stderr_tail();
        Ok(())
    }

    pub async fn local_status(&self) -> StockRuntimeStatus {
        let state = self.state.lock().await;
        let root = state
            .process
            .as_ref()
            .map(|process| process.root.to_string_lossy().into_owned());
        let stderr_tail = self.stderr_snapshot();
        let message = (state.consecutive_failures >= MAX_CONSECUTIVE_FAILURES)
            .then(|| Self::disabled_message(&state));
        StockRuntimeStatus {
            available: state.consecutive_failures < MAX_CONSECUTIVE_FAILURES,
            running: state.process.is_some(),
            disabled_after_failures: state.consecutive_failures >= MAX_CONSECUTIVE_FAILURES,
            consecutive_failures: state.consecutive_failures,
            sidecar_root: root,
            stderr_tail,
            last_failure: state.last_failure.clone(),
            message,
        }
    }
}

async fn request_once(
    process: &mut StockProcess,
    encoded: &[u8],
    request_id: &str,
    timeout_ms: u64,
    cancel_rx: &mut oneshot::Receiver<()>,
) -> Result<Value, RequestFailure> {
    write_request_frame(&mut process.stdin, encoded)
        .await
        .map_err(|error| {
            RequestFailure::transport("write", format!("写入股票 sidecar 请求失败：{error}"))
        })?;
    process.stdin.flush().await.map_err(|error| {
        RequestFailure::transport("flush", format!("刷新股票 sidecar stdin 失败：{error}"))
    })?;

    let read = read_matching_response(&mut process.stdout, request_id);
    tokio::pin!(read);
    tokio::select! {
        _ = &mut *cancel_rx => Err(RequestFailure::Cancelled),
        response = tokio::time::timeout(Duration::from_millis(timeout_ms), &mut read) => {
            match response {
                Ok(result) => result,
                Err(_) => Err(RequestFailure::Timeout),
            }
        }
    }
}

async fn write_request_frame<W>(writer: &mut W, encoded: &[u8]) -> std::io::Result<()>
where
    W: tokio::io::AsyncWrite + Unpin,
{
    let mut frame = Vec::with_capacity(encoded.len() + 1);
    frame.extend_from_slice(encoded);
    frame.push(b'\n');
    writer.write_all(&frame).await
}

fn is_read_only_stock_method(method: &str) -> bool {
    matches!(
        method,
        "resolve" | "snapshot" | "research" | "marketBrief" | "backtest" | "status" | "fxRates"
    )
}

fn format_runtime_failure(failure: &StockRuntimeFailure) -> String {
    let mut message = format!("{}：{}", failure.stage, failure.first_error);
    if let Some(exit_code) = failure.exit_code {
        message.push_str(&format!("（退出码 {exit_code}）"));
    }
    if !failure.stderr_tail.is_empty() {
        message.push_str("；stderr: ");
        message.push_str(&failure.stderr_tail.join(" | "));
    }
    sanitize_diagnostic_text(&message)
}

fn format_spawn_failure(failure: &StockSpawnFailure) -> String {
    let mut message = failure.message.clone();
    if let Some(exit_code) = failure.exit_code {
        message.push_str(&format!("（退出码 {exit_code}）"));
    }
    if !failure.stderr_tail.is_empty() {
        message.push_str("；stderr: ");
        message.push_str(&failure.stderr_tail.join(" | "));
    }
    sanitize_diagnostic_text(&message)
}

fn sanitize_diagnostic_text(value: &str) -> String {
    sanitize_diagnostic_text_with_secrets(value, &[])
}

fn sanitize_diagnostic_text_with_secrets(value: &str, secrets: &[String]) -> String {
    let mut sanitized = value.replace('\r', " ").replace('\n', " ");
    for secret in secrets.iter().filter(|secret| !secret.is_empty()) {
        sanitized = sanitized.replace(secret, "[REDACTED]");
    }

    static PROVIDER_ENV: OnceLock<Regex> = OnceLock::new();
    static SENSITIVE_ASSIGNMENT: OnceLock<Regex> = OnceLock::new();
    static BEARER_TOKEN: OnceLock<Regex> = OnceLock::new();
    let provider_env = PROVIDER_ENV.get_or_init(|| {
        Regex::new(r"(?i)(?<prefix>CALEN_STOCK_PROVIDER_KEYS\s*=\s*)(?<secret>\{[^\r\n]*\}|\S+)")
            .expect("valid provider env redaction regex")
    });
    let sensitive_assignment = SENSITIVE_ASSIGNMENT.get_or_init(|| {
        Regex::new(
            r#"(?i)(?<prefix>"?(?:api[_-]?key|x-api-key|sdk-key|token|password|secret|tushare|zzshare|tickflow|fuyao)"?\s*[:=]\s*"?)(?<secret>[^"\s,;&}]+)"#,
        )
        .expect("valid sensitive assignment redaction regex")
    });
    let bearer_token = BEARER_TOKEN.get_or_init(|| {
        Regex::new(r"(?i)(?<prefix>(?:authorization\s*:\s*)?bearer\s+)(?<secret>[^\s,;]+)")
            .expect("valid bearer redaction regex")
    });
    sanitized = provider_env
        .replace_all(&sanitized, "${prefix}[REDACTED]")
        .into_owned();
    sanitized = sensitive_assignment
        .replace_all(&sanitized, "${prefix}[REDACTED]")
        .into_owned();
    sanitized = bearer_token
        .replace_all(&sanitized, "${prefix}[REDACTED]")
        .into_owned();

    const MAX_DIAGNOSTIC_CHARS: usize = 2_000;
    if sanitized.chars().count() > MAX_DIAGNOSTIC_CHARS {
        sanitized = sanitized.chars().take(MAX_DIAGNOSTIC_CHARS).collect();
        sanitized.push('…');
    }
    sanitized
}

async fn finish_stderr_capture(process: &mut StockProcess) {
    finish_stderr_task(&mut process.stderr_task).await;
}

async fn finish_stderr_task(task: &mut Option<tauri::async_runtime::JoinHandle<()>>) {
    let Some(mut task) = task.take() else {
        return;
    };
    if tokio::time::timeout(Duration::from_millis(250), &mut task)
        .await
        .is_err()
    {
        task.abort();
        let _ = task.await;
    }
}

async fn observe_or_terminate_stock_process(process: &mut StockProcess) -> Option<i32> {
    for _ in 0..20 {
        match process.child.try_wait() {
            Ok(Some(status)) => return status.code(),
            Ok(None) => tokio::time::sleep(Duration::from_millis(10)).await,
            Err(_) => break,
        }
    }
    terminate_stock_process(process).await.ok().flatten()
}

async fn terminate_stock_process(process: &mut StockProcess) -> Result<Option<i32>, String> {
    #[cfg(target_os = "windows")]
    if let Err(error) = process.process_tree.terminate() {
        // A crashed sidecar may already have left the job with no live
        // process. Treat that state as an idempotent stop so update/restart
        // is not blocked by a process that is already gone.
        if process
            .child
            .try_wait()
            .map_err(|wait_error| format!("检查股票 sidecar 状态失败：{wait_error}"))?
            .is_none()
        {
            return Err(error);
        }
    }

    #[cfg(not(target_os = "windows"))]
    if process
        .child
        .try_wait()
        .map_err(|error| format!("检查股票 sidecar 状态失败：{error}"))?
        .is_none()
    {
        process
            .child
            .kill()
            .await
            .map_err(|error| format!("停止股票 sidecar 失败：{error}"))?;
    }

    let status = process
        .child
        .wait()
        .await
        .map_err(|error| format!("等待股票 sidecar 退出失败：{error}"))?;
    Ok(status.code())
}

struct SidecarLaunch {
    program: PathBuf,
    args: Vec<OsString>,
    root: PathBuf,
}

fn resolve_sidecar_launch(app: &AppHandle) -> Result<SidecarLaunch, String> {
    if let Ok(entry) = std::env::var("CALEN_STOCK_SIDECAR_ENTRY") {
        let entry = PathBuf::from(entry);
        let root = entry
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .to_path_buf();
        let program = std::env::var_os("CALEN_STOCK_NODE")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("node"));
        return Ok(SidecarLaunch {
            program,
            args: vec![entry.into_os_string()],
            root,
        });
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        let root = resource_dir.join("stock-sidecar");
        let program = root.join(if cfg!(target_os = "windows") {
            "node.exe"
        } else {
            "node"
        });
        let entry = root.join("dist").join("stdio.mjs");
        if program.is_file() && entry.is_file() {
            return Ok(SidecarLaunch {
                program,
                args: vec![entry.into_os_string()],
                root,
            });
        }
    }

    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../stock-sidecar");
    let entry = root.join("dist").join("stdio.mjs");
    if !entry.is_file() {
        return Err(format!(
            "未找到股票 sidecar 构建产物：{}；请先构建 crates/stock-sidecar",
            entry.display()
        ));
    }
    let program = std::env::var_os("CALEN_STOCK_NODE")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("node"));
    Ok(SidecarLaunch {
        program,
        args: vec![entry.into_os_string()],
        root,
    })
}

fn stock_data_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "无法定位用户目录".to_string())?;
    let path = home.join(".liveagent").join("stock-research");
    std::fs::create_dir_all(&path).map_err(|error| format!("创建股票数据目录失败：{error}"))?;
    Ok(path)
}

fn stock_settings_db() -> Result<Connection, String> {
    let path = stock_data_dir()?.join(STOCK_SETTINGS_DB);
    let conn =
        Connection::open(path).map_err(|error| format!("打开股票设置数据库失败：{error}"))?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|error| format!("配置股票设置数据库超时失败：{error}"))?;
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS stock_settings (
            config_id TEXT PRIMARY KEY,
            payload_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );
        ",
    )
    .map_err(|error| format!("初始化股票设置数据库失败：{error}"))?;
    Ok(conn)
}

fn default_stock_settings() -> Value {
    json!({
        "enabled": true,
        "defaultMarket": "CN",
        "timeoutMs": DEFAULT_TIMEOUT_MS,
        "cacheTtlMinutes": 5,
        "providers": [
            { "id": "tencent", "enabled": true },
            { "id": "eastmoney", "enabled": true },
            { "id": "sinafinance", "enabled": false },
            { "id": "baostock", "enabled": false },
            { "id": "zzshare", "enabled": false },
            { "id": "tushare", "enabled": false },
            { "id": "tickflow", "enabled": false },
            { "id": "fuyao", "enabled": false }
        ]
    })
}

fn normalize_stock_settings(input: Value) -> Value {
    let defaults = default_stock_settings();
    let source = input.as_object();
    let enabled = source
        .and_then(|object| object.get("enabled"))
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let default_market = source
        .and_then(|object| object.get("defaultMarket"))
        .and_then(Value::as_str)
        .filter(|market| matches!(*market, "CN" | "HK" | "US"))
        .unwrap_or("CN");
    let timeout_ms = source
        .and_then(|object| object.get("timeoutMs"))
        .and_then(Value::as_u64)
        .unwrap_or(DEFAULT_TIMEOUT_MS)
        .clamp(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
    let cache_ttl = source
        .and_then(|object| object.get("cacheTtlMinutes"))
        .and_then(Value::as_u64)
        .unwrap_or(5)
        .clamp(0, 1440);
    let default_providers = defaults
        .get("providers")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let requested = source
        .and_then(|object| object.get("providers"))
        .and_then(Value::as_array);
    let providers = default_providers
        .into_iter()
        .map(|provider| {
            let id = provider
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let default_enabled = provider
                .get("enabled")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let selected = requested.and_then(|items| {
                items
                    .iter()
                    .find(|item| item.get("id").and_then(Value::as_str) == Some(id))
            });
            json!({
                "id": id,
                "enabled": selected
                    .and_then(|item| item.get("enabled"))
                    .and_then(Value::as_bool)
                    .unwrap_or(default_enabled)
            })
        })
        .collect::<Vec<_>>();
    json!({
        "enabled": enabled,
        "defaultMarket": default_market,
        "timeoutMs": timeout_ms,
        "cacheTtlMinutes": cache_ttl,
        "providers": providers,
    })
}

fn load_stock_settings() -> Result<Value, String> {
    let conn = stock_settings_db()?;
    let payload: Option<String> = conn
        .query_row(
            "SELECT payload_json FROM stock_settings WHERE config_id = 'default'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("读取股票设置失败：{error}"))?;
    let parsed = payload
        .as_deref()
        .map(serde_json::from_str)
        .transpose()
        .map_err(|error| format!("解析股票设置失败：{error}"))?
        .unwrap_or_else(default_stock_settings);
    Ok(normalize_stock_settings(parsed))
}

fn save_stock_settings_value(settings: &Value) -> Result<(), String> {
    let conn = stock_settings_db()?;
    let payload =
        serde_json::to_string(settings).map_err(|error| format!("序列化股票设置失败：{error}"))?;
    let updated_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    conn.execute(
        "INSERT INTO stock_settings(config_id, payload_json, updated_at)
         VALUES('default', ?1, ?2)
         ON CONFLICT(config_id) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at",
        params![payload, updated_at],
    )
    .map_err(|error| format!("保存股票设置失败：{error}"))?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn set_provider_key(provider_id: &str, value: Option<&str>) -> Result<(), String> {
    let entry = keyring::Entry::new(STOCK_KEYRING_SERVICE, provider_id)
        .map_err(|error| format!("打开 {provider_id} 凭据失败：{error}"))?;
    match value.map(str::trim).filter(|value| !value.is_empty()) {
        Some(secret) => entry
            .set_password(secret)
            .map_err(|error| format!("保存 {provider_id} Key 失败：{error}")),
        None => match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(format!("删除 {provider_id} Key 失败：{error}")),
        },
    }
}

#[cfg(not(target_os = "windows"))]
fn set_provider_key(_provider_id: &str, _value: Option<&str>) -> Result<(), String> {
    Err("股票 Provider Key 安全存储首版仅支持 Windows".to_string())
}

#[cfg(target_os = "windows")]
fn get_provider_key(provider_id: &str) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(STOCK_KEYRING_SERVICE, provider_id)
        .map_err(|error| format!("打开 {provider_id} 凭据失败：{error}"))?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("读取 {provider_id} Key 失败：{error}")),
    }
}

#[cfg(not(target_os = "windows"))]
fn get_provider_key(_provider_id: &str) -> Result<Option<String>, String> {
    Ok(None)
}

fn provider_is_enabled(settings: &Value, provider_id: &str) -> bool {
    settings.get("enabled").and_then(Value::as_bool) != Some(false)
        && settings
            .get("providers")
            .and_then(Value::as_array)
            .is_some_and(|providers| {
                providers.iter().any(|provider| {
                    provider.get("id").and_then(Value::as_str) == Some(provider_id)
                        && provider.get("enabled").and_then(Value::as_bool) == Some(true)
                })
            })
}

fn load_provider_keys_with<F>(
    settings: &Value,
    implemented_keyed_providers: &[&str],
    mut read_key: F,
) -> Result<HashMap<String, String>, String>
where
    F: FnMut(&str) -> Result<Option<String>, String>,
{
    let mut keys = HashMap::new();
    for provider in implemented_keyed_providers {
        if !KEYED_PROVIDERS.contains(provider) || !provider_is_enabled(settings, provider) {
            continue;
        }
        if let Some(value) = read_key(provider)? {
            let value = value.trim();
            if !value.is_empty() {
                keys.insert((*provider).to_string(), value.to_string());
            }
        }
    }
    Ok(keys)
}

fn load_provider_keys(settings: &Value) -> Result<HashMap<String, String>, String> {
    load_provider_keys_with(settings, IMPLEMENTED_KEYED_PROVIDERS, get_provider_key)
}

fn public_stock_settings() -> Result<Value, String> {
    let mut settings = load_stock_settings()?;
    if let Some(providers) = settings.get_mut("providers").and_then(Value::as_array_mut) {
        for provider in providers {
            let Some(id) = provider
                .get("id")
                .and_then(Value::as_str)
                .map(str::to_string)
            else {
                continue;
            };
            let configured =
                KEYED_PROVIDERS.contains(&id.as_str()) && get_provider_key(&id)?.is_some();
            if let Some(object) = provider.as_object_mut() {
                object.insert("keyConfigured".to_string(), Value::Bool(configured));
            }
        }
    }
    Ok(settings)
}

fn request_id_from_params(params: &Value) -> String {
    params
        .get("requestId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| Uuid::new_v4().to_string())
}

fn timeout_from_params(params: &Value, configured_default: u64) -> u64 {
    params
        .get("deadlineMs")
        .and_then(Value::as_u64)
        .unwrap_or(configured_default)
        .clamp(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS)
}

async fn read_matching_response(
    stdout: &mut Lines<BufReader<ChildStdout>>,
    request_id: &str,
) -> Result<Value, RequestFailure> {
    for _ in 0..MAX_UNMATCHED_RESPONSES {
        let line = stdout
            .next_line()
            .await
            .map_err(|error| {
                RequestFailure::transport("read", format!("读取股票 sidecar 响应失败：{error}"))
            })?
            .ok_or_else(|| RequestFailure::transport("exit", "股票 sidecar 意外退出"))?;
        let response: Value = serde_json::from_str(&line).map_err(|error| {
            RequestFailure::transport("protocol", format!("股票 sidecar 返回无效 JSON：{error}"))
        })?;
        if response.get("id").and_then(Value::as_str) != Some(request_id) {
            continue;
        }
        if let Some(error) = response.get("error") {
            let message = error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("股票 sidecar 请求失败");
            return Err(RequestFailure::Sidecar(message.to_string()));
        }
        return response
            .get("result")
            .cloned()
            .ok_or_else(|| RequestFailure::transport("protocol", "股票 sidecar 响应缺少 result"));
    }
    Err(RequestFailure::transport(
        "protocol",
        "股票 sidecar 返回过多不匹配响应",
    ))
}

async fn invoke_stock_method(
    app: AppHandle,
    state: tauri::State<'_, Arc<StockResearchManager>>,
    method: &'static str,
    payload: Value,
) -> Result<Value, String> {
    state.call(&app, method, payload).await
}

#[tauri::command]
pub async fn stock_search(
    app: AppHandle,
    state: tauri::State<'_, Arc<StockResearchManager>>,
    payload: Value,
) -> Result<Value, String> {
    invoke_stock_method(app, state, "resolve", payload).await
}

#[tauri::command]
pub async fn stock_snapshot(
    app: AppHandle,
    state: tauri::State<'_, Arc<StockResearchManager>>,
    payload: Value,
) -> Result<Value, String> {
    invoke_stock_method(app, state, "snapshot", payload).await
}

#[tauri::command]
pub async fn stock_research(
    app: AppHandle,
    state: tauri::State<'_, Arc<StockResearchManager>>,
    payload: Value,
) -> Result<Value, String> {
    invoke_stock_method(app, state, "research", payload).await
}

#[tauri::command]
pub async fn stock_market_brief(
    app: AppHandle,
    state: tauri::State<'_, Arc<StockResearchManager>>,
    payload: Value,
) -> Result<Value, String> {
    invoke_stock_method(app, state, "marketBrief", payload).await
}

#[tauri::command]
pub async fn stock_backtest(
    app: AppHandle,
    state: tauri::State<'_, Arc<StockResearchManager>>,
    payload: Value,
) -> Result<Value, String> {
    invoke_stock_method(app, state, "backtest", payload).await
}

#[tauri::command]
pub async fn stock_status(
    app: AppHandle,
    state: tauri::State<'_, Arc<StockResearchManager>>,
) -> Result<Value, String> {
    if load_stock_settings()?
        .get("enabled")
        .and_then(Value::as_bool)
        == Some(false)
    {
        return Ok(json!({
            "state": "stopped",
            "message": "股票研究服务已关闭",
            "providers": []
        }));
    }
    match state
        .call(&app, "status", json!({ "deadlineMs": 5_000 }))
        .await
    {
        Ok(mut sidecar) => {
            if let Some(object) = sidecar.as_object_mut() {
                object.insert(
                    "runtime".to_string(),
                    serde_json::to_value(state.local_status().await)
                        .map_err(|error| format!("序列化股票运行状态失败：{error}"))?,
                );
            }
            Ok(sidecar)
        }
        Err(error) => {
            let runtime = state.local_status().await;
            Ok(json!({
                "state": if runtime.disabled_after_failures { "failed" } else { "degraded" },
                "message": error,
                "providers": [],
                "runtime": runtime,
            }))
        }
    }
}

#[tauri::command]
pub fn stock_cancel(
    state: tauri::State<'_, Arc<StockResearchManager>>,
    request_id: String,
) -> bool {
    state.cancel(request_id.trim())
}

#[tauri::command]
pub async fn stock_restart(
    app: AppHandle,
    state: tauri::State<'_, Arc<StockResearchManager>>,
) -> Result<Value, String> {
    state.restart().await?;
    let status = stock_status(app, state).await?;
    let ready = status
        .get("runtime")
        .and_then(|runtime| runtime.get("running"))
        .and_then(Value::as_bool)
        == Some(true);
    if ready {
        return Ok(status);
    }
    Err(stock_status_failure_message(&status))
}

fn stock_status_failure_message(status: &Value) -> String {
    status
        .get("runtime")
        .and_then(|runtime| {
            runtime
                .get("lastFailure")
                .or_else(|| runtime.get("failure"))
        })
        .and_then(|failure| {
            failure
                .get("restartError")
                .or_else(|| failure.get("firstError"))
        })
        .or_else(|| {
            status
                .get("runtime")
                .and_then(|runtime| runtime.get("message"))
        })
        .or_else(|| status.get("message"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| "股票服务重启后仍未就绪".to_string())
}

#[tauri::command]
pub async fn stock_stop(state: tauri::State<'_, Arc<StockResearchManager>>) -> Result<(), String> {
    state.stop().await
}

// Stable frontend domain aliases. The shorter commands above remain the builtin-tool adapter API.
#[tauri::command]
pub async fn stock_research_resolve(
    app: AppHandle,
    state: tauri::State<'_, Arc<StockResearchManager>>,
    request: Value,
) -> Result<Value, String> {
    invoke_stock_method(app, state, "resolve", request).await
}

#[tauri::command]
pub async fn stock_research_snapshot(
    app: AppHandle,
    state: tauri::State<'_, Arc<StockResearchManager>>,
    request: Value,
) -> Result<Value, String> {
    invoke_stock_method(app, state, "snapshot", request).await
}

#[tauri::command]
pub async fn stock_research_fx_rates(
    app: AppHandle,
    state: tauri::State<'_, Arc<StockResearchManager>>,
    request: Value,
) -> Result<Value, String> {
    invoke_stock_method(app, state, "fxRates", request).await
}

#[tauri::command]
pub async fn stock_research_run(
    app: AppHandle,
    state: tauri::State<'_, Arc<StockResearchManager>>,
    request: Value,
) -> Result<Value, String> {
    invoke_stock_method(app, state, "research", request).await
}

#[tauri::command]
pub async fn stock_research_market_brief(
    app: AppHandle,
    state: tauri::State<'_, Arc<StockResearchManager>>,
    request: Value,
) -> Result<Value, String> {
    invoke_stock_method(app, state, "marketBrief", request).await
}

#[tauri::command]
pub async fn stock_research_backtest(
    app: AppHandle,
    state: tauri::State<'_, Arc<StockResearchManager>>,
    request: Value,
) -> Result<Value, String> {
    invoke_stock_method(app, state, "backtest", request).await
}

#[tauri::command]
pub async fn stock_research_status(
    app: AppHandle,
    state: tauri::State<'_, Arc<StockResearchManager>>,
) -> Result<Value, String> {
    stock_status(app, state).await
}

#[tauri::command]
pub async fn stock_settings_get() -> Result<Value, String> {
    tokio::task::spawn_blocking(public_stock_settings)
        .await
        .map_err(|error| format!("读取股票设置任务失败：{error}"))?
}

#[tauri::command]
pub async fn stock_settings_save(
    state: tauri::State<'_, Arc<StockResearchManager>>,
    payload: Value,
) -> Result<Value, String> {
    let updates = payload
        .get("providerKeyUpdates")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    for (provider_id, secret) in updates {
        if !KEYED_PROVIDERS.contains(&provider_id.as_str()) {
            return Err(format!("不支持保存 {provider_id} Provider Key"));
        }
        match secret {
            Value::String(value) => set_provider_key(&provider_id, Some(&value))?,
            Value::Null => set_provider_key(&provider_id, None)?,
            _ => return Err(format!("{provider_id} Key 更新必须是字符串或 null")),
        }
    }
    let normalized = normalize_stock_settings(payload);
    tokio::task::spawn_blocking(move || save_stock_settings_value(&normalized))
        .await
        .map_err(|error| format!("保存股票设置任务失败：{error}"))??;
    state.restart().await?;
    public_stock_settings()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::pin::Pin;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::task::{Context, Poll};
    use std::time::Instant;
    use tokio::io::AsyncWrite;

    #[derive(Default)]
    struct RecordingWriter {
        writes: Vec<Vec<u8>>,
    }

    impl AsyncWrite for RecordingWriter {
        fn poll_write(
            mut self: Pin<&mut Self>,
            _cx: &mut Context<'_>,
            buffer: &[u8],
        ) -> Poll<std::io::Result<usize>> {
            self.writes.push(buffer.to_vec());
            Poll::Ready(Ok(buffer.len()))
        }

        fn poll_flush(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
            Poll::Ready(Ok(()))
        }

        fn poll_shutdown(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
            Poll::Ready(Ok(()))
        }
    }

    fn scripted_sidecar_dir() -> tempfile::TempDir {
        tempfile::Builder::new()
            .prefix("Calen 股票 生命周期 ")
            .tempdir()
            .expect("create Unicode/space sidecar test directory")
    }

    #[cfg(target_os = "windows")]
    fn write_scripted_sidecar(root: &Path) -> Result<PathBuf, String> {
        let script = root.join("fake stock sidecar.cmd");
        std::fs::write(
            &script,
            r#"@echo off
set "mode=%~1"
set "response_id=%~2"
if "%mode%"=="prewrite-exit" (
  >&2 echo prewrite-exit-tail
  exit /b 23
)
set /p request=
if "%mode%"=="reorder" (
  echo {"jsonrpc":"2.0","id":"stale-id","result":{"sequence":"stale"}}
  echo {"jsonrpc":"2.0","id":"%response_id%","result":{"sequence":"matched"}}
  exit /b 0
)
if "%mode%"=="stderr" (
  >&2 echo stderr-first
  >&2 echo stderr-last
  echo {"jsonrpc":"2.0","id":"%response_id%","result":{"ok":true}}
  exit /b 0
)
if "%mode%"=="sidecar-error" (
  echo {"jsonrpc":"2.0","id":"%response_id%","error":{"message":"provider unavailable"}}
  exit /b 0
)
if "%mode%"=="hang" (
  ping 127.0.0.1 -n 31 >nul
  exit /b 0
)
if "%mode%"=="crash" (
  >&2 echo crash-tail
  exit /b 17
)
exit /b 19
"#,
        )
        .map_err(|error| format!("write Windows fake sidecar: {error}"))?;
        Ok(script)
    }

    #[cfg(not(target_os = "windows"))]
    fn write_scripted_sidecar(root: &Path) -> Result<PathBuf, String> {
        let script = root.join("fake stock sidecar.sh");
        std::fs::write(
            &script,
            r#"mode="$1"
response_id="$2"
if [ "$mode" = "prewrite-exit" ]; then
  printf '%s\n' 'prewrite-exit-tail' >&2
  exit 23
fi
IFS= read -r request || exit 17
case "$mode" in
  reorder)
    printf '%s\n' '{"jsonrpc":"2.0","id":"stale-id","result":{"sequence":"stale"}}'
    printf '{"jsonrpc":"2.0","id":"%s","result":{"sequence":"matched"}}\n' "$response_id"
    ;;
  stderr)
    printf '%s\n' 'stderr-first' 'stderr-last' >&2
    printf '{"jsonrpc":"2.0","id":"%s","result":{"ok":true}}\n' "$response_id"
    ;;
  sidecar-error)
    printf '{"jsonrpc":"2.0","id":"%s","error":{"message":"provider unavailable"}}\n' "$response_id"
    ;;
  hang)
    sleep 30
    ;;
  crash)
    printf '%s\n' 'crash-tail' >&2
    exit 17
    ;;
  *) exit 19 ;;
esac
"#,
        )
        .map_err(|error| format!("write Unix fake sidecar: {error}"))?;
        Ok(script)
    }

    async fn spawn_scripted_test_process(
        manager: &StockResearchManager,
        root: &Path,
        mode: &str,
        response_id: &str,
    ) -> Result<StockProcess, StockSpawnFailure> {
        manager.clear_stderr_tail();
        let script = write_scripted_sidecar(root).map_err(StockSpawnFailure::launch)?;

        #[cfg(target_os = "windows")]
        let mut command = {
            let mut command = Command::new("cmd.exe");
            command.args([
                OsString::from("/D"),
                OsString::from("/Q"),
                OsString::from("/C"),
                script.into_os_string(),
                OsString::from(mode),
                OsString::from(response_id),
            ]);
            command
        };

        #[cfg(not(target_os = "windows"))]
        let mut command = {
            let mut command = Command::new("/bin/sh");
            command.arg(&script).arg(mode).arg(response_id);
            command
        };

        command
            .current_dir(root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let mut child = command.spawn().map_err(|error| {
            StockSpawnFailure::launch(format!("spawn scripted test sidecar: {error}"))
        })?;
        let process_id = child
            .id()
            .ok_or_else(|| StockSpawnFailure::launch("scripted test sidecar has no process id"))?;
        let process_tree =
            Arc::new(StockProcessTree::attach(process_id).map_err(StockSpawnFailure::launch)?);
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| StockSpawnFailure::launch("scripted test sidecar has no stdin"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| StockSpawnFailure::launch("scripted test sidecar has no stdout"))?;
        let stderr_task = child
            .stderr
            .take()
            .map(|stderr| manager.capture_stderr_tail(stderr));
        manager
            .set_active_process_tree(Arc::clone(&process_tree))
            .map_err(StockSpawnFailure::launch)?;
        Ok(StockProcess {
            child,
            stdin,
            stdout: BufReader::new(stdout).lines(),
            root: root.to_path_buf(),
            process_tree,
            stderr_task,
        })
    }

    #[cfg(target_os = "windows")]
    async fn spawn_installed_windows_sidecar(
        manager: &StockResearchManager,
        root: &Path,
        data_dir: &Path,
    ) -> Result<StockProcess, StockSpawnFailure> {
        manager.clear_stderr_tail();
        let node = root.join("node.exe");
        let entry = root.join("dist").join("stdio.mjs");
        let mut command = Command::new(&node);
        command
            .arg(&entry)
            .current_dir(root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .env("CALEN_STOCK_DATA_DIR", data_dir)
            .env(
                "CALEN_STOCK_SETTINGS",
                json!({ "enabled": true, "providers": [] }).to_string(),
            )
            .env_remove("CALEN_STOCK_PROVIDER_KEYS");
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.as_std_mut().creation_flags(CREATE_NO_WINDOW);
        let mut child = command.spawn().map_err(|error| StockSpawnFailure {
            stage: "launch",
            message: format!("spawn installed sidecar {}: {error}", node.display()),
            process_id: None,
            exit_code: None,
            stderr_tail: Vec::new(),
            sidecar_root: Some(root.to_string_lossy().into_owned()),
        })?;
        let process_id = child
            .id()
            .ok_or_else(|| StockSpawnFailure::launch("installed sidecar has no process id"))?;
        let process_tree =
            Arc::new(StockProcessTree::attach(process_id).map_err(StockSpawnFailure::launch)?);
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| StockSpawnFailure::launch("installed sidecar has no stdin"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| StockSpawnFailure::launch("installed sidecar has no stdout"))?;
        let stderr_task = child
            .stderr
            .take()
            .map(|stderr| manager.capture_stderr_tail(stderr));
        manager
            .set_active_process_tree(Arc::clone(&process_tree))
            .map_err(StockSpawnFailure::launch)?;
        Ok(StockProcess {
            child,
            stdin,
            stdout: BufReader::new(stdout).lines(),
            root: root.to_path_buf(),
            process_tree,
            stderr_task,
        })
    }

    #[test]
    fn request_id_prefers_explicit_non_empty_value() {
        let params = json!({ "requestId": " stock-42 " });
        assert_eq!(request_id_from_params(&params), "stock-42");
    }

    #[test]
    fn timeout_is_bounded() {
        assert_eq!(
            timeout_from_params(&json!({ "deadlineMs": 2 }), DEFAULT_TIMEOUT_MS),
            MIN_TIMEOUT_MS
        );
        assert_eq!(
            timeout_from_params(&json!({ "deadlineMs": 999_999 }), DEFAULT_TIMEOUT_MS),
            MAX_TIMEOUT_MS
        );
        assert_eq!(timeout_from_params(&json!({}), 12_345), 12_345);
    }

    #[test]
    fn sidecar_errors_do_not_increment_transport_failure_budget() {
        let sidecar = RequestFailure::Sidecar("provider unavailable".to_string());
        assert!(!sidecar.invalidates_process());
        assert!(!sidecar.triggers_auto_restart());
        assert!(RequestFailure::Timeout.invalidates_process());
        assert!(!RequestFailure::Timeout.triggers_auto_restart());
        let transport = RequestFailure::transport("exit", "sidecar exited");
        assert!(transport.invalidates_process());
        assert!(transport.triggers_auto_restart());
    }

    #[tokio::test]
    async fn json_rpc_request_is_written_as_one_complete_frame() {
        let mut writer = RecordingWriter::default();

        write_request_frame(&mut writer, br#"{"jsonrpc":"2.0","id":"one"}"#)
            .await
            .expect("write one request frame");

        assert_eq!(writer.writes.len(), 1);
        assert_eq!(
            writer.writes[0],
            br#"{"jsonrpc":"2.0","id":"one"}
"#
        );
    }

    #[tokio::test]
    async fn out_of_order_json_rpc_responses_match_the_requested_id() {
        let manager = StockResearchManager::default();
        let root = scripted_sidecar_dir();
        assert!(root.path().to_string_lossy().contains("股票 生命周期"));
        let (_cancel_tx, cancel_rx) = oneshot::channel();

        let result = manager
            .call_locked_with_spawns(
                "status",
                json!({}),
                "matched-request",
                2_000,
                cancel_rx,
                spawn_scripted_test_process(&manager, root.path(), "reorder", "matched-request"),
                spawn_scripted_test_process(&manager, root.path(), "reorder", "matched-request"),
            )
            .await
            .expect("manager should ignore a stale response and return the matching response");

        assert_eq!(result, json!({ "sequence": "matched" }));
        manager.stop().await.expect("stop scripted sidecar");
        assert!(!manager.local_status().await.running);
    }

    #[tokio::test]
    async fn stderr_tail_from_real_process_is_exposed_in_runtime_status() {
        let manager = StockResearchManager::default();
        let root = scripted_sidecar_dir();
        let (_cancel_tx, cancel_rx) = oneshot::channel();

        manager
            .call_locked_with_spawns(
                "status",
                json!({}),
                "stderr-request",
                2_000,
                cancel_rx,
                spawn_scripted_test_process(&manager, root.path(), "stderr", "stderr-request"),
                spawn_scripted_test_process(&manager, root.path(), "stderr", "stderr-request"),
            )
            .await
            .expect("scripted sidecar response");

        let status = tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                let status = manager.local_status().await;
                if status.stderr_tail.iter().any(|line| line == "stderr-last") {
                    break status;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("stderr reader should publish its tail promptly");
        assert_eq!(
            status.stderr_tail,
            vec!["stderr-first".to_string(), "stderr-last".to_string()]
        );
        manager.stop().await.expect("stop scripted sidecar");
    }

    #[tokio::test]
    async fn timed_out_request_terminates_process_without_auto_restart() {
        let manager = StockResearchManager::default();
        let root = scripted_sidecar_dir();
        let (_cancel_tx, cancel_rx) = oneshot::channel();
        let started = Instant::now();
        let replacement_attempts = Arc::new(AtomicUsize::new(0));
        let counted_replacement_attempts = Arc::clone(&replacement_attempts);

        let failure = manager
            .call_locked_with_spawns(
                "status",
                json!({}),
                "timeout-request",
                MIN_TIMEOUT_MS,
                cancel_rx,
                spawn_scripted_test_process(&manager, root.path(), "hang", "timeout-request"),
                async move {
                    counted_replacement_attempts.fetch_add(1, Ordering::SeqCst);
                    Err(StockSpawnFailure::launch(
                        "timeout unexpectedly triggered auto restart",
                    ))
                },
            )
            .await
            .expect_err("hanging sidecar must time out");

        assert!(matches!(failure, RequestFailure::Timeout));
        assert!(started.elapsed() < Duration::from_secs(5));
        let status = manager.local_status().await;
        assert!(!status.running, "timed-out process must be removed");
        assert_eq!(status.consecutive_failures, 0);
        let runtime_failure = status
            .last_failure
            .expect("timeout remains available as structured diagnostics");
        assert_eq!(runtime_failure.stage, "timeout");
        assert!(runtime_failure.process_id.is_some());
        assert!(runtime_failure.first_error.contains("超时"));
        assert_eq!(replacement_attempts.load(Ordering::SeqCst), 0);
        assert!(manager
            .active_process_tree
            .lock()
            .expect("active process tree lock")
            .is_none());
    }

    #[tokio::test]
    async fn in_flight_request_can_be_cancelled_and_process_is_cleaned_up() {
        let manager = StockResearchManager::default();
        let root = scripted_sidecar_dir();
        let request_id = "cancel-request";
        let (cancel_tx, cancel_rx) = oneshot::channel();
        let replacement_attempts = Arc::new(AtomicUsize::new(0));
        let counted_replacement_attempts = Arc::clone(&replacement_attempts);
        manager
            .cancellations
            .lock()
            .expect("cancellation map lock")
            .insert(request_id.to_string(), cancel_tx);

        let call = manager.call_locked_with_spawns(
            "status",
            json!({}),
            request_id,
            10_000,
            cancel_rx,
            spawn_scripted_test_process(&manager, root.path(), "hang", request_id),
            async move {
                counted_replacement_attempts.fetch_add(1, Ordering::SeqCst);
                Err(StockSpawnFailure::launch(
                    "cancellation unexpectedly triggered auto restart",
                ))
            },
        );
        let cancel = async {
            tokio::time::sleep(Duration::from_millis(100)).await;
            assert!(manager.cancel(request_id));
        };
        let (result, ()) = tokio::join!(call, cancel);

        assert!(matches!(result, Err(RequestFailure::Cancelled)));
        let status = manager.local_status().await;
        assert!(!status.running, "cancelled process must be removed");
        assert_eq!(
            status.consecutive_failures, 0,
            "user cancellation must not consume the crash restart budget"
        );
        assert_eq!(replacement_attempts.load(Ordering::SeqCst), 0);
        assert!(!manager.cancel(request_id), "cancellation is single-use");
    }

    #[tokio::test]
    async fn child_exit_before_first_frame_is_diagnosed_and_retried() {
        let manager = StockResearchManager::default();
        let root = scripted_sidecar_dir();
        let (_cancel_tx, cancel_rx) = oneshot::channel();

        let result = manager
            .call_locked_with_spawns(
                "status",
                json!({}),
                "prewrite-exit-request",
                2_000,
                cancel_rx,
                spawn_scripted_test_process(
                    &manager,
                    root.path(),
                    "prewrite-exit",
                    "prewrite-exit-request",
                ),
                spawn_scripted_test_process(
                    &manager,
                    root.path(),
                    "reorder",
                    "prewrite-exit-request",
                ),
            )
            .await
            .expect("replacement should retry after a startup-period exit");

        assert_eq!(result, json!({ "sequence": "matched" }));
        let failure = manager
            .local_status()
            .await
            .last_failure
            .expect("startup-period exit remains diagnosable");
        assert!(matches!(failure.stage.as_str(), "write" | "exit"));
        assert_eq!(failure.exit_code, Some(23));
        assert!(failure
            .stderr_tail
            .iter()
            .any(|line| line == "prewrite-exit-tail"));
        manager.stop().await.expect("stop replacement sidecar");
    }

    #[tokio::test]
    async fn transport_failure_retries_the_original_request_on_the_replacement() {
        let manager = StockResearchManager::default();
        let root = scripted_sidecar_dir();
        let (_cancel_tx, cancel_rx) = oneshot::channel();
        let result = manager
            .call_locked_with_spawns(
                "status",
                json!({}),
                "first-crash",
                2_000,
                cancel_rx,
                spawn_scripted_test_process(&manager, root.path(), "crash", "first-crash"),
                spawn_scripted_test_process(&manager, root.path(), "reorder", "first-crash"),
            )
            .await
            .expect("replacement should retry and complete the original request");

        assert_eq!(result, json!({ "sequence": "matched" }));

        let status = manager.local_status().await;
        assert_eq!(status.consecutive_failures, 0);
        assert!(status.running);
        assert!(!status.disabled_after_failures);
        let failure = status
            .last_failure
            .expect("the recovered transport failure remains diagnosable");
        assert_eq!(failure.stage, "exit");
        assert_eq!(failure.exit_code, Some(17));
        assert_eq!(failure.process_id.is_some(), true);
        assert_eq!(failure.restart_error, None);
        assert!(failure.stderr_tail.iter().any(|line| line == "crash-tail"));
        assert!(!failure.first_error.is_empty());
        manager.stop().await.expect("stop replacement sidecar");
    }

    #[tokio::test]
    async fn replacement_sidecar_error_proves_transport_recovery_and_resets_budget() {
        let manager = StockResearchManager::default();
        let root = scripted_sidecar_dir();
        let (_cancel_tx, cancel_rx) = oneshot::channel();

        let failure = manager
            .call_locked_with_spawns(
                "status",
                json!({}),
                "replacement-sidecar-error",
                2_000,
                cancel_rx,
                async { Err(StockSpawnFailure::launch("primary launch failed")) },
                spawn_scripted_test_process(
                    &manager,
                    root.path(),
                    "sidecar-error",
                    "replacement-sidecar-error",
                ),
            )
            .await
            .expect_err("replacement business error should be returned");

        assert!(matches!(failure, RequestFailure::Sidecar(_)));
        let status = manager.local_status().await;
        assert_eq!(status.consecutive_failures, 0);
        assert!(
            status.running,
            "business errors must keep the sidecar alive"
        );
        manager.stop().await.expect("stop replacement sidecar");
    }

    #[tokio::test]
    async fn replacement_timeout_is_recorded_without_consuming_another_crash_failure() {
        let manager = StockResearchManager::default();
        let root = scripted_sidecar_dir();
        let (_cancel_tx, cancel_rx) = oneshot::channel();

        let failure = manager
            .call_locked_with_spawns(
                "status",
                json!({}),
                "replacement-timeout",
                MIN_TIMEOUT_MS,
                cancel_rx,
                spawn_scripted_test_process(&manager, root.path(), "crash", "replacement-timeout"),
                spawn_scripted_test_process(&manager, root.path(), "hang", "replacement-timeout"),
            )
            .await
            .expect_err("replacement request must time out");

        assert!(matches!(failure, RequestFailure::Timeout));
        let status = manager.local_status().await;
        assert_eq!(status.consecutive_failures, 1);
        assert!(!status.running);
        let runtime_failure = status
            .last_failure
            .expect("first transport and retry timeout remain diagnosable");
        assert!(runtime_failure
            .restart_error
            .as_deref()
            .is_some_and(|message| message.contains("timeout") || message.contains("超时")));
    }

    #[cfg(target_os = "windows")]
    #[tokio::test]
    #[ignore = "requires CALEN_STOCK_WINDOWS_INSTALL_ROOT pointing at installed stock-sidecar"]
    async fn installed_node_and_dist_work_through_the_manager_request_path() {
        let manager = StockResearchManager::default();
        let root = PathBuf::from(
            std::env::var_os("CALEN_STOCK_WINDOWS_INSTALL_ROOT")
                .expect("set CALEN_STOCK_WINDOWS_INSTALL_ROOT to the stock-sidecar directory"),
        );
        assert!(root.join("node.exe").is_file());
        assert!(root.join("dist").join("stdio.mjs").is_file());
        let data_dir = tempfile::Builder::new()
            .prefix("Calen 股票 Manager 安装态 ")
            .tempdir()
            .expect("create installed sidecar data directory");
        let (_cancel_tx, cancel_rx) = oneshot::channel();

        let status = manager
            .call_locked_with_spawns(
                "status",
                json!({}),
                "installed-manager-smoke",
                10_000,
                cancel_rx,
                spawn_installed_windows_sidecar(&manager, &root, data_dir.path()),
                async {
                    Err(StockSpawnFailure::launch(
                        "installed sidecar unexpectedly required replacement",
                    ))
                },
            )
            .await
            .expect("installed sidecar responds through StockResearchManager");

        assert!(status.is_object());
        manager.stop().await.expect("stop installed sidecar");
    }

    #[tokio::test]
    async fn failed_automatic_replacement_disables_manager() {
        let manager = StockResearchManager::default();
        let root = scripted_sidecar_dir();
        let (_cancel_tx, cancel_rx) = oneshot::channel();
        let replacement_attempts = Arc::new(AtomicUsize::new(0));
        let counted_replacement_attempts = Arc::clone(&replacement_attempts);

        manager
            .call_locked_with_spawns(
                "status",
                json!({}),
                "crash-before-failed-replacement",
                2_000,
                cancel_rx,
                spawn_scripted_test_process(
                    &manager,
                    root.path(),
                    "crash",
                    "crash-before-failed-replacement",
                ),
                async move {
                    counted_replacement_attempts.fetch_add(1, Ordering::SeqCst);
                    Err(StockSpawnFailure::launch("replacement launch failed"))
                },
            )
            .await
            .expect_err("original crash remains the request result");

        assert_eq!(replacement_attempts.load(Ordering::SeqCst), 1);
        let status = manager.local_status().await;
        assert_eq!(status.consecutive_failures, MAX_CONSECUTIVE_FAILURES);
        assert!(status.disabled_after_failures);
        assert!(!status.running);
        let failure = status
            .last_failure
            .expect("the first and replacement failures remain available");
        assert_eq!(failure.stage, "exit");
        assert_eq!(failure.exit_code, Some(17));
        assert!(failure.stderr_tail.iter().any(|line| line == "crash-tail"));
        assert_eq!(
            failure.restart_error.as_deref(),
            Some("replacement launch failed")
        );

        manager
            .restart()
            .await
            .expect("manual restart resets runtime failure state");
        let status = manager.local_status().await;
        assert_eq!(status.consecutive_failures, 0);
        assert!(status.available);
        assert!(status.last_failure.is_none());

        let (_cancel_tx, cancel_rx) = oneshot::channel();
        let probe = manager
            .call_locked_with_spawns(
                "status",
                json!({}),
                "manual-restart-probe",
                2_000,
                cancel_rx,
                spawn_scripted_test_process(
                    &manager,
                    root.path(),
                    "reorder",
                    "manual-restart-probe",
                ),
                async {
                    Err(StockSpawnFailure::launch(
                        "manual restart probe unexpectedly required replacement",
                    ))
                },
            )
            .await
            .expect("manual restart permits an immediate health probe");
        assert_eq!(probe, json!({ "sequence": "matched" }));
        manager.stop().await.expect("stop manual restart probe");
    }

    #[tokio::test]
    async fn concurrent_status_requests_do_not_consume_the_restart_budget_twice() {
        let manager = StockResearchManager::default();
        let root = scripted_sidecar_dir();
        let (_cancel_tx_a, cancel_rx_a) = oneshot::channel();
        let (_cancel_tx_b, cancel_rx_b) = oneshot::channel();
        let forbidden_spawns = Arc::new(AtomicUsize::new(0));
        let counted_primary = Arc::clone(&forbidden_spawns);
        let counted_replacement = Arc::clone(&forbidden_spawns);

        let first = manager.call_locked_with_spawns(
            "status",
            json!({}),
            "concurrent-first",
            2_000,
            cancel_rx_a,
            spawn_scripted_test_process(&manager, root.path(), "crash", "concurrent-first"),
            async { Err(StockSpawnFailure::launch("first replacement failed")) },
        );
        let second = manager.call_locked_with_spawns(
            "status",
            json!({}),
            "concurrent-second",
            2_000,
            cancel_rx_b,
            async move {
                counted_primary.fetch_add(1, Ordering::SeqCst);
                Err(StockSpawnFailure::launch(
                    "disabled manager spawned primary",
                ))
            },
            async move {
                counted_replacement.fetch_add(1, Ordering::SeqCst);
                Err(StockSpawnFailure::launch(
                    "disabled manager spawned replacement",
                ))
            },
        );

        let (first_result, second_result) = tokio::join!(first, second);
        assert!(first_result.is_err());
        assert!(second_result.is_err());
        assert_eq!(forbidden_spawns.load(Ordering::SeqCst), 0);
        assert_eq!(
            manager.local_status().await.consecutive_failures,
            MAX_CONSECUTIVE_FAILURES
        );
    }

    #[test]
    fn runtime_diagnostics_redact_provider_credentials() {
        let diagnostic = sanitize_diagnostic_text_with_secrets(
            r#"CALEN_STOCK_PROVIDER_KEYS={"tushare":"secret-token"} X-API-Key: header-secret sdk-key="sdk-secret" authorization: bearer bearer-secret API_KEY=upper-secret"#,
            &["actual-provider-secret".to_string()],
        );

        assert!(!diagnostic.contains("secret-token"));
        assert!(!diagnostic.contains("header-secret"));
        assert!(!diagnostic.contains("sdk-secret"));
        assert!(!diagnostic.contains("bearer-secret"));
        assert!(!diagnostic.contains("upper-secret"));
        assert!(!sanitize_diagnostic_text_with_secrets(
            "unlabelled actual-provider-secret",
            &["actual-provider-secret".to_string()]
        )
        .contains("actual-provider-secret"));
        assert!(diagnostic.contains("[REDACTED]"));
    }

    #[test]
    fn restart_status_failure_prefers_specific_runtime_error() {
        let status = json!({
            "state": "failed",
            "message": "generic failure",
            "runtime": {
                "lastFailure": {
                    "firstError": "first pipe failure",
                    "restartError": "replacement exited with code 1"
                }
            }
        });

        assert_eq!(
            stock_status_failure_message(&status),
            "replacement exited with code 1"
        );
    }

    #[test]
    fn stock_settings_strip_secrets_and_bound_runtime_values() {
        let settings = normalize_stock_settings(json!({
            "enabled": true,
            "defaultMarket": "INVALID",
            "timeoutMs": 999999,
            "cacheTtlMinutes": 99999,
            "providers": [
                { "id": "zzshare", "enabled": true, "key": "zz-secret" },
                { "id": "tushare", "enabled": true, "key": "tu-secret" },
                { "id": "tickflow", "enabled": true, "key": "tf-secret" },
                { "id": "fuyao", "enabled": true, "key": "fy-secret" }
            ],
            "providerKeyUpdates": {
                "zzshare": "zz-secret",
                "tushare": "tu-secret",
                "tickflow": "tf-secret",
                "fuyao": "fy-secret"
            }
        }));
        assert_eq!(settings["defaultMarket"], "CN");
        assert_eq!(settings["timeoutMs"], MAX_TIMEOUT_MS);
        assert_eq!(settings["cacheTtlMinutes"], 1440);
        assert!(settings.get("providerKeyUpdates").is_none());
        let public_json = settings.to_string();
        assert!(!public_json.contains("secret"));
    }

    #[test]
    fn production_keyed_provider_allow_list_matches_sidecar_adapters() {
        assert_eq!(
            IMPLEMENTED_KEYED_PROVIDERS,
            &["zzshare", "tushare", "tickflow", "fuyao"]
        );
    }

    #[test]
    fn provider_keys_include_only_enabled_configured_providers() {
        let settings = normalize_stock_settings(json!({
            "enabled": true,
            "providers": [
                { "id": "zzshare", "enabled": true },
                { "id": "tushare", "enabled": true },
                { "id": "tickflow", "enabled": true },
                { "id": "fuyao", "enabled": true }
            ]
        }));
        let mut requested = Vec::new();
        let keys = load_provider_keys_with(&settings, IMPLEMENTED_KEYED_PROVIDERS, |provider| {
            requested.push(provider.to_string());
            Ok(match provider {
                "zzshare" => Some("  zzshare-secret  ".to_string()),
                "tushare" => None,
                "tickflow" => Some("   ".to_string()),
                "fuyao" => Some("fuyao-secret".to_string()),
                _ => unreachable!("production allow-list contains an unexpected provider"),
            })
        })
        .expect("load provider keys");

        assert_eq!(
            requested,
            IMPLEMENTED_KEYED_PROVIDERS
                .iter()
                .map(|provider| (*provider).to_string())
                .collect::<Vec<_>>()
        );
        assert_eq!(keys.len(), 2);
        assert_eq!(
            keys.get("zzshare").map(String::as_str),
            Some("zzshare-secret")
        );
        assert_eq!(keys.get("fuyao").map(String::as_str), Some("fuyao-secret"));
        assert!(!keys.contains_key("tushare"));
        assert!(!keys.contains_key("tickflow"));
    }

    #[test]
    fn provider_keys_skip_disabled_provider_even_when_key_is_saved() {
        let settings = normalize_stock_settings(json!({
            "enabled": true,
            "providers": [{ "id": "tushare", "enabled": false }]
        }));
        let keys = load_provider_keys_with(&settings, IMPLEMENTED_KEYED_PROVIDERS, |_provider| {
            panic!("disabled providers must not trigger Credential Manager reads")
        })
        .expect("load provider keys");

        assert!(keys.is_empty());
    }

    #[test]
    fn provider_keys_skip_all_providers_when_stock_service_is_disabled() {
        let settings = normalize_stock_settings(json!({
            "enabled": false,
            "providers": [
                { "id": "zzshare", "enabled": true },
                { "id": "tushare", "enabled": true },
                { "id": "tickflow", "enabled": true },
                { "id": "fuyao", "enabled": true }
            ]
        }));
        let keys = load_provider_keys_with(&settings, IMPLEMENTED_KEYED_PROVIDERS, |_provider| {
            panic!("disabled stock service must not trigger Credential Manager reads")
        })
        .expect("load provider keys");

        assert!(keys.is_empty());
    }
}
