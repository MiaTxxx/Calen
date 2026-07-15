import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { GlassPanel } from "../../components/hub/HubChrome";
import { Key, Loader2, Plus, RefreshCw, Search, Trash2, Upload } from "../../components/icons";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import {
  type EncryptedStockBackupEnvelope,
  formatStockError,
  type InstrumentRef,
  type StockBackupRestoreMode,
  type StockCurrency,
  type StockFxRateInput,
  type StockPortfolioAnalysis,
  type StockPortfolioInstrument,
  type StockPortfolioRecord,
  type StockTransactionInput,
  type StockTransactionKind,
  type StockTransactionRecord,
  type StockWatchlistView,
  stockResearch,
} from "../../lib/stock-research";

const transactionKinds: Array<{ value: StockTransactionKind; label: string }> = [
  { value: "BUY", label: "买入" },
  { value: "SELL", label: "卖出" },
  { value: "FEE", label: "费用" },
  { value: "DIVIDEND", label: "分红" },
  { value: "SPLIT", label: "拆股" },
  { value: "ADJUSTMENT", label: "调整" },
];

type Resource<T> =
  | { state: "loading" }
  | { state: "ready"; data: T }
  | { state: "error"; message: string };

type TransactionDraft = {
  transactionType: StockTransactionKind;
  market: "CN" | "HK" | "US";
  symbol: string;
  displayName: string;
  currency: StockCurrency;
  assetType: "stock" | "etf";
  occurredAt: string;
  quantity: string;
  price: string;
  fee: string;
  cashAmount: string;
  splitRatio: string;
  note: string;
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function initialTransactionDraft(): TransactionDraft {
  return {
    transactionType: "BUY",
    market: "CN",
    symbol: "",
    displayName: "",
    currency: "CNY",
    assetType: "stock",
    occurredAt: today(),
    quantity: "",
    price: "",
    fee: "",
    cashAmount: "",
    splitRatio: "",
    note: "",
  };
}

function finite(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function displayNumber(value: number | null | undefined, currency?: string) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ""}`;
}

function toPortfolioInstrument(instrument: InstrumentRef): StockPortfolioInstrument {
  return {
    instrumentId: instrument.id,
    market: instrument.market,
    exchange: instrument.exchange || null,
    symbol: instrument.symbol,
    assetType: instrument.assetType,
    currency: instrument.currency as StockCurrency,
    displayName: instrument.name,
  };
}

function inferExchange(market: string, symbol: string) {
  if (market === "HK") return "HKEX";
  if (market === "US") return "US";
  if (symbol.startsWith("5") || symbol.startsWith("6")) return "SSE";
  if (symbol.startsWith("8") || symbol.startsWith("4")) return "BSE";
  return "SZSE";
}

function readTextFile(event: ChangeEvent<HTMLInputElement>, onRead: (value: string) => void) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  void file.text().then(onRead);
}

export function PortfolioWorkspace() {
  const [portfolios, setPortfolios] = useState<Resource<StockPortfolioRecord[]>>({
    state: "loading",
  });
  const [watchlists, setWatchlists] = useState<Resource<StockWatchlistView[]>>({
    state: "loading",
  });
  const [selectedPortfolioId, setSelectedPortfolioId] = useState("");
  const [selectedWatchlistId, setSelectedWatchlistId] = useState("");
  const [analysis, setAnalysis] = useState<Resource<StockPortfolioAnalysis>>({ state: "loading" });
  const [transactions, setTransactions] = useState<Resource<StockTransactionRecord[]>>({
    state: "loading",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [newPortfolioName, setNewPortfolioName] = useState("");
  const [newPortfolioCurrency, setNewPortfolioCurrency] = useState<StockCurrency>("CNY");
  const [newWatchlistName, setNewWatchlistName] = useState("");
  const [transaction, setTransaction] = useState<TransactionDraft>(initialTransactionDraft);
  const [csv, setCsv] = useState("");
  const [watchQuery, setWatchQuery] = useState("");
  const [watchMatches, setWatchMatches] = useState<InstrumentRef[]>([]);
  const [watchSearching, setWatchSearching] = useState(false);
  const [fxDrafts, setFxDrafts] = useState<Record<StockCurrency, string>>({
    CNY: "",
    HKD: "",
    USD: "",
  });
  const loadSequence = useRef(0);
  const watchSearchSequence = useRef(0);
  const busyActionRef = useRef<string | null>(null);

  const selectedPortfolio = useMemo(
    () =>
      portfolios.state === "ready"
        ? (portfolios.data.find((portfolio) => portfolio.id === selectedPortfolioId) ?? null)
        : null,
    [portfolios, selectedPortfolioId],
  );

  const loadCatalogs = useCallback(async () => {
    try {
      const [nextPortfolios, nextWatchlists] = await Promise.all([
        stockResearch.portfolioList(),
        stockResearch.watchlistList(),
      ]);
      setPortfolios({ state: "ready", data: nextPortfolios });
      setWatchlists({ state: "ready", data: nextWatchlists });
      setSelectedPortfolioId((current) =>
        nextPortfolios.some((item) => item.id === current)
          ? current
          : (nextPortfolios[0]?.id ?? ""),
      );
      setSelectedWatchlistId((current) =>
        nextWatchlists.some((item) => item.id === current)
          ? current
          : (nextWatchlists[0]?.id ?? ""),
      );
    } catch (nextError) {
      const message = formatStockError(nextError);
      setPortfolios({ state: "error", message });
      setWatchlists({ state: "error", message });
    }
  }, []);

  const loadPortfolio = useCallback(
    async (portfolioId: string, fxRates: StockFxRateInput[] = []) => {
      const sequence = ++loadSequence.current;
      if (!portfolioId) {
        setAnalysis({ state: "error", message: "请先创建一个组合。" });
        setTransactions({ state: "ready", data: [] });
        return;
      }
      setAnalysis({ state: "loading" });
      setTransactions({ state: "loading" });
      try {
        const [base, nextTransactions] = await Promise.all([
          stockResearch.portfolioAnalyze(portfolioId),
          stockResearch.portfolioListTransactions(portfolioId),
        ]);
        const livePositions = base.positions.filter(
          (position) => Math.abs(position.quantity) > 1e-9,
        );
        const quoteResults = await Promise.all(
          livePositions.map(async (position) => {
            try {
              const result = await stockResearch.snapshot({
                instrument: {
                  id: position.instrument.instrumentId,
                  symbol: position.instrument.symbol,
                  name: position.instrument.displayName,
                  market: position.instrument.market as InstrumentRef["market"],
                  exchange: position.instrument.exchange ?? "",
                  assetType: position.instrument.assetType as InstrumentRef["assetType"],
                  currency: position.instrument.currency,
                },
              });
              return result.data?.price === null || result.data?.price === undefined
                ? null
                : {
                    instrumentId: position.instrument.instrumentId,
                    currency: position.instrument.currency,
                    price: result.data.price,
                    asOf: result.asOf ?? result.retrievedAt,
                  };
            } catch {
              return null;
            }
          }),
        );
        const prices = quoteResults.filter(
          (item): item is NonNullable<typeof item> => item !== null,
        );
        const enriched =
          prices.length || fxRates.length
            ? await stockResearch.portfolioAnalyze(portfolioId, prices, fxRates)
            : base;
        if (prices.length < livePositions.length) {
          enriched.warnings = [
            ...enriched.warnings,
            `仅 ${prices.length}/${livePositions.length} 个持仓取得了当前行情；缺失市值不会被推算。`,
          ];
        }
        if (sequence !== loadSequence.current) return;
        setAnalysis({ state: "ready", data: enriched });
        setTransactions({ state: "ready", data: nextTransactions });
      } catch (nextError) {
        if (sequence !== loadSequence.current) return;
        const message = formatStockError(nextError);
        setAnalysis({ state: "error", message });
        setTransactions({ state: "error", message });
      }
    },
    [],
  );

  useEffect(() => {
    void loadCatalogs();
  }, [loadCatalogs]);

  useEffect(() => {
    if (selectedPortfolioId) void loadPortfolio(selectedPortfolioId);
  }, [loadPortfolio, selectedPortfolioId]);

  async function run(action: string, callback: () => Promise<void>) {
    if (busyActionRef.current) return;
    busyActionRef.current = action;
    setBusy(action);
    setError(null);
    try {
      await callback();
    } catch (nextError) {
      setError(formatStockError(nextError));
    } finally {
      busyActionRef.current = null;
      setBusy(null);
    }
  }

  async function createPortfolio(event: FormEvent) {
    event.preventDefault();
    if (!newPortfolioName.trim()) return;
    await run("create-portfolio", async () => {
      const created = await stockResearch.portfolioCreate(
        newPortfolioName.trim(),
        newPortfolioCurrency,
      );
      setNewPortfolioName("");
      await loadCatalogs();
      setSelectedPortfolioId(created.id);
    });
  }

  async function createWatchlist(event: FormEvent) {
    event.preventDefault();
    if (!newWatchlistName.trim()) return;
    await run("create-watchlist", async () => {
      const created = await stockResearch.watchlistCreate(newWatchlistName.trim());
      setNewWatchlistName("");
      await loadCatalogs();
      setSelectedWatchlistId(created.id);
    });
  }

  async function recordTransaction(event: FormEvent) {
    event.preventDefault();
    if (!selectedPortfolioId || !transaction.symbol.trim()) return;
    const input: StockTransactionInput = {
      portfolioId: selectedPortfolioId,
      instrument: {
        instrumentId: `${transaction.market}:${transaction.symbol.trim().toUpperCase()}`,
        market: transaction.market,
        exchange: inferExchange(transaction.market, transaction.symbol),
        symbol: transaction.symbol.trim().toUpperCase(),
        assetType: transaction.assetType,
        currency: transaction.currency,
        displayName: transaction.displayName.trim() || transaction.symbol.trim().toUpperCase(),
      },
      transactionType: transaction.transactionType,
      occurredAt: transaction.occurredAt,
      quantity: finite(transaction.quantity),
      price: finite(transaction.price),
      fee: finite(transaction.fee),
      cashAmount: finite(transaction.cashAmount),
      splitRatio: finite(transaction.splitRatio),
      note: transaction.note.trim() || null,
    };
    await run("record-transaction", async () => {
      await stockResearch.portfolioRecordTransaction(input);
      setTransaction(initialTransactionDraft());
      await loadPortfolio(selectedPortfolioId);
    });
  }

  async function searchWatchInstrument(event: FormEvent) {
    event.preventDefault();
    const query = watchQuery.trim();
    if (!query) return;
    const sequence = ++watchSearchSequence.current;
    setWatchSearching(true);
    setError(null);
    try {
      const result = await stockResearch.resolve({ query, limit: 8 });
      if (sequence !== watchSearchSequence.current) return;
      setWatchMatches(result.instruments);
    } catch (nextError) {
      if (sequence !== watchSearchSequence.current) return;
      setError(formatStockError(nextError));
    } finally {
      if (sequence === watchSearchSequence.current) {
        setWatchSearching(false);
      }
    }
  }

  async function addWatchInstrument(instrument: InstrumentRef) {
    if (!selectedWatchlistId) return;
    await run(`watch-add-${instrument.id}`, async () => {
      await stockResearch.watchlistAddItem(selectedWatchlistId, toPortfolioInstrument(instrument));
      setWatchMatches([]);
      setWatchQuery("");
      await loadCatalogs();
    });
  }

  async function applyFxRates() {
    if (!selectedPortfolio) return;
    const asOf = new Date().toISOString();
    const fxRates = (Object.entries(fxDrafts) as Array<[StockCurrency, string]>).flatMap(
      ([fromCurrency, raw]) => {
        const rate = finite(raw);
        return rate && fromCurrency !== selectedPortfolio.baseCurrency
          ? [
              {
                fromCurrency,
                toCurrency: selectedPortfolio.baseCurrency,
                rate,
                asOf,
              } satisfies StockFxRateInput,
            ]
          : [];
      },
    );
    await loadPortfolio(selectedPortfolio.id, fxRates);
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <GlassPanel>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">组合分析</h2>
              <p className="mt-1 text-[11px] text-muted-foreground">
                原币账本是权威值；只有取得带时间戳行情和汇率时才计算市值与基准币汇总。
              </p>
            </div>
            <div className="flex gap-2">
              <select
                value={selectedPortfolioId}
                onChange={(event) => setSelectedPortfolioId(event.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-xs"
              >
                <option value="">选择组合</option>
                {portfolios.state === "ready"
                  ? portfolios.data.map((portfolio) => (
                      <option key={portfolio.id} value={portfolio.id}>
                        {portfolio.name} · {portfolio.baseCurrency}
                      </option>
                    ))
                  : null}
              </select>
              <Button
                variant="outline"
                size="icon"
                onClick={() => selectedPortfolioId && void loadPortfolio(selectedPortfolioId)}
                disabled={!selectedPortfolioId || analysis.state === "loading"}
                aria-label="刷新组合行情"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {analysis.state === "loading" ? (
            <div className="flex items-center justify-center py-12 text-xs text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 正在核算账本并获取行情…
            </div>
          ) : analysis.state === "error" ? (
            <p className="py-8 text-xs text-destructive">{analysis.message}</p>
          ) : (
            <PortfolioAnalysisTable analysis={analysis.data} />
          )}
        </GlassPanel>

        <div className="space-y-4">
          <GlassPanel>
            <h2 className="text-sm font-semibold">创建组合</h2>
            <form
              onSubmit={createPortfolio}
              className="mt-3 grid grid-cols-[minmax(0,1fr)_90px_auto] gap-2"
            >
              <Input
                value={newPortfolioName}
                onChange={(event) => setNewPortfolioName(event.target.value)}
                placeholder="例如：长期账户"
              />
              <select
                value={newPortfolioCurrency}
                onChange={(event) => setNewPortfolioCurrency(event.target.value as StockCurrency)}
                className="rounded-md border border-input bg-background px-2 text-xs"
              >
                <option value="CNY">CNY</option>
                <option value="HKD">HKD</option>
                <option value="USD">USD</option>
              </select>
              <Button type="submit" size="icon" disabled={busy === "create-portfolio"}>
                <Plus className="h-4 w-4" />
              </Button>
            </form>
          </GlassPanel>

          <GlassPanel>
            <h2 className="text-sm font-semibold">汇率换算</h2>
            <p className="mt-1 text-[10.5px] text-muted-foreground">
              填写 1 单位原币兑换组合基准币的汇率；保存时间使用当前时间。
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {(["CNY", "HKD", "USD"] as const)
                .filter((currency) => currency !== selectedPortfolio?.baseCurrency)
                .map((currency) => (
                  <div key={currency} className="text-[10.5px] text-muted-foreground">
                    {currency} → {selectedPortfolio?.baseCurrency ?? "基准币"}
                    <Input
                      aria-label={`${currency} 兑换 ${selectedPortfolio?.baseCurrency ?? "基准币"} 的汇率`}
                      className="mt-1"
                      inputMode="decimal"
                      value={fxDrafts[currency]}
                      onChange={(event) =>
                        setFxDrafts((current) => ({ ...current, [currency]: event.target.value }))
                      }
                      placeholder="留空则不换算"
                    />
                  </div>
                ))}
            </div>
            <Button
              className="mt-3 w-full"
              variant="outline"
              onClick={() => void applyFxRates()}
              disabled={!selectedPortfolioId || analysis.state === "loading"}
            >
              应用带时间戳汇率
            </Button>
          </GlassPanel>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <GlassPanel>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">完整交易流水</h2>
              <p className="mt-1 text-[10.5px] text-muted-foreground">
                支持买卖、费用、分红、拆股和调整；删除会重新校验后续账本。
              </p>
            </div>
            <CsvActions
              portfolio={selectedPortfolio}
              csv={csv}
              setCsv={setCsv}
              onImported={() => {
                if (selectedPortfolioId) return loadPortfolio(selectedPortfolioId);
              }}
              run={run}
              busy={busy}
            />
          </div>
          <TransactionTable
            resource={transactions}
            busy={busy}
            onDelete={(transactionId) =>
              run(`delete-${transactionId}`, async () => {
                await stockResearch.portfolioDeleteTransaction(transactionId);
                await loadPortfolio(selectedPortfolioId);
              })
            }
          />
        </GlassPanel>

        <GlassPanel>
          <h2 className="text-sm font-semibold">记录一笔流水</h2>
          <TransactionForm
            draft={transaction}
            setDraft={setTransaction}
            onSubmit={recordTransaction}
            disabled={!selectedPortfolioId || busy === "record-transaction"}
          />
        </GlassPanel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <WatchlistPanel
          resource={watchlists}
          selectedId={selectedWatchlistId}
          setSelectedId={setSelectedWatchlistId}
          newName={newWatchlistName}
          setNewName={setNewWatchlistName}
          onCreate={createWatchlist}
          query={watchQuery}
          setQuery={(nextQuery) => {
            watchSearchSequence.current += 1;
            setWatchQuery(nextQuery);
            setWatchMatches([]);
            setWatchSearching(false);
          }}
          matches={watchMatches}
          searching={watchSearching}
          onSearch={searchWatchInstrument}
          onAdd={addWatchInstrument}
          onRemove={(watchlistId, instrumentId) =>
            run(`watch-remove-${instrumentId}`, async () => {
              await stockResearch.watchlistRemoveItem(watchlistId, instrumentId);
              await loadCatalogs();
            })
          }
        />
        <EncryptedBackupPanel onRestored={loadCatalogs} />
      </div>
    </div>
  );
}

function PortfolioAnalysisTable({ analysis }: { analysis: StockPortfolioAnalysis }) {
  return (
    <>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {analysis.totalsByCurrency.map((total) => (
          <div
            key={total.currency}
            className="rounded-xl border border-border/40 bg-background/45 p-3"
          >
            <div className="text-[10px] text-muted-foreground">{total.currency} 原币汇总</div>
            <div className="mt-1 text-xs">成本 {displayNumber(total.costBasis)}</div>
            <div className="mt-1 text-xs">已实现 {displayNumber(total.realizedPnl)}</div>
            <div className="mt-1 text-xs">市值 {displayNumber(total.marketValue)}</div>
          </div>
        ))}
        {analysis.baseCurrencyTotals ? (
          <div className="rounded-xl border border-primary/25 bg-primary/5 p-3">
            <div className="text-[10px] text-muted-foreground">
              {analysis.baseCurrencyTotals.currency} 组合汇总
            </div>
            <div className="mt-1 text-xs">
              市值 {displayNumber(analysis.baseCurrencyTotals.marketValue)}
            </div>
            <div className="mt-1 text-xs">
              浮盈 {displayNumber(analysis.baseCurrencyTotals.unrealizedPnl)}
            </div>
            <div className="mt-1 text-[9.5px] text-muted-foreground">
              FX {analysis.baseCurrencyTotals.fxAsOf ?? "未使用汇率"}
            </div>
          </div>
        ) : null}
      </div>
      {analysis.positions.length ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="pb-3 font-medium">标的</th>
                <th className="pb-3 font-medium">数量</th>
                <th className="pb-3 font-medium">平均成本</th>
                <th className="pb-3 font-medium">当前价</th>
                <th className="pb-3 font-medium">市值</th>
                <th className="pb-3 font-medium">已实现</th>
                <th className="pb-3 font-medium">浮动盈亏</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/35">
              {analysis.positions.map((position) => (
                <tr key={position.instrument.instrumentId}>
                  <td className="py-3">
                    <div className="font-medium">{position.instrument.displayName}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {position.instrument.market} · {position.instrument.symbol}
                    </div>
                  </td>
                  <td className="py-3 tabular-nums">{position.quantity}</td>
                  <td className="py-3 tabular-nums">{displayNumber(position.averageCost)}</td>
                  <td className="py-3 tabular-nums">
                    {displayNumber(position.currentPrice, position.instrument.currency)}
                  </td>
                  <td className="py-3 tabular-nums">{displayNumber(position.marketValue)}</td>
                  <td className="py-3 tabular-nums">{displayNumber(position.realizedPnl)}</td>
                  <td className="py-3 tabular-nums">{displayNumber(position.unrealizedPnl)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="py-10 text-center text-xs text-muted-foreground">
          尚无持仓，请导入或记录流水。
        </p>
      )}
      {analysis.warnings.length ? (
        <ul className="mt-3 space-y-1 text-[10.5px] text-amber-700 dark:text-amber-300">
          {analysis.warnings.map((warning) => (
            <li key={warning}>• {warning}</li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function TransactionForm({
  draft,
  setDraft,
  onSubmit,
  disabled,
}: {
  draft: TransactionDraft;
  setDraft: (value: TransactionDraft) => void;
  onSubmit: (event: FormEvent) => void;
  disabled: boolean;
}) {
  const update = (patch: Partial<TransactionDraft>) => setDraft({ ...draft, ...patch });
  return (
    <form onSubmit={onSubmit} className="mt-3 space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <select
          value={draft.transactionType}
          onChange={(event) =>
            update({ transactionType: event.target.value as StockTransactionKind })
          }
          className="h-9 rounded-md border border-input bg-background px-2 text-xs"
        >
          {transactionKinds.map((kind) => (
            <option key={kind.value} value={kind.value}>
              {kind.label}
            </option>
          ))}
        </select>
        <select
          value={draft.market}
          onChange={(event) => {
            const market = event.target.value as TransactionDraft["market"];
            update({ market, currency: market === "HK" ? "HKD" : market === "US" ? "USD" : "CNY" });
          }}
          className="h-9 rounded-md border border-input bg-background px-2 text-xs"
        >
          <option value="CN">A 股</option>
          <option value="HK">港股</option>
          <option value="US">美股</option>
        </select>
        <select
          value={draft.assetType}
          onChange={(event) =>
            update({ assetType: event.target.value as TransactionDraft["assetType"] })
          }
          className="h-9 rounded-md border border-input bg-background px-2 text-xs"
        >
          <option value="stock">股票</option>
          <option value="etf">ETF</option>
        </select>
        <Input
          type="date"
          value={draft.occurredAt}
          onChange={(event) => update({ occurredAt: event.target.value })}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input
          value={draft.symbol}
          onChange={(event) => update({ symbol: event.target.value })}
          placeholder="证券代码"
        />
        <Input
          value={draft.displayName}
          onChange={(event) => update({ displayName: event.target.value })}
          placeholder="名称（可选）"
        />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Input
          inputMode="decimal"
          value={draft.quantity}
          onChange={(event) => update({ quantity: event.target.value })}
          placeholder="数量"
        />
        <Input
          inputMode="decimal"
          value={draft.price}
          onChange={(event) => update({ price: event.target.value })}
          placeholder="价格"
        />
        <Input
          inputMode="decimal"
          value={draft.fee}
          onChange={(event) => update({ fee: event.target.value })}
          placeholder="费用"
        />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Input
          inputMode="decimal"
          value={draft.cashAmount}
          onChange={(event) => update({ cashAmount: event.target.value })}
          placeholder="现金额/成本调整"
        />
        <Input
          inputMode="decimal"
          value={draft.splitRatio}
          onChange={(event) => update({ splitRatio: event.target.value })}
          placeholder="拆股比例"
        />
        <select
          value={draft.currency}
          onChange={(event) => update({ currency: event.target.value as StockCurrency })}
          className="h-9 rounded-md border border-input bg-background px-2 text-xs"
        >
          <option value="CNY">CNY</option>
          <option value="HKD">HKD</option>
          <option value="USD">USD</option>
        </select>
      </div>
      <Textarea
        value={draft.note}
        onChange={(event) => update({ note: event.target.value })}
        placeholder="备注"
        className="min-h-16"
      />
      <Button type="submit" className="w-full" disabled={disabled}>
        保存流水
      </Button>
    </form>
  );
}

function TransactionTable({
  resource,
  busy,
  onDelete,
}: {
  resource: Resource<StockTransactionRecord[]>;
  busy: string | null;
  onDelete: (id: string) => Promise<void>;
}) {
  if (resource.state === "loading")
    return <p className="py-8 text-xs text-muted-foreground">读取流水…</p>;
  if (resource.state === "error")
    return <p className="py-8 text-xs text-destructive">{resource.message}</p>;
  if (!resource.data.length)
    return <p className="py-8 text-xs text-muted-foreground">该组合暂无流水。</p>;
  return (
    <div className="mt-4 max-h-80 overflow-auto">
      <table className="w-full min-w-[760px] text-left text-[11px]">
        <thead className="sticky top-0 bg-background text-muted-foreground">
          <tr>
            <th className="py-2">日期</th>
            <th>类型</th>
            <th>标的</th>
            <th>数量</th>
            <th>价格/现金</th>
            <th>费用</th>
            <th>备注</th>
            <th />
          </tr>
        </thead>
        <tbody className="divide-y divide-border/35">
          {[...resource.data].reverse().map((record) => (
            <tr key={record.id}>
              <td className="py-2">{record.occurredAt.slice(0, 10)}</td>
              <td>{record.transactionType}</td>
              <td>
                {record.instrument.displayName}
                <span className="ml-1 text-muted-foreground">{record.instrument.symbol}</span>
              </td>
              <td>{record.quantity ?? "—"}</td>
              <td>{record.price ?? record.cashAmount ?? record.splitRatio ?? "—"}</td>
              <td>{record.fee ?? "—"}</td>
              <td className="max-w-40 truncate">{record.note ?? ""}</td>
              <td>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={busy === `delete-${record.id}`}
                  onClick={() => void onDelete(record.id)}
                  aria-label="删除流水"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CsvActions({
  portfolio,
  csv,
  setCsv,
  onImported,
  run,
  busy,
}: {
  portfolio: StockPortfolioRecord | null;
  csv: string;
  setCsv: (value: string) => void;
  onImported: () => Promise<void> | void;
  run: (action: string, callback: () => Promise<void>) => Promise<void>;
  busy: string | null;
}) {
  async function exportCsv() {
    if (!portfolio) return;
    await run("csv-export", async () => {
      const document = await stockResearch.portfolioExportCsvOf(portfolio.id);
      const url = URL.createObjectURL(new Blob([document], { type: "text/csv;charset=utf-8" }));
      const anchor = documentElement("a");
      anchor.href = url;
      anchor.download = `${portfolio.name.replace(/[<>:"/\\|?*]/g, "-")}-transactions.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    });
  }
  async function importCsv() {
    if (!portfolio || !csv.trim()) return;
    await run("csv-import", async () => {
      await stockResearch.portfolioImportCsvTo(portfolio.id, csv);
      setCsv("");
      await onImported();
    });
  }
  return (
    <div className="flex items-center gap-2">
      <label className="inline-flex h-8 cursor-pointer items-center rounded-md border border-input px-2 text-[10.5px] hover:bg-muted">
        <Upload className="mr-1 h-3.5 w-3.5" /> 导入
        <input
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(event) => readTextFile(event, setCsv)}
        />
      </label>
      <Button
        size="sm"
        variant="outline"
        onClick={() => void importCsv()}
        disabled={!portfolio || !csv.trim() || busy !== null}
      >
        确认导入
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => void exportCsv()}
        disabled={!portfolio || busy !== null}
      >
        导出
      </Button>
    </div>
  );
}

function documentElement(tag: "a") {
  return window.document.createElement(tag);
}

function WatchlistPanel({
  resource,
  selectedId,
  setSelectedId,
  newName,
  setNewName,
  onCreate,
  query,
  setQuery,
  matches,
  searching,
  onSearch,
  onAdd,
  onRemove,
}: {
  resource: Resource<StockWatchlistView[]>;
  selectedId: string;
  setSelectedId: (value: string) => void;
  newName: string;
  setNewName: (value: string) => void;
  onCreate: (event: FormEvent) => void;
  query: string;
  setQuery: (value: string) => void;
  matches: InstrumentRef[];
  searching: boolean;
  onSearch: (event: FormEvent) => void;
  onAdd: (instrument: InstrumentRef) => Promise<void>;
  onRemove: (watchlistId: string, instrumentId: string) => Promise<void>;
}) {
  const selected =
    resource.state === "ready" ? resource.data.find((item) => item.id === selectedId) : null;
  return (
    <GlassPanel>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">自选分组</h2>
          <p className="mt-1 text-[10.5px] text-muted-foreground">按本地分组管理股票与 ETF。</p>
        </div>
        <select
          value={selectedId}
          onChange={(event) => setSelectedId(event.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-xs"
        >
          <option value="">选择分组</option>
          {resource.state === "ready"
            ? resource.data.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))
            : null}
        </select>
      </div>
      <form onSubmit={onCreate} className="mt-3 flex gap-2">
        <Input
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          placeholder="新分组名称"
        />
        <Button type="submit" size="icon">
          <Plus className="h-4 w-4" />
        </Button>
      </form>
      <form onSubmit={onSearch} className="mt-3 flex gap-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索代码、名称或 ETF"
        />
        <Button type="submit" size="icon" disabled={!selectedId || searching}>
          {searching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
        </Button>
      </form>
      {matches.length ? (
        <div className="mt-2 space-y-1 rounded-xl border border-border/40 p-2">
          {matches.map((item) => (
            <button
              key={item.id}
              type="button"
              className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs hover:bg-muted"
              onClick={() => void onAdd(item)}
            >
              <span>
                {item.name} <span className="text-muted-foreground">{item.symbol}</span>
              </span>
              <Plus className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
      ) : null}
      <div className="mt-3 space-y-1">
        {selected?.items.length ? (
          selected.items.map((item) => (
            <div
              key={item.instrument.instrumentId}
              className="flex items-center justify-between rounded-xl border border-border/35 px-3 py-2 text-xs"
            >
              <span>
                {item.instrument.displayName}
                <span className="ml-2 text-muted-foreground">
                  {item.instrument.market} · {item.instrument.symbol}
                </span>
              </span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void onRemove(selected.id, item.instrument.instrumentId)}
                aria-label="移出自选"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))
        ) : (
          <p className="py-6 text-center text-xs text-muted-foreground">该分组暂无标的。</p>
        )}
      </div>
    </GlassPanel>
  );
}

function EncryptedBackupPanel({ onRestored }: { onRestored: () => Promise<void> }) {
  const [exportPassword, setExportPassword] = useState("");
  const [restorePassword, setRestorePassword] = useState("");
  const [envelopeText, setEnvelopeText] = useState("");
  const [mode, setMode] = useState<StockBackupRestoreMode>("merge");
  const [busy, setBusy] = useState<"export" | "restore" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function exportBackup() {
    if (!exportPassword) return;
    setBusy("export");
    setError(null);
    setMessage(null);
    try {
      const envelope = await stockResearch.portfolioExportEncryptedBackup(exportPassword);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json;charset=utf-8" }),
      );
      const anchor = documentElement("a");
      anchor.href = url;
      anchor.download = `calen-stock-backup-${today()}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage("加密备份已导出；Calen 不保存密码，也无法找回密码。");
    } catch (nextError) {
      setError(formatStockError(nextError));
    } finally {
      setExportPassword("");
      setBusy(null);
    }
  }

  async function restoreBackup() {
    if (!restorePassword || !envelopeText.trim()) return;
    setBusy("restore");
    setError(null);
    setMessage(null);
    try {
      const parsed = JSON.parse(envelopeText) as Partial<EncryptedStockBackupEnvelope>;
      if (
        typeof parsed.formatVersion !== "number" ||
        typeof parsed.cipher !== "string" ||
        typeof parsed.createdAt !== "string" ||
        typeof parsed.payloadBase64 !== "string"
      )
        throw new Error("备份文件格式无效。");
      await stockResearch.portfolioRestoreEncryptedBackup(
        parsed as EncryptedStockBackupEnvelope,
        restorePassword,
        mode,
      );
      await onRestored();
      setEnvelopeText("");
      setMessage(mode === "replaceAll" ? "备份已替换恢复。" : "备份已合并恢复。");
    } catch (nextError) {
      setError(formatStockError(nextError));
    } finally {
      setRestorePassword("");
      setBusy(null);
    }
  }

  return (
    <GlassPanel>
      <div className="flex items-start gap-3">
        <Key className="mt-0.5 h-5 w-5" />
        <div>
          <h2 className="text-sm font-semibold">密码保护的备份与恢复</h2>
          <p className="mt-1 text-[10.5px] text-muted-foreground">
            包含自选、组合与交易流水；密码不写入设置。
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <Input
            type="password"
            autoComplete="new-password"
            value={exportPassword}
            onChange={(event) => setExportPassword(event.target.value)}
            placeholder="备份密码"
          />
          <Button
            className="mt-2 w-full"
            onClick={() => void exportBackup()}
            disabled={!exportPassword || busy !== null}
          >
            {busy === "export" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}导出加密
            JSON
          </Button>
        </div>
        <div>
          <label className="flex h-9 cursor-pointer items-center justify-center rounded-md border border-input text-xs hover:bg-muted">
            <Upload className="mr-2 h-3.5 w-3.5" />
            选择备份
            <input
              type="file"
              accept=".json,application/json"
              className="sr-only"
              onChange={(event) => readTextFile(event, setEnvelopeText)}
            />
          </label>
          <Input
            className="mt-2"
            type="password"
            autoComplete="current-password"
            value={restorePassword}
            onChange={(event) => setRestorePassword(event.target.value)}
            placeholder="恢复密码"
          />
        </div>
      </div>
      <Textarea
        className="mt-3 min-h-20 font-mono text-[10px]"
        value={envelopeText}
        onChange={(event) => setEnvelopeText(event.target.value)}
        placeholder="或粘贴加密备份 JSON"
      />
      <div className="mt-2 flex gap-2">
        <select
          value={mode}
          onChange={(event) => setMode(event.target.value as StockBackupRestoreMode)}
          className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-xs"
        >
          <option value="merge">合并现有数据</option>
          <option value="replaceAll">全部替换</option>
        </select>
        <Button
          variant={mode === "replaceAll" ? "destructive" : "outline"}
          onClick={() => void restoreBackup()}
          disabled={!restorePassword || !envelopeText.trim() || busy !== null}
        >
          恢复
        </Button>
      </div>
      {error ? <p className="mt-2 text-[10.5px] text-destructive">{error}</p> : null}
      {message ? (
        <p className="mt-2 text-[10.5px] text-emerald-700 dark:text-emerald-300">{message}</p>
      ) : null}
    </GlassPanel>
  );
}
