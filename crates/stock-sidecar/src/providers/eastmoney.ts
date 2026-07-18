import { makeInstrument } from "../instruments.ts";
import { strictFiniteNumber as number } from "../numbers.ts";
import type {
  InstrumentRef,
  PriceBar,
  ProviderEvidence,
  StockProvider,
  StockSnapshot,
  StockResolveRequest,
} from "../types.ts";
import { ProviderError } from "./registry.ts";
import { fetchEastmoneyMarketBrief } from "./eastmoney-market.ts";
import {
  fetchEastmoneyFinancials,
  fetchEastmoneyEtf,
  fetchEastmoneyDividend,
  fetchEastmoneyMoneyFlow,
  fetchEastmoneyNews,
  fetchEastmoneyNotices,
  fetchEastmoneyProfile,
  fetchEastmoneyShareholders,
} from "./eastmoney-research.ts";

type UnknownRecord = Record<string, unknown>;

function object(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === "object"
    ? (value as UnknownRecord)
    : undefined;
}

function quoteTime(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (/^\d{14}$/.test(text))
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T${text.slice(8, 10)}:${text.slice(10, 12)}:${text.slice(12, 14)}+08:00`;
  const parsed = number(value);
  if (parsed !== undefined) {
    const milliseconds = parsed > 10_000_000_000 ? parsed : parsed * 1_000;
    const date = new Date(milliseconds);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return fallback;
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
  if (instrument.market !== "CN") return null;
  const marketId =
    instrument.exchange === "SSE"
      ? "1"
      : instrument.exchange === "SZSE" || instrument.exchange === "BSE"
        ? "0"
        : null;
  return marketId ? `${marketId}.${instrument.symbol}` : null;
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
  const exchange = /^(?:[48]|920)/.test(code)
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
    capabilities: [
      "resolve",
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
      "marketBrief",
    ],
    async resolve(
      request: StockResolveRequest,
      context
    ): Promise<ProviderEvidence<InstrumentRef[]>> {
      const url = new URL("https://searchapi.eastmoney.com/api/suggest/get");
      url.searchParams.set("input", request.query);
      url.searchParams.set("type", "14");
      // Eastmoney 网页搜索接口的公开固定参数，不是用户 API Key 或私密凭据。
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
    async snapshot(
      instrument,
      context
    ): Promise<ProviderEvidence<StockSnapshot>> {
      const securityId = secId(instrument);
      if (!securityId)
        return {
          data: null,
          asOf: context.now().toISOString(),
          warnings: ["东方财富行情仅支持已归一化的沪深北 A 股标的"],
        };
      const url = new URL("https://push2.eastmoney.com/api/qt/stock/get");
      url.searchParams.set("secid", securityId);
      url.searchParams.set("fltt", "2");
      url.searchParams.set("invt", "2");
      url.searchParams.set("ut", "fa5fd1943c7b386f172d6893dbfba10b");
      url.searchParams.set(
        "fields",
        "f43,f57,f58,f59,f60,f46,f44,f45,f47,f48,f169,f170,f86"
      );
      const payload = await fetchJson(url, context.signal, context.fetch);
      const data = object(payload.data);
      const price = number(data?.f43);
      if (price === undefined || price <= 0)
        throw new ProviderError("东方财富行情返回空数据");
      const asOf = quoteTime(data?.f86, "unknown");
      const code = typeof data?.f57 === "string" ? data.f57 : instrument.symbol;
      const name =
        typeof data?.f58 === "string" ? data.f58.trim() : instrument.name;
      const snapshot: StockSnapshot = {
        instrument: {
          ...instrument,
          symbol: code,
          name: name || instrument.name,
        },
        price,
        marketTime: asOf,
      };
      const optional: Array<[keyof StockSnapshot, number | undefined]> = [
        ["previousClose", number(data?.f60)],
        ["open", number(data?.f46)],
        ["high", number(data?.f44)],
        ["low", number(data?.f45)],
        ["volume", number(data?.f47)],
        ["change", number(data?.f169)],
        ["changePercent", number(data?.f170)],
      ];
      for (const [key, value] of optional) {
        if (value !== undefined)
          (snapshot as unknown as Record<string, unknown>)[key] = value;
      }
      const evidence: ProviderEvidence<StockSnapshot> = {
        data: snapshot,
        asOf,
      };
      if (asOf === "unknown")
        evidence.warnings = [
          "东方财富未提供有效行情时间；asOf 标记为 unknown，获取时间仅记录在 retrievedAt。",
        ];
      return evidence;
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
          warnings: ["东方财富历史行情仅支持已归一化的沪深北 A 股标的"],
        };
      const period = request.period ?? "day";
      // klt：1=1 分钟，101=日，102=周，103=月。
      const klt =
        period === "minute"
          ? "1"
          : period === "week"
            ? "102"
            : period === "month"
              ? "103"
              : "101";
      const url = new URL(
        "https://push2his.eastmoney.com/api/qt/stock/kline/get"
      );
      url.searchParams.set("secid", securityId);
      url.searchParams.set("klt", klt);
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
        // 分钟线时间形如 "2026-07-18 09:31"；secid 仅覆盖 A 股，固定 +08:00，
        // 与腾讯分时的 ISO 时间格式保持一致。
        const time =
          period === "minute" &&
          /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(fields[0])
            ? `${fields[0].replace(" ", "T")}:00+08:00`
            : fields[0];
        const bar: PriceBar = { time, open, close, high, low };
        if (volume !== undefined) bar.volume = volume;
        return [bar];
      });
      return {
        data: bars.length ? bars : null,
        asOf: bars.at(-1)?.time ?? context.now().toISOString(),
      };
    },
    profile: fetchEastmoneyProfile,
    financials: fetchEastmoneyFinancials,
    shareholders: fetchEastmoneyShareholders,
    dividend: fetchEastmoneyDividend,
    moneyFlow: fetchEastmoneyMoneyFlow,
    news: fetchEastmoneyNews,
    notices: fetchEastmoneyNotices,
    etf: fetchEastmoneyEtf,
    marketBrief: fetchEastmoneyMarketBrief,
  };
}
