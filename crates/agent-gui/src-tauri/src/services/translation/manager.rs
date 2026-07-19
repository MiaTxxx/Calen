pub use super::download::TranslationHttpClientFactory;

use super::{
    catalog::{read_imported_manifests, DownloadConsentPolicy, ImportedModelManifest, ModelSpec},
    download::{
        part_path, replace_file_atomically, run_download, sha256_file, DownloadCancellation,
        DownloadEntry, DownloadRegistry,
    },
    error::{TranslationError, TranslationErrorCode},
    runtime::{self, RuntimeState},
    types::{
        TranslationCatalog, TranslationDownloadConsent, TranslationDownloadPhase,
        TranslationDownloadStatus, TranslationInferenceProfile, TranslationModel,
        TranslationModelSource, TranslationRequest, TranslationResult, TranslationStatus,
    },
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
    time::SystemTime,
};
use tokio::sync::Mutex;
use uuid::Uuid;

impl TranslationHttpClientFactory for crate::services::network::AppNetworkManager {
    fn create(&self) -> Result<reqwest::Client, String> {
        self.download_client()
    }
}

#[derive(Clone)]
pub struct TranslationManager {
    inner: Arc<TranslationManagerInner>,
}

struct TranslationManagerInner {
    model_dir: PathBuf,
    runtime_path: PathBuf,
    builtins: Vec<ModelSpec>,
    http_factory: Arc<dyn TranslationHttpClientFactory>,
    downloads: DownloadRegistry,
    runtime: Mutex<RuntimeState>,
    integrity_cache: Mutex<HashMap<PathBuf, ModelIntegrityCacheEntry>>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ModelFileFingerprint {
    size_bytes: u64,
    modified_at: Option<SystemTime>,
}

#[derive(Clone, Debug)]
struct ModelIntegrityCacheEntry {
    fingerprint: ModelFileFingerprint,
    sha256: String,
}

enum ResolvedModel {
    BuiltIn(ModelSpec),
    UserImport(ImportedModelManifest),
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredDownloadConsent {
    model_id: String,
    consent: TranslationDownloadConsent,
}

impl ResolvedModel {
    fn id(&self) -> &str {
        match self {
            Self::BuiltIn(spec) => &spec.id,
            Self::UserImport(manifest) => &manifest.id,
        }
    }

    fn file_name(&self) -> &str {
        match self {
            Self::BuiltIn(spec) => &spec.file_name,
            Self::UserImport(manifest) => &manifest.file_name,
        }
    }

    fn inference_profile(&self) -> TranslationInferenceProfile {
        match self {
            Self::BuiltIn(spec) => spec.inference_profile,
            Self::UserImport(manifest) => manifest.inference_profile,
        }
    }

    fn size_bytes(&self) -> u64 {
        match self {
            Self::BuiltIn(spec) => spec.size_bytes,
            Self::UserImport(manifest) => manifest.size_bytes,
        }
    }

    fn download_consent_policy(&self) -> Option<&DownloadConsentPolicy> {
        match self {
            Self::BuiltIn(spec) => spec.download_consent_policy.as_ref(),
            Self::UserImport(_) => None,
        }
    }

    fn sha256(&self) -> &str {
        match self {
            Self::BuiltIn(spec) => &spec.sha256,
            Self::UserImport(manifest) => &manifest.sha256,
        }
    }
}

impl TranslationManager {
    pub fn with_paths_and_client(
        model_dir: PathBuf,
        runtime_path: PathBuf,
        http_factory: Arc<dyn TranslationHttpClientFactory>,
    ) -> Result<Self, TranslationError> {
        Self::with_catalog(
            model_dir,
            runtime_path,
            vec![
                ModelSpec::hy_mt_q4_builtin(),
                ModelSpec::hy_mt_q8_builtin(),
                ModelSpec::qwen3_builtin(),
            ],
            http_factory,
        )
    }

    fn with_catalog(
        model_dir: PathBuf,
        runtime_path: PathBuf,
        builtins: Vec<ModelSpec>,
        http_factory: Arc<dyn TranslationHttpClientFactory>,
    ) -> Result<Self, TranslationError> {
        if model_dir.as_os_str().is_empty() {
            return Err(TranslationError::invalid("离线翻译模型目录不能为空"));
        }
        Ok(Self {
            inner: Arc::new(TranslationManagerInner {
                model_dir,
                runtime_path,
                builtins,
                http_factory,
                downloads: Arc::new(Mutex::new(HashMap::new())),
                runtime: Mutex::new(RuntimeState::default()),
                integrity_cache: Mutex::new(HashMap::new()),
            }),
        })
    }

    #[cfg(test)]
    pub(super) fn with_test_catalog(
        model_dir: PathBuf,
        runtime_path: PathBuf,
        builtins: Vec<ModelSpec>,
        http_factory: Arc<dyn TranslationHttpClientFactory>,
    ) -> Result<Self, TranslationError> {
        Self::with_catalog(model_dir, runtime_path, builtins, http_factory)
    }

    pub async fn catalog(&self) -> Result<TranslationCatalog, TranslationError> {
        let mut models = Vec::new();
        for spec in &self.inner.builtins {
            let installed = self
                .model_file_is_valid(&spec.file_name, spec.size_bytes, &spec.sha256)
                .await
                .unwrap_or(false);
            let consent_satisfied = spec
                .download_consent_policy
                .as_ref()
                .map(|policy| {
                    stored_download_consent_is_valid(&self.inner.model_dir, &spec.id, policy)
                })
                .unwrap_or(true);
            models.push(spec.as_model(installed, consent_satisfied));
        }
        for manifest in read_imported_manifests(&self.inner.model_dir)? {
            let installed = self
                .model_file_is_valid(&manifest.file_name, manifest.size_bytes, &manifest.sha256)
                .await
                .unwrap_or(false);
            models.push(manifest.as_model(installed));
        }
        Ok(TranslationCatalog { models })
    }

    pub async fn status(&self) -> Result<TranslationStatus, TranslationError> {
        let models = self.catalog().await?.models;
        let mut downloads = self
            .inner
            .downloads
            .lock()
            .await
            .values()
            .map(|entry| entry.status.clone())
            .collect::<Vec<_>>();
        downloads.sort_by(|left, right| left.model_id.cmp(&right.model_id));
        let mut runtime_state = self.inner.runtime.lock().await;
        let runtime = runtime::status(&mut runtime_state, &self.inner.runtime_path).await;
        Ok(TranslationStatus {
            models,
            downloads,
            runtime,
        })
    }

    pub async fn download_start(
        &self,
        model_id: &str,
        consent: Option<&TranslationDownloadConsent>,
    ) -> Result<TranslationDownloadStatus, TranslationError> {
        let spec = self
            .inner
            .builtins
            .iter()
            .find(|spec| spec.id == model_id)
            .cloned()
            .ok_or_else(|| TranslationError::not_found("未找到可下载的离线翻译模型"))?;
        if let Some(policy) = spec.download_consent_policy.as_ref() {
            let consent = validate_download_consent(policy, consent)?;
            write_download_consent_atomically(&self.inner.model_dir, &spec.id, consent)?;
        }
        if self
            .model_file_is_valid(&spec.file_name, spec.size_bytes, &spec.sha256)
            .await?
        {
            return Ok(TranslationDownloadStatus {
                model_id: spec.id,
                phase: TranslationDownloadPhase::Completed,
                bytes_downloaded: spec.size_bytes,
                total_bytes: spec.size_bytes,
                resumed: false,
                error: None,
            });
        }
        let mut downloads = self.inner.downloads.lock().await;
        if let Some(existing) = downloads.get(model_id) {
            if existing.status.phase.is_active() {
                return Err(TranslationError::new(
                    TranslationErrorCode::AlreadyRunning,
                    "该离线翻译模型已在下载",
                ));
            }
        }
        let part_bytes = part_path(&self.inner.model_dir, &spec.file_name)
            .metadata()
            .map(|metadata| metadata.len())
            .unwrap_or(0)
            .min(spec.size_bytes);
        let status = TranslationDownloadStatus {
            model_id: spec.id.clone(),
            phase: TranslationDownloadPhase::Queued,
            bytes_downloaded: part_bytes,
            total_bytes: spec.size_bytes,
            resumed: part_bytes > 0,
            error: None,
        };
        let cancel = Arc::new(DownloadCancellation::default());
        downloads.insert(
            model_id.to_string(),
            DownloadEntry {
                status: status.clone(),
                cancel: Arc::clone(&cancel),
            },
        );
        drop(downloads);

        let inner = Arc::clone(&self.inner);
        tokio::spawn(async move {
            run_download(
                inner.model_dir.clone(),
                spec,
                Arc::clone(&inner.http_factory),
                Arc::clone(&inner.downloads),
                cancel,
            )
            .await;
        });
        Ok(status)
    }

    pub async fn download_status(
        &self,
        model_id: &str,
    ) -> Result<Option<TranslationDownloadStatus>, TranslationError> {
        if !self.inner.builtins.iter().any(|spec| spec.id == model_id) {
            return Err(TranslationError::not_found("未找到可下载的离线翻译模型"));
        }
        Ok(self
            .inner
            .downloads
            .lock()
            .await
            .get(model_id)
            .map(|entry| entry.status.clone()))
    }

    pub async fn download_cancel(
        &self,
        model_id: &str,
    ) -> Result<TranslationDownloadStatus, TranslationError> {
        let downloads = self.inner.downloads.lock().await;
        let entry = downloads
            .get(model_id)
            .ok_or_else(|| TranslationError::not_found("该模型没有可取消的下载任务"))?;
        if entry.status.phase.is_active() {
            entry.cancel.cancel();
        }
        Ok(entry.status.clone())
    }

    pub async fn import_model(
        &self,
        source: PathBuf,
        display_name: Option<String>,
    ) -> Result<TranslationModel, TranslationError> {
        validate_import_source(&source)?;
        let model_dir = self.inner.model_dir.clone();
        let fallback_name = source
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("GGUF 本地模型")
            .to_string();
        let name = normalize_display_name(display_name.as_deref().unwrap_or(&fallback_name))?;
        tokio::task::spawn_blocking(move || {
            import_into_managed_directory(&model_dir, &source, &name)
        })
        .await
        .map_err(|error| {
            TranslationError::new(
                TranslationErrorCode::Io,
                format!("导入离线翻译模型任务异常结束：{error}"),
            )
        })?
    }

    pub async fn delete_model(&self, model_id: &str) -> Result<(), TranslationError> {
        if let Some(entry) = self.inner.downloads.lock().await.get(model_id) {
            if entry.status.phase.is_active() {
                return Err(TranslationError::new(
                    TranslationErrorCode::AlreadyRunning,
                    "请先取消模型下载，再删除模型",
                ));
            }
        }
        let resolved = self.resolve_model(model_id)?;
        {
            let mut runtime_state = self.inner.runtime.lock().await;
            if runtime_state.model_id() == Some(resolved.id()) {
                runtime::stop(&mut runtime_state, &self.inner.runtime_path).await;
            }
        }
        let target = self.inner.model_dir.join(resolved.file_name());
        remove_file_if_present(&target, "删除离线翻译模型失败")?;
        remove_file_if_present(
            &part_path(&self.inner.model_dir, resolved.file_name()),
            "删除离线翻译模型分片失败",
        )?;
        if matches!(resolved, ResolvedModel::UserImport(_)) {
            remove_file_if_present(
                &manifest_path(&self.inner.model_dir, model_id),
                "删除导入模型记录失败",
            )?;
        }
        self.inner.integrity_cache.lock().await.remove(&target);
        self.inner.downloads.lock().await.remove(model_id);
        Ok(())
    }

    pub async fn translate(
        &self,
        request: TranslationRequest,
    ) -> Result<TranslationResult, TranslationError> {
        validate_translation_request(&request)?;
        let resolved = self.resolve_model(&request.model_id)?;
        let model_path = self.inner.model_dir.join(resolved.file_name());
        if !self
            .model_file_is_valid(
                resolved.file_name(),
                resolved.size_bytes(),
                resolved.sha256(),
            )
            .await?
        {
            return Err(TranslationError::new(
                if model_path.is_file() {
                    TranslationErrorCode::IntegrityMismatch
                } else {
                    TranslationErrorCode::NotInstalled
                },
                "离线翻译模型缺失或完整性校验失败，请重新下载或导入",
            ));
        }
        if let Some(policy) = resolved.download_consent_policy() {
            if !stored_download_consent_is_valid(&self.inner.model_dir, resolved.id(), policy) {
                return Err(TranslationError::invalid(
                    "使用该模型前必须重新确认当前许可证、Acceptable Use Policy 和地域资格",
                ));
            }
        }
        let mut runtime_state = self.inner.runtime.lock().await;
        runtime::translate(
            &mut runtime_state,
            &self.inner.runtime_path,
            resolved.id(),
            &model_path,
            resolved.inference_profile(),
            request,
        )
        .await
    }

    pub async fn stop(&self) -> Result<super::types::TranslationRuntimeStatus, TranslationError> {
        let mut runtime_state = self.inner.runtime.lock().await;
        Ok(runtime::stop(&mut runtime_state, &self.inner.runtime_path).await)
    }

    /// Application-exit cleanup: preserve resumable `.part` files while
    /// stopping every active download and the local inference process tree.
    pub async fn shutdown_cleanup(&self) -> super::types::TranslationRuntimeStatus {
        {
            let downloads = self.inner.downloads.lock().await;
            for entry in downloads.values() {
                if entry.status.phase.is_active() {
                    entry.cancel.cancel();
                }
            }
        }
        let mut runtime_state = self.inner.runtime.lock().await;
        runtime::stop(&mut runtime_state, &self.inner.runtime_path).await
    }

    fn resolve_model(&self, model_id: &str) -> Result<ResolvedModel, TranslationError> {
        if let Some(spec) = self.inner.builtins.iter().find(|spec| spec.id == model_id) {
            return Ok(ResolvedModel::BuiltIn(spec.clone()));
        }
        read_imported_manifests(&self.inner.model_dir)?
            .into_iter()
            .find(|manifest| manifest.id == model_id)
            .map(ResolvedModel::UserImport)
            .ok_or_else(|| TranslationError::not_found("未找到离线翻译模型"))
    }

    async fn model_file_is_valid(
        &self,
        file_name: &str,
        expected_size: u64,
        expected_sha256: &str,
    ) -> Result<bool, TranslationError> {
        let path = self.inner.model_dir.join(file_name);
        let metadata = match tokio::fs::metadata(&path).await {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                self.inner.integrity_cache.lock().await.remove(&path);
                return Ok(false);
            }
            Err(error) => {
                return Err(TranslationError::io("读取离线翻译模型元数据失败", error));
            }
        };
        if !metadata.is_file() || metadata.len() != expected_size {
            self.inner.integrity_cache.lock().await.remove(&path);
            return Ok(false);
        }
        let fingerprint = ModelFileFingerprint {
            size_bytes: metadata.len(),
            modified_at: metadata.modified().ok(),
        };
        if self
            .inner
            .integrity_cache
            .lock()
            .await
            .get(&path)
            .is_some_and(|entry| {
                entry.fingerprint == fingerprint
                    && entry.sha256.eq_ignore_ascii_case(expected_sha256)
            })
        {
            return Ok(true);
        }

        let hash_path = path.clone();
        let actual_sha256 = tokio::task::spawn_blocking(move || sha256_file(&hash_path))
            .await
            .map_err(|error| {
                TranslationError::new(
                    TranslationErrorCode::IntegrityMismatch,
                    format!("模型完整性校验任务异常结束：{error}"),
                )
            })??;
        let valid = actual_sha256.eq_ignore_ascii_case(expected_sha256);
        let mut cache = self.inner.integrity_cache.lock().await;
        if valid {
            cache.insert(
                path,
                ModelIntegrityCacheEntry {
                    fingerprint,
                    sha256: actual_sha256,
                },
            );
        } else {
            cache.remove(&path);
        }
        Ok(valid)
    }
}

fn validate_import_source(source: &Path) -> Result<(), TranslationError> {
    if !source.is_file() {
        return Err(TranslationError::invalid("请选择存在的 GGUF 模型文件"));
    }
    let is_gguf = source
        .extension()
        .and_then(|value| value.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("gguf"))
        .unwrap_or(false);
    if !is_gguf {
        return Err(TranslationError::invalid("只能导入 .gguf 离线模型文件"));
    }
    Ok(())
}

fn normalize_display_name(value: &str) -> Result<String, TranslationError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(TranslationError::invalid("模型显示名称不能为空"));
    }
    if value.chars().count() > 100 {
        return Err(TranslationError::invalid("模型显示名称不能超过 100 个字符"));
    }
    Ok(value.to_string())
}

fn import_into_managed_directory(
    model_dir: &Path,
    source: &Path,
    display_name: &str,
) -> Result<TranslationModel, TranslationError> {
    std::fs::create_dir_all(model_dir)
        .map_err(|error| TranslationError::io("创建离线翻译模型目录失败", error))?;
    let temp = model_dir.join(format!("import-{}.part", Uuid::new_v4()));
    std::fs::copy(source, &temp)
        .map_err(|error| TranslationError::io("复制导入的 GGUF 模型失败", error))?;
    let result = (|| {
        let size_bytes = temp
            .metadata()
            .map_err(|error| TranslationError::io("读取导入模型大小失败", error))?
            .len();
        if size_bytes == 0 {
            return Err(TranslationError::invalid("不能导入空的 GGUF 模型文件"));
        }
        let sha256 = sha256_file(&temp)?;
        let id = format!("user-import-{sha256}");
        let file_name = format!("{id}.gguf");
        let target = model_dir.join(&file_name);
        replace_file_atomically(&temp, &target)
            .map_err(|error| TranslationError::io("安装导入的 GGUF 模型失败", error))?;
        let manifest = ImportedModelManifest {
            id: id.clone(),
            display_name: display_name.to_string(),
            file_name,
            size_bytes,
            sha256,
            source: TranslationModelSource::UserImport,
            inference_profile: infer_import_profile(source, display_name),
        };
        write_manifest_atomically(model_dir, &manifest)?;
        Ok(manifest.as_model(true))
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}

fn infer_import_profile(source: &Path, display_name: &str) -> TranslationInferenceProfile {
    let file_name = source
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    let normalized = format!("{file_name} {display_name}")
        .to_ascii_lowercase()
        .replace(['_', ' ', '.'], "");
    if normalized.contains("hy-mt") || normalized.contains("hymt") {
        TranslationInferenceProfile::HyMt
    } else {
        TranslationInferenceProfile::Generic
    }
}

fn manifest_path(model_dir: &Path, model_id: &str) -> PathBuf {
    model_dir.join(format!("{model_id}.model.json"))
}

fn download_consent_path(model_dir: &Path, model_id: &str) -> PathBuf {
    model_dir.join(format!("{model_id}.license-consent.json"))
}

fn validate_download_consent<'a>(
    policy: &DownloadConsentPolicy,
    consent: Option<&'a TranslationDownloadConsent>,
) -> Result<&'a TranslationDownloadConsent, TranslationError> {
    let consent = consent.ok_or_else(|| {
        TranslationError::invalid(
            "下载该模型前必须明确接受其许可证、Acceptable Use Policy 和地域限制",
        )
    })?;
    if consent.license_revision.trim() != policy.license_revision {
        return Err(TranslationError::invalid(
            "许可确认版本与当前固定模型 revision 不一致，请重新阅读并确认",
        ));
    }
    if !consent.license_accepted {
        return Err(TranslationError::invalid("必须接受完整模型许可证"));
    }
    if !consent.acceptable_use_policy_accepted {
        return Err(TranslationError::invalid(
            "必须接受许可证中的 Acceptable Use Policy",
        ));
    }
    if !consent.territory_eligible {
        return Err(TranslationError::invalid(
            "该模型不能在欧盟、英国或韩国下载或使用",
        ));
    }
    Ok(consent)
}

fn stored_download_consent_is_valid(
    model_dir: &Path,
    model_id: &str,
    policy: &DownloadConsentPolicy,
) -> bool {
    let Ok(bytes) = std::fs::read(download_consent_path(model_dir, model_id)) else {
        return false;
    };
    let Ok(stored) = serde_json::from_slice::<StoredDownloadConsent>(&bytes) else {
        return false;
    };
    stored.model_id == model_id && validate_download_consent(policy, Some(&stored.consent)).is_ok()
}

fn write_download_consent_atomically(
    model_dir: &Path,
    model_id: &str,
    consent: &TranslationDownloadConsent,
) -> Result<(), TranslationError> {
    std::fs::create_dir_all(model_dir)
        .map_err(|error| TranslationError::io("创建离线翻译模型目录失败", error))?;
    let target = download_consent_path(model_dir, model_id);
    let part = model_dir.join(format!("{model_id}.{}.consent.part", Uuid::new_v4()));
    let bytes = serde_json::to_vec_pretty(&StoredDownloadConsent {
        model_id: model_id.to_string(),
        consent: consent.clone(),
    })
    .map_err(|error| {
        TranslationError::new(
            TranslationErrorCode::Io,
            format!("序列化模型许可确认失败：{error}"),
        )
    })?;
    std::fs::write(&part, bytes)
        .map_err(|error| TranslationError::io("写入模型许可确认失败", error))?;
    if let Err(error) = replace_file_atomically(&part, &target) {
        let _ = std::fs::remove_file(&part);
        return Err(TranslationError::io("安装模型许可确认失败", error));
    }
    Ok(())
}

fn write_manifest_atomically(
    model_dir: &Path,
    manifest: &ImportedModelManifest,
) -> Result<(), TranslationError> {
    let target = manifest_path(model_dir, &manifest.id);
    let part = model_dir.join(format!("{}.{}.part", manifest.id, Uuid::new_v4()));
    let bytes = serde_json::to_vec_pretty(manifest).map_err(|error| {
        TranslationError::new(
            TranslationErrorCode::Io,
            format!("序列化导入模型记录失败：{error}"),
        )
    })?;
    std::fs::write(&part, bytes)
        .map_err(|error| TranslationError::io("写入导入模型记录失败", error))?;
    replace_file_atomically(&part, &target)
        .map_err(|error| TranslationError::io("安装导入模型记录失败", error))?;
    Ok(())
}

fn remove_file_if_present(path: &Path, context: &str) -> Result<(), TranslationError> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(TranslationError::io(context, error)),
    }
}

fn validate_translation_request(request: &TranslationRequest) -> Result<(), TranslationError> {
    if request.model_id.trim().is_empty() {
        return Err(TranslationError::invalid("未选择离线翻译模型"));
    }
    if request.text.trim().is_empty() {
        return Err(TranslationError::invalid("待翻译文本不能为空"));
    }
    if request.text.chars().count() > 12_000 {
        return Err(TranslationError::invalid(
            "单次离线翻译不能超过 12,000 个字符",
        ));
    }
    let target = request.target_language.trim();
    if target.is_empty() || target.chars().count() > 80 {
        return Err(TranslationError::invalid("目标语言无效"));
    }
    if request
        .source_language
        .as_deref()
        .map(|value| value.chars().count() > 80)
        .unwrap_or(false)
    {
        return Err(TranslationError::invalid("源语言无效"));
    }
    Ok(())
}
