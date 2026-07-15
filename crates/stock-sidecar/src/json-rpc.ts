import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { StockResearchPort } from "./types.ts";

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: JsonRpcId; result: unknown }
  | { jsonrpc: "2.0"; id: JsonRpcId; error: JsonRpcError };

function error(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown
): JsonRpcResponse {
  const detail: JsonRpcError = { code, message };
  if (data !== undefined) detail.data = data;
  return { jsonrpc: "2.0", id, error: detail };
}

function requestFrom(value: unknown): JsonRpcRequest | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.jsonrpc !== "2.0" || typeof record.method !== "string")
    return null;
  if (
    record.id !== undefined &&
    record.id !== null &&
    typeof record.id !== "string" &&
    typeof record.id !== "number"
  )
    return null;
  if (
    record.params !== undefined &&
    (!record.params ||
      typeof record.params !== "object" ||
      Array.isArray(record.params))
  )
    return null;
  return record as unknown as JsonRpcRequest;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function validInstrument(value: unknown): boolean {
  const instrument = record(value);
  if (!instrument) return false;
  const market = instrument.market;
  const symbol = instrument.symbol;
  return (
    typeof instrument.id === "string" &&
    typeof symbol === "string" &&
    symbol.length > 0 &&
    instrument.id === `${market}:${symbol}` &&
    typeof instrument.name === "string" &&
    instrument.name.length > 0 &&
    (market === "CN" || market === "HK" || market === "US") &&
    typeof instrument.exchange === "string" &&
    instrument.exchange.length > 0 &&
    (instrument.assetType === "stock" ||
      instrument.assetType === "etf" ||
      instrument.assetType === "index" ||
      instrument.assetType === "fund" ||
      instrument.assetType === "unknown") &&
    (instrument.currency === "CNY" ||
      instrument.currency === "HKD" ||
      instrument.currency === "USD")
  );
}

function validNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validMarket(value: unknown): boolean {
  return (
    value === undefined || value === "CN" || value === "HK" || value === "US"
  );
}

function validInteger(
  value: unknown,
  minimum: number,
  maximum: number
): boolean {
  return (
    value === undefined ||
    (validNumber(value) &&
      Number.isInteger(value) &&
      value >= minimum &&
      value <= maximum)
  );
}

function validDate(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value))
  );
}

const RESEARCH_CAPABILITIES = new Set([
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
  "technical",
  "score",
  "strategy",
  "evaluator",
]);

const QUANT_STRATEGY_IDS = new Set([
  "trend",
  "mean-reversion",
  "breakout",
  "momentum",
  "volume-price",
]);
const BACKTEST_STRATEGY_IDS = new Set([
  "sma-cross",
  ...QUANT_STRATEGY_IDS,
  "fused",
]);

function validateParams(
  method: string,
  params: Record<string, unknown>
): string | null {
  if (method === "resolve") {
    if (typeof params.query !== "string" || !params.query.trim())
      return "resolve.query 必须是非空字符串";
    if (!validMarket(params.market))
      return "resolve.market 必须是 CN、HK 或 US";
    if (!validInteger(params.limit, 1, 100))
      return "resolve.limit 必须是 1-100 的整数";
    return null;
  }
  if (method === "snapshot") {
    if (!validInstrument(params.instrument))
      return "snapshot.instrument 缺失或格式无效";
    if (!validInteger(params.maxAgeMs, 0, 86_400_000))
      return "snapshot.maxAgeMs 必须是有效的非负整数";
    if (
      params.includeHistory !== undefined &&
      typeof params.includeHistory !== "boolean"
    )
      return "snapshot.includeHistory 必须是布尔值";
    if (
      params.includeProfile !== undefined &&
      typeof params.includeProfile !== "boolean"
    )
      return "snapshot.includeProfile 必须是布尔值";
    if (!validInteger(params.historyLimit, 1, 120))
      return "snapshot.historyLimit 必须是 1-120 的整数";
    return null;
  }
  if (method === "research") {
    if (!validInstrument(params.instrument))
      return "research.instrument 缺失或格式无效";
    if (!validInteger(params.historyLimit, 1, 2_000))
      return "research.historyLimit 必须是 1-2000 的整数";
    if (params.capabilities !== undefined) {
      if (!Array.isArray(params.capabilities) || !params.capabilities.length)
        return "research.capabilities 必须是非空数组";
      if (
        params.capabilities.some(
          (capability) =>
            typeof capability !== "string" ||
            !RESEARCH_CAPABILITIES.has(capability)
        )
      )
        return "research.capabilities 包含未知或不可用于研究的能力";
    }
    if (params.strategyIds !== undefined) {
      if (!Array.isArray(params.strategyIds) || !params.strategyIds.length)
        return "research.strategyIds 必须是非空数组";
      if (
        params.strategyIds.some(
          (strategyId) =>
            typeof strategyId !== "string" ||
            !QUANT_STRATEGY_IDS.has(strategyId)
        )
      )
        return "research.strategyIds 包含未知策略";
    }
    return null;
  }
  if (method === "marketBrief") {
    if (!validMarket(params.market))
      return "marketBrief.market 必须是 CN、HK 或 US";
    if (!validInteger(params.limit, 1, 100))
      return "marketBrief.limit 必须是 1-100 的整数";
    return null;
  }
  if (method === "status") return null;
  if (method === "backtest") {
    if (!Array.isArray(params.bars) && !validInstrument(params.instrument))
      return "backtest 必须提供 bars 或 instrument";
    if (
      params.initialCash !== undefined &&
      (!validNumber(params.initialCash) || params.initialCash <= 0)
    )
      return "backtest.initialCash 必须是正数";
    if (
      params.feeRate !== undefined &&
      (!validNumber(params.feeRate) ||
        params.feeRate < 0 ||
        params.feeRate >= 1)
    )
      return "backtest.feeRate 超出范围";
    if (!validDate(params.start) || !validDate(params.end))
      return "backtest.start/end 必须是 ISO 日期";
    if (
      typeof params.start === "string" &&
      typeof params.end === "string" &&
      params.start > params.end
    )
      return "backtest.start 不能晚于 end";
    const strategy =
      params.strategy === undefined ? null : record(params.strategy);
    if (params.strategy !== undefined && !strategy)
      return "backtest.strategy 格式无效";
    if (
      strategy?.id !== undefined &&
      (typeof strategy.id !== "string" ||
        !BACKTEST_STRATEGY_IDS.has(strategy.id))
    )
      return "backtest.strategy.id 包含未知策略";
    if (
      strategy &&
      (!validInteger(strategy.shortWindow, 1, 500) ||
        !validInteger(strategy.longWindow, 2, 1_000))
    ) {
      return "backtest.strategy 窗口必须是有效整数";
    }
    if (
      strategy &&
      validNumber(strategy.shortWindow) &&
      validNumber(strategy.longWindow) &&
      strategy.shortWindow >= strategy.longWindow
    )
      return "backtest shortWindow 必须小于 longWindow";
    if (Array.isArray(params.bars)) {
      if (params.bars.length > 2_000) return "backtest.bars 最多 2000 根";
      for (const value of params.bars) {
        const bar = record(value);
        if (
          !bar ||
          typeof bar.time !== "string" ||
          !validNumber(bar.open) ||
          !validNumber(bar.high) ||
          !validNumber(bar.low) ||
          !validNumber(bar.close)
        )
          return "backtest.bars 包含无效 K 线";
      }
    }
    return null;
  }
  return null;
}

export async function dispatchJsonRpc(
  service: StockResearchPort,
  value: unknown
): Promise<JsonRpcResponse | null> {
  const request = requestFrom(value);
  const candidateId =
    value && typeof value === "object"
      ? (value as Record<string, unknown>).id
      : null;
  const id =
    typeof candidateId === "string" ||
    typeof candidateId === "number" ||
    candidateId === null
      ? candidateId
      : null;
  if (!request) return error(id, -32600, "Invalid Request");
  const notification = request.id === undefined;
  const params = request.params ?? {};
  const validation = validateParams(request.method, params);
  if (validation)
    return notification
      ? null
      : error(request.id ?? null, -32602, `Invalid params: ${validation}`);
  try {
    let result: unknown;
    switch (request.method) {
      case "resolve":
        result = await service.resolve(params as never);
        break;
      case "snapshot":
        result = await service.snapshot(params as never);
        break;
      case "research":
        result = await service.research(params as never);
        break;
      case "marketBrief":
        result = await service.marketBrief(params as never);
        break;
      case "backtest":
        result = await service.backtest(params as never);
        break;
      case "status":
        result = await service.status();
        break;
      default:
        return notification
          ? null
          : error(
              request.id ?? null,
              -32601,
              `Method not found: ${request.method}`
            );
    }
    return notification
      ? null
      : { jsonrpc: "2.0", id: request.id ?? null, result };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return notification
      ? null
      : error(request.id ?? null, -32603, "Internal error", { message });
  }
}

export interface JsonRpcStdioOptions {
  input: Readable;
  output: Writable;
  service: StockResearchPort;
}

export async function runJsonRpcStdio(
  options: JsonRpcStdioOptions
): Promise<void> {
  const lines = createInterface({
    input: options.input,
    crlfDelay: Infinity,
    terminal: false,
  });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let response: JsonRpcResponse | null;
    try {
      response = await dispatchJsonRpc(options.service, JSON.parse(line));
    } catch {
      response = error(null, -32700, "Parse error");
    }
    if (response) options.output.write(`${JSON.stringify(response)}\n`);
  }
}
