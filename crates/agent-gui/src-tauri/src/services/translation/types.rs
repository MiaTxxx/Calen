use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TranslationModelSource {
    BuiltIn,
    UserImport,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum TranslationInferenceProfile {
    #[serde(rename = "qwen3")]
    Qwen3,
    #[serde(rename = "hy-mt")]
    HyMt,
    #[default]
    #[serde(rename = "generic")]
    Generic,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationModel {
    pub id: String,
    pub display_name: String,
    pub description: String,
    pub source: TranslationModelSource,
    pub inference_profile: TranslationInferenceProfile,
    pub file_name: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub license_name: String,
    pub license_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revision: Option<String>,
    pub installed: bool,
    pub recommended: bool,
    pub downloadable: bool,
    pub download_license_acceptance_required: bool,
    pub download_license_acceptance_satisfied: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationDownloadConsent {
    pub license_revision: String,
    pub license_accepted: bool,
    pub acceptable_use_policy_accepted: bool,
    pub territory_eligible: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationCatalog {
    pub models: Vec<TranslationModel>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TranslationDownloadPhase {
    Queued,
    Downloading,
    Verifying,
    Completed,
    Cancelled,
    Failed,
}

impl TranslationDownloadPhase {
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Cancelled | Self::Failed)
    }

    pub(crate) fn is_active(self) -> bool {
        matches!(self, Self::Queued | Self::Downloading | Self::Verifying)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationDownloadStatus {
    pub model_id: String,
    pub phase: TranslationDownloadPhase,
    pub bytes_downloaded: u64,
    pub total_bytes: u64,
    pub resumed: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationRuntimeStatus {
    pub available: bool,
    pub running: bool,
    pub model_id: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationStatus {
    pub models: Vec<TranslationModel>,
    pub downloads: Vec<TranslationDownloadStatus>,
    pub runtime: TranslationRuntimeStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationRequest {
    pub model_id: String,
    pub text: String,
    pub source_language: Option<String>,
    pub target_language: String,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationResult {
    pub text: String,
    pub model_id: String,
    pub elapsed_ms: u64,
}
