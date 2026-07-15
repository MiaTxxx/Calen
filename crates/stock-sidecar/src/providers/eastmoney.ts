import { makeInstrument } from "../instruments.ts";
import type {
  InstrumentRef,
  MarketBriefRequest,
  PriceBar,
  ProviderEvidence,
  StockProvider,
  StockResolveRequest,
} from "../types.ts";
import { ProviderError } from "./registry.ts";

type UnknownRecord = Record<string, unknown>;

function object(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === "object"
    ? (value as UnknownRecord)
    : undefined;
}

function number(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function fetchJson(
  url: URL,
  signal: AbortSignal | undefined,
  fetchImpl: typeof fetch
): Promise<UnknownRecord> {
  const init: RequestInit = {
    headers: {
      Accept: "application/json",
      Referer: "https://quote.eastmoney.com/",
    },
  };
  if (signal) init.signal = signal;
  const response = await fetchImpl(url, init);
  if (!response.ok)
    throw new ProviderError(`HTTP ${response.status}`, {
      status: response.status,
    });
  const payload = object(await response.json());
  if (!payload) throw new ProviderError("东方财富返回无效 JSON");
  return payload;
}

function secId(instrument: InstrumentRef): string | null {
  if (instrument.market !== "CN" || instrument.exchange === "BSE") return null;
  return `${instrument.exchange === "SSE" ? "1" : "0"}.${instrument.symbol}`;
}

function mapSearchItem(value: unknown): InstrumentRef | null {
  const item = object(value);
  const code = typeof item?.Code === "string" ? item.Code : undefined;
  const name = typeof item?.Name === "string" ? item.Name : code;
  const marketNumber = number(item?.MktNum);
  if (
    !code ||
    !/^\d{6}$/.test(code) ||
    (marketNumber !== 0 && marketNumber !== 1)
  )
    return null;
  const exchange = /^[48]/.test(code)
    ? "BSE"
    : marketNumber === 1
      ? "SSE"
      : "SZSE";
  const assetClass = /^(1[568]|5[0168])/.test(code) ? "ETF" : "EQUITY";
  return makeInstrument("CN", code, exchange, assetClass, "CNY", name);
}

export function createEastmoneyProvider(): StockProvider {
  return {
    id: "eastmoney",
    priority: 20,
    free: true,
    capabilities: ["resolve", "history", "marketBrief"],
    async resolve(
      request: StockResolveRequest,
      context
    ): Promise<ProviderEvidence<InstrumentRef[]>> {
      const url = new URL("https://searchapi.eastmoney.com/api/suggest/get");
      url.searchParams.set("input", request.query);
      url.searchParams.set("type", "14");
      url.searchParams.set("token", "D43BF722C8E33BDC906FB84D85E326E8");
      const payload = await fetchJson(url, context.signal, context.fetch);
      const table = object(payload.QuotationCodeTable);
      const rows = Array.isArray(table?.Data) ? table.Data : [];
      const instruments = rows
        .map(mapSearchItem)
        .filter((item) => item !== null)
        .slice(0, request.limit ?? 10);
      return {
        data: instruments.length ? instruments : null,
        asOf: context.now().toISOString(),
      };
    },
    async history(
      instrument,
      request,
      context
    ): Promise<ProviderEvidence<PriceBar[]>> {
      const securityId = secId(instrument);
      if (!securityId)
        return {
          data: null,
          asOf: context.now().toISOString(),
          warnings: [
            instrument.exchange === "BSE"
              ? "东方财富历史行情适配器暂不支持北交所"
              : "东方财富首版历史行情仅支持 A 股",
          ],
        };
      const url = new URL(
        "https://push2his.eastmoney.com/api/qt/stock/kline/get"
      );
      url.searchParams.set("secid", securityId);
      url.searchParams.set("klt", "101");
      url.searchParams.set("fqt", "1");
      url.searchParams.set(
        "lmt",
        String(Math.min(Math.max(request.limit ?? 120, 1), 2_000))
      );
      url.searchParams.set("fields1", "f1,f2,f3,f4,f5,f6");
      url.searchParams.set(
        "fields2",
        "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61"
      );
      if (request.start)
        url.searchParams.set("beg", request.start.replaceAll("-", ""));
      if (request.end)
        url.searchParams.set("end", request.end.replaceAll("-", ""));
      const payload = await fetchJson(url, context.signal, context.fetch);
      const data = object(payload.data);
      const rows = Array.isArray(data?.klines) ? data.klines : [];
      const bars = rows.flatMap((row): PriceBar[] => {
        if (typeof row !== "string") return [];
        const fields = row.split(",");
        const open = number(fields[1]);
        const close = number(fields[2]);
        const high = number(fields[3]);
        const low = number(fields[4]);
        const volume = number(fields[5]);
        if (
          !fields[0] ||
          open === undefined ||
          close === undefined ||
          high === undefined ||
          low === undefined
        )
          return [];
        const bar: PriceBar = { time: fields[0], open, close, high, low };
        if (volume !== undefined) bar.volume = volume;
        return [bar];
      });
      return {
        data: bars.length ? bars : null,
        asOf: bars.at(-1)?.time ?? context.now().toISOString(),
      };
    },
    async marketBrief(
      request: MarketBriefRequest,
      context
    ): Promise<ProviderEvidence<unknown>> {
      if (request.market && request.market !== "CN") {
        return {
          data: null,
          asOf: context.now().toISOString(),
          warnings: ["东方财富市场概览首版仅支持 A 股"],
        };
      }
      const url = new URL("https://push2.eastmoney.com/api/qt/clist/get");
      url.searchParams.set("pn", "1");
      url.searchParams.set(
        "pz",
        String(Math.min(Math.max(request.limit ?? 20, 1), 100))
      );
      url.searchParams.set("po", "1");
      url.searchParams.set("np", "1");
      url.searchParams.set("fltt", "2");
      url.searchParams.set("invt", "2");
      url.searchParams.set("fid", "f3");
      url.searchParams.set("fs", "m:0+t:6,m:1+t:2");
      url.searchParams.set("fields", "f12,f14,f2,f3,f4,f5,f6");
      const payload = await fetchJson(url, context.signal, context.fetch);
      const diff = object(payload.data)?.diff;
      const rows = Array.isArray(diff) ? diff : [];
      const movers = rows.flatMap((value) => {
        const item = object(value);
        const symbol = typeof item?.f12 === "string" ? item.f12 : undefined;
        const name = typeof item?.f14 === "string" ? item.f14 : undefined;
        const price = number(item?.f2);
        const changePercent = number(item?.f3);
        const change = number(item?.f4);
        if (
          !symbol ||
          !name ||
          price === undefined ||
          changePercent === undefined
        )
          return [];
        return [
          {
            symbol,
            name,
            price,
            change: change ?? 0,
            changePercent,
            volume: number(item?.f5) ?? 0,
            turnover: number(item?.f6) ?? 0,
          },
        ];
      });
      return {
        data: movers.length ? { market: "CN", movers } : null,
        asOf: context.now().toISOString(),
      };
    },
  };
}
