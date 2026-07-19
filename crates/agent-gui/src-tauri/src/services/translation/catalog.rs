use super::{
    error::TranslationError,
    types::{TranslationInferenceProfile, TranslationModel, TranslationModelSource},
};
use serde::{Deserialize, Serialize};
use std::{ffi::OsStr, path::Path};

pub(crate) const QWEN_MODEL_ID: &str = "qwen3-0.6b-q8-0";
pub(crate) const HY_MT_Q4_MODEL_ID: &str = "hy-mt1.5-1.8b-q4-k-m";
pub(crate) const HY_MT_Q8_MODEL_ID: &str = "hy-mt1.5-1.8b-q8-0";
const QWEN_FILE_NAME: &str = "Qwen3-0.6B-Q8_0.gguf";
const QWEN_SIZE: u64 = 639_446_688;
const QWEN_SHA256: &str = "9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031";
const QWEN_MODELSCOPE_URL: &str =
    "https://modelscope.cn/models/Qwen/Qwen3-0.6B-GGUF/resolve/32d6327dd2a5b42f7ce0fe5e6b6f25346b0ee8f9/Qwen3-0.6B-Q8_0.gguf";
const QWEN_HUGGING_FACE_URL: &str = "https://huggingface.co/Qwen/Qwen3-0.6B-GGUF/resolve/23749fefcc72300e3a2ad315e1317431b06b590a/Qwen3-0.6B-Q8_0.gguf";
const QWEN_REVISION: &str = "23749fefcc72300e3a2ad315e1317431b06b590a";
const QWEN_SOURCE_URL: &str = "https://huggingface.co/Qwen/Qwen3-0.6B-GGUF";
const QWEN_LICENSE_URL: &str = "https://huggingface.co/Qwen/Qwen3-0.6B-GGUF/blob/23749fefcc72300e3a2ad315e1317431b06b590a/LICENSE";
const HY_MT_Q4_FILE_NAME: &str = "HY-MT1.5-1.8B-Q4_K_M.gguf";
const HY_MT_Q4_SIZE: u64 = 1_133_080_512;
const HY_MT_Q4_SHA256: &str = "4383ac0c3c8e476de98ff979c2a3f069f8c4fb385e7860cf2d28da896cc477c7";
const HY_MT_Q8_FILE_NAME: &str = "HY-MT1.5-1.8B-Q8_0.gguf";
const HY_MT_Q8_SIZE: u64 = 1_908_528_288;
const HY_MT_Q8_SHA256: &str = "6789b06d0902f2f5312c0e1703d56ccbddfcfb6c653d22519b7c720f7db9a98e";
const HY_MT_HUGGING_FACE_REVISION: &str = "265b2e615a7dc9b06c435dc878829ad99a512ba2";
const HY_MT_MODELSCOPE_REVISION: &str = "acac2122e32c8d7e6221fb135f918f6e6c87ce49";
const HY_MT_SOURCE_URL: &str = "https://huggingface.co/tencent/HY-MT1.5-1.8B-GGUF/tree/265b2e615a7dc9b06c435dc878829ad99a512ba2";
const HY_MT_LICENSE_URL: &str = "https://huggingface.co/tencent/HY-MT1.5-1.8B-GGUF/blob/265b2e615a7dc9b06c435dc878829ad99a512ba2/License.txt";
const HY_MT_LICENSE_NAME: &str = "Tencent HY Community License Agreement";

#[derive(Debug, Clone)]
pub(crate) struct DownloadConsentPolicy {
    pub license_revision: String,
}

#[derive(Debug, Clone)]
pub(crate) struct ModelSpec {
    pub id: String,
    pub display_name: String,
    pub description: String,
    pub file_name: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub urls: Vec<String>,
    pub recommended: bool,
    pub download_consent_policy: Option<DownloadConsentPolicy>,
    pub inference_profile: TranslationInferenceProfile,
    pub license_name: String,
    pub license_url: Option<String>,
    pub source_url: Option<String>,
    pub revision: Option<String>,
}

impl ModelSpec {
    pub(crate) fn qwen3_builtin() -> Self {
        Self {
            id: QWEN_MODEL_ID.to_string(),
            display_name: "Qwen3-0.6B Q8_0".to_string(),
            description: String::new(),
            file_name: QWEN_FILE_NAME.to_string(),
            size_bytes: QWEN_SIZE,
            sha256: QWEN_SHA256.to_string(),
            urls: vec![
                QWEN_MODELSCOPE_URL.to_string(),
                QWEN_HUGGING_FACE_URL.to_string(),
            ],
            recommended: false,
            download_consent_policy: None,
            inference_profile: TranslationInferenceProfile::Qwen3,
            license_name: "Apache-2.0".to_string(),
            license_url: Some(QWEN_LICENSE_URL.to_string()),
            source_url: Some(QWEN_SOURCE_URL.to_string()),
            revision: Some(QWEN_REVISION.to_string()),
        }
    }

    pub(crate) fn hy_mt_q4_builtin() -> Self {
        Self::hy_mt_builtin(
            HY_MT_Q4_MODEL_ID,
            "HY-MT1.5 1.8B Q4_K_M",
            "",
            HY_MT_Q4_FILE_NAME,
            HY_MT_Q4_SIZE,
            HY_MT_Q4_SHA256,
            true,
        )
    }

    pub(crate) fn hy_mt_q8_builtin() -> Self {
        Self::hy_mt_builtin(
            HY_MT_Q8_MODEL_ID,
            "HY-MT1.5 1.8B Q8_0",
            "",
            HY_MT_Q8_FILE_NAME,
            HY_MT_Q8_SIZE,
            HY_MT_Q8_SHA256,
            false,
        )
    }

    fn hy_mt_builtin(
        id: &str,
        display_name: &str,
        description: &str,
        file_name: &str,
        size_bytes: u64,
        sha256: &str,
        recommended: bool,
    ) -> Self {
        Self {
            id: id.to_string(),
            display_name: display_name.to_string(),
            description: description.to_string(),
            file_name: file_name.to_string(),
            size_bytes,
            sha256: sha256.to_string(),
            urls: vec![
                format!(
                    "https://modelscope.cn/models/Tencent-Hunyuan/HY-MT1.5-1.8B-GGUF/resolve/{HY_MT_MODELSCOPE_REVISION}/{file_name}"
                ),
                format!(
                    "https://huggingface.co/tencent/HY-MT1.5-1.8B-GGUF/resolve/{HY_MT_HUGGING_FACE_REVISION}/{file_name}"
                ),
            ],
            recommended,
            download_consent_policy: Some(DownloadConsentPolicy {
                license_revision: HY_MT_HUGGING_FACE_REVISION.to_string(),
            }),
            inference_profile: TranslationInferenceProfile::HyMt,
            license_name: HY_MT_LICENSE_NAME.to_string(),
            license_url: Some(HY_MT_LICENSE_URL.to_string()),
            source_url: Some(HY_MT_SOURCE_URL.to_string()),
            revision: Some(HY_MT_HUGGING_FACE_REVISION.to_string()),
        }
    }

    #[cfg(test)]
    pub(crate) fn test_model(
        id: &str,
        file_name: &str,
        size_bytes: u64,
        sha256: &str,
        urls: Vec<String>,
    ) -> Self {
        Self {
            id: id.to_string(),
            display_name: id.to_string(),
            description: "test model".to_string(),
            file_name: file_name.to_string(),
            size_bytes,
            sha256: sha256.to_string(),
            urls,
            recommended: false,
            download_consent_policy: None,
            inference_profile: TranslationInferenceProfile::Generic,
            license_name: "test license".to_string(),
            license_url: None,
            source_url: None,
            revision: None,
        }
    }

    #[cfg(test)]
    pub(crate) fn with_download_consent_policy(mut self, license_revision: &str) -> Self {
        self.download_consent_policy = Some(DownloadConsentPolicy {
            license_revision: license_revision.to_string(),
        });
        self.revision = Some(license_revision.to_string());
        self
    }

    pub(crate) fn as_model(
        &self,
        installed: bool,
        download_license_acceptance_satisfied: bool,
    ) -> TranslationModel {
        TranslationModel {
            id: self.id.clone(),
            display_name: self.display_name.clone(),
            description: self.description.clone(),
            source: TranslationModelSource::BuiltIn,
            inference_profile: self.inference_profile,
            file_name: self.file_name.clone(),
            size_bytes: self.size_bytes,
            sha256: self.sha256.clone(),
            license_name: self.license_name.clone(),
            license_url: self.license_url.clone(),
            source_url: self.source_url.clone(),
            revision: self.revision.clone(),
            installed,
            recommended: self.recommended,
            downloadable: true,
            download_license_acceptance_required: self.download_consent_policy.is_some(),
            download_license_acceptance_satisfied,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportedModelManifest {
    pub id: String,
    pub display_name: String,
    pub file_name: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub source: TranslationModelSource,
    #[serde(default)]
    pub inference_profile: TranslationInferenceProfile,
}

impl ImportedModelManifest {
    pub(crate) fn validate(&self) -> bool {
        self.source == TranslationModelSource::UserImport
            && self.id.starts_with("user-import-")
            && !self.display_name.trim().is_empty()
            && Path::new(&self.file_name).file_name() == Some(OsStr::new(&self.file_name))
            && self
                .file_name
                .rsplit_once('.')
                .map(|(_, extension)| extension.eq_ignore_ascii_case("gguf"))
                .unwrap_or(false)
            && self.sha256.len() == 64
    }

    pub(crate) fn as_model(&self, installed: bool) -> TranslationModel {
        TranslationModel {
            id: self.id.clone(),
            display_name: self.display_name.clone(),
            description: "用户自行提供的 GGUF 本地模型；请用户自行确认授权与使用范围。".to_string(),
            source: TranslationModelSource::UserImport,
            inference_profile: self.inference_profile,
            file_name: self.file_name.clone(),
            size_bytes: self.size_bytes,
            sha256: self.sha256.clone(),
            license_name: "未知许可证（用户自行提供）".to_string(),
            license_url: None,
            source_url: None,
            revision: None,
            installed,
            recommended: false,
            downloadable: false,
            download_license_acceptance_required: false,
            download_license_acceptance_satisfied: true,
        }
    }
}

pub(crate) fn read_imported_manifests(
    model_dir: &Path,
) -> Result<Vec<ImportedModelManifest>, TranslationError> {
    if !model_dir.exists() {
        return Ok(Vec::new());
    }
    let entries = std::fs::read_dir(model_dir)
        .map_err(|error| TranslationError::io("读取离线翻译模型目录失败", error))?;
    let mut manifests = Vec::new();
    for entry in entries {
        let Ok(entry) = entry else {
            continue;
        };
        let path = entry.path();
        if !path
            .file_name()
            .and_then(OsStr::to_str)
            .map(|name| name.ends_with(".model.json"))
            .unwrap_or(false)
        {
            continue;
        }
        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        let Ok(manifest) = serde_json::from_slice::<ImportedModelManifest>(&bytes) else {
            continue;
        };
        if manifest.validate() {
            manifests.push(manifest);
        }
    }
    manifests.sort_by(|left, right| left.display_name.cmp(&right.display_name));
    Ok(manifests)
}
