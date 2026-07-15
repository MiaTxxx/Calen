use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Currency {
    Cny,
    Hkd,
    Usd,
}

impl Currency {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Cny => "CNY",
            Self::Hkd => "HKD",
            Self::Usd => "USD",
        }
    }

    pub(crate) fn parse(value: &str) -> Result<Self, String> {
        match value.trim().to_ascii_uppercase().as_str() {
            "CNY" => Ok(Self::Cny),
            "HKD" => Ok(Self::Hkd),
            "USD" => Ok(Self::Usd),
            _ => Err(format!("unsupported currency: {value}")),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortfolioInstrument {
    pub instrument_id: String,
    pub market: String,
    pub exchange: Option<String>,
    pub symbol: String,
    pub asset_type: String,
    pub currency: Currency,
    pub display_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Watchlist {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchlistItem {
    pub watchlist_id: String,
    pub instrument: PortfolioInstrument,
    pub note: Option<String>,
    pub added_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchlistView {
    #[serde(flatten)]
    pub watchlist: Watchlist,
    pub items: Vec<WatchlistItem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Portfolio {
    pub id: String,
    pub name: String,
    pub base_currency: Currency,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TransactionKind {
    Buy,
    Sell,
    /// A position-scoped expense. Use `cash_amount`; `fee` is accepted for CSV compatibility.
    Fee,
    /// A position-scoped cash distribution recorded in `cash_amount`.
    Dividend,
    /// Multiplies the held quantity by `split_ratio` without changing cost basis.
    Split,
    /// Applies signed `quantity` and cost-basis (`cash_amount`) deltas without realizing P&L.
    Adjustment,
}

impl TransactionKind {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Buy => "BUY",
            Self::Sell => "SELL",
            Self::Fee => "FEE",
            Self::Dividend => "DIVIDEND",
            Self::Split => "SPLIT",
            Self::Adjustment => "ADJUSTMENT",
        }
    }

    pub(crate) fn parse(value: &str) -> Result<Self, String> {
        match value.trim().to_ascii_uppercase().as_str() {
            "BUY" => Ok(Self::Buy),
            "SELL" => Ok(Self::Sell),
            "FEE" => Ok(Self::Fee),
            "DIVIDEND" => Ok(Self::Dividend),
            "SPLIT" => Ok(Self::Split),
            "ADJUSTMENT" => Ok(Self::Adjustment),
            _ => Err(format!("unsupported transaction type: {value}")),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionInput {
    pub id: Option<String>,
    pub portfolio_id: String,
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionRecord {
    pub id: String,
    pub portfolio_id: String,
    pub instrument: PortfolioInstrument,
    pub transaction_type: TransactionKind,
    pub occurred_at: String,
    pub quantity: Option<f64>,
    pub price: Option<f64>,
    pub fee: Option<f64>,
    pub cash_amount: Option<f64>,
    pub split_ratio: Option<f64>,
    pub note: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PriceInput {
    pub instrument_id: String,
    pub currency: Currency,
    pub price: f64,
    pub as_of: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FxRateInput {
    pub from_currency: Currency,
    pub to_currency: Currency,
    pub rate: f64,
    pub as_of: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortfolioSnapshotRequest {
    pub portfolio_id: String,
    #[serde(default)]
    pub prices: Vec<PriceInput>,
    #[serde(default)]
    pub fx_rates: Vec<FxRateInput>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PositionSnapshot {
    pub instrument: PortfolioInstrument,
    pub quantity: f64,
    pub average_cost: f64,
    pub cost_basis: f64,
    pub realized_pnl: f64,
    pub current_price: Option<f64>,
    pub price_as_of: Option<String>,
    pub market_value: Option<f64>,
    pub unrealized_pnl: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrencyTotals {
    pub currency: Currency,
    pub cost_basis: f64,
    pub realized_pnl: f64,
    pub market_value: Option<f64>,
    pub unrealized_pnl: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaseCurrencyTotals {
    pub currency: Currency,
    pub cost_basis: f64,
    pub realized_pnl: f64,
    pub market_value: Option<f64>,
    pub unrealized_pnl: Option<f64>,
    pub fx_as_of: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortfolioSnapshot {
    pub portfolio: Portfolio,
    pub positions: Vec<PositionSnapshot>,
    pub totals_by_currency: Vec<CurrencyTotals>,
    pub base_currency_totals: Option<BaseCurrencyTotals>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvImportResult {
    pub imported: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvImportRecord {
    pub id: String,
    pub portfolio_id: String,
    pub source_label: String,
    pub imported_at: i64,
    pub total_rows: usize,
    pub success_count: usize,
    pub failure_count: usize,
    pub error_summary: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RestoreMode {
    ReplaceAll,
    Merge,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StockPortfolioBackup {
    pub schema_version: u32,
    pub exported_at: String,
    pub watchlists: Vec<WatchlistView>,
    pub portfolios: Vec<Portfolio>,
    pub transactions: Vec<TransactionRecord>,
    #[serde(default)]
    pub csv_imports: Vec<CsvImportRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptedBackupEnvelope {
    pub format_version: u32,
    pub cipher: String,
    pub created_at: String,
    pub payload_base64: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiInstrumentRef {
    pub id: String,
    pub symbol: String,
    pub name: String,
    pub market: String,
    pub exchange: String,
    pub asset_type: String,
    pub currency: String,
}

impl From<PortfolioInstrument> for UiInstrumentRef {
    fn from(instrument: PortfolioInstrument) -> Self {
        Self {
            id: instrument.instrument_id,
            symbol: instrument.symbol,
            name: instrument.display_name,
            market: instrument.market,
            exchange: instrument.exchange.unwrap_or_default(),
            asset_type: instrument.asset_type,
            currency: instrument.currency.as_str().to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiPortfolioSummary {
    pub id: String,
    pub name: String,
    pub base_currency: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiPortfolioPosition {
    pub portfolio_id: String,
    pub instrument: UiInstrumentRef,
    pub quantity: f64,
    pub average_cost: f64,
    pub market_value: Option<f64>,
    pub unrealized_pnl: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiPortfolioTransaction {
    pub id: String,
    pub portfolio_id: String,
    pub instrument: UiInstrumentRef,
    #[serde(rename = "type")]
    pub transaction_type: String,
    pub time: String,
    pub quantity: Option<f64>,
    pub price: Option<f64>,
    pub fee: Option<f64>,
    pub currency: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiPortfolioOverview {
    pub portfolios: Vec<UiPortfolioSummary>,
    pub positions: Vec<UiPortfolioPosition>,
    pub transactions: Vec<UiPortfolioTransaction>,
    pub as_of: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StockPortfolioCsvExport {
    pub file_name: String,
    pub csv: String,
}
