use super::*;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use rusqlite::Connection;

fn repository() -> StockPortfolioRepository {
    StockPortfolioRepository::new(Connection::open_in_memory().expect("open in-memory sqlite"))
        .expect("initialize stock portfolio repository")
}

fn instrument(id: &str, currency: Currency) -> PortfolioInstrument {
    let market = id.split(':').next().unwrap_or("CN");
    PortfolioInstrument {
        instrument_id: id.to_string(),
        market: market.to_string(),
        exchange: Some(
            match market {
                "CN" => "SSE",
                "HK" => "HKEX",
                _ => "NASDAQ",
            }
            .to_string(),
        ),
        symbol: id.split(':').next_back().unwrap_or(id).to_string(),
        asset_type: "stock".to_string(),
        currency,
        display_name: id.to_string(),
    }
}

fn transaction(
    portfolio_id: &str,
    instrument: PortfolioInstrument,
    transaction_type: TransactionKind,
    date: &str,
) -> TransactionInput {
    TransactionInput {
        id: None,
        portfolio_id: portfolio_id.to_string(),
        instrument,
        transaction_type,
        occurred_at: date.to_string(),
        quantity: None,
        price: None,
        fee: None,
        cash_amount: None,
        split_ratio: None,
        note: None,
    }
}

fn assert_close(actual: f64, expected: f64) {
    assert!(
        (actual - expected).abs() < 1e-8,
        "expected {expected}, received {actual}"
    );
}

#[test]
fn user_can_create_and_list_watchlists_and_portfolios() {
    let mut repo = repository();
    let watchlist = repo.create_watchlist("核心观察").expect("create watchlist");
    let portfolio = repo
        .create_portfolio("长期账户", Currency::Cny)
        .expect("create portfolio");

    assert_eq!(
        repo.list_watchlists().expect("list watchlists")[0].watchlist,
        watchlist
    );
    assert_eq!(
        repo.list_portfolios().expect("list portfolios"),
        vec![portfolio]
    );
}

#[test]
fn user_can_add_and_remove_a_watchlist_instrument() {
    let mut repo = repository();
    let watchlist = repo.create_watchlist("ETF").expect("create watchlist");
    let added = repo
        .add_watchlist_item(
            &watchlist.id,
            instrument("CN:510300", Currency::Cny),
            Some("沪深300\n长期观察".to_string()),
        )
        .expect("add watchlist item");

    let views = repo.list_watchlists().expect("list watchlists");
    assert_eq!(views[0].items, vec![added.clone()]);
    assert!(repo
        .remove_watchlist_item(&watchlist.id, &added.instrument.instrument_id)
        .expect("remove watchlist item"));
    assert!(repo.list_watchlists().expect("list watchlists")[0]
        .items
        .is_empty());
}

#[test]
fn weighted_average_cost_handles_fees_income_sales_and_splits() {
    let mut repo = repository();
    let portfolio = repo
        .create_portfolio("A 股", Currency::Cny)
        .expect("create portfolio");
    let stock = instrument("CN:600519", Currency::Cny);

    let mut buy_one = transaction(
        &portfolio.id,
        stock.clone(),
        TransactionKind::Buy,
        "2026-01-01",
    );
    buy_one.quantity = Some(10.0);
    buy_one.price = Some(100.0);
    buy_one.fee = Some(5.0);
    repo.record_transaction(buy_one).expect("record first buy");

    let mut buy_two = transaction(
        &portfolio.id,
        stock.clone(),
        TransactionKind::Buy,
        "2026-01-02",
    );
    buy_two.quantity = Some(10.0);
    buy_two.price = Some(110.0);
    buy_two.fee = Some(5.0);
    repo.record_transaction(buy_two).expect("record second buy");

    let mut sell = transaction(
        &portfolio.id,
        stock.clone(),
        TransactionKind::Sell,
        "2026-01-03",
    );
    sell.quantity = Some(5.0);
    sell.price = Some(120.0);
    sell.fee = Some(2.0);
    repo.record_transaction(sell).expect("record sell");

    let mut dividend = transaction(
        &portfolio.id,
        stock.clone(),
        TransactionKind::Dividend,
        "2026-01-04",
    );
    dividend.cash_amount = Some(30.0);
    repo.record_transaction(dividend).expect("record dividend");

    let mut fee = transaction(
        &portfolio.id,
        stock.clone(),
        TransactionKind::Fee,
        "2026-01-05",
    );
    fee.cash_amount = Some(10.0);
    repo.record_transaction(fee).expect("record fee");

    let mut split = transaction(&portfolio.id, stock, TransactionKind::Split, "2026-01-06");
    split.split_ratio = Some(2.0);
    repo.record_transaction(split).expect("record split");

    let snapshot = repo
        .portfolio_snapshot(PortfolioSnapshotRequest {
            portfolio_id: portfolio.id,
            prices: vec![PriceInput {
                instrument_id: "CN:600519".to_string(),
                currency: Currency::Cny,
                price: 60.0,
                as_of: "2026-01-07T07:00:00Z".to_string(),
            }],
            fx_rates: Vec::new(),
        })
        .expect("calculate snapshot");
    let position = &snapshot.positions[0];
    assert_close(position.quantity, 30.0);
    assert_close(position.cost_basis, 1_582.5);
    assert_close(position.average_cost, 52.75);
    assert_close(position.realized_pnl, 90.5);
    assert_close(position.market_value.expect("market value"), 1_800.0);
    assert_close(position.unrealized_pnl.expect("unrealized pnl"), 217.5);
}

#[test]
fn invalid_backdated_sale_is_rejected_without_partial_write() {
    let mut repo = repository();
    let portfolio = repo
        .create_portfolio("回滚测试", Currency::Cny)
        .expect("create portfolio");
    let stock = instrument("CN:000001", Currency::Cny);
    let mut buy = transaction(
        &portfolio.id,
        stock.clone(),
        TransactionKind::Buy,
        "2026-02-02",
    );
    buy.quantity = Some(10.0);
    buy.price = Some(10.0);
    repo.record_transaction(buy).expect("record buy");

    let mut sell = transaction(&portfolio.id, stock, TransactionKind::Sell, "2026-02-01");
    sell.quantity = Some(1.0);
    sell.price = Some(11.0);
    assert!(repo.record_transaction(sell).is_err());
    assert_eq!(
        repo.list_transactions(&portfolio.id)
            .expect("list transactions")
            .len(),
        1
    );
}

#[test]
fn deleting_a_required_buy_is_rejected_without_corrupting_the_ledger() {
    let mut repo = repository();
    let portfolio = repo
        .create_portfolio("删除回滚", Currency::Cny)
        .expect("create portfolio");
    let stock = instrument("CN:000002", Currency::Cny);
    let mut buy = transaction(
        &portfolio.id,
        stock.clone(),
        TransactionKind::Buy,
        "2026-02-01",
    );
    buy.quantity = Some(5.0);
    buy.price = Some(10.0);
    let buy = repo.record_transaction(buy).expect("record buy");
    let mut sell = transaction(&portfolio.id, stock, TransactionKind::Sell, "2026-02-02");
    sell.quantity = Some(5.0);
    sell.price = Some(11.0);
    repo.record_transaction(sell).expect("record sell");

    assert!(repo.delete_transaction(&buy.id).is_err());
    assert_eq!(
        repo.list_transactions(&portfolio.id)
            .expect("list transactions")
            .len(),
        2
    );
}

#[test]
fn adjustment_applies_explicit_quantity_and_cost_basis_deltas() {
    let mut repo = repository();
    let portfolio = repo
        .create_portfolio("调整测试", Currency::Usd)
        .expect("create portfolio");
    let stock = instrument("US:AAPL", Currency::Usd);
    let mut adjustment = transaction(
        &portfolio.id,
        stock,
        TransactionKind::Adjustment,
        "2026-02-03",
    );
    adjustment.quantity = Some(4.0);
    adjustment.cash_amount = Some(500.0);
    repo.record_transaction(adjustment)
        .expect("record adjustment");

    let snapshot = repo
        .portfolio_snapshot(PortfolioSnapshotRequest {
            portfolio_id: portfolio.id,
            prices: Vec::new(),
            fx_rates: Vec::new(),
        })
        .expect("calculate snapshot");
    assert_close(snapshot.positions[0].quantity, 4.0);
    assert_close(snapshot.positions[0].cost_basis, 500.0);
    assert_close(snapshot.positions[0].average_cost, 125.0);
}

#[test]
fn aggregate_requires_explicit_timestamped_fx_rates() {
    let mut repo = repository();
    let portfolio = repo
        .create_portfolio("跨币种", Currency::Cny)
        .expect("create portfolio");
    let stock = instrument("HK:00700", Currency::Hkd);
    let mut buy = transaction(&portfolio.id, stock, TransactionKind::Buy, "2026-03-01");
    buy.quantity = Some(10.0);
    buy.price = Some(300.0);
    repo.record_transaction(buy).expect("record buy");

    let without_fx = repo
        .portfolio_snapshot(PortfolioSnapshotRequest {
            portfolio_id: portfolio.id.clone(),
            prices: vec![PriceInput {
                instrument_id: "HK:00700".to_string(),
                currency: Currency::Hkd,
                price: 320.0,
                as_of: "2026-03-02T08:00:00Z".to_string(),
            }],
            fx_rates: Vec::new(),
        })
        .expect("snapshot without FX");
    assert!(without_fx.base_currency_totals.is_none());

    let with_fx = repo
        .portfolio_snapshot(PortfolioSnapshotRequest {
            portfolio_id: portfolio.id,
            prices: vec![PriceInput {
                instrument_id: "HK:00700".to_string(),
                currency: Currency::Hkd,
                price: 320.0,
                as_of: "2026-03-02T08:00:00Z".to_string(),
            }],
            fx_rates: vec![FxRateInput {
                from_currency: Currency::Hkd,
                to_currency: Currency::Cny,
                rate: 0.91,
                as_of: "2026-03-02T08:00:00Z".to_string(),
            }],
        })
        .expect("snapshot with FX");
    let total = with_fx.base_currency_totals.expect("base total");
    assert_close(total.market_value.expect("market value"), 2_912.0);
    assert_eq!(total.fx_as_of.as_deref(), Some("2026-03-02T08:00:00Z"));
}

#[test]
fn csv_round_trip_preserves_all_ledger_fields_and_quoted_notes() {
    let mut source = repository();
    let portfolio = source
        .create_portfolio("CSV 账户", Currency::Cny)
        .expect("create source portfolio");
    let mut buy = transaction(
        &portfolio.id,
        instrument("CN:600000", Currency::Cny),
        TransactionKind::Buy,
        "2026-04-01",
    );
    buy.quantity = Some(100.0);
    buy.price = Some(12.5);
    buy.fee = Some(1.2);
    buy.note = Some("首笔, 包含\"引号\"\n和换行".to_string());
    source.record_transaction(buy).expect("record source buy");
    let document = source
        .export_transactions_csv(&portfolio.id)
        .expect("export CSV");

    let mut target = repository();
    let target_portfolio = target
        .create_portfolio("CSV 账户", Currency::Cny)
        .expect("create target portfolio");
    assert_eq!(
        target
            .import_transactions_csv(&target_portfolio.id, &document)
            .expect("import CSV")
            .imported,
        1
    );
    let imported = target
        .list_transactions(&target_portfolio.id)
        .expect("list imported transactions");
    assert_eq!(
        imported[0].note.as_deref(),
        Some("首笔, 包含\"引号\"\n和换行")
    );
    assert_eq!(imported[0].fee, Some(1.2));

    let imports = target
        .list_csv_import_records(&target_portfolio.id)
        .expect("list CSV import records");
    assert_eq!(imports.len(), 1);
    assert_eq!(imports[0].source_label, DEFAULT_CSV_IMPORT_SOURCE);
    assert_eq!(imports[0].total_rows, 1);
    assert_eq!(imports[0].success_count, 1);
    assert_eq!(imports[0].failure_count, 0);
    assert!(imports[0].error_summary.is_none());
}

#[test]
fn csv_import_history_preserves_the_source_label() {
    let mut repo = repository();
    let portfolio = repo
        .create_portfolio("CSV audit", Currency::Cny)
        .expect("create portfolio");
    let document = concat!(
        "market,symbol,transaction_type,date,quantity,price,currency\r\n",
        "CN,600000,BUY,2026-04-01,100,12.5,CNY\r\n"
    );

    repo.import_transactions_csv_with_source(
        &portfolio.id,
        document,
        "  broker-export.csv  ",
    )
    .expect("import labeled CSV");

    let imports = repo
        .list_csv_import_records(&portfolio.id)
        .expect("list CSV import records");
    assert_eq!(imports.len(), 1);
    assert_eq!(imports[0].portfolio_id, portfolio.id);
    assert_eq!(imports[0].source_label, "broker-export.csv");
    assert!(imports[0].imported_at > 0);
}

#[test]
fn failed_csv_import_is_audited_without_partial_ledger_writes() {
    let mut repo = repository();
    let portfolio = repo
        .create_portfolio("CSV rollback", Currency::Cny)
        .expect("create portfolio");
    let document = concat!(
        "market,symbol,transaction_type,date,quantity,price,currency\r\n",
        "CN,600000,BUY,2026-04-01,100,12.5,CNY\r\n",
        "CN,600001,BUY,not-a-date,100,8.5,CNY\r\n"
    );

    let error = repo
        .import_transactions_csv_with_source(&portfolio.id, document, "broker-export.csv")
        .expect_err("reject invalid CSV import");
    assert!(error.contains("CSV row 3"));
    assert!(repo
        .list_transactions(&portfolio.id)
        .expect("list transactions")
        .is_empty());

    let imports = repo
        .list_csv_import_records(&portfolio.id)
        .expect("list CSV import records");
    assert_eq!(imports.len(), 1);
    assert_eq!(imports[0].total_rows, 2);
    assert_eq!(imports[0].success_count, 0);
    assert_eq!(imports[0].failure_count, 2);
    assert!(imports[0]
        .error_summary
        .as_deref()
        .is_some_and(|summary| summary.contains("CSV row 3")));
}

#[test]
fn stock_hub_overview_uses_the_frontend_compatibility_shape() {
    let mut repo = repository();
    let portfolio = repo
        .create_portfolio("Hub", Currency::Cny)
        .expect("create portfolio");
    let mut buy = transaction(
        &portfolio.id,
        instrument("CN:601318", Currency::Cny),
        TransactionKind::Buy,
        "2026-05-01",
    );
    buy.quantity = Some(20.0);
    buy.price = Some(40.0);
    repo.record_transaction(buy).expect("record buy");

    let overview = repo.ui_overview().expect("read stock hub overview");
    assert_eq!(overview.portfolios[0].base_currency, "CNY");
    assert_eq!(overview.positions[0].instrument.id, "CN:601318");
    assert_eq!(overview.transactions[0].transaction_type, "buy");
    assert_eq!(overview.transactions[0].time, "2026-05-01T00:00:00Z");
}

#[test]
fn exported_file_names_are_safe_on_windows() {
    assert_eq!(safe_file_stem("长期:账户?", "fallback"), "长期_账户_");
    assert_eq!(safe_file_stem("...", "fallback"), "fallback");
}

struct TestCipher;

impl BackupCipher for TestCipher {
    fn algorithm(&self) -> &str {
        "test-xor-v1"
    }

    fn encrypt(&self, plaintext: &[u8], password: &str) -> Result<Vec<u8>, String> {
        Ok(xor(plaintext, password.as_bytes()))
    }

    fn decrypt(&self, ciphertext: &[u8], password: &str) -> Result<Vec<u8>, String> {
        Ok(xor(ciphertext, password.as_bytes()))
    }
}

fn xor(input: &[u8], key: &[u8]) -> Vec<u8> {
    input
        .iter()
        .enumerate()
        .map(|(index, byte)| byte ^ key[index % key.len()])
        .collect()
}

#[test]
fn password_cipher_adapter_round_trips_the_versioned_backup_contract() {
    let mut source = repository();
    source
        .create_watchlist("备份自选")
        .expect("create watchlist");
    let portfolio = source
        .create_portfolio("备份组合", Currency::Usd)
        .expect("create portfolio");
    source
        .import_transactions_csv_with_source(
            &portfolio.id,
            concat!(
                "market,symbol,transaction_type,date,quantity,price,currency\r\n",
                "US,AAPL,BUY,2026-05-01,1,200,USD\r\n"
            ),
            "backup-import.csv",
        )
        .expect("import audited CSV before backup");
    let envelope = source
        .export_backup_with_cipher("correct-horse", &TestCipher)
        .expect("export protected envelope");
    assert_eq!(envelope.cipher, "test-xor-v1");
    assert!(!BASE64
        .decode(envelope.payload_base64.as_bytes())
        .expect("decode envelope")
        .starts_with(b"{"));

    let mut target = repository();
    target
        .restore_backup_with_cipher(
            envelope,
            "correct-horse",
            RestoreMode::ReplaceAll,
            &TestCipher,
        )
        .expect("restore protected envelope");
    assert_eq!(
        target.list_portfolios().expect("list portfolios")[0].name,
        portfolio.name
    );
    assert_eq!(
        target.list_watchlists().expect("list watchlists")[0]
            .watchlist
            .name,
        "备份自选"
    );
    let restored_imports = target
        .list_csv_import_records(&portfolio.id)
        .expect("list restored CSV import history");
    assert_eq!(restored_imports.len(), 1);
    assert_eq!(restored_imports[0].source_label, "backup-import.csv");
}

struct TestBrokerImportPort;

impl BrokerPortfolioImportPort for TestBrokerImportPort {
    fn read_import_batch(
        &self,
        credential: &BrokerCredentialRef,
        request: &BrokerImportRequest,
    ) -> Result<BrokerImportBatch, PortfolioExternalPortError> {
        assert_eq!(credential.local_secret_id(), "secret-store:broker-1");
        Ok(BrokerImportBatch {
            schema_version: BROKER_IMPORT_SCHEMA_VERSION,
            adapter_id: "test-broker".to_string(),
            account: BrokerAccountRef {
                external_account_id: request.external_account_id.clone(),
                display_name: "只读测试账户".to_string(),
                base_currency: Currency::Cny,
            },
            transactions: vec![BrokerTransactionRecord {
                external_transaction_id: "trade-1".to_string(),
                instrument: instrument("CN:600519", Currency::Cny),
                transaction_type: TransactionKind::Buy,
                occurred_at: "2026-06-01".to_string(),
                quantity: Some(1.0),
                price: Some(1500.0),
                fee: Some(1.0),
                cash_amount: None,
                split_ratio: None,
                note: None,
            }],
            as_of: "2026-06-02T00:00:00Z".to_string(),
            next_cursor: None,
            warnings: Vec::new(),
        })
    }
}

#[test]
fn broker_port_is_read_only_and_uses_an_opaque_local_credential_reference() {
    assert_eq!(
        BrokerCredentialRef::new("   "),
        Err(PortfolioExternalPortError::InvalidRequest)
    );
    let credential = BrokerCredentialRef::new("secret-store:broker-1")
        .expect("create local credential reference");
    let request = BrokerImportRequest {
        connection_id: "connection-1".to_string(),
        external_account_id: "account-1".to_string(),
        since: None,
        cursor: None,
    };
    let batch = TestBrokerImportPort
        .read_import_batch(&credential, &request)
        .expect("read normalized broker batch");

    assert_eq!(batch.schema_version, BROKER_IMPORT_SCHEMA_VERSION);
    assert_eq!(batch.transactions.len(), 1);

    let mut repo = repository();
    let portfolio = repo
        .create_portfolio("显式导入目标", Currency::Cny)
        .expect("create local target");
    assert!(repo
        .list_transactions(&portfolio.id)
        .expect("list untouched ledger")
        .is_empty());

    let record = batch.transactions.into_iter().next().expect("broker record");
    repo.record_transaction(TransactionInput {
        id: None,
        portfolio_id: portfolio.id.clone(),
        instrument: record.instrument,
        transaction_type: record.transaction_type,
        occurred_at: record.occurred_at,
        quantity: record.quantity,
        price: record.price,
        fee: record.fee,
        cash_amount: record.cash_amount,
        split_ratio: record.split_ratio,
        note: record.note,
    })
    .expect("explicitly import into selected local portfolio");
    assert_eq!(
        repo.list_transactions(&portfolio.id)
            .expect("list imported ledger")
            .len(),
        1
    );
}

#[derive(Default)]
struct TestPortfolioSyncCrypto {
    opened: std::sync::Mutex<Option<PortfolioSyncPlaintext>>,
}

impl PortfolioSyncCryptoPort for TestPortfolioSyncCrypto {
    fn seal(
        &self,
        key: &PortfolioSyncKeyRef,
        plaintext: &PortfolioSyncPlaintext,
    ) -> Result<EncryptedPortfolioSyncEnvelope, PortfolioExternalPortError> {
        assert_eq!(key.local_key_id(), "secret-store:sync-key-1");
        *self
            .opened
            .lock()
            .map_err(|_| PortfolioExternalPortError::EncryptionFailed)? =
            Some(plaintext.clone());
        Ok(EncryptedPortfolioSyncEnvelope {
            format_version: PORTFOLIO_SYNC_ENVELOPE_VERSION,
            envelope_id: "envelope-1".to_string(),
            source_device_id: plaintext.source_device_id.clone(),
            public_key_id: "public-key-1".to_string(),
            cipher_suite: "test-aead".to_string(),
            nonce_base64: "bm9uY2U=".to_string(),
            ciphertext_base64: "b3BhcXVlLWNpcGhlcnRleHQ=".to_string(),
            created_at: "2026-07-16T00:00:00Z".to_string(),
        })
    }

    fn open(
        &self,
        key: &PortfolioSyncKeyRef,
        _envelope: &EncryptedPortfolioSyncEnvelope,
    ) -> Result<PortfolioSyncPlaintext, PortfolioExternalPortError> {
        assert_eq!(key.local_key_id(), "secret-store:sync-key-1");
        self.opened
            .lock()
            .map_err(|_| PortfolioExternalPortError::DecryptionFailed)?
            .clone()
            .ok_or(PortfolioExternalPortError::DecryptionFailed)
    }
}

struct TestEncryptedSyncTransport;

impl EncryptedPortfolioSyncTransportPort for TestEncryptedSyncTransport {
    fn push(
        &self,
        envelope: &EncryptedPortfolioSyncEnvelope,
    ) -> Result<EncryptedPortfolioSyncReceipt, PortfolioExternalPortError> {
        Ok(EncryptedPortfolioSyncReceipt {
            envelope_id: envelope.envelope_id.clone(),
            accepted_at: "2026-07-16T00:00:01Z".to_string(),
            cursor: "cursor-1".to_string(),
        })
    }

    fn pull(
        &self,
        _after_cursor: Option<&str>,
    ) -> Result<EncryptedPortfolioSyncPage, PortfolioExternalPortError> {
        Ok(EncryptedPortfolioSyncPage {
            envelopes: Vec::new(),
            next_cursor: None,
        })
    }
}

#[test]
fn gateway_sync_port_accepts_only_an_encrypted_envelope() {
    assert_eq!(
        PortfolioSyncKeyRef::new(""),
        Err(PortfolioExternalPortError::InvalidRequest)
    );
    let mut repo = repository();
    repo.create_portfolio("不可见资产", Currency::Cny)
        .expect("create portfolio");
    let plaintext = PortfolioSyncPlaintext {
        schema_version: 1,
        revision: "revision-1".to_string(),
        source_device_id: "device-1".to_string(),
        backup: repo.export_backup_document().expect("export local backup"),
    };
    let key = PortfolioSyncKeyRef::new("secret-store:sync-key-1")
        .expect("create local key reference");
    let crypto = TestPortfolioSyncCrypto::default();
    let envelope = crypto.seal(&key, &plaintext).expect("seal locally");

    let relay_json = serde_json::to_string(&envelope).expect("serialize relay envelope");
    assert!(!relay_json.contains("不可见资产"));
    assert!(!relay_json.contains("secret-store:sync-key-1"));
    assert!(!relay_json.contains("portfolios"));
    assert!(relay_json.contains("ciphertextBase64"));

    let receipt = TestEncryptedSyncTransport
        .push(&envelope)
        .expect("push encrypted envelope");
    assert_eq!(receipt.envelope_id, envelope.envelope_id);
    assert_eq!(
        crypto.open(&key, &envelope).expect("open locally"),
        plaintext
    );
}
