use super::{
    catalog::ModelSpec,
    error::{TranslationError, TranslationErrorCode},
    types::{TranslationDownloadPhase, TranslationDownloadStatus},
};
use futures_util::StreamExt;
use reqwest::{header, StatusCode};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::OpenOptions,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use tokio::sync::{Mutex, Notify};

pub trait TranslationHttpClientFactory: Send + Sync {
    fn create(&self) -> Result<reqwest::Client, String>;
}

pub(crate) struct DownloadEntry {
    pub status: TranslationDownloadStatus,
    pub cancel: Arc<DownloadCancellation>,
}

#[derive(Default)]
pub(crate) struct DownloadCancellation {
    cancelled: AtomicBool,
    notify: Notify,
}

impl DownloadCancellation {
    pub fn cancel(&self) {
        if !self.cancelled.swap(true, Ordering::Relaxed) {
            // A download has at most one network wait at a time. `notify_one`
            // retains a permit, so cancellation cannot be lost between the
            // flag check and registering the async waiter.
            self.notify.notify_one();
        }
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Relaxed)
    }

    async fn cancelled(&self) {
        if self.is_cancelled() {
            return;
        }
        self.notify.notified().await;
    }
}

pub(crate) type DownloadRegistry = Arc<Mutex<HashMap<String, DownloadEntry>>>;

enum DownloadFailure {
    Cancelled,
    Error(TranslationError),
}

impl From<TranslationError> for DownloadFailure {
    fn from(value: TranslationError) -> Self {
        Self::Error(value)
    }
}

pub(crate) fn part_path(model_dir: &Path, file_name: &str) -> PathBuf {
    model_dir.join(format!("{file_name}.part"))
}

pub(crate) async fn run_download(
    model_dir: PathBuf,
    spec: ModelSpec,
    factory: Arc<dyn TranslationHttpClientFactory>,
    downloads: DownloadRegistry,
    cancel: Arc<DownloadCancellation>,
) {
    let result = download_to_managed_path(&model_dir, &spec, factory, &downloads, &cancel).await;
    let mut registry = downloads.lock().await;
    let Some(entry) = registry.get_mut(&spec.id) else {
        return;
    };
    match result {
        Ok(()) => {
            entry.status.phase = TranslationDownloadPhase::Completed;
            entry.status.bytes_downloaded = spec.size_bytes;
            entry.status.error = None;
        }
        Err(DownloadFailure::Cancelled) => {
            entry.status.phase = TranslationDownloadPhase::Cancelled;
            entry.status.error = None;
            entry.status.bytes_downloaded = part_path(&model_dir, &spec.file_name)
                .metadata()
                .map(|metadata| metadata.len())
                .unwrap_or(entry.status.bytes_downloaded);
        }
        Err(DownloadFailure::Error(error)) => {
            entry.status.phase = TranslationDownloadPhase::Failed;
            entry.status.error = Some(error.to_string());
            entry.status.bytes_downloaded = part_path(&model_dir, &spec.file_name)
                .metadata()
                .map(|metadata| metadata.len())
                .unwrap_or(entry.status.bytes_downloaded);
        }
    }
}

async fn download_to_managed_path(
    model_dir: &Path,
    spec: &ModelSpec,
    factory: Arc<dyn TranslationHttpClientFactory>,
    downloads: &DownloadRegistry,
    cancel: &Arc<DownloadCancellation>,
) -> Result<(), DownloadFailure> {
    std::fs::create_dir_all(model_dir)
        .map_err(|error| TranslationError::io("创建离线翻译模型目录失败", error))?;
    let part = part_path(model_dir, &spec.file_name);
    let target = model_dir.join(&spec.file_name);
    let mut offset = part.metadata().map(|metadata| metadata.len()).unwrap_or(0);
    if offset > spec.size_bytes {
        std::fs::remove_file(&part)
            .map_err(|error| TranslationError::io("清理异常模型分片失败", error))?;
        offset = 0;
    }
    update_download(downloads, &spec.id, |status| {
        status.phase = TranslationDownloadPhase::Downloading;
        status.bytes_downloaded = offset;
        status.resumed = offset > 0;
        status.error = None;
    })
    .await;

    if offset < spec.size_bytes {
        let client = factory.create().map_err(|error| {
            TranslationError::new(
                TranslationErrorCode::DownloadFailed,
                format!("创建模型下载客户端失败：{error}"),
            )
        })?;
        let mut failures = Vec::new();
        let mut complete = false;
        for url in &spec.urls {
            if cancel.is_cancelled() {
                return Err(DownloadFailure::Cancelled);
            }
            offset = part.metadata().map(|metadata| metadata.len()).unwrap_or(0);
            match download_from_url(
                &client,
                url,
                &part,
                spec.size_bytes,
                offset,
                downloads,
                &spec.id,
                cancel,
            )
            .await
            {
                Ok(()) => {
                    complete = true;
                    break;
                }
                Err(DownloadFailure::Cancelled) => return Err(DownloadFailure::Cancelled),
                Err(DownloadFailure::Error(error)) => failures.push(error.to_string()),
            }
        }
        if !complete {
            return Err(TranslationError::new(
                TranslationErrorCode::DownloadFailed,
                format!("所有离线模型下载渠道均失败：{}", failures.join("；")),
            )
            .into());
        }
    }

    if cancel.is_cancelled() {
        return Err(DownloadFailure::Cancelled);
    }
    update_download(downloads, &spec.id, |status| {
        status.phase = TranslationDownloadPhase::Verifying;
        status.bytes_downloaded = spec.size_bytes;
    })
    .await;

    let part_for_hash = part.clone();
    let cancel_for_hash = Arc::clone(cancel);
    // Hashing is intentionally offloaded because the production model is about 640 MB.
    let hash_result = tokio::task::spawn_blocking(move || {
        sha256_file_with_cancel(&part_for_hash, Some(&cancel_for_hash))
    })
    .await
    .map_err(|error| {
        TranslationError::new(
            TranslationErrorCode::IntegrityMismatch,
            format!("模型校验任务异常结束：{error}"),
        )
    })?;
    if cancel.is_cancelled() {
        return Err(DownloadFailure::Cancelled);
    }
    let actual_sha = hash_result?;
    if !actual_sha.eq_ignore_ascii_case(&spec.sha256) {
        let _ = std::fs::remove_file(&part);
        return Err(TranslationError::new(
            TranslationErrorCode::IntegrityMismatch,
            format!(
                "模型 SHA-256 校验失败，期望 {}，实际 {actual_sha}",
                spec.sha256
            ),
        )
        .into());
    }
    replace_file_atomically(&part, &target)
        .map_err(|error| TranslationError::io("安装已校验的离线模型失败", error))?;
    Ok(())
}

#[cfg(windows)]
pub(crate) fn replace_file_atomically(source: &Path, target: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let target = target
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let moved = unsafe {
        MoveFileExW(
            source.as_ptr(),
            target.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if moved == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
pub(crate) fn replace_file_atomically(source: &Path, target: &Path) -> std::io::Result<()> {
    std::fs::rename(source, target)
}

async fn download_from_url(
    client: &reqwest::Client,
    url: &str,
    part: &Path,
    expected_size: u64,
    offset: u64,
    downloads: &DownloadRegistry,
    model_id: &str,
    cancel: &DownloadCancellation,
) -> Result<(), DownloadFailure> {
    let mut request = client.get(url);
    if offset > 0 {
        request = request.header(header::RANGE, format!("bytes={offset}-"));
    }
    let response = tokio::select! {
        response = request.send() => response.map_err(|error| {
            TranslationError::new(
                TranslationErrorCode::DownloadFailed,
                format!("请求模型下载渠道失败：{error}"),
            )
        })?,
        _ = cancel.cancelled() => return Err(DownloadFailure::Cancelled),
    };
    let status = response.status();
    if !status.is_success() {
        return Err(TranslationError::new(
            TranslationErrorCode::DownloadFailed,
            format!("模型下载渠道返回 HTTP {status}"),
        )
        .into());
    }

    let append = offset > 0 && status == StatusCode::PARTIAL_CONTENT;
    if status == StatusCode::PARTIAL_CONTENT {
        let expected_offset = if append { offset } else { 0 };
        let content_range = response
            .headers()
            .get(header::CONTENT_RANGE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default();
        if !content_range.starts_with(&format!("bytes {expected_offset}-")) {
            return Err(TranslationError::new(
                TranslationErrorCode::DownloadFailed,
                "下载渠道返回了与本地分片不匹配的 Content-Range",
            )
            .into());
        }
    } else if status != StatusCode::OK && !(offset == 0 && status == StatusCode::PARTIAL_CONTENT) {
        return Err(TranslationError::new(
            TranslationErrorCode::DownloadFailed,
            "下载渠道不支持可验证的断点续传",
        )
        .into());
    }
    if offset > 0 && !append {
        update_download(downloads, model_id, |download| {
            download.bytes_downloaded = 0;
            download.resumed = false;
        })
        .await;
    }

    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .append(append)
        .truncate(!append)
        .open(part)
        .map_err(|error| TranslationError::io("打开模型下载分片失败", error))?;
    let mut written = if append { offset } else { 0 };
    let mut stream = response.bytes_stream();
    loop {
        let next = tokio::select! {
            chunk = stream.next() => chunk,
            _ = cancel.cancelled() => {
                file.flush().map_err(|error| {
                    TranslationError::io("保存已下载分片失败", error)
                })?;
                return Err(DownloadFailure::Cancelled);
            }
        };
        let Some(chunk) = next else {
            break;
        };
        let chunk = chunk.map_err(|error| {
            TranslationError::new(
                TranslationErrorCode::DownloadFailed,
                format!("读取模型下载流失败：{error}"),
            )
        })?;
        if written.saturating_add(chunk.len() as u64) > expected_size {
            return Err(TranslationError::new(
                TranslationErrorCode::DownloadFailed,
                "模型下载数据超过目录中声明的大小",
            )
            .into());
        }
        file.write_all(&chunk)
            .map_err(|error| TranslationError::io("写入模型下载分片失败", error))?;
        written += chunk.len() as u64;
        update_download(downloads, model_id, |download| {
            download.bytes_downloaded = written;
        })
        .await;
    }
    file.flush()
        .map_err(|error| TranslationError::io("刷新模型下载分片失败", error))?;
    if written != expected_size {
        return Err(TranslationError::new(
            TranslationErrorCode::DownloadFailed,
            format!("模型下载不完整：已下载 {written}，期望 {expected_size}"),
        )
        .into());
    }
    Ok(())
}

async fn update_download(
    downloads: &DownloadRegistry,
    model_id: &str,
    update: impl FnOnce(&mut TranslationDownloadStatus),
) {
    let mut registry = downloads.lock().await;
    if let Some(entry) = registry.get_mut(model_id) {
        update(&mut entry.status);
    }
}

pub(crate) fn sha256_file(path: &Path) -> Result<String, TranslationError> {
    sha256_file_with_cancel(path, None)
}

fn sha256_file_with_cancel(
    path: &Path,
    cancel: Option<&DownloadCancellation>,
) -> Result<String, TranslationError> {
    let mut file = std::fs::File::open(path)
        .map_err(|error| TranslationError::io("打开模型以计算 SHA-256 失败", error))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        if cancel
            .map(DownloadCancellation::is_cancelled)
            .unwrap_or(false)
        {
            return Err(TranslationError::new(
                TranslationErrorCode::DownloadFailed,
                "模型校验已取消",
            ));
        }
        let read = file
            .read(&mut buffer)
            .map_err(|error| TranslationError::io("读取模型以计算 SHA-256 失败", error))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}
