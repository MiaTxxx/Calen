import { ProviderError } from "./registry.ts";
import type {
  MarketBriefRequest,
  ProviderContext,
  ProviderEvidence,
} from "../types.ts";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === "object"
    ? (value as UnknownRecord)
    : undefined;
}

function finite(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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
): Promise<{ name: string; data: T | null; warning?: string }> {
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
  context: ProviderContext
) {
  const endpoint = kind === "up" ? "getTopicZTPool" : "getTopicDTPool";
  const url = new URL(`https://push2ex.eastmoney.com/${endpoint}`);
  url.searchParams.set("ut", "7eea3edcaed734bea9cbfc24409ed989");
  url.searchParams.set("dpt", "wz.ztzt");
  url.searchParams.set("Pageindex", "0");
  url.searchParams.set("pagesize", String(limit));
  url.searchParams.set("sort", kind === "up" ? "fbt:asc" : "fund:asc");
  url.searchParams.set(
    "date",
    context.now().toISOString().slice(0, 10).replaceAll("-", "")
  );
  const data = record((await fetchJson(url, context)).data);
  if (!data || !Array.isArray(data.pool)) return null;
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
    tradeDate: String(data?.qdate ?? ""),
    total: finite(data?.tc) ?? items.length,
    items,
  };
}

async function loadDragonTiger(limit: number, context: ProviderContext) {
  const url = new URL("https://datacenter-web.eastmoney.com/api/data/v1/get");
  url.searchParams.set("reportName", "RPT_DAILYBILLBOARD_DETAILSNEW");
  url.searchParams.set("columns", "ALL");
  url.searchParams.set("pageNumber", "1");
  url.searchParams.set("pageSize", String(limit));
  url.searchParams.set("sortTypes", "-1,-1");
  url.searchParams.set("sortColumns", "TRADE_DATE,NET_BUY_AMT");
  url.searchParams.set("source", "WEB");
  url.searchParams.set("client", "WEB");
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
  return items.length ? { items } : null;
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
  const [
    moversResult,
    limitUp,
    limitDown,
    hotSectors,
    sectorMoney,
    dragonTiger,
    unusualMoves,
  ] = await Promise.all([
    section("movers", async () => {
      const rows = clistRows(
        await fetchJson(clistUrl(limit, "m:0+t:6,m:1+t:2", "f3"), context)
      );
      const movers = mapMovers(rows);
      return movers.length ? movers : null;
    }),
    section("limitUp", () => loadLimitPool("up", limit, context)),
    section("limitDown", () => loadLimitPool("down", limit, context)),
    section("hotSectors", async () => {
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
    section("moneyFlow", async () => {
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
    section("dragonTiger", () => loadDragonTiger(limit, context)),
    section("unusualMoves", () => loadUnusualMoves(limit, context)),
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
  const upCount = limitUp.data?.total;
  const downCount = limitDown.data?.total;
  let sentiment: unknown = null;
  if (upCount !== undefined && downCount !== undefined) {
    const hotAverage = hotSectors.data?.items.length
      ? hotSectors.data.items.reduce(
          (sum, item) => sum + (item.changePercent ?? 0),
          0
        ) / hotSectors.data.items.length
      : 0;
    const flow =
      sectorMoney.data?.items.reduce(
        (sum, item) => sum + (item.mainNetInflow ?? 0),
        0
      ) ?? 0;
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
  } else warnings.push("sentiment: 涨跌停分项不完整，无法计算派生情绪");
  const data = {
    market: "CN",
    movers: moversResult.data ?? [],
    sections: {
      limitUp: limitUp.data,
      limitDown: limitDown.data,
      hotSectors: hotSectors.data,
      moneyFlow: sectorMoney.data,
      dragonTiger: dragonTiger.data,
      unusualMoves: unusualMoves.data,
      sentiment,
    },
  };
  const result: ProviderEvidence<unknown> = {
    data,
    asOf: context.now().toISOString(),
  };
  if (warnings.length) result.warnings = warnings;
  return result;
}
