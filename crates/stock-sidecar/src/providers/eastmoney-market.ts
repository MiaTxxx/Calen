import { ProviderError } from "./registry.ts";
import { strictFiniteNumber as finite } from "../numbers.ts";
import type {
  MarketBriefSection,
  MarketBriefRequest,
  MarketBriefSession,
  ProviderContext,
  ProviderEvidence,
} from "../types.ts";

type UnknownRecord = Record<string, unknown>;
type MarketSectionResult<T> = {
  name: string;
  data: T | null;
  warning?: string;
};

const DEFAULT_SECTIONS: Record<MarketBriefSession, MarketBriefSection[]> = {
  pre_market: ["movers", "hotSectors", "moneyFlow", "dragonTiger"],
  intraday: [
    "movers",
    "limitUp",
    "limitDown",
    "hotSectors",
    "moneyFlow",
    "unusualMoves",
    "sentiment",
  ],
  close: [
    "movers",
    "limitUp",
    "limitDown",
    "hotSectors",
    "moneyFlow",
    "dragonTiger",
    "unusualMoves",
    "sentiment",
  ],
  general: [
    "movers",
    "limitUp",
    "limitDown",
    "hotSectors",
    "moneyFlow",
    "dragonTiger",
    "unusualMoves",
    "sentiment",
  ],
};

function record(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === "object"
    ? (value as UnknownRecord)
    : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function chinaMarketClock(date: Date): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    minutes: Number(value("hour")) * 60 + Number(value("minute")),
  };
}

function compactDate(value: string): string {
  return value.replaceAll("-", "");
}

function normalizeProviderDate(value: unknown): string | undefined {
  const compact = String(value ?? "").match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  return string(value)?.slice(0, 10);
}

async function fetchJson(
  url: URL,
  context: ProviderContext
): Promise<UnknownRecord> {
  const init: RequestInit = {
    headers: {
      Accept: "application/json",
      Referer: "https://quote.eastmoney.com/",
    },
  };
  if (context.signal) init.signal = context.signal;
  const response = await context.fetch(url, init);
  if (!response.ok)
    throw new ProviderError(`HTTP ${response.status}`, {
      status: response.status,
    });
  const payload = record(await response.json());
  if (!payload) throw new ProviderError("东方财富市场接口返回无效 JSON");
  return payload;
}

async function section<T>(
  name: string,
  loader: () => Promise<T | null>
): Promise<MarketSectionResult<T>> {
  try {
    const data = await loader();
    return data === null
      ? { name, data, warning: `${name}: 返回空数据` }
      : { name, data };
  } catch (error) {
    return {
      name,
      data: null,
      warning: `${name}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function clistUrl(limit: number, fs: string, fid: string, po = "1"): URL {
  const url = new URL("https://push2.eastmoney.com/api/qt/clist/get");
  url.searchParams.set("pn", "1");
  url.searchParams.set("pz", String(limit));
  url.searchParams.set("po", po);
  url.searchParams.set("np", "1");
  url.searchParams.set("fltt", "2");
  url.searchParams.set("invt", "2");
  url.searchParams.set("fid", fid);
  url.searchParams.set("fs", fs);
  url.searchParams.set("fields", "f12,f14,f2,f3,f4,f5,f6,f62,f184,f164,f174");
  return url;
}

function clistRows(payload: UnknownRecord): UnknownRecord[] {
  const diff = record(payload.data)?.diff;
  return Array.isArray(diff)
    ? diff.map(record).filter((row) => row !== undefined)
    : [];
}

function mapMovers(rows: UnknownRecord[]) {
  return rows.flatMap((row) => {
    const symbol = string(row.f12);
    const name = string(row.f14);
    const price = finite(row.f2);
    const changePercent = finite(row.f3);
    if (!symbol || !name || price === undefined || changePercent === undefined)
      return [];
    return [
      {
        symbol,
        name,
        price,
        change: finite(row.f4) ?? 0,
        changePercent,
        volume: finite(row.f5) ?? 0,
        turnover: finite(row.f6) ?? 0,
      },
    ];
  });
}

async function loadLimitPool(
  kind: "up" | "down",
  limit: number,
  tradeDate: string,
  context: ProviderContext
) {
  const endpoint = kind === "up" ? "getTopicZTPool" : "getTopicDTPool";
  const url = new URL(`https://push2ex.eastmoney.com/${endpoint}`);
  url.searchParams.set("ut", "7eea3edcaed734bea9cbfc24409ed989");
  url.searchParams.set("dpt", "wz.ztzt");
  url.searchParams.set("Pageindex", "0");
  url.searchParams.set("pagesize", String(limit));
  url.searchParams.set("sort", kind === "up" ? "fbt:asc" : "fund:asc");
  url.searchParams.set("date", compactDate(tradeDate));
  const data = record((await fetchJson(url, context)).data);
  if (!data || !Array.isArray(data.pool)) return null;
  const actualTradeDate = normalizeProviderDate(data.qdate);
  if (actualTradeDate && actualTradeDate !== tradeDate)
    throw new ProviderError(
      `返回交易日 ${actualTradeDate}，与请求的 ${tradeDate} 不一致`
    );
  const pool = data.pool;
  const items = pool.flatMap((value) => {
    const row = record(value);
    const symbol = string(row?.c);
    const name = string(row?.n);
    if (!symbol || !name) return [];
    return [
      {
        symbol,
        name,
        price: (finite(row?.p) ?? 0) / 1000,
        changePercent: finite(row?.zdp),
        amount: finite(row?.amount),
        turnoverRate: finite(row?.hs),
        industry: string(row?.hybk),
        consecutiveLimitUp: finite(row?.lbc),
        sealedFunds: finite(row?.fund),
      },
    ];
  });
  return {
    tradeDate: actualTradeDate ?? tradeDate,
    total: finite(data?.tc) ?? items.length,
    items,
  };
}

async function loadDragonTiger(
  limit: number,
  tradeDate: string,
  context: ProviderContext
) {
  const url = new URL("https://datacenter-web.eastmoney.com/api/data/v1/get");
  url.searchParams.set("reportName", "RPT_DAILYBILLBOARD_DETAILSNEW");
  url.searchParams.set("columns", "ALL");
  url.searchParams.set("pageNumber", "1");
  url.searchParams.set("pageSize", String(limit));
  url.searchParams.set("sortTypes", "-1,-1");
  url.searchParams.set("sortColumns", "TRADE_DATE,NET_BUY_AMT");
  url.searchParams.set("source", "WEB");
  url.searchParams.set("client", "WEB");
  url.searchParams.set("filter", `(TRADE_DATE='${tradeDate}')`);
  const result = record((await fetchJson(url, context)).result);
  const rows = Array.isArray(result?.data) ? result.data : [];
  const items = rows.flatMap((value) => {
    const row = record(value);
    const symbol = string(row?.SECURITY_CODE);
    const name = string(row?.SECURITY_NAME_ABBR);
    if (!symbol || !name) return [];
    return [
      {
        symbol,
        name,
        tradeDate: string(row?.TRADE_DATE),
        reason: string(row?.EXPLANATION),
        close: finite(row?.CLOSE_PRICE),
        changePercent: finite(row?.CHANGE_RATE),
        netBuyAmount: finite(row?.NET_BUY_AMT),
        totalAmount: finite(row?.ACCUM_AMOUNT),
      },
    ];
  });
  const matchingItems = items.filter(
    (item) => !item.tradeDate || item.tradeDate.slice(0, 10) === tradeDate
  );
  return matchingItems.length ? { items: matchingItems } : null;
}

async function loadUnusualMoves(limit: number, context: ProviderContext) {
  const url = new URL("https://push2ex.eastmoney.com/getAllStockChanges");
  url.searchParams.set("type", "8201,8202,8193,8194,64,128,4,32,16,8");
  url.searchParams.set("pageindex", "0");
  url.searchParams.set("pagesize", String(limit));
  url.searchParams.set("dpt", "wzchanges");
  url.searchParams.set("ut", "7eea3edcaed734bea9cbfc24409ed989");
  const data = record((await fetchJson(url, context)).data);
  const rows = Array.isArray(data?.allstock) ? data.allstock : [];
  const items = rows.flatMap((value) => {
    const row = record(value);
    const symbol = string(row?.c);
    const name = string(row?.n);
    if (!symbol || !name) return [];
    return [
      {
        symbol,
        name,
        time: string(row?.tm),
        type: string(row?.t),
        detail: string(row?.m),
      },
    ];
  });
  return items.length ? { items } : null;
}

export async function fetchEastmoneyMarketBrief(
  request: MarketBriefRequest,
  context: ProviderContext
): Promise<ProviderEvidence<unknown>> {
  if (request.market && request.market !== "CN") {
    return {
      data: null,
      asOf: context.now().toISOString(),
      warnings: ["东方财富市场简报首版仅支持 A 股"],
    };
  }
  const limit = Math.min(Math.max(request.limit ?? 20, 1), 100);
  const session = request.session ?? "general";
  const clock = chinaMarketClock(context.now());
  const tradeDate = request.tradeDate ?? clock.date;
  const historical = tradeDate !== clock.date;
  const requestedSections = request.sections?.length
    ? [...new Set(request.sections)]
    : DEFAULT_SECTIONS[session];
  const requested = new Set(requestedSections);
  const sentimentDependencies = new Set<MarketBriefSection>([
    "limitUp",
    "limitDown",
    "hotSectors",
    "moneyFlow",
  ]);
  const needed = (name: MarketBriefSection) =>
    requested.has(name) ||
    (requested.has("sentiment") && sentimentDependencies.has(name));
  const skipped = <T = never>(
    name: MarketBriefSection
  ): Promise<MarketSectionResult<T>> => Promise.resolve({ name, data: null });
  const unavailable = <T>(
    name: MarketBriefSection,
    reason: string
  ): Promise<MarketSectionResult<T>> =>
    Promise.resolve({ name, data: null, warning: `${name}: ${reason}` });
  const liveSection = <T>(
    name: MarketBriefSection,
    loader: () => Promise<T | null>
  ): Promise<MarketSectionResult<T>> => {
    if (!needed(name)) return skipped<T>(name);
    if (historical)
      return unavailable<T>(name, "东方财富不支持按历史交易日查询该实时分项");
    return section(name, loader);
  };
  const [
    moversResult,
    limitUp,
    limitDown,
    hotSectors,
    sectorMoney,
    dragonTiger,
    unusualMoves,
  ] = await Promise.all([
    liveSection("movers", async () => {
      const rows = clistRows(
        await fetchJson(clistUrl(limit, "m:0+t:6,m:1+t:2", "f3"), context)
      );
      const movers = mapMovers(rows);
      return movers.length ? movers : null;
    }),
    needed("limitUp")
      ? section("limitUp", () => loadLimitPool("up", limit, tradeDate, context))
      : skipped("limitUp"),
    needed("limitDown")
      ? section("limitDown", () =>
          loadLimitPool("down", limit, tradeDate, context)
        )
      : skipped("limitDown"),
    liveSection("hotSectors", async () => {
      const rows = clistRows(
        await fetchJson(clistUrl(limit, "m:90+s:4", "f3"), context)
      );
      const items = rows.flatMap((row) => {
        const code = string(row.f12);
        const name = string(row.f14);
        if (!code || !name) return [];
        return [
          {
            code,
            name,
            changePercent: finite(row.f3),
            mainNetInflow: finite(row.f62),
          },
        ];
      });
      return items.length ? { items } : null;
    }),
    liveSection("moneyFlow", async () => {
      const rows = clistRows(
        await fetchJson(clistUrl(limit, "m:90+s:4", "f62"), context)
      );
      const items = rows.flatMap((row) => {
        const code = string(row.f12);
        const name = string(row.f14);
        if (!code || !name) return [];
        return [
          {
            code,
            name,
            mainNetInflow: finite(row.f62),
            mainNetPercent: finite(row.f184),
            mainNet5d: finite(row.f164),
            mainNet10d: finite(row.f174),
            changePercent: finite(row.f3),
          },
        ];
      });
      return items.length ? { items } : null;
    }),
    needed("dragonTiger")
      ? section("dragonTiger", () => loadDragonTiger(limit, tradeDate, context))
      : skipped("dragonTiger"),
    liveSection("unusualMoves", () => loadUnusualMoves(limit, context)),
  ]);
  const warnings = [
    moversResult.warning,
    limitUp.warning,
    limitDown.warning,
    hotSectors.warning,
    sectorMoney.warning,
    dragonTiger.warning,
    unusualMoves.warning,
  ].filter((warning): warning is string => warning !== undefined);
  if (session === "pre_market")
    warnings.push(
      "pre_market: 东方财富没有可验证的盘前时点快照；结果仅代表所选分项的最新或指定交易日数据"
    );
  if (session === "intraday" && historical)
    warnings.push("intraday: 历史交易日不支持还原盘中时点，未返回实时分项");
  if (session === "close" && !historical && clock.minutes < 15 * 60)
    warnings.push("close: 当前交易日尚未收盘，返回数据可能不完整");
  const upCount = limitUp.data?.total;
  const downCount = limitDown.data?.total;
  const hotChanges =
    hotSectors.data?.items.flatMap((item) =>
      item.changePercent === undefined ? [] : [item.changePercent]
    ) ?? [];
  const sectorFlows =
    sectorMoney.data?.items.flatMap((item) =>
      item.mainNetInflow === undefined ? [] : [item.mainNetInflow]
    ) ?? [];
  let sentiment: unknown = null;
  if (
    requested.has("sentiment") &&
    upCount !== undefined &&
    downCount !== undefined &&
    hotChanges.length > 0 &&
    sectorFlows.length > 0
  ) {
    const hotAverage =
      hotChanges.reduce((sum, value) => sum + value, 0) / hotChanges.length;
    const flow = sectorFlows.reduce((sum, value) => sum + value, 0);
    const score = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          50 +
            (upCount - downCount) * 2 +
            hotAverage * 4 +
            (flow > 0 ? 5 : flow < 0 ? -5 : 0)
        )
      )
    );
    sentiment = {
      method: "calen.market-sentiment.v1",
      score,
      label: score >= 60 ? "optimistic" : score <= 40 ? "cautious" : "neutral",
      components: {
        limitUpCount: upCount,
        limitDownCount: downCount,
        hotSectorAverageChange: Math.round(hotAverage * 100) / 100,
        sectorMainNetInflow: flow,
      },
      disclaimer: "由公开市场分项派生，不是数据供应商原始情绪指标。",
    };
  } else if (requested.has("sentiment"))
    warnings.push(
      "sentiment: 涨跌停、板块涨跌或板块资金流证据不完整，无法计算派生情绪"
    );
  const sections: Record<string, unknown> = {};
  if (requested.has("limitUp")) sections.limitUp = limitUp.data;
  if (requested.has("limitDown")) sections.limitDown = limitDown.data;
  if (requested.has("hotSectors")) sections.hotSectors = hotSectors.data;
  if (requested.has("moneyFlow")) sections.moneyFlow = sectorMoney.data;
  if (requested.has("dragonTiger")) sections.dragonTiger = dragonTiger.data;
  if (requested.has("unusualMoves")) sections.unusualMoves = unusualMoves.data;
  if (requested.has("sentiment")) sections.sentiment = sentiment;
  const data = {
    market: "CN",
    session,
    tradeDate,
    requestedSections,
    movers: requested.has("movers") ? (moversResult.data ?? []) : [],
    sections,
  };
  const result: ProviderEvidence<unknown> = {
    data,
    asOf: request.tradeDate ?? context.now().toISOString(),
  };
  if (warnings.length) result.warnings = warnings;
  return result;
}
