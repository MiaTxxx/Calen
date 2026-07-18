use super::{
    error::TranslationError,
    types::{TranslationInferenceProfile, TranslationModel, TranslationModelSource},
};
use serde::{Deserialize, Serialize};
use std::{ffi::OsStr, path::Path};

pub(crate) const QWEN_MODEL_ID: &str = "qwen3-0.6b-q8-0";
const QWEN_FILE_NAME: &str = "Qwen3-0.6B-Q8_0.gguf";
const QWEN_SIZE: u64 = 639_446_688;
const QWEN_SHA256: &str = "9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031";
const QWEN_MODELSCOPE_URL: &str =
    "https://modelscope.cn/models/Qwen/Qwen3-0.6B-GGUF/resolve/32d6327dd2a5b42f7ce0fe5e6b6f25346b0ee8f9/Qwen3-0.6B-Q8_0.gguf";
const QWEN_HUGGING_FACE_URL: &str = "https://huggingface.co/Qwen/Qwen3-0.6B-GGUF/resolve/23749fefcc72300e3a2ad315e1317431b06b590a/Qwen3-0.6B-Q8_0.gguf";
const QWEN_REVISION: &str = "23749fefcc72300e3a2ad315e1317431b06b590a";
const QWEN_SOURCE_URL: &str = "https://huggingface.co/Qwen/Qwen3-0.6B-GGUF";
const QWEN_LICENSE_URL: &str = "https://huggingface.co/Qwen/Qwen3-0.6B-GGUF/blob/23749fefcc72300e3a2ad315e1317431b06b590a/LICENSE";

#[derive(Debug, Clone)]
pub(crate) struct ModelSpec {
    pub id: String,
    pub display_name: String,
    pub file_name: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub urls: Vec<String>,
    pub recommended: bool,
    pub inference_profile: TranslationInferenceProfile,
}

impl ModelSpec {
    pub(crate) fn qwen3_builtin() -> Self {
        Self {
            id: QWEN_MODEL_ID.to_string(),
            display_name: "Qwen3-0.6B Q8_0 · 实验性离线翻译".to_string(),
            file_name: QWEN_FILE_NAME.to_string(),
            size_bytes: QWEN_SIZE,
            sha256: QWEN_SHA256.to_string(),
            urls: vec![
                QWEN_MODELSCOPE_URL.to_string(),
                QWEN_HUGGING_FACE_URL.to_string(),
            ],
            recommended: true,
            inference_profile: TranslationInferenceProfile::Qwen3,
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
            file_name: file_name.to_string(),
            size_bytes,
            sha256: sha256.to_string(),
            urls,
            recommended: false,
            inference_profile: TranslationInferenceProfile::Generic,
        }
    }

    pub(crate) fn as_model(&self, installed: bool) -> TranslationModel {
        TranslationModel {
            id: self.id.clone(),
            display_name: self.display_name.clone(),
            description: "用于 Skills 商店描述等短文本的实验性本地翻译模型。".to_string(),
            source: TranslationModelSource::BuiltIn,
            inference_profile: self.inference_profile,
            file_name: self.file_name.clone(),
            size_bytes: self.size_bytes,
            sha256: self.sha256.clone(),
            license_name: "Apache-2.0".to_string(),
            license_url: Some(QWEN_LICENSE_URL.to_string()),
            source_url: Some(QWEN_SOURCE_URL.to_string()),
            revision: Some(QWEN_REVISION.to_string()),
            installed,
            recommended: self.recommended,
            downloadable: true,
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
