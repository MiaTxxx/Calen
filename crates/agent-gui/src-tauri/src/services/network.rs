use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex, OnceLock, RwLock},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use reqwest::Url;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

const DEFAULT_BYPASS: [&str; 3] = ["localhost", "127.0.0.1", "::1"];
const NETWORK_SETTINGS_TABLE: &str = "app_network_settings";
const NETWORK_SETTINGS_ID: &str = "default";
const NETWORK_SETTINGS_SELECT_SQL: &str =
    "SELECT payload_json FROM app_network_settings WHERE config_id = ?1";
const NETWORK_SETTINGS_UPSERT_SQL: &str = r#"
    INSERT INTO app_network_settings (config_id, payload_json, updated_at)
    VALUES (?1, ?2, ?3)
    ON CONFLICT(config_id) DO UPDATE SET
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at
"#;
const PROXY_ENV_KEYS: [&str; 9] = [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
    "NODE_USE_ENV_PROXY",
];
const CONNECTION_TEST_TIMEOUT: Duration = Duration::from_secs(10);
const DOWNLOAD_CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
const DOWNLOAD_READ_TIMEOUT: Duration = Duration::from_secs(90);
const DOWNLOAD_USER_AGENT: &str = "Calen-Asset-Downloader/1.0";
static GLOBAL_APP_NETWORK_MANAGER: OnceLock<Arc<AppNetworkManager>> = OnceLock::new();

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AppProxyMode {
    Direct,
    #[default]
    System,
    ManualHttp,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct AppProxySettings {
    pub mode: AppProxyMode,
    pub manual_url: String,
    pub bypass: Vec<String>,
    pub apply_to_child_processes: bool,
}

impl Default for AppProxySettings {
    fn default() -> Self {
        Self {
            mode: AppProxyMode::System,
            manual_url: String::new(),
            bypass: DEFAULT_BYPASS.iter().map(ToString::to_string).collect(),
            apply_to_child_processes: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProcessProxyEnv {
    pub set: BTreeMap<String, String>,
    /// Callers remove these inherited variables before applying `set`.
    pub remove: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppNetworkStatus {
    pub effective_mode: AppProxyMode,
    pub system_proxy_detected: bool,
    pub system_source: Option<String>,
    pub pac_detected: bool,
    pub pac_supported: bool,
    pub proxy_display: Option<String>,
    pub bypass: Vec<String>,
    pub apply_to_child_processes: bool,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NetworkTestResult {
    pub ok: bool,
    pub latency_ms: Option<u64>,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UpdaterProxyPolicy {
    NoProxy,
    SystemDefault,
    Proxy(Url),
}

#[derive(Debug, Clone, Default)]
struct SystemProxySnapshot {
    source: String,
    proxy_enabled: bool,
    proxy_server: Option<String>,
    proxy_override: Vec<String>,
    auto_config_url: Option<String>,
}

trait SystemProxyReader: Send + Sync {
    fn read(&self) -> Result<SystemProxySnapshot, String>;
}

struct NativeSystemProxyReader;

impl SystemProxyReader for NativeSystemProxyReader {
    fn read(&self) -> Result<SystemProxySnapshot, String> {
        read_native_system_proxy()
    }
}

struct AppNetworkInner {
    conn: Mutex<Connection>,
    settings: RwLock<AppProxySettings>,
    system_proxy_reader: Arc<dyn SystemProxyReader>,
}

#[derive(Clone)]
pub struct AppNetworkManager {
    inner: Arc<AppNetworkInner>,
}

pub fn install_global(manager: Arc<AppNetworkManager>) -> Result<(), String> {
    if let Some(current) = GLOBAL_APP_NETWORK_MANAGER.get() {
        return if Arc::ptr_eq(current, &manager) {
            Ok(())
        } else {
            Err("应用网络代理管理器已经初始化".to_string())
        };
    }
    GLOBAL_APP_NETWORK_MANAGER
        .set(manager)
        .map_err(|_| "应用网络代理管理器已经初始化".to_string())
}

pub fn global() -> Result<Arc<AppNetworkManager>, String> {
    GLOBAL_APP_NETWORK_MANAGER
        .get()
        .cloned()
        .ok_or_else(|| "应用网络代理管理器尚未初始化".to_string())
}

pub fn try_global() -> Option<Arc<AppNetworkManager>> {
    GLOBAL_APP_NETWORK_MANAGER.get().cloned()
}

impl AppNetworkManager {
    pub fn new() -> Result<Self, String> {
        let conn = crate::commands::settings::open_db()?;
        Self::from_connection(conn)
    }

    pub(crate) fn from_connection(conn: Connection) -> Result<Self, String> {
        Self::from_connection_and_reader(conn, Arc::new(NativeSystemProxyReader))
    }

    fn from_connection_and_reader(
        conn: Connection,
        system_proxy_reader: Arc<dyn SystemProxyReader>,
    ) -> Result<Self, String> {
        initialize_network_storage(&conn)?;
        let settings = load_settings_from_connection(&conn)?
            .map(normalize_settings)
            .transpose()?
            .unwrap_or_default();
        Ok(Self {
            inner: Arc::new(AppNetworkInner {
                conn: Mutex::new(conn),
                settings: RwLock::new(settings),
                system_proxy_reader,
            }),
        })
    }

    pub fn load(&self) -> Result<AppProxySettings, String> {
        self.inner
            .settings
            .read()
            .map(|settings| settings.clone())
            .map_err(|_| "读取应用网络代理设置失败：状态锁已损坏".to_string())
    }

    pub fn save(&self, settings: AppProxySettings) -> Result<AppProxySettings, String> {
        let settings = normalize_settings(settings)?;
        let payload = serde_json::to_string(&settings)
            .map_err(|err| format!("序列化应用网络代理设置失败：{err}"))?;
        let conn = self
            .inner
            .conn
            .lock()
            .map_err(|_| "保存应用网络代理设置失败：数据库锁已损坏".to_string())?;
        conn.execute(
            NETWORK_SETTINGS_UPSERT_SQL,
            params![NETWORK_SETTINGS_ID, payload, now_ms()?],
        )
        .map_err(|err| format!("保存应用网络代理设置失败：{err}"))?;
        let mut current = self
            .inner
            .settings
            .write()
            .map_err(|_| "保存应用网络代理设置失败：状态锁已损坏".to_string())?;
        *current = settings.clone();
        Ok(settings)
    }

    pub fn status(&self) -> Result<AppNetworkStatus, String> {
        let settings = self.load()?;
        let mut warnings = Vec::new();
        let system = match self.inner.system_proxy_reader.read() {
            Ok(system) => system,
            Err(err) => {
                warnings.push(err);
                SystemProxySnapshot::default()
            }
        };
        #[cfg(not(windows))]
        if settings.mode == AppProxyMode::System {
            warnings.push(
                "当前平台的“跟随系统”仅读取 HTTP_PROXY、HTTPS_PROXY、ALL_PROXY 和 NO_PROXY 环境变量。"
                    .to_string(),
            );
        }
        let pac_detected = system
            .auto_config_url
            .as_deref()
            .is_some_and(|url| !url.trim().is_empty());
        if pac_detected {
            warnings.push(
                "检测到系统 PAC 自动配置；当前版本不会解析 PAC，子进程也无法通过代理环境变量复现 PAC 规则。"
                    .to_string(),
            );
        }
        let proxy_display = match settings.mode {
            AppProxyMode::Direct => None,
            AppProxyMode::ManualHttp => sanitize_proxy_endpoint(&settings.manual_url),
            AppProxyMode::System => system
                .proxy_server
                .as_deref()
                .and_then(sanitize_proxy_spec)
                .or_else(|| {
                    system
                        .auto_config_url
                        .as_deref()
                        .and_then(sanitize_pac_url)
                        .map(|url| format!("PAC: {url}"))
                }),
        };
        Ok(AppNetworkStatus {
            effective_mode: settings.mode,
            system_proxy_detected: system.proxy_enabled
                && system
                    .proxy_server
                    .as_deref()
                    .is_some_and(|value| !value.trim().is_empty()),
            system_source: (!system.source.is_empty()).then_some(system.source),
            pac_detected,
            pac_supported: false,
            proxy_display,
            bypass: settings.bypass,
            apply_to_child_processes: settings.apply_to_child_processes,
            warnings,
        })
    }

    pub fn async_client(&self) -> Result<reqwest::Client, String> {
        self.async_client_with(reqwest::Client::builder())
    }

    pub fn async_client_with(
        &self,
        builder: reqwest::ClientBuilder,
    ) -> Result<reqwest::Client, String> {
        let settings = self.load()?;
        let builder = match settings.mode {
            AppProxyMode::Direct => builder.no_proxy(),
            AppProxyMode::System => {
                apply_system_proxy(builder, &settings, self.inner.system_proxy_reader.read()?)?
            }
            AppProxyMode::ManualHttp => builder
                .proxy(manual_proxy(&settings).map_err(|err| format!("创建手动代理失败：{err}"))?),
        };
        builder
            .build()
            .map_err(|err| format!("创建应用网络客户端失败：{err}"))
    }

    pub fn blocking_client(&self) -> Result<reqwest::blocking::Client, String> {
        self.blocking_client_with(reqwest::blocking::Client::builder())
    }

    pub fn blocking_client_with(
        &self,
        builder: reqwest::blocking::ClientBuilder,
    ) -> Result<reqwest::blocking::Client, String> {
        let settings = self.load()?;
        let builder = match settings.mode {
            AppProxyMode::Direct => builder.no_proxy(),
            AppProxyMode::System => apply_system_blocking_proxy(
                builder,
                &settings,
                self.inner.system_proxy_reader.read()?,
            )?,
            AppProxyMode::ManualHttp => builder
                .proxy(manual_proxy(&settings).map_err(|err| format!("创建手动代理失败：{err}"))?),
        };
        builder
            .build()
            .map_err(|err| format!("创建应用网络客户端失败：{err}"))
    }

    pub fn download_client(&self) -> Result<reqwest::Client, String> {
        self.async_client_with(
            reqwest::Client::builder()
                .connect_timeout(DOWNLOAD_CONNECT_TIMEOUT)
                .read_timeout(DOWNLOAD_READ_TIMEOUT)
                .user_agent(DOWNLOAD_USER_AGENT),
        )
    }

    pub fn updater_proxy_policy(&self) -> Result<UpdaterProxyPolicy, String> {
        let settings = self.load()?;
        match settings.mode {
            AppProxyMode::Direct => Ok(UpdaterProxyPolicy::NoProxy),
            AppProxyMode::ManualHttp => Ok(UpdaterProxyPolicy::Proxy(validate_http_url(
                &settings.manual_url,
                "手动代理 URL",
            )?)),
            AppProxyMode::System => {
                let system = self.inner.system_proxy_reader.read()?;
                reject_pac_only_system_proxy(&system)?;
                let Some(spec) = system.proxy_server.as_deref() else {
                    return Ok(UpdaterProxyPolicy::SystemDefault);
                };
                let endpoints = proxy_endpoints_from_spec(spec)?;
                match endpoints.https.or(endpoints.all) {
                    Some(endpoint) => Ok(UpdaterProxyPolicy::Proxy(
                        Url::parse(&endpoint).map_err(|_| "系统 HTTPS 代理地址无效".to_string())?,
                    )),
                    None => Ok(UpdaterProxyPolicy::NoProxy),
                }
            }
        }
    }

    pub fn process_env(&self) -> Result<ProcessProxyEnv, String> {
        let settings = self.load()?;
        if !settings.apply_to_child_processes {
            return Ok(ProcessProxyEnv {
                set: BTreeMap::new(),
                remove: Vec::new(),
            });
        }
        self.process_env_for_settings(settings)
    }

    /// Proxy environment for Calen-owned Node sidecars and download workers.
    /// Unlike `process_env`, this always follows the selected application mode.
    pub fn app_process_env(&self) -> Result<ProcessProxyEnv, String> {
        self.process_env_for_settings(self.load()?)
    }

    fn process_env_for_settings(
        &self,
        settings: AppProxySettings,
    ) -> Result<ProcessProxyEnv, String> {
        match settings.mode {
            AppProxyMode::Direct => Ok(ProcessProxyEnv {
                set: BTreeMap::new(),
                remove: PROXY_ENV_KEYS.iter().map(ToString::to_string).collect(),
            }),
            AppProxyMode::ManualHttp => {
                let mut set = BTreeMap::new();
                for key in ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"] {
                    set.insert(key.to_string(), settings.manual_url.clone());
                }
                set.insert("NO_PROXY".to_string(), settings.bypass.join(","));
                set.insert("NODE_USE_ENV_PROXY".to_string(), "1".to_string());
                Ok(ProcessProxyEnv {
                    set,
                    remove: ["http_proxy", "https_proxy", "all_proxy", "no_proxy"]
                        .iter()
                        .map(ToString::to_string)
                        .collect(),
                })
            }
            AppProxyMode::System => {
                let system = self.inner.system_proxy_reader.read()?;
                reject_pac_only_system_proxy(&system)?;
                let mut set = system
                    .proxy_server
                    .as_deref()
                    .map(proxy_spec_to_process_env)
                    .transpose()?
                    .unwrap_or_default();
                let mut bypass = settings.bypass;
                bypass.extend(system.proxy_override);
                set.insert("NO_PROXY".to_string(), normalize_bypass(&bypass).join(","));
                set.insert("NODE_USE_ENV_PROXY".to_string(), "1".to_string());
                Ok(ProcessProxyEnv {
                    set,
                    remove: ["http_proxy", "https_proxy", "all_proxy", "no_proxy"]
                        .iter()
                        .map(ToString::to_string)
                        .collect(),
                })
            }
        }
    }

    pub async fn test_connection(&self, target_url: &str) -> Result<NetworkTestResult, String> {
        let target = validate_test_target(target_url)?;
        let target_host = display_host(&target);
        let started = Instant::now();
        let response = self
            .async_client()?
            .get(target)
            .timeout(CONNECTION_TEST_TIMEOUT)
            .send()
            .await;
        let latency_ms = Some(duration_ms(started.elapsed()));
        match response {
            Ok(response) => {
                let status = response.status();
                Ok(NetworkTestResult {
                    ok: status.is_success(),
                    latency_ms,
                    message: if status.is_success() {
                        format!("已通过当前网络设置连接 {target_host}（HTTP {status}）")
                    } else {
                        format!("已连接 {target_host}，但服务返回 HTTP {status}")
                    },
                })
            }
            Err(err) => Ok(NetworkTestResult {
                ok: false,
                latency_ms,
                message: format!("连接 {target_host} 失败：{}", classify_request_error(&err)),
            }),
        }
    }
}

fn manual_proxy(settings: &AppProxySettings) -> Result<reqwest::Proxy, reqwest::Error> {
    reqwest::Proxy::all(settings.manual_url.as_str())
        .map(|proxy| proxy.no_proxy(reqwest::NoProxy::from_string(&settings.bypass.join(","))))
}

fn apply_system_proxy(
    mut builder: reqwest::ClientBuilder,
    settings: &AppProxySettings,
    system: SystemProxySnapshot,
) -> Result<reqwest::ClientBuilder, String> {
    reject_pac_only_system_proxy(&system)?;
    let bypass = merged_system_bypass(settings, &system);
    if let Some(spec) = system.proxy_server.as_deref() {
        for proxy in reqwest_proxies_from_spec(spec, &bypass)? {
            builder = builder.proxy(proxy);
        }
    }
    Ok(builder)
}

fn apply_system_blocking_proxy(
    mut builder: reqwest::blocking::ClientBuilder,
    settings: &AppProxySettings,
    system: SystemProxySnapshot,
) -> Result<reqwest::blocking::ClientBuilder, String> {
    reject_pac_only_system_proxy(&system)?;
    let bypass = merged_system_bypass(settings, &system);
    if let Some(spec) = system.proxy_server.as_deref() {
        for proxy in reqwest_proxies_from_spec(spec, &bypass)? {
            builder = builder.proxy(proxy);
        }
    }
    Ok(builder)
}

fn merged_system_bypass(settings: &AppProxySettings, system: &SystemProxySnapshot) -> Vec<String> {
    let mut bypass = settings.bypass.clone();
    bypass.extend(system.proxy_override.iter().cloned());
    normalize_bypass(&bypass)
}

fn reject_pac_only_system_proxy(system: &SystemProxySnapshot) -> Result<(), String> {
    let has_static_proxy = system
        .proxy_server
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty());
    let has_pac = system
        .auto_config_url
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty());
    if has_pac && !has_static_proxy {
        Err(
            "检测到系统 PAC 自动代理，但当前版本尚不支持解析 PAC；请改用手动 HTTP 代理或直连模式"
                .to_string(),
        )
    } else {
        Ok(())
    }
}

#[derive(Debug, Default)]
struct ProxyEndpoints {
    http: Option<String>,
    https: Option<String>,
    all: Option<String>,
}

fn proxy_endpoints_from_spec(raw: &str) -> Result<ProxyEndpoints, String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Err("系统代理地址为空".to_string());
    }
    let has_assignments = raw.split(';').any(|entry| entry.contains('='));
    if !has_assignments {
        return Ok(ProxyEndpoints {
            all: Some(normalize_system_proxy_endpoint(raw)?),
            ..ProxyEndpoints::default()
        });
    }

    let mut endpoints = ProxyEndpoints::default();
    let mut unsupported = Vec::new();
    for entry in raw
        .split(';')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
    {
        let Some((kind, endpoint)) = entry.split_once('=') else {
            continue;
        };
        match kind.trim().to_ascii_lowercase().as_str() {
            "http" => endpoints.http = Some(normalize_system_proxy_endpoint(endpoint)?),
            "https" => endpoints.https = Some(normalize_system_proxy_endpoint(endpoint)?),
            "all" => endpoints.all = Some(normalize_system_proxy_endpoint(endpoint)?),
            other => unsupported.push(other.to_string()),
        }
    }
    if endpoints.http.is_none() && endpoints.https.is_none() && endpoints.all.is_none() {
        return Err(format!(
            "系统代理没有可用的 http/https 地址{}",
            if unsupported.is_empty() {
                String::new()
            } else {
                format!("（不支持：{}）", unsupported.join(", "))
            }
        ));
    }
    Ok(endpoints)
}

fn reqwest_proxies_from_spec(raw: &str, bypass: &[String]) -> Result<Vec<reqwest::Proxy>, String> {
    let endpoints = proxy_endpoints_from_spec(raw)?;
    let no_proxy = reqwest::NoProxy::from_string(&normalize_bypass(bypass).join(","));
    let mut proxies = Vec::new();
    if let Some(endpoint) = endpoints.http {
        proxies.push(
            reqwest::Proxy::http(endpoint.as_str())
                .map_err(|_| "系统 HTTP 代理地址无效".to_string())?
                .no_proxy(no_proxy.clone()),
        );
    }
    if let Some(endpoint) = endpoints.https {
        proxies.push(
            reqwest::Proxy::https(endpoint.as_str())
                .map_err(|_| "系统 HTTPS 代理地址无效".to_string())?
                .no_proxy(no_proxy.clone()),
        );
    }
    if let Some(endpoint) = endpoints.all {
        proxies.push(
            reqwest::Proxy::all(endpoint.as_str())
                .map_err(|_| "系统代理地址无效".to_string())?
                .no_proxy(no_proxy),
        );
    }
    Ok(proxies)
}

fn validate_http_url(raw: &str, label: &str) -> Result<Url, String> {
    let url = Url::parse(raw.trim()).map_err(|err| format!("{label}必须是完整 URL：{err}"))?;
    match url.scheme() {
        "http" | "https" => {}
        scheme => return Err(format!("{label}仅支持 http 或 https，当前为 {scheme}")),
    }
    if !url.has_host() {
        return Err(format!("{label}缺少主机名"));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(format!("{label}不允许在 URL 中嵌入用户名或密码"));
    }
    if url.path() != "/" || url.query().is_some() || url.fragment().is_some() {
        return Err(format!("{label}只能包含协议、主机和端口"));
    }
    Ok(url)
}

fn validate_test_target(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw.trim()).map_err(|err| format!("测试地址必须是完整 URL：{err}"))?;
    if !matches!(url.scheme(), "http" | "https") || !url.has_host() {
        return Err("测试地址仅支持带主机名的 http 或 https URL".to_string());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("测试地址不允许在 URL 中嵌入用户名或密码".to_string());
    }
    Ok(url)
}

fn display_host(url: &Url) -> String {
    match (url.host_str(), url.port()) {
        (Some(host), Some(port)) if host.contains(':') => format!("[{host}]:{port}"),
        (Some(host), Some(port)) => format!("{host}:{port}"),
        (Some(host), None) => host.to_string(),
        (None, _) => "目标服务".to_string(),
    }
}

fn duration_ms(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

fn classify_request_error(err: &reqwest::Error) -> &'static str {
    if err.is_timeout() {
        "连接超时"
    } else if err.is_connect() {
        "无法建立连接"
    } else if err.is_request() {
        "请求配置无效"
    } else if err.is_body() {
        "读取响应失败"
    } else {
        "网络请求失败"
    }
}

#[cfg(windows)]
fn read_native_system_proxy() -> Result<SystemProxySnapshot, String> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};

    let env_proxy = proxy_spec_from_environment();
    let env_override = std::env::var("NO_PROXY")
        .or_else(|_| std::env::var("no_proxy"))
        .ok()
        .map(|value| split_proxy_override(&value))
        .unwrap_or_default();
    let root = RegKey::predef(HKEY_CURRENT_USER);
    let settings =
        match root.open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings") {
            Ok(settings) => settings,
            Err(_) => {
                return Ok(SystemProxySnapshot {
                    source: "environment".to_string(),
                    proxy_enabled: env_proxy.is_some(),
                    proxy_server: env_proxy,
                    proxy_override: env_override,
                    auto_config_url: None,
                });
            }
        };
    let registry_enabled = settings.get_value::<u32, _>("ProxyEnable").unwrap_or(0) != 0;
    let registry_proxy = settings
        .get_value::<String, _>("ProxyServer")
        .ok()
        .filter(|value| !value.trim().is_empty());
    let registry_override = settings
        .get_value::<String, _>("ProxyOverride")
        .ok()
        .map(|value| split_proxy_override(&value))
        .unwrap_or_default();
    let auto_config_url = settings
        .get_value::<String, _>("AutoConfigURL")
        .ok()
        .filter(|value| !value.trim().is_empty());
    let uses_environment = env_proxy.is_some();
    Ok(SystemProxySnapshot {
        source: if uses_environment {
            "environment".to_string()
        } else {
            "windowsRegistry".to_string()
        },
        proxy_enabled: uses_environment || registry_enabled,
        proxy_server: env_proxy.or_else(|| registry_enabled.then_some(registry_proxy).flatten()),
        proxy_override: if env_override.is_empty() {
            registry_override
        } else {
            env_override
        },
        auto_config_url,
    })
}

#[cfg(not(windows))]
fn read_native_system_proxy() -> Result<SystemProxySnapshot, String> {
    let proxy_server = proxy_spec_from_environment();
    Ok(SystemProxySnapshot {
        source: "environment".to_string(),
        proxy_enabled: proxy_server.is_some(),
        proxy_server,
        proxy_override: std::env::var("NO_PROXY")
            .or_else(|_| std::env::var("no_proxy"))
            .ok()
            .map(|value| split_proxy_override(&value))
            .unwrap_or_default(),
        auto_config_url: None,
    })
}

fn proxy_spec_from_environment() -> Option<String> {
    let mut entries = Vec::new();
    for (name, upper, lower) in [
        ("http", "HTTP_PROXY", "http_proxy"),
        ("https", "HTTPS_PROXY", "https_proxy"),
        ("all", "ALL_PROXY", "all_proxy"),
    ] {
        if let Ok(value) = std::env::var(upper).or_else(|_| std::env::var(lower)) {
            if !value.trim().is_empty() {
                entries.push(format!("{name}={}", value.trim()));
            }
        }
    }
    (!entries.is_empty()).then(|| entries.join(";"))
}

fn split_proxy_override(raw: &str) -> Vec<String> {
    raw.split([',', ';'])
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn proxy_spec_to_process_env(raw: &str) -> Result<BTreeMap<String, String>, String> {
    let endpoints = proxy_endpoints_from_spec(raw)?;
    let mut result = BTreeMap::new();
    if let Some(endpoint) = endpoints.http {
        result.insert("HTTP_PROXY".to_string(), endpoint);
    }
    if let Some(endpoint) = endpoints.https {
        result.insert("HTTPS_PROXY".to_string(), endpoint);
    }
    if let Some(endpoint) = endpoints.all {
        result.insert("ALL_PROXY".to_string(), endpoint.clone());
        for key in ["HTTP_PROXY", "HTTPS_PROXY"] {
            result
                .entry(key.to_string())
                .or_insert_with(|| endpoint.clone());
        }
    }
    Ok(result)
}

fn normalize_system_proxy_endpoint(raw: &str) -> Result<String, String> {
    let raw = raw.trim();
    let candidate = if raw.contains("://") {
        raw.to_string()
    } else {
        format!("http://{raw}")
    };
    let url = Url::parse(&candidate).map_err(|_| "系统代理地址格式无效".to_string())?;
    if !matches!(url.scheme(), "http" | "https") || !url.has_host() {
        return Err("系统代理仅支持 http 或 https 地址".to_string());
    }
    Ok(url.as_str().trim_end_matches('/').to_string())
}

fn sanitize_proxy_spec(raw: &str) -> Option<String> {
    let has_assignments = raw.split(';').any(|entry| entry.contains('='));
    if !has_assignments {
        return sanitize_proxy_endpoint(raw);
    }
    let entries: Vec<String> = raw
        .split(';')
        .filter_map(|entry| {
            let (kind, endpoint) = entry.trim().split_once('=')?;
            sanitize_proxy_endpoint(endpoint).map(|endpoint| format!("{}={endpoint}", kind.trim()))
        })
        .collect();
    (!entries.is_empty()).then(|| entries.join(";"))
}

fn sanitize_proxy_endpoint(raw: &str) -> Option<String> {
    let raw = raw.trim();
    let candidate = if raw.contains("://") {
        raw.to_string()
    } else {
        format!("http://{raw}")
    };
    let url = Url::parse(&candidate).ok()?;
    url.has_host().then(|| url.origin().ascii_serialization())
}

fn sanitize_pac_url(raw: &str) -> Option<String> {
    let url = Url::parse(raw.trim()).ok()?;
    if !matches!(url.scheme(), "http" | "https") || !url.has_host() {
        return None;
    }
    let suffix = if url.path() == "/" { "" } else { "/…" };
    Some(format!("{}{suffix}", url.origin().ascii_serialization()))
}

fn normalize_settings(mut settings: AppProxySettings) -> Result<AppProxySettings, String> {
    settings.bypass = normalize_bypass(&settings.bypass);
    let manual_url = settings.manual_url.trim().to_string();
    if manual_url.is_empty() {
        if settings.mode == AppProxyMode::ManualHttp {
            return Err("手动代理模式需要填写代理 URL".to_string());
        }
        settings.manual_url.clear();
    } else {
        settings.manual_url = validate_http_url(&manual_url, "手动代理 URL")?
            .origin()
            .ascii_serialization();
    }
    Ok(settings)
}

fn normalize_bypass(values: &[String]) -> Vec<String> {
    let mut result: Vec<String> = DEFAULT_BYPASS.iter().map(ToString::to_string).collect();
    for candidate in values
        .iter()
        .flat_map(|value| value.split([',', ';']))
        .map(str::trim)
        .filter(|value| !value.is_empty() && !value.eq_ignore_ascii_case("<local>"))
    {
        let normalized = candidate.strip_prefix("*.").unwrap_or(candidate);
        if !result
            .iter()
            .any(|existing| existing.eq_ignore_ascii_case(normalized))
        {
            result.push(normalized.to_string());
        }
    }
    result
}

fn initialize_network_storage(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS app_network_settings (
            config_id TEXT PRIMARY KEY,
            payload_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );",
    )
    .map_err(|err| format!("初始化 {NETWORK_SETTINGS_TABLE} 失败：{err}"))
}

fn load_settings_from_connection(conn: &Connection) -> Result<Option<AppProxySettings>, String> {
    let payload = conn
        .query_row(
            NETWORK_SETTINGS_SELECT_SQL,
            params![NETWORK_SETTINGS_ID],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|err| format!("读取应用网络代理设置失败：{err}"))?;
    payload
        .map(|payload| {
            serde_json::from_str(&payload).map_err(|err| format!("解析应用网络代理设置失败：{err}"))
        })
        .transpose()
}

fn now_ms() -> Result<i64, String> {
    let elapsed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| format!("读取系统时间失败：{err}"))?;
    i64::try_from(elapsed.as_millis()).map_err(|_| "系统时间超出 SQLite 范围".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        },
        thread,
    };
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn test_manager() -> AppNetworkManager {
        AppNetworkManager::from_connection(Connection::open_in_memory().expect("open sqlite"))
            .expect("create app network manager")
    }

    #[derive(Clone)]
    struct FakeSystemProxyReader(SystemProxySnapshot);

    impl SystemProxyReader for FakeSystemProxyReader {
        fn read(&self) -> Result<SystemProxySnapshot, String> {
            Ok(self.0.clone())
        }
    }

    fn manager_with_system_proxy(snapshot: SystemProxySnapshot) -> AppNetworkManager {
        AppNetworkManager::from_connection_and_reader(
            Connection::open_in_memory().expect("open sqlite"),
            Arc::new(FakeSystemProxyReader(snapshot)),
        )
        .expect("create manager with system proxy")
    }

    #[test]
    fn new_manager_loads_system_mode_with_local_bypass_defaults() {
        let manager = test_manager();

        assert_eq!(
            manager.load().expect("load defaults"),
            AppProxySettings::default()
        );
    }

    #[test]
    fn manual_proxy_rejects_unsupported_schemes_and_embedded_credentials() {
        let manager = test_manager();
        let settings = |manual_url: &str| AppProxySettings {
            mode: AppProxyMode::ManualHttp,
            manual_url: manual_url.to_string(),
            bypass: Vec::new(),
            apply_to_child_processes: false,
        };

        assert!(manager.save(settings("socks5://127.0.0.1:1080")).is_err());
        assert!(manager
            .save(settings("http://user:secret@127.0.0.1:7890"))
            .is_err());
    }

    #[test]
    fn direct_process_environment_removes_every_inherited_proxy_variable() {
        let manager = test_manager();
        manager
            .save(AppProxySettings {
                mode: AppProxyMode::Direct,
                manual_url: String::new(),
                bypass: Vec::new(),
                apply_to_child_processes: true,
            })
            .expect("save direct mode");

        let env = manager.process_env().expect("build process environment");

        assert!(env.set.is_empty());
        for key in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "NO_PROXY",
            "http_proxy",
            "https_proxy",
            "all_proxy",
            "no_proxy",
            "NODE_USE_ENV_PROXY",
        ] {
            assert!(env.remove.iter().any(|item| item == key), "missing {key}");
        }
    }

    #[test]
    fn saved_settings_survive_reopen_and_concurrent_updates_remain_consistent() {
        let temp = tempfile::tempdir().expect("create temp directory");
        let db_path = temp.path().join("settings.db");
        let manager = Arc::new(
            AppNetworkManager::from_connection(Connection::open(&db_path).expect("open sqlite"))
                .expect("create app network manager"),
        );
        let mut workers = Vec::new();
        for index in 0..8 {
            let manager = manager.clone();
            workers.push(thread::spawn(move || {
                manager.save(AppProxySettings {
                    mode: AppProxyMode::ManualHttp,
                    manual_url: format!("http://127.0.0.1:{}", 7800 + index),
                    bypass: vec![format!("service-{index}.internal")],
                    apply_to_child_processes: index % 2 == 0,
                })
            }));
        }
        for worker in workers {
            worker
                .join()
                .expect("join save worker")
                .expect("save settings");
        }

        let current = manager.load().expect("load current settings");
        let reopened =
            AppNetworkManager::from_connection(Connection::open(&db_path).expect("reopen sqlite"))
                .expect("reopen app network manager");

        assert_eq!(reopened.load().expect("load persisted settings"), current);
    }

    #[test]
    fn child_process_injection_is_opt_in_and_manual_mode_sets_one_explicit_proxy() {
        let manager = test_manager();
        let settings = AppProxySettings {
            mode: AppProxyMode::ManualHttp,
            manual_url: "http://proxy.example:7890".to_string(),
            bypass: vec!["downloads.example".to_string()],
            apply_to_child_processes: false,
        };
        manager.save(settings.clone()).expect("save manual proxy");
        assert_eq!(
            manager.process_env().expect("disabled child env"),
            ProcessProxyEnv {
                set: BTreeMap::new(),
                remove: Vec::new(),
            }
        );

        manager
            .save(AppProxySettings {
                apply_to_child_processes: true,
                ..settings
            })
            .expect("enable child injection");
        let env = manager.process_env().expect("manual child env");

        assert_eq!(
            env.set.get("HTTP_PROXY").map(String::as_str),
            Some("http://proxy.example:7890")
        );
        assert_eq!(
            env.set.get("HTTPS_PROXY").map(String::as_str),
            Some("http://proxy.example:7890")
        );
        assert_eq!(
            env.set.get("ALL_PROXY").map(String::as_str),
            Some("http://proxy.example:7890")
        );
        assert_eq!(
            env.set.get("NODE_USE_ENV_PROXY").map(String::as_str),
            Some("1")
        );
        assert_eq!(
            env.set.get("NO_PROXY").map(String::as_str),
            Some("localhost,127.0.0.1,::1,downloads.example")
        );
        for key in ["http_proxy", "https_proxy", "all_proxy", "no_proxy"] {
            assert!(env.remove.iter().any(|item| item == key), "missing {key}");
        }
    }

    #[test]
    fn calen_owned_sidecar_environment_always_follows_the_selected_mode() {
        let manager = test_manager();
        manager
            .save(AppProxySettings {
                mode: AppProxyMode::ManualHttp,
                manual_url: "http://127.0.0.1:7890".to_string(),
                bypass: Vec::new(),
                apply_to_child_processes: false,
            })
            .expect("save manual proxy");

        let env = manager.app_process_env().expect("build Calen sidecar env");

        assert_eq!(
            env.set.get("HTTP_PROXY").map(String::as_str),
            Some("http://127.0.0.1:7890")
        );
        assert_eq!(
            env.set.get("NODE_USE_ENV_PROXY").map(String::as_str),
            Some("1")
        );
    }

    #[test]
    fn system_status_redacts_credentials_and_reports_unsupported_pac() {
        let manager = manager_with_system_proxy(SystemProxySnapshot {
            source: "windowsRegistry".to_string(),
            proxy_enabled: true,
            proxy_server: Some(
                "http=http://user:secret@proxy.example:8080;https=secure.example:8443".to_string(),
            ),
            proxy_override: vec!["*.internal.example".to_string(), "<local>".to_string()],
            auto_config_url: Some("https://pac.example/config.pac?access_token=secret".to_string()),
        });

        let status = manager.status().expect("read network status");

        assert_eq!(status.effective_mode, AppProxyMode::System);
        assert!(status.system_proxy_detected);
        assert!(status.pac_detected);
        assert!(!status.pac_supported);
        let display = status.proxy_display.expect("proxy display");
        assert!(display.contains("proxy.example:8080"));
        assert!(display.contains("secure.example:8443"));
        assert!(!display.contains("user"));
        assert!(!display.contains("secret"));
        assert!(status
            .warnings
            .iter()
            .any(|warning| warning.contains("PAC")));
    }

    #[test]
    fn system_child_environment_uses_registry_proxy_and_merges_safe_bypass() {
        let manager = manager_with_system_proxy(SystemProxySnapshot {
            source: "windowsRegistry".to_string(),
            proxy_enabled: true,
            proxy_server: Some("http=127.0.0.1:7890;https=http://127.0.0.1:7891".to_string()),
            proxy_override: vec!["*.corp.example".to_string(), "<local>".to_string()],
            auto_config_url: None,
        });
        manager
            .save(AppProxySettings {
                mode: AppProxyMode::System,
                manual_url: String::new(),
                bypass: vec!["downloads.example".to_string()],
                apply_to_child_processes: true,
            })
            .expect("save system proxy");

        let env = manager.process_env().expect("build system child env");

        assert_eq!(
            env.set.get("HTTP_PROXY").map(String::as_str),
            Some("http://127.0.0.1:7890")
        );
        assert_eq!(
            env.set.get("HTTPS_PROXY").map(String::as_str),
            Some("http://127.0.0.1:7891")
        );
        assert_eq!(
            env.set.get("NODE_USE_ENV_PROXY").map(String::as_str),
            Some("1")
        );
        assert_eq!(
            env.set.get("NO_PROXY").map(String::as_str),
            Some("localhost,127.0.0.1,::1,downloads.example,corp.example")
        );
    }

    #[test]
    fn pac_only_system_mode_fails_explicitly_instead_of_connecting_directly() {
        let manager = manager_with_system_proxy(SystemProxySnapshot {
            source: "windowsRegistry".to_string(),
            proxy_enabled: false,
            proxy_server: None,
            proxy_override: Vec::new(),
            auto_config_url: Some("https://pac.example/proxy.pac".to_string()),
        });
        manager
            .save(AppProxySettings {
                mode: AppProxyMode::System,
                apply_to_child_processes: true,
                ..AppProxySettings::default()
            })
            .expect("save system mode");

        let client_error = manager
            .async_client()
            .expect_err("PAC-only client must fail");
        let env_error = manager
            .app_process_env()
            .expect_err("PAC-only sidecar environment must fail");

        assert!(client_error.contains("PAC"));
        assert!(env_error.contains("PAC"));
    }

    #[test]
    fn updater_policy_uses_https_system_proxy_and_never_hides_pac_fallback() {
        let manager = manager_with_system_proxy(SystemProxySnapshot {
            source: "windowsRegistry".to_string(),
            proxy_enabled: true,
            proxy_server: Some("http=127.0.0.1:7890;https=http://127.0.0.1:7891".to_string()),
            proxy_override: Vec::new(),
            auto_config_url: None,
        });

        assert_eq!(
            manager.updater_proxy_policy().expect("updater policy"),
            UpdaterProxyPolicy::Proxy(
                Url::parse("http://127.0.0.1:7891").expect("parse expected proxy")
            )
        );
    }

    #[tokio::test]
    async fn manual_client_routes_connection_test_through_the_configured_proxy() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind local proxy");
        let proxy_addr = listener.local_addr().expect("read proxy address");
        let proxy_task = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("accept proxy request");
            let mut request = vec![0_u8; 4096];
            let read = stream.read(&mut request).await.expect("read proxy request");
            let request = String::from_utf8_lossy(&request[..read]);
            assert!(request.starts_with("GET http://calen.invalid/probe HTTP/1.1"));
            stream
                .write_all(
                    b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .await
                .expect("write proxy response");
        });
        let manager = test_manager();
        manager
            .save(AppProxySettings {
                mode: AppProxyMode::ManualHttp,
                manual_url: format!("http://{proxy_addr}"),
                bypass: Vec::new(),
                apply_to_child_processes: false,
            })
            .expect("save manual proxy");

        let result = manager
            .test_connection("http://calen.invalid/probe")
            .await
            .expect("test manual proxy");

        assert!(result.ok, "{}", result.message);
        assert!(result.latency_ms.is_some());
        proxy_task.await.expect("join proxy task");
    }

    #[tokio::test]
    async fn system_static_proxy_routes_requests_through_the_registry_endpoint() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind local system proxy");
        let proxy_addr = listener.local_addr().expect("read system proxy address");
        let proxy_task = tokio::spawn(async move {
            let (mut stream, _) = listener
                .accept()
                .await
                .expect("accept system proxy request");
            let mut request = vec![0_u8; 4096];
            let read = stream
                .read(&mut request)
                .await
                .expect("read system proxy request");
            let request = String::from_utf8_lossy(&request[..read]);
            assert!(request.starts_with("GET http://system-proxy.invalid/probe HTTP/1.1"));
            stream
                .write_all(
                    b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .await
                .expect("write system proxy response");
        });
        let manager = manager_with_system_proxy(SystemProxySnapshot {
            source: "windowsRegistry".to_string(),
            proxy_enabled: true,
            proxy_server: Some(format!("http={proxy_addr};https={proxy_addr}")),
            proxy_override: Vec::new(),
            auto_config_url: None,
        });

        let result = manager
            .test_connection("http://system-proxy.invalid/probe")
            .await
            .expect("test system proxy");

        assert!(result.ok, "{}", result.message);
        proxy_task.await.expect("join system proxy task");
    }

    #[tokio::test]
    async fn system_proxy_override_bypasses_the_proxy_for_rust_clients() {
        let target_listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind bypass target");
        let target_addr = target_listener.local_addr().expect("read target address");
        let proxy_listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind system proxy");
        let proxy_addr = proxy_listener.local_addr().expect("read proxy address");
        let target_hits = Arc::new(AtomicUsize::new(0));
        let proxy_hits = Arc::new(AtomicUsize::new(0));
        let target_hits_for_task = Arc::clone(&target_hits);
        let proxy_hits_for_task = Arc::clone(&proxy_hits);
        let target_task = tokio::spawn(async move {
            let (mut stream, _) = target_listener
                .accept()
                .await
                .expect("accept bypass target");
            target_hits_for_task.fetch_add(1, Ordering::SeqCst);
            let mut request = vec![0_u8; 4096];
            let _ = stream
                .read(&mut request)
                .await
                .expect("read target request");
            stream
                .write_all(
                    b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .await
                .expect("write target response");
        });
        let proxy_task = tokio::spawn(async move {
            let (mut stream, _) = proxy_listener.accept().await.expect("accept proxy request");
            proxy_hits_for_task.fetch_add(1, Ordering::SeqCst);
            let mut request = vec![0_u8; 4096];
            let _ = stream.read(&mut request).await.expect("read proxy request");
            stream
                .write_all(
                    b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .await
                .expect("write proxy response");
        });
        let manager = manager_with_system_proxy(SystemProxySnapshot {
            source: "windowsRegistry".to_string(),
            proxy_enabled: true,
            proxy_server: Some(format!("http={proxy_addr};https={proxy_addr}")),
            proxy_override: vec!["*.corp.example".to_string()],
            auto_config_url: None,
        });
        let client = manager
            .async_client_with(
                reqwest::Client::builder().resolve("service.corp.example", target_addr),
            )
            .expect("build system proxy client");

        let response = client
            .get(format!(
                "http://service.corp.example:{}/probe",
                target_addr.port()
            ))
            .send()
            .await
            .expect("send bypassed request");
        tokio::time::sleep(Duration::from_millis(25)).await;

        assert_eq!(response.status(), reqwest::StatusCode::NO_CONTENT);
        assert_eq!(target_hits.load(Ordering::SeqCst), 1);
        assert_eq!(proxy_hits.load(Ordering::SeqCst), 0);
        target_task.abort();
        proxy_task.abort();
    }

    #[test]
    fn both_client_variants_build_for_every_valid_mode() {
        let manager = test_manager();
        for settings in [
            AppProxySettings {
                mode: AppProxyMode::Direct,
                ..AppProxySettings::default()
            },
            AppProxySettings::default(),
            AppProxySettings {
                mode: AppProxyMode::ManualHttp,
                manual_url: "https://proxy.example:8443".to_string(),
                ..AppProxySettings::default()
            },
        ] {
            manager.save(settings).expect("save mode");
            manager.async_client().expect("build async client");
            manager.blocking_client().expect("build blocking client");
            manager.download_client().expect("build download client");
        }
    }
}
