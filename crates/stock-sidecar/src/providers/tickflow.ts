import type {
  InstrumentRef,
  PriceBar,
  ProviderContext,
  ProviderEvidence,
  StockProvider,
  StockSnapshot,
} from "../types.ts";
import { strictFiniteNumber as number } from "../numbers.ts";
import { ProviderError } from "./registry.ts";

type UnknownRecord = Record<string, unknown>;

const TICKFLOW_BASE_URL = "https://api.tickflow.org";

function object(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function tickflowSymbol(instrument: InstrumentRef): string | null {
  if (instrument.market === "US")
    return `${instrument.symbol.trim().toUpperCase()}.US`;
  if (instrument.market === "HK") {
    const symbol = instrument.symbol.replace(/\D/g, "").padStart(5, "0");
    return /^\d{5}$/.test(symbol) ? `${symbol}.HK` : null;
  }
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

function errorDetail(value: unknown): string | undefined {
  const payload = object(value);
  const message =
    typeof payload?.message === "string" && payload.message.trim()
      ? payload.message.trim()
      : undefined;
  const code =
    typeof payload?.code === "string" && payload.code.trim()
      ? payload.code.trim()
      : undefined;
  if (message && code) return `${message} (${code})`;
  return message ?? code;
}

function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (header === null) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : undefined;
}

async function fetchJson(
  apiKey: string,
  path: string,
  query: Record<string, string | number | undefined>,
  context: ProviderContext
): Promise<UnknownRecord> {
  const url = new URL(path, TICKFLOW_BASE_URL);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "")
      url.searchParams.set(key, String(value));
  }
  const init: RequestInit = {
    headers: { Accept: "application/json", "x-api-key": apiKey },
  };
  if (context.signal) init.signal = context.signal;
  let response: Response;
  try {
    response = await context.fetch(url, init);
  } catch (error) {
    const message = (
      error instanceof Error ? error.message : String(error)
    ).replaceAll(apiKey, "[REDACTED]");
    throw new ProviderError(`TickFlow request failed: ${message}`, {
      cause: error,
    });
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    if (!response.ok)
      throw new ProviderError(`TickFlow HTTP ${response.status}`, {
        status: response.status,
        cause,
      });
    throw new ProviderError("TickFlow 返回无效 JSON", { cause });
  }
  if (!response.ok) {
    const detail = errorDetail(payload)?.replaceAll(apiKey, "[REDACTED]");
    const options: {
      status: number;
      retryAfterMs?: number;
    } = { status: response.status };
    const retryAfter = retryAfterMs(response);
    if (retryAfter !== undefined) options.retryAfterMs = retryAfter;
    throw new ProviderError(
      detail
        ? `TickFlow HTTP ${response.status}: ${detail}`
        : `TickFlow HTTP ${response.status}`,
      options
    );
  }
  const result = object(payload);
  if (!result) throw new ProviderError("TickFlow 返回无效 JSON");
  return result;
}

function quoteRows(value: unknown): UnknownRecord[] {
  if (Array.isArray(value))
    return value.flatMap((item) => {
      const row = object(item);
      return row ? [row] : [];
    });
  const row = object(value);
  if (!row) return [];
  return Object.values(row).flatMap((item) => {
    const quote = object(item);
    return quote ? [quote] : [];
  });
}

function marketTime(value: unknown, fallback: string): string {
  if (
    typeof value === "string" &&
    value.trim() &&
    !/^\d+(?:\.\d+)?$/.test(value.trim())
  )
    return value.trim();
  const rawTimestamp = number(value);
  const timestamp =
    rawTimestamp !== undefined && Math.abs(rawTimestamp) < 100_000_000_000
      ? rawTimestamp * 1_000
      : rawTimestamp;
  if (timestamp === undefined) return fallback;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function marketDate(timestamp: number, instrument: InstrumentRef): string {
  const epochMs =
    Math.abs(timestamp) < 100_000_000_000 ? timestamp * 1_000 : timestamp;
  const timeZone =
    instrument.market === "US" ? "America/New_York" : "Asia/Shanghai";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(epochMs));
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function ymdToMs(value: string, endOfDay = false): number | undefined {
  const matched = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!matched) return undefined;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  return endOfDay
    ? Date.UTC(year, month - 1, day, 23, 59, 59, 999)
    : Date.UTC(year, month - 1, day);
}

function compactKlineData(
  payload: UnknownRecord,
  symbol: string
): UnknownRecord | undefined {
  const data = object(payload.data);
  if (!data) return undefined;
  return Array.isArray(data.timestamp) ? data : object(data[symbol]);
}

export function createTickflowProvider(apiKey: string): StockProvider {
  const key = apiKey.trim();
  if (!key) throw new Error("TickFlow API Key 不能为空");
  return {
    id: "tickflow",
    priority: 120,
    capabilities: ["snapshot", "history"],
    async snapshot(
      instrument,
      context
    ): Promise<ProviderEvidence<StockSnapshot>> {
      const symbol = tickflowSymbol(instrument);
      if (!symbol)
        return {
          data: null,
          asOf: context.now().toISOString(),
          warnings: ["TickFlow 快照仅支持 CN、HK 和 US 市场"],
        };
      const payload = await fetchJson(
        key,
        "/v1/quotes",
        { symbols: symbol },
        context
      );
      const quote = quoteRows(payload.data).find(
        (row) => String(row.symbol ?? "").toUpperCase() === symbol
      );
      const price = number(quote?.last_price);
      if (!quote || price === undefined || price <= 0)
        throw new ProviderError("TickFlow 行情返回空数据");
      const ext = object(quote.ext) ?? {};
      const previousClose = number(quote.prev_close);
      const asOf = marketTime(quote.timestamp, "unknown");
      const data: StockSnapshot = {
        instrument: {
          ...instrument,
          name:
            typeof ext.name === "string" && ext.name.trim()
              ? ext.name.trim()
              : instrument.name,
        },
        price,
        marketTime: asOf,
      };
      const directChange = number(ext.change_amount);
      const decimalChangePercent = number(ext.change_pct);
      const optional = {
        previousClose,
        open: number(quote.open),
        high: number(quote.high),
        low: number(quote.low),
        volume: number(quote.volume),
        change:
          directChange ??
          (previousClose === undefined ? undefined : price - previousClose),
        changePercent:
          decimalChangePercent === undefined
            ? previousClose && previousClose > 0
              ? ((price - previousClose) / previousClose) * 100
              : undefined
            : decimalChangePercent * 100,
      };
      for (const [field, value] of Object.entries(optional)) {
        if (value !== undefined)
          (data as unknown as Record<string, unknown>)[field] = value;
      }
      const evidence: ProviderEvidence<StockSnapshot> = { data, asOf };
      if (asOf === "unknown")
        evidence.warnings = [
          "TickFlow 未提供有效行情时间；asOf 标记为 unknown，获取时间仅记录在 retrievedAt。",
        ];
      return evidence;
    },
    async history(
      instrument,
      request,
      context
    ): Promise<ProviderEvidence<PriceBar[]>> {
      const symbol = tickflowSymbol(instrument);
      if (!symbol)
        return {
          data: null,
          asOf: context.now().toISOString(),
          warnings: ["TickFlow 日 K 仅支持 CN、HK 和 US 市场"],
        };
      const limit = Math.min(Math.max(request.limit ?? 120, 1), 2_000);
      const payload = await fetchJson(
        key,
        "/v1/klines",
        {
          symbol,
          period: "1d",
          count: limit,
          start_time: request.start ? ymdToMs(request.start) : undefined,
          end_time: request.end ? ymdToMs(request.end, true) : undefined,
          adjust: instrument.market === "CN" ? "forward_additive" : undefined,
        },
        context
      );
      const compact = compactKlineData(payload, symbol);
      const timestamps = Array.isArray(compact?.timestamp)
        ? compact.timestamp
        : [];
      const open = Array.isArray(compact?.open) ? compact.open : [];
      const high = Array.isArray(compact?.high) ? compact.high : [];
      const low = Array.isArray(compact?.low) ? compact.low : [];
      const close = Array.isArray(compact?.close) ? compact.close : [];
      const volume = Array.isArray(compact?.volume) ? compact.volume : [];
      const bars = timestamps
        .flatMap((value, index): PriceBar[] => {
          const timestamp = number(value);
          const barOpen = number(open[index]);
          const barHigh = number(high[index]);
          const barLow = number(low[index]);
          const barClose = number(close[index]);
          if (
            timestamp === undefined ||
            barOpen === undefined ||
            barHigh === undefined ||
            barLow === undefined ||
            barClose === undefined ||
            barClose <= 0
          )
            return [];
          const bar: PriceBar = {
            time: marketDate(timestamp, instrument),
            open: barOpen,
            high: barHigh,
            low: barLow,
            close: barClose,
          };
          const barVolume = number(volume[index]);
          if (barVolume !== undefined) bar.volume = barVolume;
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
