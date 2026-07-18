use std::sync::Arc;

use crate::commands::stock::StockResearchManager;
use crate::services::network::{
    AppNetworkManager, AppNetworkStatus, AppProxySettings, NetworkTestResult,
};

const DEFAULT_NETWORK_TEST_URL: &str = "https://github.com/";

#[tauri::command]
pub fn network_proxy_get(
    network: tauri::State<'_, Arc<AppNetworkManager>>,
) -> Result<AppProxySettings, String> {
    network.load()
}

#[tauri::command]
pub async fn network_proxy_save(
    payload: AppProxySettings,
    network: tauri::State<'_, Arc<AppNetworkManager>>,
    stock: tauri::State<'_, Arc<StockResearchManager>>,
) -> Result<AppProxySettings, String> {
    let previous = network.load()?;
    let saved = network.save(payload)?;
    if saved != previous {
        stock
            .restart_if_running()
            .await
            .map_err(|error| format!("代理设置已保存，但重新加载股票服务网络配置失败：{error}"))?;
    }
    Ok(saved)
}

#[tauri::command]
pub fn network_proxy_status(
    network: tauri::State<'_, Arc<AppNetworkManager>>,
) -> Result<AppNetworkStatus, String> {
    network.status()
}

#[tauri::command]
pub async fn network_proxy_test(
    test_url: Option<String>,
    network: tauri::State<'_, Arc<AppNetworkManager>>,
) -> Result<NetworkTestResult, String> {
    let test_url = test_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_NETWORK_TEST_URL);
    network.test_connection(test_url).await
}
