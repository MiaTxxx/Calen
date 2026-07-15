import { ProviderError } from "./registry.ts";
import type {
  InstrumentRef,
  PriceBar,
  ProviderEvidence,
  StockProvider,
  StockSnapshot,
} from "../types.ts";

function providerSymbol(instrument: InstrumentRef): string {
  if (instrument.market === "CN") {
    const prefix =
      instrument.exchange === "SSE"
        ? "sh"
        : instrument.exchange === "BSE"
          ? "bj"
          : "sz";
    return `${prefix}${instrument.symbol}`;
  }
  if (instrument.market === "HK") return `hk${instrument.symbol}`;
  return `us${instrument.symbol}`;
}

function numeric(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function marketTime(
  value: string | undefined,
  fallback: string,
  market: InstrumentRef["market"]
): string {
  if (!value || !/^\d{14}$/.test(value)) return fallback;
  const month = Number(value.slice(4, 6));
  const offset =
    market === "US"
      ? month >= 3 && month <= 11
        ? "-04:00"
        : "-05:00"
      : "+08:00";
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}.000${offset}`;
}

export function createTencentProvider(): StockProvider {
  return {
    id: "tencent",
    priority: 10,
    free: true,
    capabilities: ["snapshot", "history"],
    async snapshot(
      instrument,
      context
    ): Promise<ProviderEvidence<StockSnapshot>> {
      const init: RequestInit = {
        headers: { Accept: "text/plain", Referer: "https://gu.qq.com/" },
      };
      if (context.signal) init.signal = context.signal;
      const response = await context.fetch(
        `https://qt.gtimg.cn/q=${providerSymbol(instrument)}`,
        init
      );
      if (!response.ok)
        throw new ProviderError(`HTTP ${response.status}`, {
          status: response.status,
        });
      const text = await response.text();
      const payload = /="([^"]*)"/.exec(text)?.[1];
      const fields = payload?.split("~");
      const price = numeric(fields?.[3]);
      if (!fields || price === undefined || price <= 0) {
        throw new ProviderError("腾讯行情返回空数据");
      }
      const asOf = marketTime(
        fields[30],
        context.now().toISOString(),
        instrument.market
      );
      const namedInstrument = {
        ...instrument,
        name: fields[1]?.trim() || instrument.name,
      };
      const data: StockSnapshot = {
        instrument: namedInstrument,
        price,
        marketTime: asOf,
      };
      const optional = {
        previousClose: numeric(fields[4]),
        open: numeric(fields[5]),
        volume: numeric(fields[6]),
        change: numeric(fields[31]),
        changePercent: numeric(fields[32]),
        high: numeric(fields[33]),
        low: numeric(fields[34]),
      };
      for (const [key, value] of Object.entries(optional)) {
        if (value !== undefined)
          (data as unknown as Record<string, unknown>)[key] = value;
      }
      return { data, asOf };
    },
    async history(
      instrument,
      request,
      context
    ): Promise<ProviderEvidence<PriceBar[]>> {
      const symbol = providerSymbol(instrument);
      const limit = Math.min(Math.max(request.limit ?? 120, 1), 2_000);
      const url = new URL("https://web.ifzq.gtimg.cn/appstock/app/fqkline/get");
      url.searchParams.set(
        "param",
        `${symbol},day,${request.start ?? ""},${request.end ?? ""},${limit},qfq`
      );
      const init: RequestInit = {
        headers: { Accept: "application/json", Referer: "https://gu.qq.com/" },
      };
      if (context.signal) init.signal = context.signal;
      const response = await context.fetch(url, init);
      if (!response.ok)
        throw new ProviderError(`HTTP ${response.status}`, {
          status: response.status,
        });
      const payload = (await response.json()) as Record<string, unknown>;
      const data =
        payload.data && typeof payload.data === "object"
          ? (payload.data as Record<string, unknown>)
          : undefined;
      const security =
        data?.[symbol] && typeof data[symbol] === "object"
          ? (data[symbol] as Record<string, unknown>)
          : undefined;
      const rows = Array.isArray(security?.qfqday)
        ? security.qfqday
        : Array.isArray(security?.day)
          ? security.day
          : [];
      const bars = rows
        .flatMap((row): PriceBar[] => {
          if (!Array.isArray(row)) return [];
          const time = typeof row[0] === "string" ? row[0] : undefined;
          const open = numeric(String(row[1] ?? ""));
          const close = numeric(String(row[2] ?? ""));
          const high = numeric(String(row[3] ?? ""));
          const low = numeric(String(row[4] ?? ""));
          const volume = numeric(String(row[5] ?? ""));
          if (
            !time ||
            open === undefined ||
            close === undefined ||
            high === undefined ||
            low === undefined
          )
            return [];
          const bar: PriceBar = { time, open, close, high, low };
          if (volume !== undefined) bar.volume = volume;
          return [bar];
        })
        .slice(-limit);
      return {
        data: bars.length ? bars : null,
        asOf: bars.at(-1)?.time ?? context.now().toISOString(),
      };
    },
  };
}

export function createTencentBasicProfileProvider(): StockProvider {
  const quoteProvider = createTencentProvider();
  return {
    id: "tencent-basic-profile",
    priority: 30,
    free: true,
    capabilities: ["profile"],
    async profile(instrument, context): Promise<ProviderEvidence<unknown>> {
      const quote = await quoteProvider.snapshot!(instrument, context);
      if (!quote.data) {
        const result: ProviderEvidence<unknown> = {
          data: null,
          asOf: quote.asOf,
        };
        if (quote.warnings?.length) result.warnings = quote.warnings;
        return result;
      }
      return {
        data: {
          symbol: quote.data.instrument.symbol,
          name: quote.data.instrument.name,
          market: quote.data.instrument.market,
          exchange: quote.data.instrument.exchange,
          currency: quote.data.instrument.currency,
          coverage: "basic-quote-identity",
        },
        asOf: quote.asOf,
        warnings: [
          "腾讯基础资料仅包含证券身份与交易市场，不包含完整公司档案。",
        ],
      };
    },
  };
}
