use super::*;
use crate::services::translation::catalog::ModelSpec;
use axum::{
    body::Body,
    extract::State,
    http::{header::RANGE, HeaderMap, StatusCode},
    response::Response,
    routing::get,
    Router,
};
use futures_util::stream;
use std::convert::Infallible;
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tempfile::TempDir;
use tokio::net::TcpListener;

#[derive(Default)]
struct TestHttpClientFactory;

impl TranslationHttpClientFactory for TestHttpClientFactory {
    fn create(&self) -> Result<reqwest::Client, String> {
        reqwest::Client::builder()
            .no_proxy()
            .build()
            .map_err(|error| error.to_string())
    }
}

fn test_manager(temp: &TempDir, specs: Vec<ModelSpec>) -> TranslationManager {
    TranslationManager::with_test_catalog(
        temp.path().join("models"),
        temp.path().join("missing-llama-server.exe"),
        specs,
        Arc::new(TestHttpClientFactory),
    )
    .expect("create translation manager")
}

#[tokio::test]
async fn catalog_exposes_the_pinned_qwen_download() {
    let temp = TempDir::new().expect("temp directory");
    let manager = TranslationManager::with_test_catalog(
        temp.path().join("models"),
        temp.path().join("missing-llama-server.exe"),
        vec![ModelSpec::qwen3_builtin()],
        Arc::new(TestHttpClientFactory),
    )
    .expect("create translation manager");

    let catalog = manager.catalog().await.expect("read catalog");
    let model = catalog.models.first().expect("built-in model");

    assert_eq!(model.id, "qwen3-0.6b-q8-0");
    assert_eq!(model.file_name, "Qwen3-0.6B-Q8_0.gguf");
    assert_eq!(model.size_bytes, 639_446_688);
    assert_eq!(
        model.sha256,
        "9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031"
    );
    assert_eq!(model.source, TranslationModelSource::BuiltIn);
    assert_eq!(model.inference_profile, TranslationInferenceProfile::Qwen3);
    assert_eq!(model.license_name, "Apache-2.0");
    assert_eq!(
        model.revision.as_deref(),
        Some("23749fefcc72300e3a2ad315e1317431b06b590a")
    );
    assert!(model.downloadable);
    assert!(model.recommended);
    assert!(!model.installed);

    let spec = ModelSpec::qwen3_builtin();
    assert!(spec
        .urls
        .iter()
        .all(|url| !url.contains("/resolve/master/")));
    assert!(spec
        .urls
        .iter()
        .any(|url| url.contains("32d6327dd2a5b42f7ce0fe5e6b6f25346b0ee8f9")));
}

#[tokio::test]
async fn catalog_rejects_a_same_size_builtin_with_the_wrong_sha256() {
    let temp = TempDir::new().expect("temp directory");
    let spec = ModelSpec::test_model(
        "tiny-model",
        "tiny.gguf",
        3,
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        vec![],
    );
    let manager = test_manager(&temp, vec![spec]);
    let model_dir = temp.path().join("models");
    std::fs::create_dir_all(&model_dir).expect("create model directory");
    std::fs::write(model_dir.join("tiny.gguf"), b"abd").expect("write corrupt model");

    let catalog = manager.catalog().await.expect("read catalog");

    assert!(!catalog.models[0].installed);
}

#[tokio::test]
async fn importing_a_gguf_creates_a_managed_user_model() {
    let temp = TempDir::new().expect("temp directory");
    let source = temp.path().join("HY-MT-test.gguf");
    std::fs::write(&source, b"user supplied gguf").expect("write source model");
    let manager = test_manager(&temp, vec![ModelSpec::qwen3_builtin()]);

    let imported = manager
        .import_model(source.clone(), Some("HY-MT 本地导入".to_string()))
        .await
        .expect("import model");

    assert_eq!(imported.display_name, "HY-MT 本地导入");
    assert_eq!(imported.source, TranslationModelSource::UserImport);
    assert_eq!(
        imported.inference_profile,
        TranslationInferenceProfile::HyMt
    );
    assert!(imported.installed);
    assert!(!imported.downloadable);
    assert!(imported.license_name.contains("用户自行提供"));
    assert!(
        source.exists(),
        "import must not move the user's source file"
    );

    let catalog = manager.catalog().await.expect("read catalog");
    assert!(catalog.models.iter().any(|model| model.id == imported.id));
}

#[tokio::test]
async fn catalog_rejects_a_tampered_imported_model_even_when_size_is_unchanged() {
    let temp = TempDir::new().expect("temp directory");
    let source = temp.path().join("HY-MT-test.gguf");
    std::fs::write(&source, b"user supplied gguf").expect("write source model");
    let manager = test_manager(&temp, vec![]);
    let imported = manager
        .import_model(source, Some("HY-MT 本地导入".to_string()))
        .await
        .expect("import model");
    let managed_path = temp.path().join("models").join(&imported.file_name);
    std::fs::write(&managed_path, b"user supplied ggug").expect("tamper managed model");

    let catalog = manager.catalog().await.expect("read catalog");

    assert!(!catalog.models[0].installed);
}

#[tokio::test]
async fn reimporting_the_same_model_repairs_a_corrupt_managed_copy() {
    let temp = TempDir::new().expect("temp directory");
    let source = temp.path().join("HY-MT-test.gguf");
    std::fs::write(&source, b"user supplied gguf").expect("write source model");
    let manager = test_manager(&temp, vec![]);
    let imported = manager
        .import_model(source.clone(), Some("HY-MT 本地导入".to_string()))
        .await
        .expect("import model");
    let managed_path = temp.path().join("models").join(&imported.file_name);
    std::fs::write(&managed_path, b"user supplied ggug").expect("tamper managed model");

    let repaired = manager
        .import_model(source, Some("HY-MT 本地导入".to_string()))
        .await
        .expect("reimport model");

    assert!(repaired.installed);
    assert_eq!(std::fs::read(managed_path).unwrap(), b"user supplied gguf");
    assert!(manager.catalog().await.expect("read catalog").models[0].installed);
}

#[tokio::test]
async fn importing_rejects_files_that_are_not_gguf() {
    let temp = TempDir::new().expect("temp directory");
    let source = temp.path().join("model.bin");
    std::fs::write(&source, b"not a gguf").expect("write source model");
    let manager = test_manager(&temp, vec![]);

    let error = manager
        .import_model(source, None)
        .await
        .expect_err("non-GGUF import must fail");

    assert_eq!(error.code(), TranslationErrorCode::InvalidArgument);
}

#[derive(Clone)]
struct RangeServerState {
    bytes: Arc<Vec<u8>>,
    ranges: Arc<Mutex<Vec<Option<String>>>>,
}

async fn range_response(
    State(state): State<RangeServerState>,
    headers: HeaderMap,
) -> Response<Body> {
    let range = headers
        .get(RANGE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    state.ranges.lock().expect("range lock").push(range.clone());
    let start = range
        .as_deref()
        .and_then(|value| value.strip_prefix("bytes="))
        .and_then(|value| value.strip_suffix('-'))
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    let status = if start > 0 {
        StatusCode::PARTIAL_CONTENT
    } else {
        StatusCode::OK
    };
    let mut response = Response::builder()
        .status(status)
        .header("content-length", (state.bytes.len() - start).to_string());
    if start > 0 {
        response = response.header(
            "content-range",
            format!(
                "bytes {start}-{}/{}",
                state.bytes.len() - 1,
                state.bytes.len()
            ),
        );
    }
    response
        .body(Body::from(state.bytes[start..].to_vec()))
        .expect("range response")
}

async fn start_range_server(bytes: Vec<u8>) -> (String, Arc<Mutex<Vec<Option<String>>>>) {
    let ranges = Arc::new(Mutex::new(Vec::new()));
    let state = RangeServerState {
        bytes: Arc::new(bytes),
        ranges: Arc::clone(&ranges),
    };
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind test server");
    let address = listener.local_addr().expect("test server address");
    tokio::spawn(async move {
        axum::serve(
            listener,
            Router::new()
                .route("/model.gguf", get(range_response))
                .with_state(state),
        )
        .await
        .expect("serve test model");
    });
    (format!("http://{address}/model.gguf"), ranges)
}

async fn slow_response() -> Response<Body> {
    const CHUNKS: usize = 64;
    const CHUNK_SIZE: usize = 4096;
    let stream = stream::unfold(0usize, |index| async move {
        if index >= CHUNKS {
            return None;
        }
        tokio::time::sleep(Duration::from_millis(15)).await;
        Some((
            Ok::<_, Infallible>(vec![0u8; CHUNK_SIZE]),
            index.saturating_add(1),
        ))
    });
    Response::builder()
        .status(StatusCode::OK)
        .header("content-length", (CHUNKS * CHUNK_SIZE).to_string())
        .body(Body::from_stream(stream))
        .expect("slow response")
}

async fn start_slow_server() -> String {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind slow server");
    let address = listener.local_addr().expect("slow server address");
    tokio::spawn(async move {
        axum::serve(
            listener,
            Router::new().route("/slow.gguf", get(slow_response)),
        )
        .await
        .expect("serve slow model");
    });
    format!("http://{address}/slow.gguf")
}

async fn wait_for_terminal_download(
    manager: &TranslationManager,
    model_id: &str,
) -> TranslationDownloadStatus {
    for _ in 0..200 {
        if let Some(status) = manager
            .download_status(model_id)
            .await
            .expect("download status")
        {
            if status.phase.is_terminal() {
                return status;
            }
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("download did not reach a terminal state");
}

#[tokio::test]
async fn download_resumes_a_part_file_then_verifies_and_installs_atomically() {
    let temp = TempDir::new().expect("temp directory");
    let (url, ranges) = start_range_server(b"abc".to_vec()).await;
    let spec = ModelSpec::test_model(
        "tiny-model",
        "tiny.gguf",
        3,
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        vec![url],
    );
    let manager = test_manager(&temp, vec![spec]);
    let model_dir = temp.path().join("models");
    std::fs::create_dir_all(&model_dir).expect("create model directory");
    std::fs::write(model_dir.join("tiny.gguf"), b"abd")
        .expect("seed same-size corrupt installed model");
    std::fs::write(model_dir.join("tiny.gguf.part"), b"a").expect("seed partial model");

    manager
        .download_start("tiny-model")
        .await
        .expect("start download");
    let status = wait_for_terminal_download(&manager, "tiny-model").await;

    assert_eq!(status.phase, TranslationDownloadPhase::Completed);
    assert!(status.resumed);
    assert_eq!(std::fs::read(model_dir.join("tiny.gguf")).unwrap(), b"abc");
    assert!(!model_dir.join("tiny.gguf.part").exists());
    assert_eq!(
        ranges.lock().expect("range log").as_slice(),
        &[Some("bytes=1-".to_string())]
    );
}

#[tokio::test]
async fn a_model_cannot_start_two_downloads_at_the_same_time() {
    let temp = TempDir::new().expect("temp directory");
    let (url, _ranges) = start_range_server(vec![0; 1024]).await;
    let spec = ModelSpec::test_model(
        "one-at-a-time",
        "one.gguf",
        1024,
        "5f70bf18a086007016e948b04aed3b82103a36be6a28038301d1a4d8bd8a7d7",
        vec![url],
    );
    let manager = test_manager(&temp, vec![spec]);

    manager
        .download_start("one-at-a-time")
        .await
        .expect("start first download");
    let second = manager
        .download_start("one-at-a-time")
        .await
        .expect_err("second concurrent download must fail");

    assert_eq!(second.code(), TranslationErrorCode::AlreadyRunning);
}

#[tokio::test]
async fn cancelling_a_download_keeps_the_part_file_for_a_later_resume() {
    const TOTAL_BYTES: u64 = 64 * 4096;
    let temp = TempDir::new().expect("temp directory");
    let url = start_slow_server().await;
    let spec = ModelSpec::test_model(
        "cancel-model",
        "cancel.gguf",
        TOTAL_BYTES,
        "unused-after-cancel",
        vec![url],
    );
    let manager = test_manager(&temp, vec![spec]);
    manager
        .download_start("cancel-model")
        .await
        .expect("start cancellable download");

    for _ in 0..100 {
        let status = manager
            .download_status("cancel-model")
            .await
            .expect("read cancellable status")
            .expect("download status exists");
        if status.bytes_downloaded > 0 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    manager
        .download_cancel("cancel-model")
        .await
        .expect("cancel download");
    let status = wait_for_terminal_download(&manager, "cancel-model").await;

    let part = temp.path().join("models/cancel.gguf.part");
    assert_eq!(status.phase, TranslationDownloadPhase::Cancelled);
    assert!(part.is_file());
    let retained = part.metadata().expect("partial metadata").len();
    assert!(retained > 0 && retained < TOTAL_BYTES);
    assert!(!temp.path().join("models/cancel.gguf").exists());
}

#[tokio::test]
async fn shutdown_cancels_active_downloads_before_stopping_the_runtime() {
    const TOTAL_BYTES: u64 = 64 * 4096;
    let temp = TempDir::new().expect("temp directory");
    let spec = ModelSpec::test_model(
        "shutdown-model",
        "shutdown.gguf",
        TOTAL_BYTES,
        "unused-after-shutdown",
        vec![start_slow_server().await],
    );
    let manager = test_manager(&temp, vec![spec]);
    manager
        .download_start("shutdown-model")
        .await
        .expect("start download before shutdown");

    for _ in 0..100 {
        let downloaded = manager
            .download_status("shutdown-model")
            .await
            .expect("read shutdown status")
            .map(|status| status.bytes_downloaded)
            .unwrap_or(0);
        if downloaded > 0 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    let runtime = manager.shutdown_cleanup().await;
    let status = wait_for_terminal_download(&manager, "shutdown-model").await;

    assert!(!runtime.running);
    assert_eq!(status.phase, TranslationDownloadPhase::Cancelled);
    assert!(temp.path().join("models/shutdown.gguf.part").is_file());
}

#[tokio::test]
async fn translation_reports_runtime_unavailable_before_spawning() {
    let temp = TempDir::new().expect("temp directory");
    let source = temp.path().join("local.gguf");
    std::fs::write(&source, b"model").expect("write model");
    let manager = test_manager(&temp, vec![]);
    let model = manager
        .import_model(source, None)
        .await
        .expect("import model");

    let error = manager
        .translate(TranslationRequest {
            model_id: model.id,
            text: "hello".to_string(),
            source_language: Some("English".to_string()),
            target_language: "简体中文".to_string(),
            timeout_ms: None,
        })
        .await
        .expect_err("missing runtime must be reported");

    assert_eq!(error.code(), TranslationErrorCode::RuntimeUnavailable);
}
