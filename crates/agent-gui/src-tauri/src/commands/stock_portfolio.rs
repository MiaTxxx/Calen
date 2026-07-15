mod cipher;
mod csv;
mod repository;
mod types;

use cipher::CalenBackupCipher;
pub use repository::{BackupCipher, StockPortfolioRepository};
pub use types::*;

async fn run_repository<T, F>(operation: &'static str, action: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&mut StockPortfolioRepository) -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let mut repository = StockPortfolioRepository::open_default()?;
        action(&mut repository)
    })
    .await
    .map_err(|error| format!("{operation} join failed: {error}"))?
}

// UI mutation commands. These are intentionally separate from the AI-facing
// read seam below; stock tools must never register the `ui_stock_*` commands.

#[tauri::command]
pub async fn ui_stock_watchlist_create(name: String) -> Result<Watchlist, String> {
    run_repository("ui_stock_watchlist_create", move |repository| {
        repository.create_watchlist(&name)
    })
    .await
}

#[tauri::command]
pub async fn ui_stock_watchlist_list() -> Result<Vec<WatchlistView>, String> {
    run_repository("ui_stock_watchlist_list", |repository| {
        repository.list_watchlists()
    })
    .await
}

#[tauri::command]
pub async fn ui_stock_watchlist_add_item(
    watchlist_id: String,
    instrument: PortfolioInstrument,
    note: Option<String>,
) -> Result<WatchlistItem, String> {
    run_repository("ui_stock_watchlist_add_item", move |repository| {
        repository.add_watchlist_item(&watchlist_id, instrument, note)
    })
    .await
}

#[tauri::command]
pub async fn ui_stock_watchlist_remove_item(
    watchlist_id: String,
    instrument_id: String,
) -> Result<bool, String> {
    run_repository("ui_stock_watchlist_remove_item", move |repository| {
        repository.remove_watchlist_item(&watchlist_id, &instrument_id)
    })
    .await
}

#[tauri::command]
pub async fn ui_stock_portfolio_create(
    name: String,
    base_currency: Currency,
) -> Result<Portfolio, String> {
    run_repository("ui_stock_portfolio_create", move |repository| {
        repository.create_portfolio(&name, base_currency)
    })
    .await
}

#[tauri::command]
pub async fn ui_stock_portfolio_list() -> Result<Vec<Portfolio>, String> {
    run_repository("ui_stock_portfolio_list", |repository| {
        repository.list_portfolios()
    })
    .await
}

#[tauri::command]
pub async fn ui_stock_portfolio_record_transaction(
    input: TransactionInput,
) -> Result<TransactionRecord, String> {
    run_repository("ui_stock_portfolio_record_transaction", move |repository| {
        repository.record_transaction(input)
    })
    .await
}

#[tauri::command]
pub async fn ui_stock_portfolio_delete_transaction(transaction_id: String) -> Result<bool, String> {
    run_repository("ui_stock_portfolio_delete_transaction", move |repository| {
        repository.delete_transaction(&transaction_id)
    })
    .await
}

#[tauri::command]
pub async fn ui_stock_portfolio_list_transactions(
    portfolio_id: String,
) -> Result<Vec<TransactionRecord>, String> {
    run_repository("ui_stock_portfolio_list_transactions", move |repository| {
        repository.list_transactions(&portfolio_id)
    })
    .await
}

#[tauri::command]
pub async fn ui_stock_portfolio_snapshot(
    request: PortfolioSnapshotRequest,
) -> Result<PortfolioSnapshot, String> {
    run_repository("ui_stock_portfolio_snapshot", move |repository| {
        repository.portfolio_snapshot(request)
    })
    .await
}

#[tauri::command]
pub async fn ui_stock_portfolio_export_csv(portfolio_id: String) -> Result<String, String> {
    run_repository("ui_stock_portfolio_export_csv", move |repository| {
        repository.export_transactions_csv(&portfolio_id)
    })
    .await
}

#[tauri::command]
pub async fn ui_stock_portfolio_import_csv(
    portfolio_id: String,
    document: String,
) -> Result<CsvImportResult, String> {
    run_repository("ui_stock_portfolio_import_csv", move |repository| {
        repository.import_transactions_csv(&portfolio_id, &document)
    })
    .await
}

/// Versioned plaintext contract for a future platform-approved authenticated
/// encryption adapter. Do not expose this command as an "encrypted backup".
#[tauri::command]
pub async fn ui_stock_portfolio_export_backup_contract() -> Result<StockPortfolioBackup, String> {
    run_repository("ui_stock_portfolio_export_backup_contract", |repository| {
        repository.export_backup_document()
    })
    .await
}

#[tauri::command]
pub async fn ui_stock_portfolio_restore_backup_contract(
    backup: StockPortfolioBackup,
    mode: RestoreMode,
) -> Result<(), String> {
    run_repository(
        "ui_stock_portfolio_restore_backup_contract",
        move |repository| repository.restore_backup_document(backup, mode),
    )
    .await
}

#[tauri::command]
pub async fn ui_stock_portfolio_export_encrypted_backup(
    password: String,
) -> Result<EncryptedBackupEnvelope, String> {
    run_repository(
        "ui_stock_portfolio_export_encrypted_backup",
        move |repository| repository.export_backup_with_cipher(&password, &CalenBackupCipher),
    )
    .await
}

#[tauri::command]
pub async fn ui_stock_portfolio_restore_encrypted_backup(
    envelope: EncryptedBackupEnvelope,
    password: String,
    mode: RestoreMode,
) -> Result<(), String> {
    run_repository(
        "ui_stock_portfolio_restore_encrypted_backup",
        move |repository| {
            repository.restore_backup_with_cipher(envelope, &password, mode, &CalenBackupCipher)
        },
    )
    .await
}

// AI-facing read-only seam. Builtin tools should register only this command.

#[tauri::command]
pub async fn ai_stock_watchlist_list() -> Result<Vec<WatchlistView>, String> {
    run_repository("ai_stock_watchlist_list", |repository| {
        repository.list_watchlists()
    })
    .await
}

#[tauri::command]
pub async fn ai_stock_portfolio_list() -> Result<Vec<Portfolio>, String> {
    run_repository("ai_stock_portfolio_list", |repository| {
        repository.list_portfolios()
    })
    .await
}

#[tauri::command]
pub async fn ai_stock_portfolio_transactions(
    portfolio_id: String,
) -> Result<Vec<TransactionRecord>, String> {
    run_repository("ai_stock_portfolio_transactions", move |repository| {
        repository.list_transactions(&portfolio_id)
    })
    .await
}

#[tauri::command]
pub async fn ai_stock_portfolio_snapshot(
    request: PortfolioSnapshotRequest,
) -> Result<PortfolioSnapshot, String> {
    run_repository("ai_stock_portfolio_snapshot", move |repository| {
        repository.portfolio_snapshot(request)
    })
    .await
}

// Stable compatibility seam used by the Calen Stock Hub. It intentionally
// composes the richer repository API instead of introducing a second ledger.

#[tauri::command]
pub async fn stock_portfolio_read() -> Result<UiPortfolioOverview, String> {
    run_repository("stock_portfolio_read", |repository| {
        repository.ui_overview()
    })
    .await
}

#[tauri::command]
pub async fn stock_portfolio_import_csv(csv: String) -> Result<UiPortfolioOverview, String> {
    run_repository("stock_portfolio_import_csv", move |repository| {
        let portfolio = match repository.list_portfolios()?.into_iter().next() {
            Some(portfolio) => portfolio,
            None => repository.create_portfolio("默认组合", Currency::Cny)?,
        };
        repository.import_transactions_csv(&portfolio.id, &csv)?;
        repository.ui_overview()
    })
    .await
}

#[tauri::command]
pub async fn stock_portfolio_export_csv(
    portfolio_id: Option<String>,
) -> Result<StockPortfolioCsvExport, String> {
    run_repository("stock_portfolio_export_csv", move |repository| {
        let portfolio = match portfolio_id {
            Some(portfolio_id) => repository
                .list_portfolios()?
                .into_iter()
                .find(|portfolio| portfolio.id == portfolio_id)
                .ok_or_else(|| format!("portfolio not found: {portfolio_id}"))?,
            None => match repository.list_portfolios()?.into_iter().next() {
                Some(portfolio) => portfolio,
                None => repository.create_portfolio("默认组合", Currency::Cny)?,
            },
        };
        Ok(StockPortfolioCsvExport {
            file_name: format!(
                "{}-transactions.csv",
                safe_file_stem(&portfolio.name, "Calen-stock")
            ),
            csv: repository.export_transactions_csv(&portfolio.id)?,
        })
    })
    .await
}

fn safe_file_stem(value: &str, fallback: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|character| match character {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            character if character.is_control() => '_',
            character => character,
        })
        .collect();
    let sanitized = sanitized
        .trim()
        .trim_end_matches(|character| character == '.' || character == ' ');
    if sanitized.is_empty() {
        fallback.to_string()
    } else {
        sanitized.to_string()
    }
}

#[cfg(test)]
mod tests;
