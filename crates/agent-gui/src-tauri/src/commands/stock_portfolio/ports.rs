//! Future external adapters for the local stock ledger.
//!
//! These are domain seams only: there are no Tauri commands, network clients,
//! broker implementations, or Gateway handlers here. Broker adapters may read
//! normalized records for an explicit local import, but cannot place orders or
//! mutate the ledger. Gateway adapters can transport only encrypted envelopes;
//! plaintext portfolio data and key material remain on trusted endpoints.

use serde::{Deserialize, Serialize};

use super::{
    Currency, PortfolioInstrument, StockPortfolioBackup, TransactionKind,
};

pub const BROKER_IMPORT_SCHEMA_VERSION: u32 = 1;
pub const PORTFOLIO_SYNC_ENVELOPE_VERSION: u32 = 1;

/// Opaque reference to credentials held by a local secret-store adapter.
///
/// The value identifies a secret record; it is never the broker API key or
/// password itself and intentionally has no Serde implementation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BrokerCredentialRef {
    local_secret_id: String,
}

impl BrokerCredentialRef {
    pub fn new(local_secret_id: impl Into<String>) -> Result<Self, PortfolioExternalPortError> {
        let local_secret_id = local_secret_id.into();
        if local_secret_id.trim().is_empty() {
            return Err(PortfolioExternalPortError::InvalidRequest);
        }
        Ok(Self { local_secret_id })
    }

    pub fn local_secret_id(&self) -> &str {
        &self.local_secret_id
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BrokerImportRequest {
    pub connection_id: String,
    pub external_account_id: String,
    pub since: Option<String>,
    pub cursor: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BrokerAccountRef {
    pub external_account_id: String,
    pub display_name: String,
    pub base_currency: Currency,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BrokerTransactionRecord {
    pub external_transaction_id: String,
    pub instrument: PortfolioInstrument,
    pub transaction_type: TransactionKind,
    pub occurred_at: String,
    pub quantity: Option<f64>,
    pub price: Option<f64>,
    pub fee: Option<f64>,
    pub cash_amount: Option<f64>,
    pub split_ratio: Option<f64>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BrokerImportWarning {
    PartialHistory,
    DelayedData,
    UnsupportedRecordSkipped,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BrokerImportBatch {
    pub schema_version: u32,
    pub adapter_id: String,
    pub account: BrokerAccountRef,
    pub transactions: Vec<BrokerTransactionRecord>,
    pub as_of: String,
    pub next_cursor: Option<String>,
    pub warnings: Vec<BrokerImportWarning>,
}

/// Read-only broker seam. Implementations return normalized records only.
///
/// Importing the returned batch into a Calen portfolio is a separate, explicit
/// local action. There is intentionally no order, transfer, or ledger mutation
/// method on this interface.
pub trait BrokerPortfolioImportPort: Send + Sync {
    fn read_import_batch(
        &self,
        credential: &BrokerCredentialRef,
        request: &BrokerImportRequest,
    ) -> Result<BrokerImportBatch, PortfolioExternalPortError>;
}

/// Local plaintext prepared for endpoint-side encryption.
///
/// This type must never be accepted by a Gateway transport adapter. It is
/// versioned independently from the encrypted envelope so payload migrations
/// do not require the relay to understand portfolio data.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortfolioSyncPlaintext {
    pub schema_version: u32,
    pub revision: String,
    pub source_device_id: String,
    pub backup: StockPortfolioBackup,
}

/// Opaque identifier for endpoint key material stored outside ordinary
/// settings. It intentionally contains no private or symmetric key bytes and
/// has no Serde implementation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PortfolioSyncKeyRef {
    local_key_id: String,
}

impl PortfolioSyncKeyRef {
    pub fn new(local_key_id: impl Into<String>) -> Result<Self, PortfolioExternalPortError> {
        let local_key_id = local_key_id.into();
        if local_key_id.trim().is_empty() {
            return Err(PortfolioExternalPortError::InvalidRequest);
        }
        Ok(Self { local_key_id })
    }

    pub fn local_key_id(&self) -> &str {
        &self.local_key_id
    }
}

/// Relay-safe portfolio payload. The Gateway may persist and forward this
/// structure but must not receive the corresponding plaintext or key material.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptedPortfolioSyncEnvelope {
    pub format_version: u32,
    pub envelope_id: String,
    pub source_device_id: String,
    pub public_key_id: String,
    pub cipher_suite: String,
    pub nonce_base64: String,
    pub ciphertext_base64: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptedPortfolioSyncPage {
    pub envelopes: Vec<EncryptedPortfolioSyncEnvelope>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptedPortfolioSyncReceipt {
    pub envelope_id: String,
    pub accepted_at: String,
    pub cursor: String,
}

/// Endpoint-side authenticated-encryption seam. Concrete adapters resolve the
/// opaque key reference locally; callers never pass raw key material. Adapter
/// implementations must authenticate the envelope metadata as associated data
/// so relay-side metadata changes are detected during `open`.
pub trait PortfolioSyncCryptoPort: Send + Sync {
    fn seal(
        &self,
        key: &PortfolioSyncKeyRef,
        plaintext: &PortfolioSyncPlaintext,
    ) -> Result<EncryptedPortfolioSyncEnvelope, PortfolioExternalPortError>;

    fn open(
        &self,
        key: &PortfolioSyncKeyRef,
        envelope: &EncryptedPortfolioSyncEnvelope,
    ) -> Result<PortfolioSyncPlaintext, PortfolioExternalPortError>;
}

/// Gateway transport seam. Its interface is deliberately ciphertext-only.
pub trait EncryptedPortfolioSyncTransportPort: Send + Sync {
    fn push(
        &self,
        envelope: &EncryptedPortfolioSyncEnvelope,
    ) -> Result<EncryptedPortfolioSyncReceipt, PortfolioExternalPortError>;

    fn pull(
        &self,
        after_cursor: Option<&str>,
    ) -> Result<EncryptedPortfolioSyncPage, PortfolioExternalPortError>;
}

/// Stable, non-sensitive failures shared by future external adapters. Raw
/// provider responses, credentials, ciphertext and decrypted portfolio data
/// must not be embedded in errors crossing these seams.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PortfolioExternalPortError {
    InvalidRequest,
    Unauthorized,
    RateLimited,
    TemporarilyUnavailable,
    InvalidRemoteData,
    EncryptionFailed,
    DecryptionFailed,
    Conflict,
}
