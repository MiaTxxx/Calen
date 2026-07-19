use super::{
    TranslationCatalog, TranslationDownloadConsent, TranslationDownloadStatus, TranslationManager,
    TranslationModel, TranslationRequest, TranslationResult, TranslationRuntimeStatus,
    TranslationStatus,
};
use crate::services::network::AppNetworkManager;
use std::{path::PathBuf, sync::Arc};
use tauri::Manager;

pub fn resolve_runtime_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resource_dir()
        .map(|directory| {
            directory
                .join("translation-runtime")
                .join(runtime_file_name())
        })
        .map_err(|error| format!("解析离线翻译运行时路径失败：{error}"))
}

pub fn create_managed_translation_manager(
    app: &tauri::AppHandle,
    network: AppNetworkManager,
) -> Result<Arc<TranslationManager>, String> {
    let home = dirs::home_dir()
        .ok_or_else(|| "无法确定用户主目录，不能创建离线翻译模型目录".to_string())?;
    TranslationManager::with_paths_and_client(
        home.join(".liveagent").join("models").join("translation"),
        resolve_runtime_path(app)?,
        Arc::new(network),
    )
    .map(Arc::new)
    .map_err(command_error)
}

#[tauri::command]
pub async fn translation_catalog_list(
    manager: tauri::State<'_, Arc<TranslationManager>>,
) -> Result<TranslationCatalog, String> {
    manager.catalog().await.map_err(command_error)
}

#[tauri::command]
pub async fn translation_status(
    manager: tauri::State<'_, Arc<TranslationManager>>,
) -> Result<TranslationStatus, String> {
    manager.status().await.map_err(command_error)
}

#[tauri::command]
pub async fn translation_download_start(
    manager: tauri::State<'_, Arc<TranslationManager>>,
    model_id: String,
    consent: Option<TranslationDownloadConsent>,
) -> Result<TranslationDownloadStatus, String> {
    manager
        .download_start(&model_id, consent.as_ref())
        .await
        .map_err(command_error)
}

#[tauri::command]
pub async fn translation_download_status(
    manager: tauri::State<'_, Arc<TranslationManager>>,
    model_id: String,
) -> Result<TranslationDownloadStatus, String> {
    manager
        .download_status(&model_id)
        .await
        .map_err(command_error)?
        .ok_or_else(|| "notFound: 该模型尚未开始下载".to_string())
}

#[tauri::command]
pub async fn translation_download_cancel(
    manager: tauri::State<'_, Arc<TranslationManager>>,
    model_id: String,
) -> Result<TranslationDownloadStatus, String> {
    manager
        .download_cancel(&model_id)
        .await
        .map_err(command_error)
}

#[tauri::command]
pub async fn translation_import(
    manager: tauri::State<'_, Arc<TranslationManager>>,
    path: Option<String>,
    display_name: Option<String>,
) -> Result<TranslationModel, String> {
    let source = match path.map(PathBuf::from) {
        Some(path) => path,
        None => tokio::task::spawn_blocking(select_gguf_file)
            .await
            .map_err(|error| format!("io: 打开 GGUF 文件选择器失败：{error}"))?
            .ok_or_else(|| "invalidArgument: 未选择 GGUF 模型文件".to_string())?,
    };
    manager
        .import_model(source, display_name)
        .await
        .map_err(command_error)
}

#[tauri::command]
pub async fn translation_delete(
    manager: tauri::State<'_, Arc<TranslationManager>>,
    model_id: String,
) -> Result<(), String> {
    manager.delete_model(&model_id).await.map_err(command_error)
}

#[tauri::command]
pub async fn translation_translate(
    manager: tauri::State<'_, Arc<TranslationManager>>,
    model_id: String,
    text: String,
    source_language: Option<String>,
    target_language: String,
    timeout_ms: Option<u64>,
) -> Result<TranslationResult, String> {
    manager
        .translate(TranslationRequest {
            model_id,
            text,
            source_language,
            target_language,
            timeout_ms,
        })
        .await
        .map_err(command_error)
}

#[tauri::command]
pub async fn translation_stop(
    manager: tauri::State<'_, Arc<TranslationManager>>,
) -> Result<TranslationRuntimeStatus, String> {
    manager.stop().await.map_err(command_error)
}

fn select_gguf_file() -> Option<PathBuf> {
    rfd::FileDialog::new()
        .set_title("导入 GGUF 离线翻译模型")
        .add_filter("GGUF", &["gguf"])
        .pick_file()
}

fn command_error(error: super::TranslationError) -> String {
    format!("{}: {}", error.code().as_str(), error.message())
}

#[cfg(target_os = "windows")]
fn runtime_file_name() -> &'static str {
    "llama-server.exe"
}

#[cfg(not(target_os = "windows"))]
fn runtime_file_name() -> &'static str {
    "llama-server"
}
