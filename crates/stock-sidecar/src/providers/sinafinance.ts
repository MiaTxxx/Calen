import { makeInstrument } from "../instruments.ts";
import type {
  AssetClass,
  InstrumentRef,
  PriceBar,
  ProviderContext,
  ProviderEvidence,
  StockProvider,
  StockResolveRequest,
  StockSnapshot,
} from "../types.ts";
import { ProviderError } from "./registry.ts";

const SINA_REFERER = "https://finance.sina.com.cn/";
const SINA_INDEX_SYMBOLS = new Set([
  "sh000001",
  "sh000016",
  "sh000300",
  "sh000688",
  "sh000905",
  "sh000906",
  "sh000985",
]);

function requestInit(
  signal: AbortSignal | undefined,
  referer = SINA_REFERER
): RequestInit {
  const init: RequestInit = {
    headers: {
      Accept: "application/json, application/javascript, text/plain, */*",
      Referer: referer,
    },
  };
  if (signal) init.signal = signal;
  return init;
}

async function requireOk(response: Response): Promise<Response> {
  if (!response.ok)
    throw new ProviderError(`HTTP ${response.status}`, {
      status: response.status,
    });
  return response;
}

async function decodeSinaText(response: Response): Promise<string> {
  await requireOk(response);
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const encoding = /charset=(?:utf-8|utf8)/.test(contentType)
    ? "utf-8"
    : "gb18030";
  return new TextDecoder(encoding).decode(await response.arrayBuffer());
}

function number(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function rounded(value: number, digits = 2): number {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

function providerSymbol(instrument: InstrumentRef): string | null {
  if (instrument.market !== "CN") return null;
  const prefix =
    instrument.exchange === "SSE"
      ? "sh"
      : instrument.exchange === "BSE"
        ? "bj"
        : "sz";
  return `${prefix}${instrument.symbol}`;
}

function exchangeFromSymbol(symbol: string): string | null {
  if (symbol.startsWith("sh")) return "SSE";
  if (symbol.startsWith("sz")) return "SZSE";
  if (symbol.startsWith("bj")) return "BSE";
  return null;
}

function assetClass(type: string, symbol: string): AssetClass {
  if (type === "203") return "ETF";
  if (symbol.startsWith("sz399") || SINA_INDEX_SYMBOLS.has(symbol))
    return "INDEX";
  return "EQUITY";
}

function parseSuggestions(text: string, limit: number): InstrumentRef[] {
  const payload = /var\s+suggestvalue="([\s\S]*?)";?/.exec(text)?.[1] ?? "";
  const instruments: InstrumentRef[] = [];
  const seen = new Set<string>();
  for (const row of payload.split(";")) {
    const fields = row.split(",");
    const type = fields[1];
    const code = fields[2];
    const symbol = fields[3]?.toLowerCase();
    const name = fields[4]?.trim();
    if (
      !type ||
      !code ||
      !symbol ||
      !name ||
      !/^(?:sh|sz|bj)\d{6}$/.test(symbol) ||
      !/^\d{6}$/.test(code) ||
      (type !== "11" && type !== "203")
    )
      continue;
    const exchange = exchangeFromSymbol(symbol);
    const id = `CN:${code}`;
    if (!exchange || seen.has(id)) continue;
    seen.add(id);
    instruments.push(
      makeInstrument(
        "CN",
        code,
        exchange,
        assetClass(type, symbol),
        "CNY",
        name
      )
    );
    if (instruments.length >= limit) break;
  }
  return instruments;
}

function quoteTime(
  date: string | undefined,
  time: string | undefined,
  fallback: string
): string {
  if (!date || !time || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return fallback;
  if (!/^\d{2}:\d{2}:\d{2}$/.test(time)) return fallback;
  return `${date}T${time}.000+08:00`;
}

function inRange(time: string, start?: string, end?: string): boolean {
  const key = time.replaceAll("-", "").slice(0, 8);
  const startKey = start?.replaceAll("-", "").slice(0, 8);
  const endKey = end?.replaceAll("-", "").slice(0, 8);
  return (!startKey || key >= startKey) && (!endKey || key <= endKey);
}

async function resolve(
  request: StockResolveRequest,
  context: ProviderContext
): Promise<ProviderEvidence<InstrumentRef[]>> {
  if (request.market && request.market !== "CN")
    return {
      data: null,
      asOf: context.now().toISOString(),
      warnings: ["新浪财经标的搜索适配器仅支持 A 股"],
    };
  const url = new URL("https://suggest3.sinajs.cn/suggest/type=11,203");
  url.searchParams.set("key", request.query.trim());
  const text = await decodeSinaText(
    await context.fetch(url, requestInit(context.signal))
  );
  const instruments = parseSuggestions(
    text,
    Math.min(Math.max(request.limit ?? 10, 1), 50)
  );
  return {
    data: instruments.length ? instruments : null,
    asOf: context.now().toISOString(),
  };
}

async function snapshot(
  instrument: InstrumentRef,
  context: ProviderContext
): Promise<ProviderEvidence<StockSnapshot>> {
  const symbol = providerSymbol(instrument);
  if (!symbol)
    return {
      data: null,
      asOf: context.now().toISOString(),
      warnings: ["新浪财经首版行情适配器仅支持 A 股"],
    };
  const text = await decodeSinaText(
    await context.fetch(
      `https://hq.sinajs.cn/list=${symbol}`,
      requestInit(context.signal)
    )
  );
  const payload = /var\s+hq_str_[^=]+="([^"]*)"/.exec(text)?.[1];
  const fields = payload?.split(",");
  const price = number(fields?.[3]);
  if (!fields || price === undefined || price <= 0)
    throw new ProviderError("新浪财经行情返回空数据");
  const previousClose = number(fields[2]);
  const asOf = quoteTime(fields[30], fields[31], context.now().toISOString());
  const data: StockSnapshot = {
    instrument: {
      ...instrument,
      name: fields[0]?.trim() || instrument.name,
    },
    price,
    marketTime: asOf,
  };
  const optional = {
    previousClose,
    open: number(fields[1]),
    high: number(fields[4]),
    low: number(fields[5]),
    volume: number(fields[8]),
    change:
      previousClose === undefined ? undefined : rounded(price - previousClose),
    changePercent:
      previousClose && previousClose > 0
        ? rounded(((price - previousClose) / previousClose) * 100)
        : undefined,
  };
  for (const [key, value] of Object.entries(optional)) {
    if (value !== undefined)
      (data as unknown as Record<string, unknown>)[key] = value;
  }
  return { data, asOf };
}

async function history(
  instrument: InstrumentRef,
  request: { limit?: number; start?: string; end?: string },
  context: ProviderContext
): Promise<ProviderEvidence<PriceBar[]>> {
  const symbol = providerSymbol(instrument);
  if (!symbol)
    return {
      data: null,
      asOf: context.now().toISOString(),
      warnings: ["新浪财经首版历史行情适配器仅支持 A 股"],
    };
  const limit = Math.min(Math.max(request.limit ?? 120, 1), 1_023);
  const url = new URL(
    "https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData"
  );
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("scale", "240");
  url.searchParams.set("ma", "no");
  url.searchParams.set("datalen", String(limit));
  const response = await requireOk(
    await context.fetch(
      url,
      requestInit(
        context.signal,
        `https://finance.sina.com.cn/realstock/company/${symbol}/nc.shtml`
      )
    )
  );
  const payload = (await response.json()) as unknown;
  const rows = Array.isArray(payload) ? payload : [];
  const bars = rows
    .flatMap((value): PriceBar[] => {
      if (value === null || typeof value !== "object") return [];
      const row = value as Record<string, unknown>;
      const time = typeof row.day === "string" ? row.day.slice(0, 10) : "";
      const open = number(row.open);
      const high = number(row.high);
      const low = number(row.low);
      const close = number(row.close);
      const volume = number(row.volume);
      if (
        !time ||
        open === undefined ||
        high === undefined ||
        low === undefined ||
        close === undefined ||
        close <= 0 ||
        !inRange(time, request.start, request.end)
      )
        return [];
      const bar: PriceBar = { time, open, high, low, close };
      if (volume !== undefined) bar.volume = volume;
      return [bar];
    })
    .slice(-limit);
  return {
    data: bars.length ? bars : null,
    asOf: bars.at(-1)?.time ?? context.now().toISOString(),
    warnings: ["新浪财经日 K 公开接口未单独标注复权口径。"],
  };
}

export function createSinafinanceProvider(): StockProvider {
  return {
    id: "sinafinance",
    priority: 30,
    free: true,
    capabilities: ["resolve", "snapshot", "history"],
    resolve,
    snapshot,
    history,
  };
}
