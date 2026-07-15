import { normalizeInstrument } from "./instruments.ts";
import { evaluateResearch } from "./analytics.ts";
import { runBacktest, unavailableBacktestResult } from "./backtest.ts";
import { createDefaultProviders } from "./providers/defaults.ts";
import {
  ProviderRegistry,
  type ProviderRegistryOptions,
} from "./providers/registry.ts";
import type {
  InstrumentSearchResult,
  MarketBriefRequest,
  StockBacktestRequest,
  StockBacktestResult,
  StockEvidenceResult,
  StockProvider,
  StockResearchPort,
  StockResearchRequest,
  StockServiceStatus,
  StockSnapshot,
  StockSnapshotRequest,
  StockResolveRequest,
} from "./types.ts";

export interface CreateStockResearchServiceOptions extends ProviderRegistryOptions {
  providers?: StockProvider[];
}

export function createStockResearchService(
  options: CreateStockResearchServiceOptions = {}
): StockResearchPort {
  const now = options.now ?? (() => new Date());
  const providers = options.providers ?? createDefaultProviders();
  const registry = new ProviderRegistry(providers, options);
  return {
    async resolve(
      request: StockResolveRequest
    ): Promise<InstrumentSearchResult> {
      const retrievedAt = now().toISOString();
      const instrument = normalizeInstrument(request.query, request.market);
      if (instrument)
        return {
          status: "complete",
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
          warnings: [],
        };
      const result = await registry.query(
        "resolve",
        `${request.market ?? "GLOBAL"}:${request.query}:${request.limit ?? 10}`,
        (provider, context) => provider.resolve!(request, context)
      );
      if (!result.data || !result.source)
        return {
          status: "unavailable",
          instruments: [],
          sources: [],
          asOf: retrievedAt,
          retrievedAt,
          cached: false,
          warnings: result.warnings,
        };
      return {
        status: "complete",
        instruments: result.data,
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
      const result = await registry.query(
        "snapshot",
        request.instrument.id,
        (provider, context) => provider.snapshot!(request.instrument, context),
        signal,
        request.maxAgeMs
      );
      if (!result.data || !result.source) {
        return {
          status: "unavailable",
          instrument: request.instrument,
          sources: [],
          asOf: retrievedAt,
          retrievedAt,
          cached: false,
          warnings: result.warnings,
        };
      }
      return {
        status: "complete",
        instrument: request.instrument,
        data: result.data,
        sources: [result.source],
        asOf: result.source.asOf,
        retrievedAt: result.source.retrievedAt,
        cached: result.cached,
        warnings: result.warnings,
      };
    },
    async research(
      request: StockResearchRequest,
      signal?: AbortSignal
    ): Promise<StockEvidenceResult> {
      const snapshot = await registry.query(
        "snapshot",
        request.instrument.id,
        (provider, context) => provider.snapshot!(request.instrument, context),
        signal
      );
      const history = await registry.query(
        "history",
        `${request.instrument.id}:${request.historyLimit ?? 120}`,
        (provider, context) =>
          provider.history!(
            request.instrument,
            { limit: request.historyLimit ?? 120 },
            context
          ),
        signal
      );
      const retrievedAt = now().toISOString();
      const sources = [snapshot.source, history.source].filter(
        (source) => source !== undefined
      );
      const warnings = [...snapshot.warnings, ...history.warnings];
      if (!snapshot.data && !history.data) {
        return {
          status: "unavailable",
          instrument: request.instrument,
          sources: [],
          asOf: retrievedAt,
          retrievedAt,
          cached: false,
          warnings,
        };
      }
      const bars = history.data ?? [];
      const hasAnalysisSample = bars.length >= 20;
      if (!hasAnalysisSample)
        warnings.push("历史行情不足 20 根，技术指标、评分和 Evaluator 不可用");
      const analysis = hasAnalysisSample
        ? evaluateResearch(snapshot.data ?? undefined, bars)
        : { technical: null, score: null, evaluator: null };
      return {
        status: snapshot.data && history.data ? "complete" : "partial",
        instrument: request.instrument,
        data: {
          facts: { snapshot: snapshot.data ?? null, historyBars: bars.length },
          ...analysis,
          analysisMetadata: {
            sample: {
              start: bars[0]?.time ?? null,
              end: bars.at(-1)?.time ?? null,
              bars: bars.length,
            },
            limitations: ["实验性量化研究结果，不构成投资建议。"],
          },
        },
        sources,
        asOf:
          sources
            .map((source) => source.asOf)
            .sort()
            .at(-1) ?? retrievedAt,
        retrievedAt,
        cached: sources.length > 0 && sources.every((source) => source.cached),
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
        status: "complete",
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
      const providerStatus = registry.status();
      const available = providerStatus.filter(
        (provider) => provider.available
      ).length;
      return {
        state:
          available === providerStatus.length
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
