/**
 * Tencent adapter, independently rewritten for Calen's StockProvider seam.
 * Cross-market profile endpoint selection and field mapping were adapted from
 * Opptrix (Apache-2.0):
 * packages/a-stock-layer/src/providers/tencent/api/{hk,us}-detail-service.ts.
 */
import { ProviderError } from "./registry.ts";
import { makeInstrument, normalizeInstrument } from "../instruments.ts";
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

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object"
    ? (value as UnknownRecord)
    : null;
}

function smartboxAssetClass(type: string): AssetClass | null {
  const normalized = type.trim().toUpperCase();
  if (normalized === "ETF" || normalized.includes("-ETF")) return "ETF";
  if (normalized === "GP" || /^GP-A(?:-|$)/.test(normalized)) return "EQUITY";
  return null;
}

function smartboxInstrument(value: unknown): InstrumentRef | null {
  const row = record(value);
  const code = typeof row?.code === "string" ? row.code.trim() : "";
  const name = typeof row?.name === "string" ? row.name.trim() : "";
  const type = typeof row?.type === "string" ? row.type : "";
  const assetClass = smartboxAssetClass(type);
  const normalized = normalizeInstrument(code);
  if (!assetClass || !normalized || !name) return null;
  return makeInstrument(
    normalized.market,
    normalized.symbol,
    normalized.exchange,
    assetClass,
    normalized.currency,
    name
  );
}

async function resolve(
  request: StockResolveRequest,
  context: ProviderContext
): Promise<ProviderEvidence<InstrumentRef[]>> {
  const url = new URL(
    "https://proxy.finance.qq.com/cgi/cgi-bin/smartbox/search"
  );
  url.searchParams.set("stockFlag", "1");
  url.searchParams.set("fundFlag", "1");
  url.searchParams.set("app", "official_website");
  url.searchParams.set("c", "1");
  url.searchParams.set("query", request.query.trim());
  const init: RequestInit = {
    headers: { Accept: "application/json", Referer: "https://gu.qq.com/" },
  };
  if (context.signal) init.signal = context.signal;
  const response = await context.fetch(url, init);
  if (!response.ok)
    throw new ProviderError(`HTTP ${response.status}`, {
      status: response.status,
    });
  const payload = record(await response.json());
  const rows = Array.isArray(payload?.stock) ? payload.stock : [];
  const limit = Math.min(Math.max(request.limit ?? 10, 1), 50);
  const seen = new Set<string>();
  const instruments = rows
    .flatMap((value): InstrumentRef[] => {
      const instrument = smartboxInstrument(value);
      if (
        !instrument ||
        (request.market && instrument.market !== request.market) ||
        seen.has(instrument.id)
      )
        return [];
      seen.add(instrument.id);
      return [instrument];
    })
    .slice(0, limit);
  const includesOverseas =
    request.market === "HK" ||
    request.market === "US" ||
    instruments.some(({ market }) => market === "HK" || market === "US");
  const result: ProviderEvidence<InstrumentRef[]> = {
    data: instruments.length ? instruments : null,
    asOf: context.now().toISOString(),
  };
  if (includesOverseas)
    result.warnings = [
      "港美股首版仅提供搜索、行情、日 K 和有限基础研究；其余能力可能返回 partial/unavailable。",
    ];
  return result;
}

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

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

async function fetchTencentCompanyProfile(
  instrument: InstrumentRef,
  context: ProviderContext
): Promise<ProviderEvidence<unknown> | null> {
  if (instrument.market !== "HK" && instrument.market !== "US") return null;
  const url = new URL(
    instrument.market === "HK"
      ? "https://proxy.finance.qq.com/ifzqgtimg/appstock/app/hkStockinfo/jiankuang"
      : "https://proxy.finance.qq.com/ifzqgtimg/appstock/us/introduce/brief"
  );
  url.searchParams.set(
    instrument.market === "HK" ? "code" : "symbol",
    providerSymbol(instrument)
  );
  if (instrument.market === "US")
    url.searchParams.set("app", "official_website");
  const init: RequestInit = {
    headers: { Accept: "application/json", Referer: "https://gu.qq.com/" },
  };
  if (context.signal) init.signal = context.signal;
  const response = await context.fetch(url, init);
  if (!response.ok)
    throw new ProviderError(`HTTP ${response.status}`, {
      status: response.status,
    });
  const payload = record(await response.json());
  if (Number(payload?.code) !== 0)
    throw new ProviderError(text(payload?.msg) ?? "腾讯公司资料接口返回错误");
  const data = record(payload?.data);
  if (!data) return null;
  const asOf = "unknown";

  if (instrument.market === "HK") {
    const basic = record(data.basic);
    if (!basic) return null;
    const plates = Array.isArray(basic.plate)
      ? basic.plate.flatMap((item) => {
          if (typeof item === "string" && item.trim()) return [item.trim()];
          const row = record(item);
          const name = text(row?.name ?? row?.plateName);
          return name ? [name] : [];
        })
      : text(basic.plate)
        ? [text(basic.plate)!]
        : [];
    return {
      data: {
        symbol: instrument.symbol,
        name: text(basic.ChiName) ?? instrument.name,
        market: instrument.market,
        exchange: instrument.exchange,
        currency: instrument.currency,
        website: text(basic.Website),
        business: text(basic.Business),
        description: text(basic.BriefIntroduction),
        chairman: text(basic.Chairman),
        listingDate: text(basic.ListedDate),
        industry: plates[0],
        plates,
        totalShares: text(basic.STOCK_SUM),
        hkShares: text(basic.HK_STOCK_SUM),
        coverage: "company-profile",
      },
      asOf,
      warnings: [
        "腾讯公司资料接口未提供独立数据截至时间；asOf 标记为 unknown。",
      ],
    };
  }

  const basic = record(data.jbxx);
  if (!basic) return null;
  const industry = record(basic.industry);
  const revenueBreakdown = Array.isArray(data.srgc)
    ? data.srgc.flatMap((entry) => {
        const row = record(entry);
        if (!row) return [];
        return [
          {
            date: text(row.date),
            currency: text(row.currency),
            segments: Array.isArray(row.detail)
              ? row.detail.flatMap((segment) => {
                  const item = record(segment);
                  const label = text(item?.label);
                  return label
                    ? [
                        {
                          label,
                          sales: text(item?.sales),
                          ratio: text(item?.zb),
                        },
                      ]
                    : [];
                })
              : [],
          },
        ];
      })
    : [];
  return {
    data: {
      symbol: instrument.symbol,
      name: text(basic.gsmc) ?? instrument.name,
      market: instrument.market,
      exchange: text(basic.jys) ?? instrument.exchange,
      currency: instrument.currency,
      website: text(basic.website),
      description: text(basic.jianjie),
      listingDate: text(basic.ssrq),
      industry: text(industry?.name),
      industryCode: text(industry?.code),
      totalShares: text(basic.zgb),
      revenueBreakdown,
      coverage: "company-profile",
    },
    asOf,
    warnings: ["腾讯公司资料接口未提供独立数据截至时间；asOf 标记为 unknown。"],
  };
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
    capabilities: ["resolve", "snapshot", "history"],
    resolve,
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
      const companyProfile = await fetchTencentCompanyProfile(
        instrument,
        context
      );
      if (companyProfile?.data) return companyProfile;
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
        warnings: ["腾讯公司资料不可用，本次仅返回证券身份与交易市场。"],
      };
    },
  };
}
