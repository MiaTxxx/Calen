import type { Tool, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import { invoke } from "@tauri-apps/api/core";
import { Type } from "typebox";

import {
  type BuiltinToolBundle,
  createBuiltinMetadataMap,
  type StockToolResultDetails,
} from "./builtinTypes";
import { toStockSidecarToolPayload } from "./stockToolContracts";
import type { SystemToolRuntimeScope } from "./systemToolOptions";

type StockOperation = StockToolResultDetails["operation"];

type StockToolDefinition = {
  name: string;
  operation: StockOperation;
  command: string;
  description: string;
  parameters: Tool["parameters"];
  scopes: readonly SystemToolRuntimeScope[];
  experimental?: boolean;
};

const MARKET = Type.Optional(
  Type.Union([Type.Literal("CN"), Type.Literal("HK"), Type.Literal("US")], {
    description: "Market hint. CN is the deep-coverage default; HK and US have limited coverage.",
  }),
);

const INSTRUMENT = Type.Object({
  id: Type.Optional(Type.String()),
  canonicalId: Type.Optional(Type.String()),
  symbol: Type.String({ minLength: 1 }),
  market: Type.Union([Type.Literal("CN"), Type.Literal("HK"), Type.Literal("US")]),
  exchange: Type.Optional(Type.String()),
  assetType: Type.Optional(
    Type.Union([
      Type.Literal("stock"),
      Type.Literal("etf"),
      Type.Literal("index"),
      Type.Literal("fund"),
      Type.Literal("unknown"),
      Type.Literal("EQUITY"),
      Type.Literal("ETF"),
      Type.Literal("INDEX"),
    ]),
  ),
  name: Type.Optional(Type.String()),
  displayName: Type.Optional(Type.String()),
  currency: Type.Optional(
    Type.Union([Type.Literal("CNY"), Type.Literal("HKD"), Type.Literal("USD")]),
  ),
});

const DEFINITIONS: readonly StockToolDefinition[] = [
  {
    name: "StockResolve",
    operation: "resolve",
    command: "stock_search",
    description:
      "Resolve a stock or ETF name/code to stable market-qualified instruments. Use this before research when the market or symbol is ambiguous.",
    parameters: Type.Object({
      query: Type.String({
        minLength: 1,
        description: "Company, ETF, ticker, or Chinese security name.",
      }),
      market: MARKET,
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, default: 8 })),
      deadlineMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 30000 })),
    }),
    scopes: ["chat", "cron_auto_prompt"],
  },
  {
    name: "StockSnapshot",
    operation: "snapshot",
    command: "stock_snapshot",
    description:
      "Get a bounded, source-labelled snapshot for one resolved stock or ETF: quote, profile, key metrics and limited price history.",
    parameters: Type.Object({
      instrument: INSTRUMENT,
      historyDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 365, default: 30 })),
      deadlineMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 60000 })),
    }),
    scopes: ["chat", "cron_auto_prompt"],
  },
  {
    name: "StockResearch",
    operation: "research",
    command: "stock_research",
    description:
      "Research one resolved security using requested evidence capabilities. Returns facts, sources, freshness and warnings; never invent missing data or issue buy/sell instructions.",
    parameters: Type.Object({
      instrument: INSTRUMENT,
      capabilities: Type.Array(
        Type.Union([
          Type.Literal("quote"),
          Type.Literal("history"),
          Type.Literal("profile"),
          Type.Literal("financials"),
          Type.Literal("holders"),
          Type.Literal("dividends"),
          Type.Literal("moneyFlow"),
          Type.Literal("news"),
          Type.Literal("notices"),
          Type.Literal("etf"),
          Type.Literal("technical"),
          Type.Literal("score"),
          Type.Literal("strategy"),
          Type.Literal("evaluator"),
        ]),
        { minItems: 1, maxItems: 12 },
      ),
      startDate: Type.Optional(Type.String({ description: "ISO date; bounded by the sidecar." })),
      endDate: Type.Optional(Type.String({ description: "ISO date; bounded by the sidecar." })),
      maxItems: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 30 })),
      strategyIds: Type.Optional(
        Type.Array(
          Type.Union([
            Type.Literal("trend"),
            Type.Literal("mean-reversion"),
            Type.Literal("breakout"),
            Type.Literal("momentum"),
            Type.Literal("volume-price"),
          ]),
          { minItems: 1, maxItems: 5 },
        ),
      ),
      deadlineMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 120000 })),
    }),
    scopes: ["chat", "cron_auto_prompt"],
  },
  {
    name: "StockMarketBrief",
    operation: "marketBrief",
    command: "stock_market_brief",
    description:
      "Build a CN pre-market, intraday, close, or general market brief. The requested trade date and sections are enforced; unsupported historical or session-specific data is returned as partial with warnings.",
    parameters: Type.Object({
      session: Type.Optional(
        Type.Union([
          Type.Literal("pre_market"),
          Type.Literal("preMarket"),
          Type.Literal("intraday"),
          Type.Literal("close"),
          Type.Literal("general"),
        ]),
      ),
      tradeDate: Type.Optional(
        Type.String({
          description: "ISO date; defaults to the current market date.",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
        }),
      ),
      sections: Type.Optional(
        Type.Array(
          Type.Union([
            Type.Literal("movers"),
            Type.Literal("limitUp"),
            Type.Literal("limitDown"),
            Type.Literal("hotSectors"),
            Type.Literal("moneyFlow"),
            Type.Literal("dragonTiger"),
            Type.Literal("unusualMoves"),
            Type.Literal("sentiment"),
          ]),
          { minItems: 1, maxItems: 8, uniqueItems: true },
        ),
      ),
      deadlineMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 120000 })),
    }),
    scopes: ["chat", "cron_auto_prompt"],
  },
  {
    name: "StockBacktest",
    operation: "backtest",
    command: "stock_backtest",
    description:
      "Run an experimental, bounded and reproducible historical strategy evaluation. Results are research-only and include algorithm version, benchmark, fees, drawdown and data limitations.",
    parameters: Type.Object({
      instrument: INSTRUMENT,
      strategy: Type.Union([
        Type.Literal("sma-cross"),
        Type.Literal("trend"),
        Type.Literal("mean-reversion"),
        Type.Literal("breakout"),
        Type.Literal("momentum"),
        Type.Literal("volume-price"),
        Type.Literal("fused"),
      ]),
      startDate: Type.String({ minLength: 10 }),
      endDate: Type.String({ minLength: 10 }),
      parameters: Type.Optional(Type.Record(Type.String(), Type.Any())),
      feeRate: Type.Optional(Type.Number({ minimum: 0, maximum: 0.05, default: 0.001 })),
      evaluationRatio: Type.Optional(
        Type.Number({
          minimum: 0.1,
          maximum: 0.8,
          default: 0.3,
          description: "样本外评估区间占比，必须在 0.1 到 0.8 之间。",
        }),
      ),
      deadlineMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 180000 })),
    }),
    scopes: ["chat"],
    experimental: true,
  },
  {
    name: "StockPortfolioRead",
    operation: "portfolio",
    command: "ai_stock_portfolio_snapshot",
    description:
      "Read local Calen watch/portfolio data only when the user explicitly asks for portfolio analysis. This tool is read-only and never modifies holdings or transactions.",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("list"),
        Type.Literal("snapshot"),
        Type.Literal("transactions"),
      ]),
      portfolioId: Type.Optional(Type.String({ minLength: 1 })),
    }),
    scopes: ["chat"],
  },
] as const;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function asFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asStockCurrency(value: unknown): "CNY" | "HKD" | "USD" | undefined {
  return value === "CNY" || value === "HKD" || value === "USD" ? value : undefined;
}

function asWarnings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function asEvidenceTime(value: unknown): string | undefined {
  const normalized = asString(value);
  return normalized && normalized !== "unknown" ? normalized : undefined;
}

const EXPERIMENTAL_RESEARCH_CAPABILITIES = ["technical", "score", "strategy", "evaluator"] as const;

function experimentalCapabilities(evidence: Record<string, unknown>): string[] {
  const data = asRecord(evidence.data);
  const capabilities = asRecord(data.capabilities ?? evidence.capabilities);
  const explicit = Array.isArray(data.experimentalAnalysis)
    ? data.experimentalAnalysis.flatMap((item) => {
        const capability = asString(asRecord(item).capability);
        return capability ? [capability] : [];
      })
    : [];
  return EXPERIMENTAL_RESEARCH_CAPABILITIES.filter(
    (capability) => Object.hasOwn(capabilities, capability) || explicit.includes(capability),
  );
}

function resultDetails(
  definition: StockToolDefinition,
  requestId: string,
  result: unknown,
): StockToolResultDetails {
  const record = asRecord(result);
  const evidence = asRecord(record.evidence ?? record);
  const instrument = asRecord(evidence.instrument ?? asRecord(evidence.data).instrument);
  const quantCapabilities =
    definition.operation === "research" ? experimentalCapabilities(evidence) : [];
  return {
    kind: "stock_result",
    operation: definition.operation,
    requestId,
    status:
      evidence.status === "ok" || evidence.status === "partial" || evidence.status === "unavailable"
        ? evidence.status
        : undefined,
    instrument:
      Object.keys(instrument).length > 0
        ? {
            canonicalId: asString(instrument.canonicalId ?? instrument.id),
            symbol: asString(instrument.symbol),
            market: asString(instrument.market),
            displayName: asString(instrument.displayName ?? instrument.name),
          }
        : undefined,
    asOf: asEvidenceTime(evidence.asOf),
    retrievedAt: asString(evidence.retrievedAt),
    cached: asBoolean(evidence.cached),
    sources: Array.isArray(evidence.sources)
      ? evidence.sources.map((source) => {
          const item = asRecord(source);
          return {
            id: asString(item.id),
            name: asString(item.name ?? item.label),
            provider: asString(item.provider),
            label: asString(item.label ?? item.name),
            capability: asString(item.capability),
            url: asString(item.url),
            asOf: asEvidenceTime(item.asOf),
          };
        })
      : [],
    warnings: asWarnings(evidence.warnings),
    // StockResearch mixes factual evidence with optional quantitative
    // analyses.  Keep the tool/result factual by default; only Backtest (or
    // another explicitly experimental tool) marks the whole result.
    experimental:
      definition.experimental === true ||
      (definition.operation !== "research" && evidence.experimental === true),
    ...(quantCapabilities.length ? { experimentalCapabilities: quantCapabilities } : {}),
    result,
  };
}

function resultText(details: StockToolResultDetails) {
  return [
    "Calen stock research result. Treat missing/partial fields as unavailable; do not infer them.",
    details.experimental
      ? "This result is experimental research output, not investment advice or a trading instruction."
      : details.experimentalCapabilities?.length
        ? `This result contains experimental quantitative sections (${details.experimentalCapabilities.join(", ")}); factual evidence remains source-labelled. It is not investment advice or a trading instruction.`
        : "This result is research assistance, not investment advice or a trading instruction.",
    JSON.stringify(details.result, null, 2),
  ].join("\n\n");
}

async function enrichPortfolioSnapshot(
  portfolioId: string,
  requestId: string,
  activeRequestIds: Set<string>,
): Promise<{ result: unknown; warnings: string[]; sources: Record<string, unknown>[] }> {
  const base = await invoke<unknown>("ai_stock_portfolio_snapshot", {
    request: { portfolioId, prices: [], fxRates: [] },
  });
  const baseRecord = asRecord(base);
  const positions = Array.isArray(baseRecord.positions) ? baseRecord.positions.map(asRecord) : [];
  const livePositions = positions.filter(
    (position) => Math.abs(asFiniteNumber(position.quantity) ?? 0) > 1e-9,
  );
  const warnings: string[] = [];
  const sources: Record<string, unknown>[] = [];
  const prices: Record<string, unknown>[] = [];

  const quoteResults = await Promise.all(
    livePositions.map(async (position, index) => {
      const instrument = asRecord(position.instrument);
      const symbol = asString(instrument.symbol);
      const market = asString(instrument.market);
      const currency = asStockCurrency(instrument.currency);
      const instrumentId = asString(instrument.instrumentId ?? instrument.id);
      if (!symbol || !market || !currency || !instrumentId) return null;
      const childRequestId = `${requestId}:quote:${index}`;
      activeRequestIds.add(childRequestId);
      try {
        const raw = await invoke<unknown>("stock_snapshot", {
          payload: toStockSidecarToolPayload("snapshot", {
            requestId: childRequestId,
            historyDays: 0,
            instrument: {
              id: instrumentId,
              symbol,
              name: asString(instrument.displayName ?? instrument.name) ?? symbol,
              market,
              exchange: asString(instrument.exchange),
              assetType: asString(instrument.assetType),
              currency,
            },
          }),
        });
        const evidence = asRecord(raw);
        const data = asRecord(evidence.data);
        const price = asFiniteNumber(data.price);
        const asOf =
          asString(data.marketTime) ??
          asEvidenceTime(evidence.asOf) ??
          asString(evidence.retrievedAt);
        const rawSources = Array.isArray(evidence.sources) ? evidence.sources : [];
        for (const source of rawSources) {
          const sourceRecord = asRecord(source);
          if (Object.keys(sourceRecord).length) sources.push(sourceRecord);
        }
        if (price === undefined || price <= 0 || !asOf) return null;
        return { instrumentId, currency, price, asOf };
      } catch {
        return null;
      } finally {
        activeRequestIds.delete(childRequestId);
      }
    }),
  );
  for (const quote of quoteResults) if (quote) prices.push(quote);
  if (prices.length < livePositions.length) {
    warnings.push(
      `仅 ${prices.length}/${livePositions.length} 个持仓取得当前行情；缺失市值不会被推算。`,
    );
  }

  const portfolio = asRecord(baseRecord.portfolio);
  const baseCurrency = asStockCurrency(portfolio.baseCurrency);
  const currencies = new Set<string>();
  for (const position of livePositions) {
    const currency = asStockCurrency(asRecord(position.instrument).currency);
    if (currency && currency !== baseCurrency) currencies.add(currency);
  }
  const fxRates: Record<string, unknown>[] = [];
  if (baseCurrency && currencies.size) {
    const childRequestId = `${requestId}:fx`;
    activeRequestIds.add(childRequestId);
    try {
      const raw = await invoke<unknown>("stock_research_fx_rates", {
        request: {
          requestId: childRequestId,
          pairs: [...currencies].map((fromCurrency) => ({
            fromCurrency,
            toCurrency: baseCurrency,
          })),
        },
      });
      const evidence = asRecord(raw);
      const rates = Array.isArray(evidence.rates) ? evidence.rates : [];
      for (const rate of rates) {
        const item = asRecord(rate);
        const fromCurrency = asStockCurrency(item.fromCurrency);
        const toCurrency = asStockCurrency(item.toCurrency);
        const value = asFiniteNumber(item.rate);
        const asOf = asString(item.asOf);
        if (fromCurrency && toCurrency && value !== undefined && value > 0 && asOf)
          fxRates.push({ fromCurrency, toCurrency, rate: value, asOf });
      }
      for (const source of Array.isArray(evidence.sources) ? evidence.sources : []) {
        const sourceRecord = asRecord(source);
        if (Object.keys(sourceRecord).length) sources.push(sourceRecord);
      }
      for (const warning of asWarnings(evidence.warnings)) warnings.push(`自动汇率：${warning}`);
      if (asString(evidence.status) !== "ok")
        warnings.push("自动汇率部分不可用；缺失币种不会被推算。");
    } catch (error) {
      warnings.push(
        `自动汇率不可用：${error instanceof Error ? error.message : String(error)}；原币分析仍然有效。`,
      );
    } finally {
      activeRequestIds.delete(childRequestId);
    }
  }

  const enriched =
    prices.length || fxRates.length
      ? await invoke<unknown>("ai_stock_portfolio_snapshot", {
          request: { portfolioId, prices, fxRates },
        })
      : base;
  const enrichedRecord = asRecord(enriched);
  return {
    result: {
      ...enrichedRecord,
      sources: [
        ...(Array.isArray(enrichedRecord.sources) ? enrichedRecord.sources : []),
        ...sources,
      ],
      warnings: [...asWarnings(enrichedRecord.warnings), ...warnings],
    },
    warnings,
    sources,
  };
}

export function createStockResearchTools(params: {
  runtimeScope: SystemToolRuntimeScope;
  portfolioReadAuthorized?: boolean;
}): BuiltinToolBundle {
  const active = DEFINITIONS.filter(
    (definition) =>
      definition.scopes.includes(params.runtimeScope) &&
      (definition.operation !== "portfolio" || params.portfolioReadAuthorized === true),
  );
  const definitionsByName = new Map(active.map((definition) => [definition.name, definition]));

  return {
    groupId: "stock",
    tools: active.map(({ name, description, parameters }) => ({
      name,
      description,
      parameters,
    })),
    metadataByName: createBuiltinMetadataMap(
      active.map(({ name }) => [
        name,
        {
          groupId: "stock" as const,
          kind: "stock",
          isReadOnly: true,
          displayCategory: "stock" as const,
        },
      ]),
    ),
    async executeToolCall(toolCall: ToolCall, signal?: AbortSignal): Promise<ToolResultMessage> {
      const timestamp = Date.now();
      const definition = definitionsByName.get(toolCall.name);
      if (!definition) {
        return {
          role: "toolResult",
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          content: [{ type: "text", text: `Unknown stock tool: ${toolCall.name}` }],
          details: {},
          isError: true,
          timestamp,
        };
      }
      if (signal?.aborted) {
        return {
          role: "toolResult",
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          content: [
            {
              type: "text",
              text: "Stock research request cancelled before execution.",
            },
          ],
          details: {},
          isError: true,
          timestamp,
        };
      }

      const requestId = crypto.randomUUID();
      const payload: Record<string, unknown> = {
        ...asRecord(toolCall.arguments),
        requestId,
      };
      const activeRequestIds = new Set([requestId]);
      const abort = () => {
        for (const activeRequestId of activeRequestIds)
          void invoke("stock_cancel", { requestId: activeRequestId });
      };
      signal?.addEventListener("abort", abort, { once: true });
      try {
        let result: unknown;
        if (definition.operation === "portfolio") {
          const action = asString(payload.action) ?? "list";
          const portfolioId = asString(payload.portfolioId);
          if (action === "list") {
            result = await invoke("ai_stock_portfolio_list");
          } else {
            if (!portfolioId)
              throw new Error(`StockPortfolioRead action=${action} requires portfolioId.`);
            result =
              action === "transactions"
                ? await invoke("ai_stock_portfolio_transactions", {
                    portfolioId,
                  })
                : (await enrichPortfolioSnapshot(portfolioId, requestId, activeRequestIds)).result;
          }
        } else {
          result = await invoke<unknown>(definition.command, {
            payload: toStockSidecarToolPayload(definition.operation, payload),
          });
        }
        const details = resultDetails(definition, requestId, result);
        if (definition.operation === "portfolio") {
          const action = asString(payload.action) ?? "list";
          const portfolioWarnings = asWarnings(asRecord(result).warnings);
          details.status =
            action === "snapshot" ? (portfolioWarnings.length ? "partial" : "ok") : "ok";
          details.sources = [
            { provider: "calen-local", label: "Calen 本地资产账本" },
            ...(details.sources ?? []),
          ];
          details.retrievedAt = new Date().toISOString();
          details.warnings = [...new Set([...(details.warnings ?? []), ...portfolioWarnings])];
        }
        return {
          role: "toolResult",
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          content: [{ type: "text", text: resultText(details) }],
          details,
          isError: details.status === "unavailable",
          timestamp,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          role: "toolResult",
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          content: [{ type: "text", text: `Stock research failed: ${message}` }],
          details: {
            kind: "stock_result",
            operation: definition.operation,
            requestId,
            status: "unavailable",
            warnings: [message],
            experimental: definition.experimental === true,
            result: null,
          } satisfies StockToolResultDetails,
          isError: true,
          timestamp,
        };
      } finally {
        signal?.removeEventListener("abort", abort);
      }
    },
  };
}
