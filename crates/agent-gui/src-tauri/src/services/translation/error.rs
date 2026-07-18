use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TranslationErrorCode {
    InvalidArgument,
    NotFound,
    AlreadyRunning,
    NotInstalled,
    DownloadFailed,
    IntegrityMismatch,
    RuntimeUnavailable,
    RuntimeFailed,
    TranslationFailed,
    Io,
}

impl TranslationErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InvalidArgument => "invalidArgument",
            Self::NotFound => "notFound",
            Self::AlreadyRunning => "alreadyRunning",
            Self::NotInstalled => "notInstalled",
            Self::DownloadFailed => "downloadFailed",
            Self::IntegrityMismatch => "integrityMismatch",
            Self::RuntimeUnavailable => "runtimeUnavailable",
            Self::RuntimeFailed => "runtimeFailed",
            Self::TranslationFailed => "translationFailed",
            Self::Io => "io",
        }
    }
}

#[derive(Debug, Error)]
#[error("{message}")]
pub struct TranslationError {
    code: TranslationErrorCode,
    message: String,
}

impl TranslationError {
    pub fn new(code: TranslationErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn code(&self) -> TranslationErrorCode {
        self.code
    }

    pub fn message(&self) -> &str {
        &self.message
    }

    pub(crate) fn invalid(message: impl Into<String>) -> Self {
        Self::new(TranslationErrorCode::InvalidArgument, message)
    }

    pub(crate) fn not_found(message: impl Into<String>) -> Self {
        Self::new(TranslationErrorCode::NotFound, message)
    }

    pub(crate) fn io(context: &str, error: impl std::fmt::Display) -> Self {
        Self::new(TranslationErrorCode::Io, format!("{context}：{error}"))
    }
}
