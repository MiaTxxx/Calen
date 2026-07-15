import { normalizeInstrument } from "./instruments.ts";
import {
  createResearchAnalysisMetadata,
  evaluateResearch,
} from "./analytics.ts";
import { runBacktest, unavailableBacktestResult } from "./backtest.ts";
import { createDefaultProviders } from "./providers/defaults.ts";
import {
  ProviderRegistry,
  type ProviderRegistryOptions,
  type ProviderQueryResult,
} from "./providers/registry.ts";
import type {
  EvidenceSource,
  InstrumentRef,
  InstrumentSearchResult,
  MarketBriefRequest,
  PriceBar,
  ProviderStatus,
  StockBacktestRequest,
  StockBacktestResult,
  StockEvidenceResult,
  StockFxRateQuote,
  StockFxRatesRequest,
  StockFxRatesResult,
  StockProvider,
  StockSidecarPort,
  StockResearchCapability,
  StockResearchRequest,
  StockServiceStatus,
  StockSnapshot,
  StockSnapshotRequest,
  StockResolveRequest,
} from "./types.ts";

const DEFAULT_RESEARCH_CAPABILITIES: StockResearchCapability[] = [
  "snapshot",
  "history",
  "technical",
  "score",
  "strategy",
  "evaluator",
];

const REMOTE_RESEARCH_CAPABILITIES = new Set<StockResearchCapability>([
  "snapshot",
  "history",
  "profile",
  "financials",
  "shareholders",
  "dividend",
  "moneyFlow",
  "news",
  "notices",
  "etf",
]);

function enrichEtfPremium(
  value: unknown,
  snapshot: StockSnapshot | null | undefined
): { data: unknown; warnings: string[] } {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return {
      data: value,
      warnings: ["当前价格或 NAV 缺失，无法计算溢价率"],
    };
  const record = value as Record<string, unknown>;
  const navRows = Array.isArray(record.nav) ? record.nav : [];
  const latestNav = navRows
    .map((row) =>
      row && typeof row === "object" && !Array.isArray(row)
        ? (row as Record<string, unknown>)
        : undefined
    )
    .filter(
      (row): row is Record<string, unknown> =>
        row !== undefined &&
        typeof row.nav === "number" &&
        Number.isFinite(row.nav)
    )
    .sort((left, right) =>
      String(right.date ?? "").localeCompare(String(left.date ?? ""))
    )[0];
  const nav = typeof latestNav?.nav === "number" ? latestNav.nav : undefined;
  const price = snapshot?.price;
  if (price === undefined || nav === undefined || nav <= 0)
    return {
      data: {
        ...record,
        marketPrice: price ?? null,
        premiumPercent: null,
      },
      warnings: ["当前价格或 NAV 缺失，无法计算溢价率"],
    };
  return {
    data: {
      ...record,
      marketPrice: price,
      premiumPercent: Math.round((price / nav - 1) * 100 * 100) / 100,
    },
    warnings: [],
  };
}

export interface CreateStockResearchServiceOptions extends ProviderRegistryOptions {
  providers?: StockProvider[];
  providerCatalog?: ProviderStatus[];
}

function localInstrumentResult(
  instrument: InstrumentRef,
  retrievedAt: string,
  warnings: string[] = []
): InstrumentSearchResult {
  return {
    status: warnings.length ? "partial" : "ok",
    instruments: [instrument],
    sources: [
      {
        id: "calen-symbol-resolver",
        name: "Calen 标的解析器",
        provider: "calen-symbol-resolver",
        capability: "resolve",
        asOf: retrievedAt,
        retrievedAt,
        cached: false,
      },
    ],
    asOf: retrievedAt,
    retrievedAt,
    cached: false,
    warnings,
  };
}

function prefersNameSearch(
  query: string,
  instrument: InstrumentRef | null
): boolean {
  if (!instrument || instrument.market !== "US") return false;
  const value = query.trim();
  return !/^(?:US:|US[A-Z0-9]|.+\.(?:US|OQ|N|AM|PS|PK|OB))$/i.test(value);
}

export function createStockResearchService(
  options: CreateStockResearchServiceOptions = {}
): StockSidecarPort {
  const now = options.now ?? (() => new Date());
  const providers = options.providers ?? createDefaultProviders();
  const providerCatalog = options.providerCatalog ?? [];
  const registry = new ProviderRegistry(providers, options);
  return {
    async resolve(
      request: StockResolveRequest
    ): Promise<InstrumentSearchResult> {
      const retrievedAt = now().toISOString();
      const instrument = normalizeInstrument(request.query, request.market);
      if (instrument && !prefersNameSearch(request.query, instrument))
        return localInstrumentResult(instrument, retrievedAt);
      const result = await registry.query(
        "resolve",
        `${request.market ?? "GLOBAL"}:${request.query}:${request.limit ?? 10}`,
        (provider, context) => provider.resolve!(request, context)
      );
      if (!result.data || !result.source) {
        if (instrument)
          return localInstrumentResult(instrument, retrievedAt, [
            ...result.warnings,
            "名称搜索不可用，当前结果仅按可能的美股 ticker 解析，请核对证券身份。",
          ]);
        return {
          status: "unavailable",
          instruments: [],
          sources: [],
          asOf: retrievedAt,
          retrievedAt,
          cached: false,
          warnings: result.warnings,
        };
      }
      return {
        status: result.warnings.length ? "partial" : "ok",
        instruments: result.data,
        sources: [result.source],
        asOf: result.source.asOf,
        retrievedAt: result.source.retrievedAt,
        cached: result.cached,
        warnings: result.warnings,
      };
    },
    async fxRates(
      request: StockFxRatesRequest,
      signal?: AbortSignal
    ): Promise<StockFxRatesResult> {
      const seen = new Set<string>();
      const pairs = request.pairs.filter((pair) => {
        const key = `${pair.fromCurrency}/${pair.toCurrency}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const requestKey = pairs
        .map((pair) => `${pair.fromCurrency}/${pair.toCurrency}`)
        .sort()
        .join(",");
      const retrievedAt = now().toISOString();
      const result = await registry.query(
        "fxRates",
        requestKey,
        (provider, context) =>
          provider.fxRates!({ ...request, pairs }, context),
        signal,
        request.maxAgeMs
      );
      const rates = Array.isArray(result.data)
        ? (result.data as StockFxRateQuote[])
        : [];
      if (!rates.length || !result.source) {
        return {
          status: "unavailable",
          rates: [],
          sources: [],
          asOf: retrievedAt,
          retrievedAt,
          cached: false,
          warnings: result.warnings,
        };
      }
      const partial = rates.length < pairs.length || result.warnings.length > 0;
      return {
        status: partial ? "partial" : "ok",
        rates,
        sources: [result.source],
        asOf: result.source.asOf,
        retrievedAt: result.source.retrievedAt,
        cached: result.cached,
        warnings: result.warnings,
      };
    },
    async snapshot(
      request: StockSnapshotRequest,
      signal?: AbortSignal
    ): Promise<StockEvidenceResult<StockSnapshot>> {
      const retrievedAt = now().toISOString();
      const quote = await registry.query(
        "snapshot",
        request.instrument.id,
        (provider, context) => provider.snapshot!(request.instrument, context),
        signal,
        request.maxAgeMs
      );
      if (!quote.data || !quote.source) {
        return {
          status: "unavailable",
          instrument: request.instrument,
          sources: [],
          asOf: retrievedAt,
          retrievedAt,
          cached: false,
          warnings: quote.warnings,
        };
      }
      const historyLimit = Math.min(
        Math.max(request.historyLimit ?? 30, 1),
        120
      );
      const includeProfile = request.includeProfile ?? false;
      const [history, profile] = await Promise.all([
        request.includeHistory
          ? registry.query(
              "history",
              `${request.instrument.id}:snapshot:${historyLimit}`,
              (provider, context) =>
                provider.history!(
                  request.instrument,
                  { limit: historyLimit },
                  context
                ),
              signal
            )
          : Promise.resolve(null),
        includeProfile
          ? registry.query(
              "profile",
              `${request.instrument.id}:snapshot`,
              (provider, context) =>
                provider.profile!(request.instrument, context),
              signal
            )
          : Promise.resolve(null),
      ]);
      const bars = Array.isArray(history?.data)
        ? (history.data as PriceBar[])
        : [];
      const firstClose = bars[0]?.close;
      const metrics: Record<string, number | string | null> = {
        price: quote.data.price,
        previousClose: quote.data.previousClose ?? null,
        change: quote.data.change ?? null,
        changePercent: quote.data.changePercent ?? null,
        high: quote.data.high ?? null,
        low: quote.data.low ?? null,
        volume: quote.data.volume ?? null,
        historyBars: bars.length,
        periodReturnPercent:
          firstClose && firstClose > 0
            ? Math.round((quote.data.price / firstClose - 1) * 100 * 100) / 100
            : null,
      };
      const profileRecord =
        profile?.data && typeof profile.data === "object"
          ? (profile.data as Record<string, unknown>)
          : undefined;
      for (const key of [
        "marketCap",
        "floatMarketCap",
        "pe",
        "pb",
        "industry",
      ] as const) {
        const value = profileRecord?.[key];
        if (typeof value === "number" || typeof value === "string")
          metrics[key] = value;
      }
      const data: StockSnapshot = { ...quote.data, metrics };
      if (request.includeHistory && bars.length)
        data.chart = { bars, limit: historyLimit };
      if (includeProfile && profile?.data != null) data.profile = profile.data;
      const sources = [quote.source, history?.source, profile?.source].filter(
        (source) => source !== undefined
      );
      const warnings = [
        ...quote.warnings,
        ...(history?.warnings.map((warning) => `history: ${warning}`) ?? []),
        ...(profile?.warnings.map((warning) => `profile: ${warning}`) ?? []),
      ];
      if (request.includeHistory && !history?.data)
        warnings.push("history: 请求了 K 线图，但没有可用历史行情");
      if (includeProfile && !profile?.data)
        warnings.push("profile: 请求了公司资料，但没有可用数据");
      const missingRequested =
        (request.includeHistory && !history?.data) ||
        (includeProfile && !profile?.data);
      return {
        status: missingRequested || warnings.length ? "partial" : "ok",
        instrument: request.instrument,
        data,
        sources,
        asOf:
          sources
            .map((source) => source.asOf)
            .sort()
            .at(-1) ?? quote.source.asOf,
        retrievedAt,
        cached: sources.length > 0 && sources.every((source) => source.cached),
        warnings,
      };
    },
    async research(
      request: StockResearchRequest,
      signal?: AbortSignal
    ): Promise<StockEvidenceResult> {
      const retrievedAt = now().toISOString();
      const requested = [
        ...new Set(request.capabilities ?? DEFAULT_RESEARCH_CAPABILITIES),
      ];
      const needsHistory = requested.some(
        (capability) =>
          capability === "technical" ||
          capability === "score" ||
          capability === "strategy" ||
          capability === "evaluator"
      );
      const remoteNeeded = [
        ...new Set([
          ...requested.filter((capability) =>
            REMOTE_RESEARCH_CAPABILITIES.has(capability)
          ),
          ...(needsHistory ? ["history" as const] : []),
          ...(requested.includes("etf") ? ["snapshot" as const] : []),
          ...(requested.includes("evaluator") ? ["financials" as const] : []),
        ]),
      ];
      const remoteEntries = await Promise.all(
        remoteNeeded.map(async (capability) => {
          const cacheKey =
            capability === "history"
              ? `${request.instrument.id}:${request.historyLimit ?? 120}`
              : request.instrument.id;
          const result = await registry.query(
            capability,
            cacheKey,
            (provider, context) => {
              switch (capability) {
                case "snapshot":
                  return provider.snapshot!(request.instrument, context);
                case "history":
                  return provider.history!(
                    request.instrument,
                    { limit: request.historyLimit ?? 120 },
                    context
                  );
                case "profile":
                  return provider.profile!(request.instrument, context);
                case "financials":
                  return provider.financials!(request.instrument, context);
                case "shareholders":
                  return provider.shareholders!(request.instrument, context);
                case "dividend":
                  return provider.dividend!(request.instrument, context);
                case "moneyFlow":
                  return provider.moneyFlow!(request.instrument, context);
                case "news":
                  return provider.news!(request.instrument, context);
                case "notices":
                  return provider.notices!(request.instrument, context);
                case "etf":
                  return provider.etf!(request.instrument, context);
                default:
                  throw new Error(`不支持的远程研究能力：${capability}`);
              }
            },
            signal
          );
          return [capability, result] as const;
        })
      );
      const remoteResults = new Map<
        StockResearchCapability,
        ProviderQueryResult<unknown>
      >(remoteEntries);
      const historyResult = remoteResults.get("history");
      const bars = Array.isArray(historyResult?.data)
        ? (historyResult.data as PriceBar[])
        : [];
      const hasAnalysisSample = bars.length >= 20;
      const analysisWarnings = hasAnalysisSample
        ? []
        : ["历史行情不足 20 根，技术指标、评分和 Evaluator 不可用"];
      const snapshotData = remoteResults.get("snapshot")?.data as
        StockSnapshot | null | undefined;
      const analysis = hasAnalysisSample
        ? evaluateResearch(snapshotData ?? undefined, bars, {
            financials: remoteResults.get("financials")?.data,
            ...(request.strategyIds
              ? { strategyIds: request.strategyIds }
              : {}),
          })
        : { technical: null, score: null, evaluator: null, strategy: null };
      const strategy = analysis.strategy;
      const capabilities: Record<
        string,
        {
          status: "ok" | "partial" | "unavailable";
          data: unknown;
          warnings: string[];
        }
      > = {};
      const warnings: string[] = [];
      const sources: EvidenceSource[] = [];
      for (const capability of requested) {
        if (
          capability === "technical" ||
          capability === "score" ||
          capability === "strategy" ||
          capability === "evaluator"
        ) {
          const data =
            capability === "technical"
              ? analysis.technical
              : capability === "score"
                ? analysis.score
                : capability === "evaluator"
                  ? analysis.evaluator
                  : strategy;
          const sectionWarnings =
            data === null
              ? [...analysisWarnings]
              : (historyResult?.warnings ?? []).map(
                  (warning) => `历史行情证据：${warning}`
                );
          capabilities[capability] = {
            status:
              data === null
                ? "unavailable"
                : sectionWarnings.length
                  ? "partial"
                  : "ok",
            data,
            warnings: sectionWarnings,
          };
          warnings.push(
            ...sectionWarnings.map((warning) => `${capability}: ${warning}`)
          );
          continue;
        }
        const result = remoteResults.get(capability);
        const premium =
          capability === "etf"
            ? enrichEtfPremium(result?.data ?? null, snapshotData)
            : { data: result?.data ?? null, warnings: [] as string[] };
        const sectionWarnings = [
          ...(result?.warnings ?? []),
          ...premium.warnings,
        ].map((warning) => `${capability}: ${warning}`);
        const sectionStatus =
          premium.data == null
            ? "unavailable"
            : sectionWarnings.length
              ? "partial"
              : "ok";
        capabilities[capability] = {
          status: sectionStatus,
          data: premium.data,
          warnings: sectionWarnings,
        };
        warnings.push(...sectionWarnings);
        if (result?.source) sources.push(result.source);
      }
      for (const capability of remoteNeeded) {
        const result = remoteResults.get(capability);
        if (result?.source) sources.push(result.source);
        if (!requested.includes(capability)) {
          warnings.push(
            ...(result?.warnings.map(
              (warning) => `${capability}(supporting): ${warning}`
            ) ?? [])
          );
        }
      }
      const requestedStatuses = requested.map(
        (capability) => capabilities[capability]!.status
      );
      const status = requestedStatuses.every((value) => value === "ok")
        ? "ok"
        : requestedStatuses.every((value) => value === "unavailable")
          ? "unavailable"
          : "partial";
      const uniqueSources = sources.filter(
        (source, index, all) =>
          all.findIndex(
            (candidate) =>
              candidate.provider === source.provider &&
              candidate.capability === source.capability
          ) === index
      );
      return {
        status,
        instrument: request.instrument,
        data: {
          requestedCapabilities: requested,
          capabilities,
          facts: { snapshot: snapshotData ?? null, historyBars: bars.length },
          ...analysis,
          strategy,
          analysisMetadata: createResearchAnalysisMetadata(
            bars,
            request.historyLimit ?? 120
          ),
        },
        sources: uniqueSources,
        asOf:
          uniqueSources
            .map((source) => source.asOf)
            .sort()
            .at(-1) ?? retrievedAt,
        retrievedAt,
        cached:
          uniqueSources.length > 0 &&
          uniqueSources.every((source) => source.cached),
        warnings,
      };
    },
    async marketBrief(
      request: MarketBriefRequest,
      signal?: AbortSignal
    ): Promise<StockEvidenceResult> {
      const retrievedAt = now().toISOString();
      const result = await registry.query(
        "marketBrief",
        `${request.market ?? "CN"}:${request.limit ?? 20}`,
        (provider, context) => provider.marketBrief!(request, context),
        signal
      );
      if (!result.data || !result.source)
        return {
          status: "unavailable",
          sources: [],
          asOf: retrievedAt,
          retrievedAt,
          cached: false,
          warnings: result.warnings,
        };
      return {
        status: result.warnings.length ? "partial" : "ok",
        data: result.data,
        sources: [result.source],
        asOf: result.source.asOf,
        retrievedAt: result.source.retrievedAt,
        cached: result.cached,
        warnings: result.warnings,
      };
    },
    async backtest(
      request: StockBacktestRequest,
      signal?: AbortSignal
    ): Promise<StockBacktestResult> {
      const retrievedAt = now().toISOString();
      if (request.bars) return runBacktest(request, request.bars, retrievedAt);
      if (!request.instrument)
        return unavailableBacktestResult(retrievedAt, [
          "必须提供 instrument 或 bars",
        ]);
      const historyRequest = { limit: 2_000 } as {
        limit: number;
        start?: string;
        end?: string;
      };
      if (request.start) historyRequest.start = request.start;
      if (request.end) historyRequest.end = request.end;
      const history = await registry.query(
        "history",
        `${request.instrument.id}:backtest:${request.start ?? ""}:${request.end ?? ""}`,
        (provider, context) =>
          provider.history!(request.instrument!, historyRequest, context),
        signal
      );
      if (!history.data)
        return unavailableBacktestResult(retrievedAt, history.warnings);
      const result = runBacktest(request, history.data, retrievedAt);
      if (history.source) result.sources.unshift(history.source);
      result.warnings.unshift(...history.warnings);
      return result;
    },
    async status(): Promise<StockServiceStatus> {
      const runtimeStatus = registry.status();
      const runtimeIds = new Set(runtimeStatus.map((provider) => provider.id));
      const providerStatus = [
        ...runtimeStatus,
        ...providerCatalog.filter((provider) => !runtimeIds.has(provider.id)),
      ];
      const available = providerStatus.filter(
        (provider) => provider.available
      ).length;
      return {
        state:
          available > 0 &&
          available ===
            providerStatus.filter((provider) => provider.enabled).length
            ? "ready"
            : available > 0
              ? "degraded"
              : providerStatus.length
                ? "unavailable"
                : "ready",
        service: "calen-stock-sidecar",
        version: "0.1.0",
        providers: providerStatus,
        retrievedAt: now().toISOString(),
      };
    },
  };
}
