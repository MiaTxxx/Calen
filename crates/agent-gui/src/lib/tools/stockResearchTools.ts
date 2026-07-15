import type { Tool, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import { invoke } from "@tauri-apps/api/core";
import { Type } from "typebox";

import {
  type BuiltinToolBundle,
  createBuiltinMetadataMap,
  type StockToolResultDetails,
} from "./builtinTypes";
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
  canonicalId: Type.Optional(Type.String()),
  symbol: Type.String({ minLength: 1 }),
  market: Type.Union([Type.Literal("CN"), Type.Literal("HK"), Type.Literal("US")]),
  exchange: Type.Optional(Type.String()),
  assetType: Type.Optional(Type.Union([Type.Literal("EQUITY"), Type.Literal("ETF")])),
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
      deadlineMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 120000 })),
    }),
    scopes: ["chat", "cron_auto_prompt"],
  },
  {
    name: "StockMarketBrief",
    operation: "marketBrief",
    command: "stock_market_brief",
    description:
      "Build an on-demand CN market brief covering market state, sectors, flows, limit-up/down, hot stocks, unusual moves and sentiment with partial-data warnings.",
    parameters: Type.Object({
      session: Type.Optional(
        Type.Union([Type.Literal("preMarket"), Type.Literal("intraday"), Type.Literal("close")]),
      ),
      tradeDate: Type.Optional(
        Type.String({
          description: "ISO date; defaults to the current market date.",
        }),
      ),
      sections: Type.Optional(Type.Array(Type.String(), { maxItems: 12 })),
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
      strategy: Type.String({ minLength: 1 }),
      startDate: Type.String({ minLength: 10 }),
      endDate: Type.String({ minLength: 10 }),
      parameters: Type.Optional(Type.Record(Type.String(), Type.Any())),
      benchmark: Type.Optional(Type.String()),
      feeRate: Type.Optional(Type.Number({ minimum: 0, maximum: 0.05, default: 0.001 })),
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
      prices: Type.Optional(Type.Array(Type.Any(), { maxItems: 200 })),
      fxRates: Type.Optional(Type.Array(Type.Any(), { maxItems: 20 })),
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

function asWarnings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function resultDetails(
  definition: StockToolDefinition,
  requestId: string,
  result: unknown,
): StockToolResultDetails {
  const record = asRecord(result);
  const evidence = asRecord(record.evidence ?? record);
  const instrument = asRecord(evidence.instrument);
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
            canonicalId: asString(instrument.canonicalId),
            symbol: asString(instrument.symbol),
            market: asString(instrument.market),
            displayName: asString(instrument.displayName),
          }
        : undefined,
    asOf: asString(evidence.asOf),
    retrievedAt: asString(evidence.retrievedAt),
    cached: asBoolean(evidence.cached),
    sources: Array.isArray(evidence.sources)
      ? evidence.sources.map((source) => {
          const item = asRecord(source);
          return {
            provider: asString(item.provider),
            label: asString(item.label),
            url: asString(item.url),
            asOf: asString(item.asOf),
          };
        })
      : [],
    warnings: asWarnings(evidence.warnings),
    experimental: definition.experimental === true || evidence.experimental === true,
    result,
  };
}

function resultText(details: StockToolResultDetails) {
  return [
    "Calen stock research result. Treat missing/partial fields as unavailable; do not infer them.",
    details.experimental
      ? "This result is experimental research output, not investment advice or a trading instruction."
      : "This result is research assistance, not investment advice or a trading instruction.",
    JSON.stringify(details.result, null, 2),
  ].join("\n\n");
}

export function createStockResearchTools(params: {
  runtimeScope: SystemToolRuntimeScope;
}): BuiltinToolBundle {
  const active = DEFINITIONS.filter((definition) =>
    definition.scopes.includes(params.runtimeScope),
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
      const abort = () => {
        void invoke("stock_cancel", { requestId });
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
                : await invoke("ai_stock_portfolio_snapshot", {
                    request: {
                      portfolioId,
                      prices: Array.isArray(payload.prices) ? payload.prices : [],
                      fxRates: Array.isArray(payload.fxRates) ? payload.fxRates : [],
                    },
                  });
          }
        } else {
          result = await invoke<unknown>(definition.command, { payload });
        }
        const details = resultDetails(definition, requestId, result);
        if (definition.operation === "portfolio") {
          details.status = "ok";
          details.sources = [{ provider: "calen-local", label: "Calen 本地资产账本" }];
          details.retrievedAt = new Date().toISOString();
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
