import { makeInstrument } from "../instruments.ts";
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

const ZZSHARE_BASE_URL = "https://api.zizizaizai.com/v3";
const ZZSHARE_EXCHANGES = ["SS", "KSH", "SZ", "GEM", "BJ"] as const;

function object(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function number(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function date(value: unknown): string | undefined {
  const text = String(value ?? "");
  return /^(\d{4})(\d{2})(\d{2})$/.test(text)
    ? text.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3")
    : undefined;
}

function recordList(value: unknown): UnknownRecord[] {
  const source = Array.isArray(value) ? value : object(value)?.list;
  return Array.isArray(source)
    ? source.flatMap((item) => {
        const row = object(item);
        return row ? [row] : [];
      })
    : [];
}

function exchangeForSymbol(symbol: string): {
  backend: (typeof ZZSHARE_EXCHANGES)[number];
  exchange: string;
  suffix: "SH" | "SZ" | "BJ";
} {
  if (/^[48]/.test(symbol))
    return { backend: "BJ", exchange: "BSE", suffix: "BJ" };
  if (/^68/.test(symbol))
    return { backend: "KSH", exchange: "SSE", suffix: "SH" };
  if (/^[569]/.test(symbol))
    return { backend: "SS", exchange: "SSE", suffix: "SH" };
  if (/^3/.test(symbol))
    return { backend: "GEM", exchange: "SZSE", suffix: "SZ" };
  return { backend: "SZ", exchange: "SZSE", suffix: "SZ" };
}

function tsCode(instrument: InstrumentRef): string | null {
  if (instrument.market !== "CN" || !/^\d{6}$/.test(instrument.symbol))
    return null;
  return `${instrument.symbol}.${exchangeForSymbol(instrument.symbol).suffix}`;
}

function marketName(typeCode: unknown): string {
  const code = String(typeCode ?? "").toUpperCase();
  if (code.includes("GEM")) return "创业板";
  if (code.includes("KSH") || code.includes("STAR")) return "科创板";
  if (code.includes("BJ")) return "北交所";
  return "主板";
}

function mapInstrument(row: UnknownRecord): InstrumentRef | null {
  const symbol = String(row.code ?? row.symbol ?? "").trim();
  if (!/^\d{6}$/.test(symbol)) return null;
  const route = exchangeForSymbol(symbol);
  return makeInstrument(
    "CN",
    symbol,
    route.exchange,
    "EQUITY",
    "CNY",
    String(row.name ?? symbol)
  );
}

function retryAfterMs(response: Response): number | undefined {
  const value = response.headers.get("Retry-After");
  if (!value) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0
    ? Math.round(seconds * 1_000)
    : undefined;
}

async function get(
  path: string,
  params: Record<string, string | number | undefined>,
  token: string,
  context: ProviderContext
): Promise<unknown> {
  const url = new URL(`${ZZSHARE_BASE_URL}/${path.replace(/^\//, "")}`);
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && value !== "")
      url.searchParams.set(key, String(value));
  const init: RequestInit = {
    headers: {
      Accept: "application/json",
      "sdk-key": token,
    },
  };
  if (context.signal) init.signal = context.signal;
  const response = await context.fetch(url, init);
  if (!response.ok) {
    const options: { status: number; retryAfterMs?: number } = {
      status: response.status,
    };
    const retryAfter = retryAfterMs(response);
    if (retryAfter !== undefined) options.retryAfterMs = retryAfter;
    throw new ProviderError(`ZZShare HTTP ${response.status}`, options);
  }
  const body = object(await response.json());
  if (!body) throw new ProviderError("ZZShare 返回无效 JSON");
  const code = number(body.code);
  if (code !== 200 && code !== 20_000)
    throw new ProviderError(`ZZShare API 返回错误码 ${String(body.code)}`);
  return body.data ?? null;
}

function unsupported(
  context: ProviderContext,
  capability: string
): ProviderEvidence<never> {
  return {
    data: null,
    asOf: context.now().toISOString(),
    warnings: [`ZZShare ${capability} 首版仅支持 A 股`],
  };
}

async function listedRows(
  exchanges: readonly (typeof ZZSHARE_EXCHANGES)[number][],
  token: string,
  context: ProviderContext,
  filter: { tsCode?: string; name?: string } = {}
): Promise<UnknownRecord[]> {
  const results = await Promise.all(
    exchanges.map((exchange) =>
      get(
        "open/stocks/list",
        {
          exchange,
          list_status: "L",
          format: "records",
          ts_code: filter.tsCode,
          name: filter.name,
        },
        token,
        context
      )
    )
  );
  return results.flatMap(recordList);
}

async function dailyBars(
  instrument: InstrumentRef,
  request: { limit: number; start?: string; end?: string },
  token: string,
  context: ProviderContext
): Promise<PriceBar[]> {
  const code = tsCode(instrument);
  if (!code) return [];
  const data = await get(
    `market/kline/day/${code}`,
    {
      get_type: "range",
      candle_mode: 0,
      start_date: request.start?.replaceAll("-", ""),
      end_date: request.end?.replaceAll("-", ""),
      limit: request.limit,
    },
    token,
    context
  );
  return recordList(data)
    .flatMap((row): PriceBar[] => {
      const time = date(row.trade_date);
      const open = number(row.open);
      const high = number(row.high);
      const low = number(row.low);
      const close = number(row.close);
      if (
        !time ||
        open === undefined ||
        high === undefined ||
        low === undefined ||
        close === undefined
      )
        return [];
      const bar: PriceBar = { time, open, high, low, close };
      const volume = number(row.volume ?? row.vol);
      if (volume !== undefined) bar.volume = volume;
      return [bar];
    })
    .sort((left, right) => left.time.localeCompare(right.time))
    .slice(-request.limit);
}

export function createZzshareProvider(token?: string): StockProvider {
  const sdkKey = token?.trim() || "anonymous";
  return {
    id: "zzshare",
    priority: 45,
    free: true,
    capabilities: ["resolve", "snapshot", "history", "profile"],
    async resolve(
      request: StockResolveRequest,
      context
    ): Promise<ProviderEvidence<InstrumentRef[]>> {
      if (request.market && request.market !== "CN")
        return unsupported(context, "标的搜索");
      const query = request.query.trim();
      const exactSymbol = /^\d{6}$/.test(query) ? query : undefined;
      const exchanges = exactSymbol
        ? [exchangeForSymbol(exactSymbol).backend]
        : ZZSHARE_EXCHANGES;
      const rows = await listedRows(exchanges, sdkKey, context, {
        ...(exactSymbol ? { tsCode: exactSymbol } : { name: query }),
      });
      const matched = rows
        .filter((row) => {
          const symbol = String(row.code ?? row.symbol ?? "");
          const name = String(row.name ?? "");
          return exactSymbol
            ? symbol === exactSymbol
            : symbol.includes(query) || name.includes(query);
        })
        .map(mapInstrument)
        .filter((item) => item !== null)
        .slice(0, Math.min(Math.max(request.limit ?? 10, 1), 50));
      return {
        data: matched.length ? matched : null,
        asOf: context.now().toISOString(),
      };
    },
    async snapshot(
      instrument,
      context
    ): Promise<ProviderEvidence<StockSnapshot>> {
      if (!tsCode(instrument)) return unsupported(context, "行情快照");
      const data = await get(
        `market/kline/day/${tsCode(instrument)}`,
        { get_type: "range", candle_mode: 0, limit: 1 },
        sdkKey,
        context
      );
      const row = recordList(data).at(-1);
      const marketTime = date(row?.trade_date);
      const close = number(row?.close);
      if (!row || !marketTime || close === undefined)
        return {
          data: null,
          asOf: context.now().toISOString(),
          warnings: ["ZZShare 未返回有效日线快照"],
        };
      const snapshot: StockSnapshot = {
        instrument,
        price: close,
        marketTime,
      };
      const previousClose = number(row.prev_close ?? row.pre_close);
      if (previousClose !== undefined) {
        snapshot.previousClose = previousClose;
        snapshot.change = close - previousClose;
      }
      const open = number(row.open);
      const high = number(row.high);
      const low = number(row.low);
      const volume = number(row.volume ?? row.vol);
      const changePercent = number(row.quote_rate ?? row.pct_chg);
      if (open !== undefined) snapshot.open = open;
      if (high !== undefined) snapshot.high = high;
      if (low !== undefined) snapshot.low = low;
      if (volume !== undefined) snapshot.volume = volume;
      if (changePercent !== undefined) snapshot.changePercent = changePercent;
      return {
        data: snapshot,
        asOf: marketTime,
        warnings: ["ZZShare 快照来自最近交易日日线收盘数据，并非实时行情"],
      };
    },
    async history(instrument, request, context) {
      if (!tsCode(instrument)) return unsupported(context, "日 K");
      const limit = Math.min(Math.max(request.limit ?? 120, 1), 2_000);
      const bounded: { limit: number; start?: string; end?: string } = {
        limit,
      };
      if (request.start) bounded.start = request.start;
      if (request.end) bounded.end = request.end;
      const bars = await dailyBars(instrument, bounded, sdkKey, context);
      return {
        data: bars.length ? bars : null,
        asOf: bars.at(-1)?.time ?? context.now().toISOString(),
      };
    },
    async profile(instrument, context): Promise<ProviderEvidence<unknown>> {
      const code = tsCode(instrument);
      if (!code) return unsupported(context, "公司资料");
      const route = exchangeForSymbol(instrument.symbol);
      const [info, rows] = await Promise.all([
        get(
          "open/stock/info",
          { stock_id: instrument.symbol, info_type: 0 },
          sdkKey,
          context
        ),
        listedRows([route.backend], sdkKey, context, {
          tsCode: instrument.symbol,
        }),
      ]);
      const basic = rows.find(
        (row) => String(row.code ?? row.symbol ?? "") === instrument.symbol
      );
      const details = recordList(info)[0] ?? object(info);
      if (!basic && !details)
        return {
          data: null,
          asOf: context.now().toISOString(),
          warnings: ["ZZShare 未返回公司资料"],
        };
      return {
        data: {
          name: String(basic?.name ?? instrument.name),
          symbol: instrument.symbol,
          exchange: route.exchange,
          market: marketName(basic?.type_code),
          area: details?.area,
          industry: details?.industry,
          mainBusiness: details?.main_business,
        },
        asOf: context.now().toISOString(),
        warnings: details
          ? []
          : ["ZZShare 公司扩展资料不可用，仅返回上市标的资料"],
      };
    },
  };
}
