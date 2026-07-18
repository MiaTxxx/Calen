mod catalog;
pub(crate) mod commands;
mod download;
mod error;
mod manager;
mod runtime;
mod types;

pub use commands::create_managed_translation_manager;
pub use error::TranslationError;
pub use manager::TranslationManager;
pub use types::{
    TranslationCatalog, TranslationDownloadStatus, TranslationModel, TranslationRequest,
    TranslationResult, TranslationRuntimeStatus, TranslationStatus,
};

#[cfg(test)]
pub(crate) use error::TranslationErrorCode;
#[cfg(test)]
pub(crate) use manager::TranslationHttpClientFactory;
#[cfg(test)]
pub(crate) use types::{
    TranslationDownloadPhase, TranslationInferenceProfile, TranslationModelSource,
};

#[cfg(test)]
mod tests;
