use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::{oneshot, Mutex};
use uuid::Uuid;

#[cfg(target_os = "windows")]
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

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
const IMPLEMENTED_KEYED_PROVIDERS: &[&str] =
    &["zzshare", "tushare", "tickflow", "fuyao"];

#[derive(Debug)]
struct StockProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: Lines<BufReader<ChildStdout>>,
    root: PathBuf,
    process_tree: Arc<StockProcessTree>,
}

#[cfg(target_os = "windows")]
#[derive(Debug)]
struct StockProcessTree {
    job: OwnedHandle,
}

#[cfg(target_os = "windows")]
impl StockProcessTree {
    fn attach(process_id: u32) -> Result<Self, String> {
        let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if job.is_null() {
            return Err(format!(
                "创建股票 sidecar Windows Job Object 失败：{}",
                std::io::Error::last_os_error()
            ));
        }
        let job = unsafe { OwnedHandle::from_raw_handle(job) };

        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let configured = unsafe {
            SetInformationJobObject(
                job.as_raw_handle(),
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const std::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if configured == 0 {
            return Err(format!(
                "配置股票 sidecar Windows Job Object 失败：{}",
                std::io::Error::last_os_error()
            ));
        }

        let process = unsafe {
            OpenProcess(
                PROCESS_SET_QUOTA | PROCESS_TERMINATE,
                0,
                process_id,
            )
        };
        if process.is_null() {
            return Err(format!(
                "打开股票 sidecar 进程失败：{}",
                std::io::Error::last_os_error()
            ));
        }
        let process = unsafe { OwnedHandle::from_raw_handle(process) };
        let assigned = unsafe { AssignProcessToJobObject(job.as_raw_handle(), process.as_raw_handle()) };
        if assigned == 0 {
            return Err(format!(
                "将股票 sidecar 加入 Windows Job Object 失败：{}",
                std::io::Error::last_os_error()
            ));
        }

        Ok(Self { job })
    }

    fn terminate(&self) -> Result<(), String> {
        let terminated = unsafe { TerminateJobObject(self.job.as_raw_handle(), 1) };
        if terminated == 0 {
            return Err(format!(
                "终止股票 sidecar 进程树失败：{}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(())
    }
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
    message: Option<String>,
}

#[derive(Default)]
pub struct StockResearchManager {
    state: Mutex<StockManagerState>,
    cancellations: StdMutex<HashMap<String, oneshot::Sender<()>>>,
    stderr_tail: Arc<StdMutex<VecDeque<String>>>,
    active_process_tree: StdMutex<Option<Arc<StockProcessTree>>>,
}

#[derive(Debug)]
enum RequestFailure {
    Cancelled,
    Timeout,
    Transport(String),
    Sidecar(String),
}

impl RequestFailure {
    fn message(&self) -> String {
        match self {
            Self::Cancelled => "股票研究请求已取消".to_string(),
            Self::Timeout => "股票研究请求超时，sidecar 已停止并将在下次请求时重启".to_string(),
            Self::Transport(message) => message.clone(),
            Self::Sidecar(message) => message.clone(),
        }
    }

    fn breaks_process(&self) -> bool {
        matches!(self, Self::Timeout | Self::Transport(_))
    }
}

impl StockResearchManager {
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
        mut cancel_rx: oneshot::Receiver<()>,
    ) -> Result<Value, RequestFailure> {
        let mut state = self.state.lock().await;
        if state.consecutive_failures >= MAX_CONSECUTIVE_FAILURES {
            return Err(RequestFailure::Transport(
                "股票 sidecar 连续失败，已暂停自动重启；请在数据源页面手动重启".to_string(),
            ));
        }

        if state.process.is_none() {
            match self.spawn(app).await {
                Ok(process) => state.process = Some(process),
                Err(error) => {
                    state.consecutive_failures = state.consecutive_failures.saturating_add(1);
                    return Err(RequestFailure::Transport(error));
                }
            }
        }

        let envelope = json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "method": method,
            "params": params,
        });
        let encoded = serde_json::to_vec(&envelope)
            .map_err(|error| RequestFailure::Transport(format!("序列化股票请求失败：{error}")))?;

        let outcome = {
            let process = state
                .process
                .as_mut()
                .ok_or_else(|| RequestFailure::Transport("股票 sidecar 未启动".to_string()))?;
            async {
                process.stdin.write_all(&encoded).await.map_err(|error| {
                    RequestFailure::Transport(format!("写入股票 sidecar 失败：{error}"))
                })?;
                process.stdin.write_all(b"\n").await.map_err(|error| {
                    RequestFailure::Transport(format!("写入股票请求分隔符失败：{error}"))
                })?;
                process.stdin.flush().await.map_err(|error| {
                    RequestFailure::Transport(format!("刷新股票 sidecar stdin 失败：{error}"))
                })?;

                let read = read_matching_response(&mut process.stdout, request_id);
                tokio::pin!(read);
                tokio::select! {
                    _ = &mut cancel_rx => Err(RequestFailure::Cancelled),
                    response = tokio::time::timeout(Duration::from_millis(timeout_ms), &mut read) => {
                        match response {
                            Ok(result) => result,
                            Err(_) => Err(RequestFailure::Timeout),
                        }
                    }
                }
            }
            .await
        };

        match outcome {
            Ok(value) => {
                state.consecutive_failures = 0;
                Ok(value)
            }
            Err(failure) => {
                self.fail_running_process(&mut state, &failure).await;
                Err(failure)
            }
        }
    }

    async fn fail_running_process(&self, state: &mut StockManagerState, failure: &RequestFailure) {
        if failure.breaks_process() || matches!(failure, RequestFailure::Cancelled) {
            if let Some(mut process) = state.process.take() {
                let process_tree = Arc::clone(&process.process_tree);
                let _ = terminate_stock_process(&mut process).await;
                self.clear_active_process_tree(&process_tree);
            }
        }
        if failure.breaks_process() {
            state.consecutive_failures = state.consecutive_failures.saturating_add(1);
        }
    }

    async fn spawn(&self, app: &AppHandle) -> Result<StockProcess, String> {
        let launch = resolve_sidecar_launch(app)?;
        let mut command = Command::new(&launch.program);
        command
            .args(&launch.args)
            .current_dir(&launch.root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .env("CALEN_STOCK_DATA_DIR", stock_data_dir()?.as_os_str());
        let settings = load_stock_settings()?;
        command.env(
            "CALEN_STOCK_SETTINGS",
            serde_json::to_string(&settings)
                .map_err(|error| format!("序列化股票设置失败：{error}"))?,
        );
        command.env_remove("CALEN_STOCK_PROVIDER_KEYS");
        let provider_keys = load_provider_keys(&settings)?;
        if !provider_keys.is_empty() {
            command.env(
                "CALEN_STOCK_PROVIDER_KEYS",
                serde_json::to_string(&provider_keys)
                    .map_err(|error| format!("序列化股票 Provider Key 失败：{error}"))?,
            );
        }

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.as_std_mut().creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = command.spawn().map_err(|error| {
            format!(
                "启动股票 sidecar 失败（{}）：{error}",
                launch.program.display()
            )
        })?;
        let process_id = child
            .id()
            .ok_or_else(|| "股票 sidecar 启动后没有进程 ID".to_string())?;
        let process_tree = match StockProcessTree::attach(process_id) {
            Ok(process_tree) => Arc::new(process_tree),
            Err(error) => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                return Err(error);
            }
        };
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "股票 sidecar 未提供 stdin".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "股票 sidecar 未提供 stdout".to_string())?;
        if let Some(stderr) = child.stderr.take() {
            let tail = Arc::clone(&self.stderr_tail);
            tauri::async_runtime::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if let Ok(mut values) = tail.lock() {
                        values.push_back(line);
                        while values.len() > MAX_STDERR_LINES {
                            values.pop_front();
                        }
                    }
                }
            });
        }

        self.set_active_process_tree(Arc::clone(&process_tree))?;
        Ok(StockProcess {
            child,
            stdin,
            stdout: BufReader::new(stdout).lines(),
            root: launch.root,
            process_tree,
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
            self.clear_active_process_tree(&process_tree);
            result?;
        } else if let Ok(mut active) = self.active_process_tree.lock() {
            active.take();
        }
        Ok(())
    }

    pub async fn restart(&self) -> Result<(), String> {
        self.stop().await?;
        self.state.lock().await.consecutive_failures = 0;
        Ok(())
    }

    pub async fn local_status(&self) -> StockRuntimeStatus {
        let state = self.state.lock().await;
        let root = state
            .process
            .as_ref()
            .map(|process| process.root.to_string_lossy().into_owned());
        let stderr_tail = self
            .stderr_tail
            .lock()
            .map(|tail| tail.iter().cloned().collect())
            .unwrap_or_default();
        StockRuntimeStatus {
            available: state.consecutive_failures < MAX_CONSECUTIVE_FAILURES,
            running: state.process.is_some(),
            disabled_after_failures: state.consecutive_failures >= MAX_CONSECUTIVE_FAILURES,
            consecutive_failures: state.consecutive_failures,
            sidecar_root: root,
            stderr_tail,
            message: (state.consecutive_failures >= MAX_CONSECUTIVE_FAILURES)
                .then(|| "股票 sidecar 连续失败，等待手动重启".to_string()),
        }
    }
}

async fn terminate_stock_process(process: &mut StockProcess) -> Result<(), String> {
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

    process
        .child
        .wait()
        .await
        .map_err(|error| format!("等待股票 sidecar 退出失败：{error}"))?;
    Ok(())
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
                RequestFailure::Transport(format!("读取股票 sidecar 响应失败：{error}"))
            })?
            .ok_or_else(|| RequestFailure::Transport("股票 sidecar 意外退出".to_string()))?;
        let response: Value = serde_json::from_str(&line).map_err(|error| {
            RequestFailure::Transport(format!("股票 sidecar 返回无效 JSON：{error}"))
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
            .ok_or_else(|| RequestFailure::Transport("股票 sidecar 响应缺少 result".to_string()));
    }
    Err(RequestFailure::Transport(
        "股票 sidecar 返回过多不匹配响应".to_string(),
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
        Ok(sidecar) => Ok(sidecar),
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
    state: tauri::State<'_, Arc<StockResearchManager>>,
) -> Result<(), String> {
    state.restart().await
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

    #[cfg(target_os = "windows")]
    use wait_timeout::ChildExt;

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
        assert!(!RequestFailure::Sidecar("provider unavailable".to_string()).breaks_process());
        assert!(RequestFailure::Timeout.breaks_process());
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
        let keys = load_provider_keys_with(
            &settings,
            IMPLEMENTED_KEYED_PROVIDERS,
            |provider| {
                requested.push(provider.to_string());
                Ok(match provider {
                    "zzshare" => Some("  zzshare-secret  ".to_string()),
                    "tushare" => None,
                    "tickflow" => Some("   ".to_string()),
                    "fuyao" => Some("fuyao-secret".to_string()),
                    _ => unreachable!("production allow-list contains an unexpected provider"),
                })
            },
        )
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
        let keys = load_provider_keys_with(
            &settings,
            IMPLEMENTED_KEYED_PROVIDERS,
            |_provider| panic!("disabled providers must not trigger Credential Manager reads"),
        )
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
        let keys = load_provider_keys_with(
            &settings,
            IMPLEMENTED_KEYED_PROVIDERS,
            |_provider| {
                panic!("disabled stock service must not trigger Credential Manager reads")
            },
        )
        .expect("load provider keys");

        assert!(keys.is_empty());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn shutdown_cleanup_terminates_the_registered_windows_process_tree() {
        let mut child = std::process::Command::new("powershell.exe")
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Start-Sleep -Seconds 30",
            ])
            .spawn()
            .expect("spawn lifecycle test process");
        let process_tree = Arc::new(
            StockProcessTree::attach(child.id()).expect("attach lifecycle test process to job"),
        );
        let manager = StockResearchManager::default();
        manager
            .set_active_process_tree(process_tree)
            .expect("register lifecycle test process tree");

        manager.shutdown_cleanup();

        let status = child
            .wait_timeout(Duration::from_secs(5))
            .expect("wait for lifecycle test process");
        assert!(status.is_some(), "Job Object cleanup must terminate the process");
    }
}
