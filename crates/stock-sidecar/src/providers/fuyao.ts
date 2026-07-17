/*
 * Fuyao Provider for Calen.
 * The endpoint and DTO mapping were adapted from Opptrix
 * packages/a-stock-layer/src/providers/tonghuashun (Apache-2.0), then
 * independently reduced and rewritten for Calen's stable Provider seam.
 */

import { makeInstrument } from "../instruments.ts";
import { strictFiniteNumber as number } from "../numbers.ts";
import type {
  InstrumentRef,
  PriceBar,
  ProviderContext,
  ProviderEvidence,
  StockProvider,
  StockResolveRequest,
  StockSnapshot,
} from "../types.ts";
import { ProviderError } from "./registry.ts";

type UnknownRecord = Record<string, unknown>;
type QueryValue = string | number | undefined;

const BASE_URL = "https://fuyao.aicubes.cn";
const REFERER = "https://fuyao.aicubes.cn/";

function object(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function thscode(instrument: InstrumentRef): string | null {
  if (instrument.market !== "CN" || !/^\d{6}$/.test(instrument.symbol))
    return null;
  const suffix =
    instrument.exchange === "SSE"
      ? "SH"
      : instrument.exchange === "SZSE"
        ? "SZ"
        : instrument.exchange === "BSE"
          ? "BJ"
          : null;
  return suffix ? `${instrument.symbol}.${suffix}` : null;
}

function mapInstrument(value: unknown): InstrumentRef | null {
  const row = object(value);
  const code = text(row?.thscode) ?? text(row?.ticker);
  const match = /^(\d{6})\.(SH|SZ|BJ)$/i.exec(code ?? "");
  if (!match) return null;
  const symbol = match[1]!;
  const suffix = match[2]!.toUpperCase();
  const exchange = suffix === "SH" ? "SSE" : suffix === "SZ" ? "SZSE" : "BSE";
  const assetType = text(row?.asset_type)?.toLowerCase();
  const assetClass =
    assetType?.includes("etf") || /^(1[568]|5[0168])/.test(symbol)
      ? "ETF"
      : "EQUITY";
  return makeInstrument(
    "CN",
    symbol,
    exchange,
    assetClass,
    "CNY",
    text(row?.name) ?? symbol
  );
}

function apiMessage(payload: UnknownRecord | undefined): string | undefined {
  return text(payload?.message) ?? text(payload?.msg);
}

function redact(value: string | undefined, apiKey: string): string | undefined {
  return value?.replaceAll(apiKey, "[REDACTED]");
}

async function get(
  apiKey: string,
  path: string,
  params: Record<string, QueryValue>,
  context: ProviderContext
): Promise<UnknownRecord> {
  const url = new URL(path, BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "")
      url.searchParams.set(key, String(value));
  }
  const init: RequestInit = {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-api-key": apiKey,
      Referer: REFERER,
    },
  };
  if (context.signal) init.signal = context.signal;
  let response: Response;
  try {
    response = await context.fetch(url, init);
  } catch (error) {
    if (context.signal?.aborted) throw context.signal.reason ?? error;
    const message = redact(
      error instanceof Error ? error.message : String(error),
      apiKey
    );
    throw new ProviderError(`Fuyao request failed: ${message}`, {
      cause: error,
    });
  }
  let payload: UnknownRecord | undefined;
  try {
    payload = object(await response.json());
  } catch (error) {
    if (response.ok)
      throw new ProviderError("Fuyao returned invalid JSON", { cause: error });
  }
  const message = redact(apiMessage(payload), apiKey);
  if (!response.ok) {
    throw new ProviderError(
      `Fuyao HTTP ${response.status}${message ? `: ${message}` : ""}`,
      { status: response.status }
    );
  }
  if (!payload) throw new ProviderError("Fuyao returned an empty response");
  const code = number(payload.code);
  if (code !== 0) {
    const requestId = text(payload.request_id);
    throw new ProviderError(
      `Fuyao API code=${String(payload.code ?? "unknown")}: ${message ?? "unknown error"}${requestId ? ` (${requestId})` : ""}`
    );
  }
  return object(payload.data) ?? {};
}

function items(data: UnknownRecord): unknown[] {
  return Array.isArray(data.item) ? data.item : [];
}

function marketTimestamp(
  row: UnknownRecord,
  fallback: string
): { value: string; inferred: boolean } {
  for (const candidate of [
    row.date_ms,
    row.timestamp_ms,
    row.time_ms,
    row.timestamp,
    row.trade_time,
  ]) {
    const epoch = number(candidate);
    if (epoch !== undefined && epoch > 0)
      return { value: new Date(epoch).toISOString(), inferred: false };
    if (typeof candidate === "string") {
      const parsed = Date.parse(candidate);
      if (Number.isFinite(parsed))
        return { value: new Date(parsed).toISOString(), inferred: false };
    }
  }
  return { value: fallback, inferred: true };
}

function ymdToMs(value: string, endOfDay = false): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new ProviderError(`Fuyao invalid date: ${value}`);
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0
  );
}

function ymdInChina(value: unknown): string | undefined {
  const epoch = number(value);
  if (epoch === undefined || epoch <= 0) return undefined;
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(epoch));
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );
  return values.year && values.month && values.day
    ? `${values.year}-${values.month}-${values.day}`
    : undefined;
}

function currentYmdInChina(date: Date): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function defaultStart(end: string, limit: number): string {
  const date = new Date(ymdToMs(end));
  date.setUTCDate(date.getUTCDate() - Math.min(limit * 2 + 30, 3_650));
  return date.toISOString().slice(0, 10);
}

function unsupported(
  context: ProviderContext,
  capability: string
): ProviderEvidence<never> {
  return {
    data: null,
    asOf: context.now().toISOString(),
    warnings: [`Fuyao ${capability} 首版仅支持 A 股`],
  };
}

export function createFuyaoProvider(apiKey: string): StockProvider {
  const providerKey = apiKey.trim();
  if (!providerKey) throw new Error("Fuyao API Key 不能为空");
  return {
    id: "fuyao",
    priority: 16,
    capabilities: ["resolve", "snapshot", "history"],
    async resolve(
      request: StockResolveRequest,
      context
    ): Promise<ProviderEvidence<InstrumentRef[]>> {
      if (request.market && request.market !== "CN")
        return unsupported(context, "标的搜索");
      const limit = Math.min(Math.max(request.limit ?? 10, 1), 50);
      const data = await get(
        providerKey,
        "/api/meta/tickers/search",
        { q: request.query.trim(), limit, asset_type: "a-share" },
        context
      );
      const instruments = items(data)
        .map(mapInstrument)
        .filter((item) => item !== null)
        .slice(0, limit);
      return {
        data: instruments.length ? instruments : null,
        asOf: context.now().toISOString(),
      };
    },
    async snapshot(
      instrument,
      context
    ): Promise<ProviderEvidence<StockSnapshot>> {
      const code = thscode(instrument);
      if (!code) return unsupported(context, "行情快照");
      const data = await get(
        providerKey,
        "/api/a-share/prices/snapshot",
        { thscodes: code },
        context
      );
      const row =
        items(data)
          .map(object)
          .find(
            (item) =>
              item &&
              String(item.thscode ?? item.ticker ?? "").toUpperCase() === code
          ) ?? object(items(data)[0]);
      const price = number(row?.last_price);
      if (!row || price === undefined || price <= 0) {
        return {
          data: null,
          asOf: context.now().toISOString(),
          warnings: ["Fuyao 未返回有效行情快照"],
        };
      }
      const timestamp = marketTimestamp(row, context.now().toISOString());
      const snapshot: StockSnapshot = {
        instrument,
        price,
        marketTime: timestamp.value,
      };
      const optional = {
        previousClose: number(row.prev_price),
        open: number(row.open_price),
        high: number(row.high_price),
        low: number(row.low_price),
        volume: number(row.volume),
        change: number(row.price_change),
        changePercent: number(row.price_change_ratio_pct),
      };
      for (const [key, value] of Object.entries(optional)) {
        if (value !== undefined)
          (snapshot as unknown as Record<string, unknown>)[key] = value;
      }
      const evidence: ProviderEvidence<StockSnapshot> = {
        data: snapshot,
        asOf: timestamp.value,
      };
      if (timestamp.inferred)
        evidence.warnings = [
          "Fuyao 快照未提供可解析的行情时间，asOf 使用获取时间",
        ];
      return evidence;
    },
    async history(
      instrument,
      request,
      context
    ): Promise<ProviderEvidence<PriceBar[]>> {
      const code = thscode(instrument);
      if (!code) return unsupported(context, "日 K");
      const limit = Math.min(Math.max(request.limit ?? 120, 1), 2_000);
      const endDate = request.end ?? currentYmdInChina(context.now());
      const startDate = request.start ?? defaultStart(endDate, limit);
      const start = ymdToMs(startDate);
      const end = ymdToMs(endDate, true);
      if (start > end)
        throw new ProviderError("Fuyao history start date is after end date");
      const data = await get(
        providerKey,
        "/api/a-share/prices/historical",
        { thscode: code, interval: "1d", start, end, adjust: "forward" },
        context
      );
      const bars = items(data)
        .flatMap((value): PriceBar[] => {
          const row = object(value);
          const time = ymdInChina(row?.date_ms);
          const open = number(row?.open_price);
          const high = number(row?.high_price);
          const low = number(row?.low_price);
          const close = number(row?.close_price);
          if (
            !time ||
            open === undefined ||
            high === undefined ||
            low === undefined ||
            close === undefined ||
            close <= 0
          )
            return [];
          const bar: PriceBar = { time, open, high, low, close };
          const volume = number(row?.volume);
          if (volume !== undefined) bar.volume = volume;
          return [bar];
        })
        .sort((left, right) => left.time.localeCompare(right.time))
        .slice(-limit);
      return {
        data: bars.length ? bars : null,
        asOf: bars.at(-1)?.time ?? context.now().toISOString(),
      };
    },
  };
}
