import { invoke } from "@tauri-apps/api/core";
import {
  mapStockBacktestResult,
  mapStockFxRatesResult,
  mapStockMarketBriefResult,
  mapStockResearchResult,
  mapStockResolveEnvelope,
  mapStockServiceStatus,
  mapStockSnapshotResult,
  toSidecarBacktestRequest,
  toSidecarMarketBriefRequest,
  toSidecarResearchRequest,
  toSidecarResolveRequest,
  toSidecarSnapshotRequest,
} from "./contracts";
import type {
  EncryptedStockBackupEnvelope,
  MarketBriefRequest,
  PortfolioSnapshot,
  StockBacktestRequest,
  StockBackupRestoreMode,
  StockCurrency,
  StockFxRateInput,
  StockFxRatePort,
  StockFxRatesRequest,
  StockPortfolioAnalysis,
  StockPortfolioInstrument,
  StockPortfolioRecord,
  StockPriceInput,
  StockResearchPort,
  StockResearchRequest,
  StockResolveRequest,
  StockSettings,
  StockSettingsSavePayload,
  StockSnapshotRequest,
  StockTransactionInput,
  StockTransactionRecord,
  StockWatchlist,
  StockWatchlistItem,
  StockWatchlistView,
} from "./types";

const commands = {
  resolve: "stock_research_resolve",
  fxRates: "stock_research_fx_rates",
  snapshot: "stock_research_snapshot",
  research: "stock_research_run",
  marketBrief: "stock_research_market_brief",
  backtest: "stock_research_backtest",
  status: "stock_research_status",
  restart: "stock_restart",
  settingsGet: "stock_settings_get",
  settingsSave: "stock_settings_save",
  portfolioRead: "stock_portfolio_read",
  portfolioImportCsv: "stock_portfolio_import_csv",
  portfolioExportCsv: "stock_portfolio_export_csv",
  portfolioExportEncryptedBackup: "ui_stock_portfolio_export_encrypted_backup",
  portfolioRestoreEncryptedBackup: "ui_stock_portfolio_restore_encrypted_backup",
  watchlistCreate: "ui_stock_watchlist_create",
  watchlistList: "ui_stock_watchlist_list",
  watchlistAddItem: "ui_stock_watchlist_add_item",
  watchlistRemoveItem: "ui_stock_watchlist_remove_item",
  portfolioCreate: "ui_stock_portfolio_create",
  portfolioList: "ui_stock_portfolio_list",
  portfolioRecordTransaction: "ui_stock_portfolio_record_transaction",
  portfolioDeleteTransaction: "ui_stock_portfolio_delete_transaction",
  portfolioListTransactions: "ui_stock_portfolio_list_transactions",
  portfolioAnalyze: "ui_stock_portfolio_snapshot",
  portfolioImportCsvTo: "ui_stock_portfolio_import_csv",
  portfolioExportCsvOf: "ui_stock_portfolio_export_csv",
} as const;

export class TauriStockResearchAdapter implements StockResearchPort, StockFxRatePort {
  resolve(request: StockResolveRequest) {
    return invoke<unknown>(commands.resolve, {
      request: toSidecarResolveRequest(request),
    }).then(mapStockResolveEnvelope);
  }

  fxRates(request: StockFxRatesRequest) {
    return invoke<unknown>(commands.fxRates, { request }).then(mapStockFxRatesResult);
  }

  snapshot(request: StockSnapshotRequest) {
    return invoke<unknown>(commands.snapshot, {
      request: toSidecarSnapshotRequest(request),
    }).then(mapStockSnapshotResult);
  }

  research(request: StockResearchRequest) {
    return invoke<unknown>(commands.research, {
      request: toSidecarResearchRequest(request),
    }).then(mapStockResearchResult);
  }

  marketBrief(request: MarketBriefRequest) {
    return invoke<unknown>(commands.marketBrief, {
      request: toSidecarMarketBriefRequest(request),
    }).then((raw) =>
      mapStockMarketBriefResult(
        raw,
        request.session === "pre_open" || request.session === "close"
          ? request.session
          : "on_demand",
      ),
    );
  }

  backtest(request: StockBacktestRequest) {
    return invoke<unknown>(commands.backtest, {
      request: toSidecarBacktestRequest(request),
    }).then(mapStockBacktestResult);
  }

  status() {
    return invoke<unknown>(commands.status).then(mapStockServiceStatus);
  }

  restart() {
    return invoke<unknown>(commands.restart).then(mapStockServiceStatus);
  }

  settingsGet() {
    return invoke<StockSettings>(commands.settingsGet);
  }

  settingsSave(payload: StockSettingsSavePayload) {
    return invoke<StockSettings>(commands.settingsSave, { payload });
  }

  portfolioRead() {
    return invoke<PortfolioSnapshot>(commands.portfolioRead);
  }

  portfolioImportCsv(csv: string) {
    return invoke<PortfolioSnapshot>(commands.portfolioImportCsv, { csv });
  }

  portfolioExportCsv(portfolioId?: string) {
    return invoke<{ fileName: string; csv: string }>(commands.portfolioExportCsv, { portfolioId });
  }

  portfolioExportEncryptedBackup(password: string) {
    return invoke<EncryptedStockBackupEnvelope>(commands.portfolioExportEncryptedBackup, {
      password,
    });
  }

  portfolioRestoreEncryptedBackup(
    envelope: EncryptedStockBackupEnvelope,
    password: string,
    mode: StockBackupRestoreMode,
  ) {
    return invoke<void>(commands.portfolioRestoreEncryptedBackup, {
      envelope,
      password,
      mode,
    });
  }

  watchlistCreate(name: string) {
    return invoke<StockWatchlist>(commands.watchlistCreate, { name });
  }

  watchlistList() {
    return invoke<StockWatchlistView[]>(commands.watchlistList);
  }

  watchlistAddItem(watchlistId: string, instrument: StockPortfolioInstrument, note?: string) {
    return invoke<StockWatchlistItem>(commands.watchlistAddItem, {
      watchlistId,
      instrument,
      note: note?.trim() || null,
    });
  }

  watchlistRemoveItem(watchlistId: string, instrumentId: string) {
    return invoke<boolean>(commands.watchlistRemoveItem, { watchlistId, instrumentId });
  }

  portfolioCreate(name: string, baseCurrency: StockCurrency) {
    return invoke<StockPortfolioRecord>(commands.portfolioCreate, { name, baseCurrency });
  }

  portfolioList() {
    return invoke<StockPortfolioRecord[]>(commands.portfolioList);
  }

  portfolioRecordTransaction(input: StockTransactionInput) {
    return invoke<StockTransactionRecord>(commands.portfolioRecordTransaction, { input });
  }

  portfolioDeleteTransaction(transactionId: string) {
    return invoke<boolean>(commands.portfolioDeleteTransaction, { transactionId });
  }

  portfolioListTransactions(portfolioId: string) {
    return invoke<StockTransactionRecord[]>(commands.portfolioListTransactions, { portfolioId });
  }

  portfolioAnalyze(
    portfolioId: string,
    prices: StockPriceInput[] = [],
    fxRates: StockFxRateInput[] = [],
  ) {
    return invoke<StockPortfolioAnalysis>(commands.portfolioAnalyze, {
      request: { portfolioId, prices, fxRates },
    });
  }

  portfolioImportCsvTo(portfolioId: string, document: string) {
    return invoke<{ imported: number }>(commands.portfolioImportCsvTo, {
      portfolioId,
      document,
    });
  }

  portfolioExportCsvOf(portfolioId: string) {
    return invoke<string>(commands.portfolioExportCsvOf, { portfolioId });
  }
}

export const stockResearch = new TauriStockResearchAdapter();
