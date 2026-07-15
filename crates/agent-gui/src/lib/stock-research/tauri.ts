import { invoke } from "@tauri-apps/api/core";
import type {
  BacktestResult,
  EncryptedStockBackupEnvelope,
  InstrumentRef,
  MarketBrief,
  MarketBriefRequest,
  PortfolioSnapshot,
  QuoteSnapshot,
  ResearchBundle,
  StockBacktestRequest,
  StockBackupRestoreMode,
  StockEvidenceResult,
  StockResearchPort,
  StockResearchRequest,
  StockResolveRequest,
  StockServiceStatus,
  StockSettings,
  StockSettingsSavePayload,
  StockSnapshotRequest,
} from "./types";

const commands = {
  resolve: "stock_research_resolve",
  snapshot: "stock_research_snapshot",
  research: "stock_research_run",
  marketBrief: "stock_research_market_brief",
  backtest: "stock_research_backtest",
  status: "stock_research_status",
  settingsGet: "stock_settings_get",
  settingsSave: "stock_settings_save",
  portfolioRead: "stock_portfolio_read",
  portfolioImportCsv: "stock_portfolio_import_csv",
  portfolioExportCsv: "stock_portfolio_export_csv",
  portfolioExportEncryptedBackup: "ui_stock_portfolio_export_encrypted_backup",
  portfolioRestoreEncryptedBackup:
    "ui_stock_portfolio_restore_encrypted_backup",
} as const;

export class TauriStockResearchAdapter implements StockResearchPort {
  resolve(request: StockResolveRequest) {
    return invoke<InstrumentRef[]>(commands.resolve, { request });
  }

  snapshot(request: StockSnapshotRequest) {
    return invoke<StockEvidenceResult<QuoteSnapshot>>(commands.snapshot, {
      request,
    });
  }

  research(request: StockResearchRequest) {
    return invoke<StockEvidenceResult<ResearchBundle>>(commands.research, {
      request,
    });
  }

  marketBrief(request: MarketBriefRequest) {
    return invoke<StockEvidenceResult<MarketBrief>>(commands.marketBrief, {
      request,
    });
  }

  backtest(request: StockBacktestRequest) {
    return invoke<StockEvidenceResult<BacktestResult>>(commands.backtest, {
      request,
    });
  }

  status() {
    return invoke<StockServiceStatus>(commands.status);
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
    return invoke<{ fileName: string; csv: string }>(
      commands.portfolioExportCsv,
      { portfolioId }
    );
  }

  portfolioExportEncryptedBackup(password: string) {
    return invoke<EncryptedStockBackupEnvelope>(
      commands.portfolioExportEncryptedBackup,
      {
        password,
      }
    );
  }

  portfolioRestoreEncryptedBackup(
    envelope: EncryptedStockBackupEnvelope,
    password: string,
    mode: StockBackupRestoreMode
  ) {
    return invoke<void>(commands.portfolioRestoreEncryptedBackup, {
      envelope,
      password,
      mode,
    });
  }
}

export const stockResearch = new TauriStockResearchAdapter();
