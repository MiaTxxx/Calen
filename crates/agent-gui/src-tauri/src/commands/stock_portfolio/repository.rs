use super::{csv, types::*};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::{DateTime, NaiveDate, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use std::{
    collections::{BTreeMap, HashMap},
    fs,
    time::Duration,
};
use uuid::Uuid;

const DB_FILENAME: &str = "stock-portfolio.sqlite3";
const SCHEMA_VERSION: i64 = 2;
const BACKUP_SCHEMA_VERSION: u32 = 1;
const ENVELOPE_FORMAT_VERSION: u32 = 1;
const EPSILON: f64 = 1e-8;
const DEFAULT_CSV_IMPORT_SOURCE: &str = "Calen CSV import";

/// Password protection is deliberately a boundary. The repository owns the
/// versioned backup contract while a platform-approved cipher owns key
/// derivation and authenticated encryption.
pub trait BackupCipher {
    fn algorithm(&self) -> &str;
    fn encrypt(&self, plaintext: &[u8], password: &str) -> Result<Vec<u8>, String>;
    fn decrypt(&self, ciphertext: &[u8], password: &str) -> Result<Vec<u8>, String>;
}

pub struct StockPortfolioRepository {
    conn: Connection,
}

impl StockPortfolioRepository {
    pub fn new(conn: Connection) -> Result<Self, String> {
        configure_connection(&conn)?;
        initialize_schema(&conn)?;
        Ok(Self { conn })
    }

    pub fn open_default() -> Result<Self, String> {
        let dir = crate::runtime::app_paths::app_data_dir()
            .map_err(|e| format!("创建股票账本目录失败：{e}"))?;
        let conn = Connection::open(dir.join(DB_FILENAME))
            .map_err(|e| format!("打开股票账本数据库失败：{e}"))?;
        Self::new(conn)
    }

    pub fn create_watchlist(&mut self, name: &str) -> Result<Watchlist, String> {
        let name = required(name, "watchlist name")?;
        let now = now_millis();
        let watchlist = Watchlist {
            id: Uuid::new_v4().to_string(),
            name,
            created_at: now,
            updated_at: now,
        };
        self.conn
            .execute(
                "INSERT INTO stock_watchlist (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
                params![watchlist.id, watchlist.name, watchlist.created_at, watchlist.updated_at],
            )
            .map_err(|e| format!("创建自选列表失败：{e}"))?;
        Ok(watchlist)
    }

    pub fn list_watchlists(&self) -> Result<Vec<WatchlistView>, String> {
        let mut statement = self
            .conn
            .prepare(
                "SELECT id, name, created_at, updated_at FROM stock_watchlist ORDER BY created_at, id",
            )
            .map_err(|e| format!("准备自选列表查询失败：{e}"))?;
        let rows = statement
            .query_map([], |row| {
                Ok(Watchlist {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    created_at: row.get(2)?,
                    updated_at: row.get(3)?,
                })
            })
            .map_err(|e| format!("查询自选列表失败：{e}"))?;
        let mut views = Vec::new();
        for row in rows {
            let watchlist = row.map_err(|e| format!("读取自选列表失败：{e}"))?;
            let items = load_watchlist_items(&self.conn, &watchlist.id)?;
            views.push(WatchlistView { watchlist, items });
        }
        Ok(views)
    }

    pub fn add_watchlist_item(
        &mut self,
        watchlist_id: &str,
        instrument: PortfolioInstrument,
        note: Option<String>,
    ) -> Result<WatchlistItem, String> {
        let watchlist_id = required(watchlist_id, "watchlist id")?;
        ensure_watchlist_exists(&self.conn, &watchlist_id)?;
        let instrument = normalize_instrument(instrument)?;
        let now = now_millis();
        let note = normalize_optional_text(note);
        self.conn
            .execute(
                r#"
                INSERT INTO stock_watchlist_item (
                    watchlist_id, instrument_id, market, exchange, symbol, asset_type,
                    currency, display_name, note, added_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                ON CONFLICT(watchlist_id, instrument_id) DO UPDATE SET
                    market = excluded.market,
                    exchange = excluded.exchange,
                    symbol = excluded.symbol,
                    asset_type = excluded.asset_type,
                    currency = excluded.currency,
                    display_name = excluded.display_name,
                    note = excluded.note
                "#,
                params![
                    watchlist_id,
                    instrument.instrument_id,
                    instrument.market,
                    instrument.exchange,
                    instrument.symbol,
                    instrument.asset_type,
                    instrument.currency.as_str(),
                    instrument.display_name,
                    note,
                    now,
                ],
            )
            .map_err(|e| format!("添加自选标的失败：{e}"))?;
        self.conn
            .execute(
                "UPDATE stock_watchlist SET updated_at = ?2 WHERE id = ?1",
                params![watchlist_id, now],
            )
            .map_err(|e| format!("更新自选列表时间失败：{e}"))?;
        Ok(WatchlistItem {
            watchlist_id,
            instrument,
            note,
            added_at: now,
        })
    }

    pub fn remove_watchlist_item(
        &mut self,
        watchlist_id: &str,
        instrument_id: &str,
    ) -> Result<bool, String> {
        let changed = self
            .conn
            .execute(
                "DELETE FROM stock_watchlist_item WHERE watchlist_id = ?1 AND instrument_id = ?2",
                params![watchlist_id.trim(), instrument_id.trim()],
            )
            .map_err(|e| format!("移除自选标的失败：{e}"))?;
        if changed > 0 {
            self.conn
                .execute(
                    "UPDATE stock_watchlist SET updated_at = ?2 WHERE id = ?1",
                    params![watchlist_id.trim(), now_millis()],
                )
                .map_err(|e| format!("更新自选列表时间失败：{e}"))?;
        }
        Ok(changed > 0)
    }

    pub fn create_portfolio(
        &mut self,
        name: &str,
        base_currency: Currency,
    ) -> Result<Portfolio, String> {
        let name = required(name, "portfolio name")?;
        let now = now_millis();
        let portfolio = Portfolio {
            id: Uuid::new_v4().to_string(),
            name,
            base_currency,
            created_at: now,
            updated_at: now,
        };
        self.conn
            .execute(
                "INSERT INTO stock_portfolio (id, name, base_currency, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    portfolio.id,
                    portfolio.name,
                    portfolio.base_currency.as_str(),
                    portfolio.created_at,
                    portfolio.updated_at,
                ],
            )
            .map_err(|e| format!("创建投资组合失败：{e}"))?;
        Ok(portfolio)
    }

    pub fn list_portfolios(&self) -> Result<Vec<Portfolio>, String> {
        load_portfolios(&self.conn)
    }

    pub fn record_transaction(
        &mut self,
        input: TransactionInput,
    ) -> Result<TransactionRecord, String> {
        let mut record = normalize_transaction(input)?;
        let transaction = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| format!("开始交易流水事务失败：{e}"))?;
        ensure_portfolio_exists(&transaction, &record.portfolio_id)?;
        ensure_instrument_consistency(&transaction, &record)?;
        record.created_at =
            next_transaction_created_at(&transaction, &record.portfolio_id, record.created_at)?;
        insert_transaction(&transaction, &record)?;
        validate_ledger(&transaction, &record.portfolio_id)?;
        touch_portfolio(&transaction, &record.portfolio_id)?;
        transaction
            .commit()
            .map_err(|e| format!("提交交易流水失败：{e}"))?;
        Ok(record)
    }

    pub fn delete_transaction(&mut self, transaction_id: &str) -> Result<bool, String> {
        let transaction_id = required(transaction_id, "transaction id")?;
        let transaction = self
            .conn
            .transaction()
            .map_err(|e| format!("开始删除交易流水事务失败：{e}"))?;
        let portfolio_id: Option<String> = transaction
            .query_row(
                "SELECT portfolio_id FROM stock_transaction WHERE id = ?1",
                [&transaction_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| format!("读取待删除交易流水失败：{e}"))?;
        let Some(portfolio_id) = portfolio_id else {
            return Ok(false);
        };
        transaction
            .execute(
                "DELETE FROM stock_transaction WHERE id = ?1",
                [&transaction_id],
            )
            .map_err(|e| format!("删除交易流水失败：{e}"))?;
        validate_ledger(&transaction, &portfolio_id)?;
        touch_portfolio(&transaction, &portfolio_id)?;
        transaction
            .commit()
            .map_err(|e| format!("提交交易流水删除失败：{e}"))?;
        Ok(true)
    }

    pub fn list_transactions(&self, portfolio_id: &str) -> Result<Vec<TransactionRecord>, String> {
        ensure_portfolio_exists(&self.conn, portfolio_id)?;
        load_transactions(&self.conn, portfolio_id)
    }

    pub fn portfolio_snapshot(
        &self,
        request: PortfolioSnapshotRequest,
    ) -> Result<PortfolioSnapshot, String> {
        let portfolio = load_portfolio(&self.conn, &request.portfolio_id)?;
        let transactions = load_transactions(&self.conn, &request.portfolio_id)?;
        let accumulators = calculate_positions(&transactions)?;
        build_snapshot(portfolio, accumulators, request.prices, request.fx_rates)
    }

    pub fn ui_overview(&self) -> Result<UiPortfolioOverview, String> {
        let portfolios = self.list_portfolios()?;
        let mut positions = Vec::new();
        let mut transactions = Vec::new();
        for portfolio in &portfolios {
            let snapshot = self.portfolio_snapshot(PortfolioSnapshotRequest {
                portfolio_id: portfolio.id.clone(),
                prices: Vec::new(),
                fx_rates: Vec::new(),
            })?;
            positions.extend(
                snapshot
                    .positions
                    .into_iter()
                    .filter(|position| position.quantity.abs() > EPSILON)
                    .map(|position| UiPortfolioPosition {
                        portfolio_id: portfolio.id.clone(),
                        instrument: position.instrument.into(),
                        quantity: position.quantity,
                        average_cost: position.average_cost,
                        market_value: position.market_value,
                        unrealized_pnl: position.unrealized_pnl,
                    }),
            );
            transactions.extend(self.list_transactions(&portfolio.id)?.into_iter().map(
                |transaction| UiPortfolioTransaction {
                    id: transaction.id,
                    portfolio_id: transaction.portfolio_id,
                    currency: transaction.instrument.currency.as_str().to_string(),
                    instrument: transaction.instrument.into(),
                    transaction_type: transaction.transaction_type.as_str().to_ascii_lowercase(),
                    time: transaction.occurred_at,
                    quantity: transaction.quantity,
                    price: transaction.price,
                    fee: transaction.fee.or(transaction.cash_amount),
                    note: transaction.note,
                },
            ));
        }
        Ok(UiPortfolioOverview {
            portfolios: portfolios
                .into_iter()
                .map(|portfolio| UiPortfolioSummary {
                    id: portfolio.id,
                    name: portfolio.name,
                    base_currency: portfolio.base_currency.as_str().to_string(),
                })
                .collect(),
            positions,
            transactions,
            as_of: now_rfc3339(),
        })
    }

    pub fn export_transactions_csv(&self, portfolio_id: &str) -> Result<String, String> {
        let portfolio = load_portfolio(&self.conn, portfolio_id)?;
        let transactions = load_transactions(&self.conn, portfolio_id)?;
        let mut rows = vec![CSV_HEADERS.iter().map(|value| value.to_string()).collect()];
        for transaction in transactions {
            rows.push(vec![
                transaction.id,
                portfolio.name.clone(),
                transaction.instrument.market,
                transaction.instrument.exchange.unwrap_or_default(),
                transaction.instrument.symbol,
                transaction.instrument.instrument_id,
                transaction.instrument.asset_type,
                transaction.instrument.display_name,
                transaction.transaction_type.as_str().to_string(),
                transaction.occurred_at,
                option_number(transaction.quantity),
                option_number(transaction.price),
                option_number(transaction.fee),
                option_number(transaction.cash_amount),
                option_number(transaction.split_ratio),
                transaction.instrument.currency.as_str().to_string(),
                transaction.note.unwrap_or_default(),
            ]);
        }
        Ok(csv::encode(&rows))
    }

    pub fn import_transactions_csv(
        &mut self,
        portfolio_id: &str,
        document: &str,
    ) -> Result<CsvImportResult, String> {
        self.import_transactions_csv_with_source(
            portfolio_id,
            document,
            DEFAULT_CSV_IMPORT_SOURCE,
        )
    }

    pub fn import_transactions_csv_with_source(
        &mut self,
        portfolio_id: &str,
        document: &str,
        source_label: &str,
    ) -> Result<CsvImportResult, String> {
        ensure_portfolio_exists(&self.conn, portfolio_id)?;
        let source_label = normalize_csv_import_source(source_label);
        let imported_at = now_millis();
        match self.import_transactions_csv_transaction(
            portfolio_id,
            document,
            &source_label,
            imported_at,
        ) {
            Ok(result) => Ok(result),
            Err(error) => {
                let total_rows = csv_data_row_count(document);
                let record = CsvImportRecord {
                    id: Uuid::new_v4().to_string(),
                    portfolio_id: portfolio_id.to_string(),
                    source_label,
                    imported_at,
                    total_rows,
                    success_count: 0,
                    failure_count: total_rows,
                    error_summary: Some(csv_import_error_summary(&error)),
                };
                match insert_csv_import_record(&self.conn, &record) {
                    Ok(()) => Err(error),
                    Err(audit_error) => Err(format!(
                        "{error}; failed to persist CSV import history: {audit_error}"
                    )),
                }
            }
        }
    }

    fn import_transactions_csv_transaction(
        &mut self,
        portfolio_id: &str,
        document: &str,
        source_label: &str,
        imported_at: i64,
    ) -> Result<CsvImportResult, String> {
        let portfolio = load_portfolio(&self.conn, portfolio_id)?;
        let rows = csv::decode(document)?;
        if rows.is_empty() {
            return Err("CSV document is empty".to_string());
        }
        let total_rows = rows.len().saturating_sub(1);
        let headers = csv_header_map(&rows[0])?;
        let mut records = Vec::new();
        for (index, row) in rows.iter().enumerate().skip(1) {
            let input = transaction_from_csv_row(&portfolio, &headers, row)
                .map_err(|e| format!("CSV row {}: {e}", index + 1))?;
            records.push(
                normalize_transaction(input)
                    .map_err(|e| format!("CSV row {}: {e}", index + 1))?,
            );
        }

        let transaction = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| format!("开始 CSV 导入事务失败：{e}"))?;
        for record in &mut records {
            ensure_instrument_consistency(&transaction, record)?;
            record.created_at =
                next_transaction_created_at(&transaction, &record.portfolio_id, record.created_at)?;
            insert_transaction(&transaction, record)?;
        }
        validate_ledger(&transaction, &portfolio.id)?;
        touch_portfolio(&transaction, &portfolio.id)?;
        insert_csv_import_record(
            &transaction,
            &CsvImportRecord {
                id: Uuid::new_v4().to_string(),
                portfolio_id: portfolio.id.clone(),
                source_label: source_label.to_string(),
                imported_at,
                total_rows,
                success_count: records.len(),
                failure_count: total_rows.saturating_sub(records.len()),
                error_summary: None,
            },
        )?;
        transaction
            .commit()
            .map_err(|e| format!("提交 CSV 导入失败：{e}"))?;
        Ok(CsvImportResult {
            imported: records.len(),
        })
    }

    pub fn list_csv_import_records(
        &self,
        portfolio_id: &str,
    ) -> Result<Vec<CsvImportRecord>, String> {
        ensure_portfolio_exists(&self.conn, portfolio_id)?;
        let mut statement = self
            .conn
            .prepare(
                r#"
                SELECT id, portfolio_id, source_label, imported_at, total_rows,
                       success_count, failure_count, error_summary
                FROM stock_csv_import
                WHERE portfolio_id = ?1
                ORDER BY imported_at DESC, id DESC
                "#,
            )
            .map_err(|e| format!("prepare stock CSV import history query: {e}"))?;
        let rows = statement
            .query_map([portfolio_id], |row| {
                Ok(CsvImportRecord {
                    id: row.get(0)?,
                    portfolio_id: row.get(1)?,
                    source_label: row.get(2)?,
                    imported_at: row.get(3)?,
                    total_rows: row.get::<_, i64>(4)? as usize,
                    success_count: row.get::<_, i64>(5)? as usize,
                    failure_count: row.get::<_, i64>(6)? as usize,
                    error_summary: row.get(7)?,
                })
            })
            .map_err(|e| format!("query stock CSV import history: {e}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("read stock CSV import history: {e}"))
    }

    pub fn export_backup_document(&self) -> Result<StockPortfolioBackup, String> {
        let watchlists = self.list_watchlists()?;
        let portfolios = self.list_portfolios()?;
        let mut transactions = Vec::new();
        let mut csv_imports = Vec::new();
        for portfolio in &portfolios {
            transactions.extend(self.list_transactions(&portfolio.id)?);
            csv_imports.extend(self.list_csv_import_records(&portfolio.id)?);
        }
        Ok(StockPortfolioBackup {
            schema_version: BACKUP_SCHEMA_VERSION,
            exported_at: now_rfc3339(),
            watchlists,
            portfolios,
            transactions,
            csv_imports,
        })
    }

    pub fn restore_backup_document(
        &mut self,
        backup: StockPortfolioBackup,
        mode: RestoreMode,
    ) -> Result<(), String> {
        if backup.schema_version != BACKUP_SCHEMA_VERSION {
            return Err(format!(
                "unsupported stock portfolio backup schema version: {}",
                backup.schema_version
            ));
        }
        let transaction = self
            .conn
            .transaction()
            .map_err(|e| format!("开始恢复股票账本事务失败：{e}"))?;
        if mode == RestoreMode::ReplaceAll {
            transaction
                .execute_batch(
                    "DELETE FROM stock_transaction; DELETE FROM stock_watchlist_item; DELETE FROM stock_portfolio; DELETE FROM stock_watchlist;",
                )
                .map_err(|e| format!("清理现有股票账本失败：{e}"))?;
        }
        restore_watchlists(&transaction, &backup.watchlists)?;
        restore_portfolios(&transaction, &backup.portfolios)?;
        for record in &backup.transactions {
            validate_transaction_record(record)?;
            insert_transaction_upsert(&transaction, record)?;
        }
        for record in &backup.csv_imports {
            ensure_csv_import_record_matches_backup(record, &backup.portfolios)?;
            insert_csv_import_record(&transaction, record)?;
        }
        for portfolio in &backup.portfolios {
            validate_ledger(&transaction, &portfolio.id)?;
        }
        transaction
            .commit()
            .map_err(|e| format!("提交股票账本恢复失败：{e}"))
    }

    pub fn export_backup_with_cipher<C: BackupCipher>(
        &self,
        password: &str,
        cipher: &C,
    ) -> Result<EncryptedBackupEnvelope, String> {
        validate_password(password)?;
        let plaintext = serde_json::to_vec(&self.export_backup_document()?)
            .map_err(|e| format!("serialize stock portfolio backup: {e}"))?;
        let ciphertext = cipher.encrypt(&plaintext, password)?;
        Ok(EncryptedBackupEnvelope {
            format_version: ENVELOPE_FORMAT_VERSION,
            cipher: cipher.algorithm().to_string(),
            created_at: now_rfc3339(),
            payload_base64: BASE64.encode(ciphertext),
        })
    }

    pub fn restore_backup_with_cipher<C: BackupCipher>(
        &mut self,
        envelope: EncryptedBackupEnvelope,
        password: &str,
        mode: RestoreMode,
        cipher: &C,
    ) -> Result<(), String> {
        validate_password(password)?;
        if envelope.format_version != ENVELOPE_FORMAT_VERSION {
            return Err(format!(
                "unsupported encrypted backup envelope version: {}",
                envelope.format_version
            ));
        }
        if envelope.cipher != cipher.algorithm() {
            return Err(format!(
                "backup cipher mismatch: expected {}, received {}",
                cipher.algorithm(),
                envelope.cipher
            ));
        }
        let ciphertext = BASE64
            .decode(envelope.payload_base64.as_bytes())
            .map_err(|e| format!("decode encrypted stock portfolio backup: {e}"))?;
        let plaintext = cipher.decrypt(&ciphertext, password)?;
        let backup: StockPortfolioBackup = serde_json::from_slice(&plaintext)
            .map_err(|e| format!("parse stock portfolio backup: {e}"))?;
        self.restore_backup_document(backup, mode)
    }
}

const CSV_HEADERS: [&str; 17] = [
    "id",
    "portfolio",
    "market",
    "exchange",
    "symbol",
    "instrument_id",
    "asset_type",
    "display_name",
    "transaction_type",
    "date",
    "quantity",
    "price",
    "fee",
    "cash_amount",
    "split_ratio",
    "currency",
    "note",
];

fn configure_connection(conn: &Connection) -> Result<(), String> {
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|e| format!("配置股票账本 busy timeout 失败：{e}"))?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("启用股票账本外键失败：{e}"))
}

fn initialize_schema(conn: &Connection) -> Result<(), String> {
    let version = conn
        .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
        .map_err(|e| format!("读取股票账本版本失败：{e}"))?;
    if version > SCHEMA_VERSION {
        return Err(format!(
            "stock portfolio database version {version} is newer than supported version {SCHEMA_VERSION}"
        ));
    }
    conn.execute_batch(
        r#"
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS stock_watchlist (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS stock_watchlist_item (
            watchlist_id TEXT NOT NULL,
            instrument_id TEXT NOT NULL,
            market TEXT NOT NULL,
            exchange TEXT,
            symbol TEXT NOT NULL,
            asset_type TEXT NOT NULL,
            currency TEXT NOT NULL CHECK(currency IN ('CNY', 'HKD', 'USD')),
            display_name TEXT NOT NULL,
            note TEXT,
            added_at INTEGER NOT NULL,
            PRIMARY KEY (watchlist_id, instrument_id),
            FOREIGN KEY (watchlist_id) REFERENCES stock_watchlist(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS stock_portfolio (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            base_currency TEXT NOT NULL CHECK(base_currency IN ('CNY', 'HKD', 'USD')),
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS stock_transaction (
            id TEXT PRIMARY KEY,
            portfolio_id TEXT NOT NULL,
            instrument_id TEXT NOT NULL,
            market TEXT NOT NULL,
            exchange TEXT,
            symbol TEXT NOT NULL,
            asset_type TEXT NOT NULL,
            currency TEXT NOT NULL CHECK(currency IN ('CNY', 'HKD', 'USD')),
            display_name TEXT NOT NULL,
            transaction_type TEXT NOT NULL CHECK(transaction_type IN ('BUY', 'SELL', 'FEE', 'DIVIDEND', 'SPLIT', 'ADJUSTMENT')),
            occurred_at TEXT NOT NULL,
            quantity REAL,
            price REAL,
            fee REAL,
            cash_amount REAL,
            split_ratio REAL,
            note TEXT,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (portfolio_id) REFERENCES stock_portfolio(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_stock_transaction_portfolio_time
            ON stock_transaction(portfolio_id, occurred_at, created_at, id);
        CREATE INDEX IF NOT EXISTS idx_stock_transaction_instrument
            ON stock_transaction(portfolio_id, instrument_id, occurred_at);
        CREATE TABLE IF NOT EXISTS stock_csv_import (
            id TEXT PRIMARY KEY,
            portfolio_id TEXT NOT NULL,
            source_label TEXT NOT NULL,
            imported_at INTEGER NOT NULL,
            total_rows INTEGER NOT NULL CHECK(total_rows >= 0),
            success_count INTEGER NOT NULL CHECK(success_count >= 0),
            failure_count INTEGER NOT NULL CHECK(failure_count >= 0),
            error_summary TEXT,
            FOREIGN KEY (portfolio_id) REFERENCES stock_portfolio(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_stock_csv_import_portfolio_time
            ON stock_csv_import(portfolio_id, imported_at DESC, id DESC);
        PRAGMA user_version = 2;
        COMMIT;
        "#,
    )
    .map_err(|e| format!("初始化股票账本失败：{e}"))
}

fn normalize_csv_import_source(value: &str) -> String {
    let value = value.trim();
    if value.is_empty() {
        DEFAULT_CSV_IMPORT_SOURCE.to_string()
    } else {
        value.chars().take(255).collect()
    }
}

fn csv_data_row_count(document: &str) -> usize {
    csv::decode(document)
        .map(|rows| rows.len().saturating_sub(1))
        .unwrap_or(0)
}

fn csv_import_error_summary(error: &str) -> String {
    const MAX_CHARS: usize = 1_000;
    let mut summary: String = error.chars().take(MAX_CHARS).collect();
    if error.chars().count() > MAX_CHARS {
        summary.push_str("...");
    }
    summary
}

fn insert_csv_import_record(
    conn: &Connection,
    record: &CsvImportRecord,
) -> Result<(), String> {
    conn.execute(
        r#"
        INSERT INTO stock_csv_import (
            id, portfolio_id, source_label, imported_at, total_rows,
            success_count, failure_count, error_summary
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ON CONFLICT(id) DO UPDATE SET
            portfolio_id = excluded.portfolio_id,
            source_label = excluded.source_label,
            imported_at = excluded.imported_at,
            total_rows = excluded.total_rows,
            success_count = excluded.success_count,
            failure_count = excluded.failure_count,
            error_summary = excluded.error_summary
        "#,
        params![
            record.id,
            record.portfolio_id,
            record.source_label,
            record.imported_at,
            record.total_rows as i64,
            record.success_count as i64,
            record.failure_count as i64,
            record.error_summary,
        ],
    )
    .map_err(|e| format!("persist stock CSV import history: {e}"))?;
    Ok(())
}

fn ensure_csv_import_record_matches_backup(
    record: &CsvImportRecord,
    portfolios: &[Portfolio],
) -> Result<(), String> {
    if record.id.trim().is_empty()
        || record.source_label.trim().is_empty()
        || !portfolios.iter().any(|portfolio| portfolio.id == record.portfolio_id)
        || record.success_count.saturating_add(record.failure_count) < record.total_rows
    {
        return Err("invalid stock CSV import record in backup".to_string());
    }
    Ok(())
}

fn load_watchlist_items(
    conn: &Connection,
    watchlist_id: &str,
) -> Result<Vec<WatchlistItem>, String> {
    let mut statement = conn
        .prepare(
            r#"
            SELECT watchlist_id, instrument_id, market, exchange, symbol, asset_type,
                   currency, display_name, note, added_at
            FROM stock_watchlist_item
            WHERE watchlist_id = ?1
            ORDER BY added_at, instrument_id
            "#,
        )
        .map_err(|e| format!("准备自选标的查询失败：{e}"))?;
    let rows = statement
        .query_map([watchlist_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, i64>(9)?,
            ))
        })
        .map_err(|e| format!("查询自选标的失败：{e}"))?;
    let mut items = Vec::new();
    for row in rows {
        let (
            watchlist_id,
            instrument_id,
            market,
            exchange,
            symbol,
            asset_type,
            currency,
            display_name,
            note,
            added_at,
        ) = row.map_err(|e| format!("读取自选标的失败：{e}"))?;
        items.push(WatchlistItem {
            watchlist_id,
            instrument: PortfolioInstrument {
                instrument_id,
                market,
                exchange,
                symbol,
                asset_type,
                currency: Currency::parse(&currency)?,
                display_name,
            },
            note,
            added_at,
        });
    }
    Ok(items)
}

fn load_portfolios(conn: &Connection) -> Result<Vec<Portfolio>, String> {
    let mut statement = conn
        .prepare(
            "SELECT id, name, base_currency, created_at, updated_at FROM stock_portfolio ORDER BY created_at, id",
        )
        .map_err(|e| format!("准备投资组合查询失败：{e}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })
        .map_err(|e| format!("查询投资组合失败：{e}"))?;
    rows.map(|row| {
        let (id, name, currency, created_at, updated_at) =
            row.map_err(|e| format!("读取投资组合失败：{e}"))?;
        Ok(Portfolio {
            id,
            name,
            base_currency: Currency::parse(&currency)?,
            created_at,
            updated_at,
        })
    })
    .collect()
}

fn load_portfolio(conn: &Connection, portfolio_id: &str) -> Result<Portfolio, String> {
    let row: Option<(String, String, String, i64, i64)> = conn
        .query_row(
            "SELECT id, name, base_currency, created_at, updated_at FROM stock_portfolio WHERE id = ?1",
            [portfolio_id.trim()],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        )
        .optional()
        .map_err(|e| format!("读取投资组合失败：{e}"))?;
    let (id, name, currency, created_at, updated_at) =
        row.ok_or_else(|| format!("portfolio not found: {portfolio_id}"))?;
    Ok(Portfolio {
        id,
        name,
        base_currency: Currency::parse(&currency)?,
        created_at,
        updated_at,
    })
}

fn load_transactions(
    conn: &Connection,
    portfolio_id: &str,
) -> Result<Vec<TransactionRecord>, String> {
    let mut statement = conn
        .prepare(
            r#"
            SELECT id, portfolio_id, instrument_id, market, exchange, symbol, asset_type,
                   currency, display_name, transaction_type, occurred_at, quantity, price,
                   fee, cash_amount, split_ratio, note, created_at
            FROM stock_transaction
            WHERE portfolio_id = ?1
            ORDER BY occurred_at, created_at, id
            "#,
        )
        .map_err(|e| format!("准备交易流水查询失败：{e}"))?;
    let rows = statement
        .query_map([portfolio_id.trim()], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, String>(9)?,
                row.get::<_, String>(10)?,
                row.get::<_, Option<f64>>(11)?,
                row.get::<_, Option<f64>>(12)?,
                row.get::<_, Option<f64>>(13)?,
                row.get::<_, Option<f64>>(14)?,
                row.get::<_, Option<f64>>(15)?,
                row.get::<_, Option<String>>(16)?,
                row.get::<_, i64>(17)?,
            ))
        })
        .map_err(|e| format!("查询交易流水失败：{e}"))?;
    rows.map(|row| {
        let row = row.map_err(|e| format!("读取交易流水失败：{e}"))?;
        Ok(TransactionRecord {
            id: row.0,
            portfolio_id: row.1,
            instrument: PortfolioInstrument {
                instrument_id: row.2,
                market: row.3,
                exchange: row.4,
                symbol: row.5,
                asset_type: row.6,
                currency: Currency::parse(&row.7)?,
                display_name: row.8,
            },
            transaction_type: TransactionKind::parse(&row.9)?,
            occurred_at: row.10,
            quantity: row.11,
            price: row.12,
            fee: row.13,
            cash_amount: row.14,
            split_ratio: row.15,
            note: row.16,
            created_at: row.17,
        })
    })
    .collect()
}

fn next_transaction_created_at(
    conn: &Connection,
    portfolio_id: &str,
    proposed: i64,
) -> Result<i64, String> {
    let latest = conn
        .query_row(
            "SELECT MAX(created_at) FROM stock_transaction WHERE portfolio_id = ?1",
            [portfolio_id],
            |row| row.get::<_, Option<i64>>(0),
        )
        .map_err(|e| format!("read latest stock transaction order: {e}"))?;
    match latest {
        Some(latest) if proposed <= latest => latest
            .checked_add(1)
            .ok_or_else(|| "stock transaction order overflow".to_string()),
        _ => Ok(proposed),
    }
}

fn normalize_transaction(input: TransactionInput) -> Result<TransactionRecord, String> {
    let record = TransactionRecord {
        id: match input.id {
            Some(id) => required(&id, "transaction id")?,
            None => Uuid::new_v4().to_string(),
        },
        portfolio_id: required(&input.portfolio_id, "portfolio id")?,
        instrument: normalize_instrument(input.instrument)?,
        transaction_type: input.transaction_type,
        occurred_at: normalize_date(&input.occurred_at)?,
        quantity: finite_option(input.quantity, "quantity")?,
        price: finite_option(input.price, "price")?,
        fee: finite_option(input.fee, "fee")?,
        cash_amount: finite_option(input.cash_amount, "cash amount")?,
        split_ratio: finite_option(input.split_ratio, "split ratio")?,
        note: normalize_optional_text(input.note),
        created_at: now_millis(),
    };
    validate_transaction_record(&record)?;
    Ok(record)
}

fn validate_transaction_record(record: &TransactionRecord) -> Result<(), String> {
    required(&record.id, "transaction id")?;
    required(&record.portfolio_id, "portfolio id")?;
    normalize_instrument(record.instrument.clone())?;
    normalize_date(&record.occurred_at)?;
    for (value, label) in [
        (record.quantity, "quantity"),
        (record.price, "price"),
        (record.fee, "fee"),
        (record.cash_amount, "cash amount"),
        (record.split_ratio, "split ratio"),
    ] {
        finite_option(value, label)?;
    }
    let positive = |value: Option<f64>, label: &str| -> Result<f64, String> {
        let value = value.ok_or_else(|| format!("{label} is required"))?;
        if value <= 0.0 {
            return Err(format!("{label} must be greater than zero"));
        }
        Ok(value)
    };
    let non_negative = |value: Option<f64>, label: &str| -> Result<f64, String> {
        let value = value.unwrap_or(0.0);
        if value < 0.0 {
            return Err(format!("{label} cannot be negative"));
        }
        Ok(value)
    };
    match record.transaction_type {
        TransactionKind::Buy | TransactionKind::Sell => {
            positive(record.quantity, "quantity")?;
            let price = record
                .price
                .ok_or_else(|| "price is required".to_string())?;
            if price < 0.0 {
                return Err("price cannot be negative".to_string());
            }
            non_negative(record.fee, "fee")?;
        }
        TransactionKind::Fee => {
            let amount = record.cash_amount.or(record.fee);
            positive(amount, "fee amount")?;
        }
        TransactionKind::Dividend => {
            positive(record.cash_amount, "dividend cash amount")?;
        }
        TransactionKind::Split => {
            positive(record.split_ratio, "split ratio")?;
        }
        TransactionKind::Adjustment => {
            if record.quantity.unwrap_or(0.0).abs() <= EPSILON
                && record.cash_amount.unwrap_or(0.0).abs() <= EPSILON
            {
                return Err("adjustment requires a quantity or cost-basis change".to_string());
            }
        }
    }
    Ok(())
}

fn insert_transaction(conn: &Transaction<'_>, record: &TransactionRecord) -> Result<(), String> {
    conn.execute(
        r#"
        INSERT INTO stock_transaction (
            id, portfolio_id, instrument_id, market, exchange, symbol, asset_type,
            currency, display_name, transaction_type, occurred_at, quantity, price,
            fee, cash_amount, split_ratio, note, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
        "#,
        params![
            record.id,
            record.portfolio_id,
            record.instrument.instrument_id,
            record.instrument.market,
            record.instrument.exchange,
            record.instrument.symbol,
            record.instrument.asset_type,
            record.instrument.currency.as_str(),
            record.instrument.display_name,
            record.transaction_type.as_str(),
            record.occurred_at,
            record.quantity,
            record.price,
            record.fee,
            record.cash_amount,
            record.split_ratio,
            record.note,
            record.created_at,
        ],
    )
    .map_err(|e| format!("写入交易流水失败：{e}"))?;
    Ok(())
}

fn insert_transaction_upsert(
    conn: &Transaction<'_>,
    record: &TransactionRecord,
) -> Result<(), String> {
    conn.execute(
        r#"
        INSERT INTO stock_transaction (
            id, portfolio_id, instrument_id, market, exchange, symbol, asset_type,
            currency, display_name, transaction_type, occurred_at, quantity, price,
            fee, cash_amount, split_ratio, note, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
        ON CONFLICT(id) DO UPDATE SET
            portfolio_id = excluded.portfolio_id,
            instrument_id = excluded.instrument_id,
            market = excluded.market,
            exchange = excluded.exchange,
            symbol = excluded.symbol,
            asset_type = excluded.asset_type,
            currency = excluded.currency,
            display_name = excluded.display_name,
            transaction_type = excluded.transaction_type,
            occurred_at = excluded.occurred_at,
            quantity = excluded.quantity,
            price = excluded.price,
            fee = excluded.fee,
            cash_amount = excluded.cash_amount,
            split_ratio = excluded.split_ratio,
            note = excluded.note,
            created_at = excluded.created_at
        "#,
        params![
            record.id,
            record.portfolio_id,
            record.instrument.instrument_id,
            record.instrument.market,
            record.instrument.exchange,
            record.instrument.symbol,
            record.instrument.asset_type,
            record.instrument.currency.as_str(),
            record.instrument.display_name,
            record.transaction_type.as_str(),
            record.occurred_at,
            record.quantity,
            record.price,
            record.fee,
            record.cash_amount,
            record.split_ratio,
            record.note,
            record.created_at,
        ],
    )
    .map_err(|e| format!("恢复交易流水失败：{e}"))?;
    Ok(())
}

#[derive(Clone)]
struct PositionAccumulator {
    instrument: PortfolioInstrument,
    quantity: f64,
    cost_basis: f64,
    realized_pnl: f64,
}

fn calculate_positions(
    transactions: &[TransactionRecord],
) -> Result<BTreeMap<String, PositionAccumulator>, String> {
    let mut positions = BTreeMap::new();
    for record in transactions {
        let position = positions
            .entry(record.instrument.instrument_id.clone())
            .or_insert_with(|| PositionAccumulator {
                instrument: record.instrument.clone(),
                quantity: 0.0,
                cost_basis: 0.0,
                realized_pnl: 0.0,
            });
        if position.instrument != record.instrument {
            return Err(format!(
                "instrument metadata changed within ledger: {}",
                record.instrument.instrument_id
            ));
        }
        match record.transaction_type {
            TransactionKind::Buy => {
                let quantity = record.quantity.unwrap_or_default();
                let price = record.price.unwrap_or_default();
                let fee = record.fee.unwrap_or_default();
                position.quantity += quantity;
                position.cost_basis += quantity * price + fee;
            }
            TransactionKind::Sell => {
                let quantity = record.quantity.unwrap_or_default();
                if quantity > position.quantity + EPSILON {
                    return Err(format!(
                        "transaction {} would sell {} shares while only {} are held",
                        record.id, quantity, position.quantity
                    ));
                }
                let average_cost = if position.quantity.abs() <= EPSILON {
                    0.0
                } else {
                    position.cost_basis / position.quantity
                };
                let removed_basis = average_cost * quantity;
                let proceeds =
                    quantity * record.price.unwrap_or_default() - record.fee.unwrap_or_default();
                position.quantity -= quantity;
                position.cost_basis -= removed_basis;
                position.realized_pnl += proceeds - removed_basis;
            }
            TransactionKind::Fee => {
                position.realized_pnl -= record.cash_amount.or(record.fee).unwrap_or_default();
            }
            TransactionKind::Dividend => {
                position.realized_pnl += record.cash_amount.unwrap_or_default();
            }
            TransactionKind::Split => {
                position.quantity *= record.split_ratio.unwrap_or(1.0);
            }
            TransactionKind::Adjustment => {
                position.quantity += record.quantity.unwrap_or_default();
                position.cost_basis += record.cash_amount.unwrap_or_default();
            }
        }
        position.quantity = rounded(position.quantity);
        position.cost_basis = rounded(position.cost_basis);
        position.realized_pnl = rounded(position.realized_pnl);
        if position.quantity < -EPSILON {
            return Err(format!(
                "transaction {} would make holdings negative",
                record.id
            ));
        }
        if position.cost_basis < -EPSILON {
            return Err(format!(
                "transaction {} would make cost basis negative",
                record.id
            ));
        }
        if position.quantity.abs() <= EPSILON {
            position.quantity = 0.0;
            if position.cost_basis.abs() <= EPSILON {
                position.cost_basis = 0.0;
            }
        }
    }
    Ok(positions)
}

fn validate_ledger(conn: &Connection, portfolio_id: &str) -> Result<(), String> {
    calculate_positions(&load_transactions(conn, portfolio_id)?)?;
    Ok(())
}

fn build_snapshot(
    portfolio: Portfolio,
    accumulators: BTreeMap<String, PositionAccumulator>,
    prices: Vec<PriceInput>,
    fx_rates: Vec<FxRateInput>,
) -> Result<PortfolioSnapshot, String> {
    let mut price_map = HashMap::new();
    for price in prices {
        if !price.price.is_finite() || price.price < 0.0 {
            return Err(format!("invalid price for {}", price.instrument_id));
        }
        normalize_date(&price.as_of)?;
        price_map.insert(price.instrument_id.clone(), price);
    }
    let mut warnings = Vec::new();
    let mut positions = Vec::new();
    let mut totals: BTreeMap<Currency, CurrencyAggregate> = BTreeMap::new();
    for accumulator in accumulators.into_values() {
        let quote = price_map.get(&accumulator.instrument.instrument_id);
        if let Some(quote) = quote {
            if quote.currency != accumulator.instrument.currency {
                return Err(format!(
                    "price currency mismatch for {}",
                    accumulator.instrument.instrument_id
                ));
            }
        }
        let requires_quote = accumulator.quantity > EPSILON;
        if quote.is_none() && requires_quote {
            warnings.push(format!(
                "missing current price for {}",
                accumulator.instrument.instrument_id
            ));
        }
        let market_value = quote.map(|quote| rounded(accumulator.quantity * quote.price));
        let unrealized_pnl = market_value.map(|value| rounded(value - accumulator.cost_basis));
        let aggregate = totals.entry(accumulator.instrument.currency).or_default();
        aggregate.cost_basis += accumulator.cost_basis;
        aggregate.realized_pnl += accumulator.realized_pnl;
        if requires_quote && quote.is_none() {
            aggregate.missing_price = true;
        } else {
            aggregate.market_value += market_value.unwrap_or(0.0);
            aggregate.unrealized_pnl += unrealized_pnl.unwrap_or(0.0);
        }
        positions.push(PositionSnapshot {
            instrument: accumulator.instrument,
            quantity: accumulator.quantity,
            average_cost: if accumulator.quantity > EPSILON {
                rounded(accumulator.cost_basis / accumulator.quantity)
            } else {
                0.0
            },
            cost_basis: accumulator.cost_basis,
            realized_pnl: accumulator.realized_pnl,
            current_price: quote.map(|quote| quote.price),
            price_as_of: quote.map(|quote| quote.as_of.clone()),
            market_value,
            unrealized_pnl,
        });
    }
    let totals_by_currency: Vec<CurrencyTotals> = totals
        .iter()
        .map(|(currency, aggregate)| CurrencyTotals {
            currency: *currency,
            cost_basis: rounded(aggregate.cost_basis),
            realized_pnl: rounded(aggregate.realized_pnl),
            market_value: (!aggregate.missing_price).then(|| rounded(aggregate.market_value)),
            unrealized_pnl: (!aggregate.missing_price).then(|| rounded(aggregate.unrealized_pnl)),
        })
        .collect();
    let base_currency_totals = convert_totals(
        portfolio.base_currency,
        &totals_by_currency,
        fx_rates,
        &mut warnings,
    )?;
    Ok(PortfolioSnapshot {
        portfolio,
        positions,
        totals_by_currency,
        base_currency_totals,
        warnings,
    })
}

#[derive(Default)]
struct CurrencyAggregate {
    cost_basis: f64,
    realized_pnl: f64,
    market_value: f64,
    unrealized_pnl: f64,
    missing_price: bool,
}

fn convert_totals(
    base_currency: Currency,
    totals: &[CurrencyTotals],
    fx_rates: Vec<FxRateInput>,
    warnings: &mut Vec<String>,
) -> Result<Option<BaseCurrencyTotals>, String> {
    let mut rate_map = HashMap::new();
    for rate in fx_rates {
        if !rate.rate.is_finite() || rate.rate <= 0.0 {
            return Err(format!(
                "invalid FX rate from {} to {}",
                rate.from_currency.as_str(),
                rate.to_currency.as_str()
            ));
        }
        normalize_date(&rate.as_of)?;
        rate_map.insert((rate.from_currency, rate.to_currency), rate);
    }
    let mut cost_basis = 0.0;
    let mut realized_pnl = 0.0;
    let mut market_value = 0.0;
    let mut unrealized_pnl = 0.0;
    let mut market_complete = true;
    let mut fx_timestamps = Vec::new();
    for total in totals {
        let rate = if total.currency == base_currency {
            1.0
        } else if let Some(input) = rate_map.get(&(total.currency, base_currency)) {
            fx_timestamps.push(input.as_of.clone());
            input.rate
        } else {
            warnings.push(format!(
                "missing FX rate from {} to {}",
                total.currency.as_str(),
                base_currency.as_str()
            ));
            return Ok(None);
        };
        cost_basis += total.cost_basis * rate;
        realized_pnl += total.realized_pnl * rate;
        match (total.market_value, total.unrealized_pnl) {
            (Some(market), Some(unrealized)) => {
                market_value += market * rate;
                unrealized_pnl += unrealized * rate;
            }
            _ => market_complete = false,
        }
    }
    fx_timestamps.sort();
    Ok(Some(BaseCurrencyTotals {
        currency: base_currency,
        cost_basis: rounded(cost_basis),
        realized_pnl: rounded(realized_pnl),
        market_value: market_complete.then(|| rounded(market_value)),
        unrealized_pnl: market_complete.then(|| rounded(unrealized_pnl)),
        fx_as_of: fx_timestamps.first().cloned(),
    }))
}

fn ensure_watchlist_exists(conn: &Connection, watchlist_id: &str) -> Result<(), String> {
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM stock_watchlist WHERE id = ?1)",
            [watchlist_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("检查自选列表失败：{e}"))?;
    if exists {
        Ok(())
    } else {
        Err(format!("watchlist not found: {watchlist_id}"))
    }
}

fn ensure_portfolio_exists(conn: &Connection, portfolio_id: &str) -> Result<(), String> {
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM stock_portfolio WHERE id = ?1)",
            [portfolio_id.trim()],
            |row| row.get(0),
        )
        .map_err(|e| format!("检查投资组合失败：{e}"))?;
    if exists {
        Ok(())
    } else {
        Err(format!("portfolio not found: {portfolio_id}"))
    }
}

fn ensure_instrument_consistency(
    conn: &Connection,
    record: &TransactionRecord,
) -> Result<(), String> {
    let existing: Option<(String, Option<String>, String, String, String, String)> = conn
        .query_row(
            r#"
            SELECT market, exchange, symbol, asset_type, currency, display_name
            FROM stock_transaction
            WHERE portfolio_id = ?1 AND instrument_id = ?2
            LIMIT 1
            "#,
            params![record.portfolio_id, record.instrument.instrument_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .optional()
        .map_err(|e| format!("检查标的元数据失败：{e}"))?;
    if let Some((market, exchange, symbol, asset_type, currency, display_name)) = existing {
        let candidate = &record.instrument;
        if market != candidate.market
            || exchange != candidate.exchange
            || symbol != candidate.symbol
            || asset_type != candidate.asset_type
            || currency != candidate.currency.as_str()
            || display_name != candidate.display_name
        {
            return Err(format!(
                "instrument metadata conflicts with existing ledger: {}",
                candidate.instrument_id
            ));
        }
    }
    Ok(())
}

fn touch_portfolio(conn: &Connection, portfolio_id: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE stock_portfolio SET updated_at = ?2 WHERE id = ?1",
        params![portfolio_id, now_millis()],
    )
    .map_err(|e| format!("更新投资组合时间失败：{e}"))?;
    Ok(())
}

fn restore_watchlists(conn: &Transaction<'_>, views: &[WatchlistView]) -> Result<(), String> {
    for view in views {
        conn.execute(
            r#"
            INSERT INTO stock_watchlist (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)
            ON CONFLICT(id) DO UPDATE SET name = excluded.name, created_at = excluded.created_at, updated_at = excluded.updated_at
            "#,
            params![view.watchlist.id, view.watchlist.name, view.watchlist.created_at, view.watchlist.updated_at],
        )
        .map_err(|e| format!("恢复自选列表失败：{e}"))?;
        for item in &view.items {
            let instrument = normalize_instrument(item.instrument.clone())?;
            conn.execute(
                r#"
                INSERT INTO stock_watchlist_item (
                    watchlist_id, instrument_id, market, exchange, symbol, asset_type,
                    currency, display_name, note, added_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                ON CONFLICT(watchlist_id, instrument_id) DO UPDATE SET
                    market = excluded.market, exchange = excluded.exchange,
                    symbol = excluded.symbol, asset_type = excluded.asset_type,
                    currency = excluded.currency, display_name = excluded.display_name,
                    note = excluded.note, added_at = excluded.added_at
                "#,
                params![
                    view.watchlist.id,
                    instrument.instrument_id,
                    instrument.market,
                    instrument.exchange,
                    instrument.symbol,
                    instrument.asset_type,
                    instrument.currency.as_str(),
                    instrument.display_name,
                    item.note,
                    item.added_at,
                ],
            )
            .map_err(|e| format!("恢复自选标的失败：{e}"))?;
        }
    }
    Ok(())
}

fn restore_portfolios(conn: &Transaction<'_>, portfolios: &[Portfolio]) -> Result<(), String> {
    for portfolio in portfolios {
        conn.execute(
            r#"
            INSERT INTO stock_portfolio (id, name, base_currency, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name, base_currency = excluded.base_currency,
                created_at = excluded.created_at, updated_at = excluded.updated_at
            "#,
            params![
                portfolio.id,
                portfolio.name,
                portfolio.base_currency.as_str(),
                portfolio.created_at,
                portfolio.updated_at
            ],
        )
        .map_err(|e| format!("恢复投资组合失败：{e}"))?;
    }
    Ok(())
}

fn csv_header_map(headers: &[String]) -> Result<HashMap<String, usize>, String> {
    let map: HashMap<String, usize> = headers
        .iter()
        .enumerate()
        .map(|(index, header)| (header.trim().to_ascii_lowercase(), index))
        .collect();
    for required in [
        "portfolio",
        "market",
        "symbol",
        "transaction_type",
        "date",
        "quantity",
        "price",
        "fee",
        "currency",
        "note",
    ] {
        if !map.contains_key(required) {
            return Err(format!("CSV is missing required column: {required}"));
        }
    }
    Ok(map)
}

fn transaction_from_csv_row(
    portfolio: &Portfolio,
    headers: &HashMap<String, usize>,
    row: &[String],
) -> Result<TransactionInput, String> {
    let get = |name: &str| -> &str {
        headers
            .get(name)
            .and_then(|index| row.get(*index))
            .map(String::as_str)
            .unwrap_or("")
            .trim()
    };
    // The selected target portfolio is authoritative. The CSV portfolio name
    // remains useful when exporting, but does not silently redirect imports.
    let market = required(get("market"), "market")?;
    let symbol = required(get("symbol"), "symbol")?;
    let instrument_id = if get("instrument_id").is_empty() {
        format!(
            "{}:{}",
            market.to_ascii_uppercase(),
            symbol.to_ascii_uppercase()
        )
    } else {
        get("instrument_id").to_string()
    };
    Ok(TransactionInput {
        id: optional_string(get("id")),
        portfolio_id: portfolio.id.clone(),
        instrument: PortfolioInstrument {
            instrument_id,
            market,
            exchange: optional_string(get("exchange")),
            symbol: symbol.clone(),
            asset_type: if get("asset_type").is_empty() {
                "stock".to_string()
            } else {
                get("asset_type").to_string()
            },
            currency: Currency::parse(get("currency"))?,
            display_name: if get("display_name").is_empty() {
                symbol
            } else {
                get("display_name").to_string()
            },
        },
        transaction_type: TransactionKind::parse(get("transaction_type"))?,
        occurred_at: get("date").to_string(),
        quantity: optional_f64(get("quantity"), "quantity")?,
        price: optional_f64(get("price"), "price")?,
        fee: optional_f64(get("fee"), "fee")?,
        cash_amount: optional_f64(get("cash_amount"), "cash_amount")?,
        split_ratio: optional_f64(get("split_ratio"), "split_ratio")?,
        note: optional_string(get("note")),
    })
}

fn normalize_instrument(
    mut instrument: PortfolioInstrument,
) -> Result<PortfolioInstrument, String> {
    instrument.instrument_id = required(&instrument.instrument_id, "instrument id")?;
    instrument.market = required(&instrument.market, "market")?.to_ascii_uppercase();
    instrument.symbol = required(&instrument.symbol, "symbol")?;
    instrument.asset_type = required(&instrument.asset_type, "asset type")?.to_ascii_lowercase();
    instrument.display_name = required(&instrument.display_name, "display name")?;
    instrument.exchange = normalize_optional_text(instrument.exchange);
    Ok(instrument)
}

fn required(value: &str, label: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        Err(format!("{label} is required"))
    } else {
        Ok(value.to_string())
    }
}

fn optional_string(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_string())
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value.and_then(|value| optional_string(&value))
}

fn optional_f64(value: &str, label: &str) -> Result<Option<f64>, String> {
    if value.is_empty() {
        return Ok(None);
    }
    let number = value
        .parse::<f64>()
        .map_err(|e| format!("invalid {label}: {e}"))?;
    finite_option(Some(number), label)
}

fn finite_option(value: Option<f64>, label: &str) -> Result<Option<f64>, String> {
    if value.is_some_and(|value| !value.is_finite()) {
        Err(format!("{label} must be finite"))
    } else {
        Ok(value)
    }
}

fn normalize_date(value: &str) -> Result<String, String> {
    let value = required(value, "date")?;
    if let Ok(date) = NaiveDate::parse_from_str(&value, "%Y-%m-%d") {
        return Ok(format!("{}T00:00:00Z", date.format("%Y-%m-%d")));
    }
    DateTime::parse_from_rfc3339(&value)
        .map(|date| date.to_utc().to_rfc3339_opts(SecondsFormat::Secs, true))
        .map_err(|e| format!("date must be YYYY-MM-DD or RFC3339: {e}"))
}

fn option_number(value: Option<f64>) -> String {
    value.map(|value| value.to_string()).unwrap_or_default()
}

fn rounded(value: f64) -> f64 {
    (value * 100_000_000.0).round() / 100_000_000.0
}

fn now_millis() -> i64 {
    Utc::now().timestamp_millis()
}

fn now_rfc3339() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn validate_password(password: &str) -> Result<(), String> {
    if password.chars().count() < 8 {
        Err("backup password must contain at least 8 characters".to_string())
    } else {
        Ok(())
    }
}
