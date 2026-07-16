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

type TushareValue = string | number | null;
type TushareRow = Record<string, TushareValue>;
type UnknownRecord = Record<string, unknown>;

const TUSHARE_ENDPOINT = "https://api.tushare.pro";

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

function compactDate(value: string): string {
  return value.replaceAll("-", "");
}

function redact(value: string, secret: string): string {
  return value.replaceAll(secret, "[REDACTED]");
}

function tsCode(instrument: InstrumentRef): string | null {
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

function queryTsCode(query: string): string | undefined {
  const raw = query.trim().toUpperCase();
  const qualified = /^(\d{6})\.(SH|SZ|BJ)$/.exec(raw);
  if (qualified) return `${qualified[1]}.${qualified[2]}`;
  if (!/^\d{6}$/.test(raw)) return undefined;
  const suffix = /^[48]/.test(raw) ? "BJ" : /^[569]/.test(raw) ? "SH" : "SZ";
  return `${raw}.${suffix}`;
}

function mapInstrument(row: TushareRow): InstrumentRef | null {
  const code = String(row.ts_code ?? "").toUpperCase();
  const matched = /^(\d{6})\.(SH|SZ|BJ)$/.exec(code);
  if (!matched) return null;
  const exchange =
    matched[2] === "SH" ? "SSE" : matched[2] === "SZ" ? "SZSE" : "BSE";
  return makeInstrument(
    "CN",
    matched[1]!,
    exchange,
    "EQUITY",
    "CNY",
    String(row.name ?? row.symbol ?? matched[1]!)
  );
}

function rows(fields: unknown, items: unknown): TushareRow[] {
  if (
    !Array.isArray(fields) ||
    !fields.every((field) => typeof field === "string") ||
    !Array.isArray(items)
  )
    return [];
  return items.flatMap((item): TushareRow[] => {
    if (!Array.isArray(item)) return [];
    const row: TushareRow = {};
    for (let index = 0; index < fields.length; index += 1) {
      const value = item[index];
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number"
      )
        row[fields[index] as string] = value;
      else row[fields[index] as string] = null;
    }
    return [row];
  });
}

async function query(
  token: string,
  apiName: string,
  params: Record<string, unknown>,
  fields: string,
  context: ProviderContext
): Promise<TushareRow[]> {
  const init: RequestInit = {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      api_name: apiName,
      token,
      params,
      fields,
    }),
  };
  if (context.signal) init.signal = context.signal;
  const response = await context.fetch(TUSHARE_ENDPOINT, init);
  if (!response.ok)
    throw new ProviderError(`HTTP ${response.status}`, {
      status: response.status,
    });
  const payload = object(await response.json());
  if (!payload) throw new ProviderError("Tushare 返回无效 JSON");
  const code = number(payload.code);
  if (code !== 0) {
    const message = redact(
      typeof payload.msg === "string" && payload.msg.trim()
        ? payload.msg.trim()
        : `API error ${String(payload.code ?? "unknown")}`,
      token
    );
    throw new ProviderError(`Tushare API: ${message}`);
  }
  const data = object(payload.data);
  return rows(data?.fields, data?.items);
}

function unsupported(
  context: ProviderContext,
  capability: string
): ProviderEvidence<never> {
  return {
    data: null,
    asOf: context.now().toISOString(),
    warnings: [`Tushare ${capability} 首版仅支持 A 股`],
  };
}

export function createTushareProvider(token: string): StockProvider {
  if (!token.trim()) throw new Error("Tushare token 不能为空");
  const providerToken = token.trim();
  return {
    id: "tushare",
    // Key Provider 仅在用户显式启用后注册；排在首个免费源之后，避免被
    // ProviderRegistry 的尝试上限截断，同时仍保留腾讯的无 Key 快照优先级。
    priority: 15,
    capabilities: ["resolve", "snapshot", "history", "profile"],
    async resolve(
      request: StockResolveRequest,
      context
    ): Promise<ProviderEvidence<InstrumentRef[]>> {
      if (request.market && request.market !== "CN")
        return unsupported(context, "标的搜索");
      const limit = Math.min(Math.max(request.limit ?? 10, 1), 50);
      const code = queryTsCode(request.query);
      const params: Record<string, unknown> = {
        list_status: "L",
        ...(code ? { ts_code: code } : { name: request.query.trim() }),
        limit,
      };
      const result = await query(
        providerToken,
        "stock_basic",
        params,
        "ts_code,symbol,name,exchange,market,list_status",
        context
      );
      const instruments = result
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
      const code = tsCode(instrument);
      if (!code) return unsupported(context, "行情快照");
      const result = await query(
        providerToken,
        "daily",
        { ts_code: code, limit: 1 },
        "ts_code,trade_date,open,high,low,close,pre_close,vol,pct_chg",
        context
      );
      const row = result[0];
      const marketTime = date(row?.trade_date);
      const close = number(row?.close);
      if (!row || !marketTime || close === undefined)
        return {
          data: null,
          asOf: context.now().toISOString(),
          warnings: ["Tushare 未返回有效日线快照"],
        };
      const snapshot: StockSnapshot = {
        instrument,
        price: close,
        marketTime,
      };
      const previousClose = number(row.pre_close);
      const open = number(row.open);
      const high = number(row.high);
      const low = number(row.low);
      const volume = number(row.vol);
      const changePercent = number(row.pct_chg);
      if (previousClose !== undefined) {
        snapshot.previousClose = previousClose;
        snapshot.change = close - previousClose;
      }
      if (open !== undefined) snapshot.open = open;
      if (high !== undefined) snapshot.high = high;
      if (low !== undefined) snapshot.low = low;
      if (volume !== undefined) snapshot.volume = volume;
      if (changePercent !== undefined) snapshot.changePercent = changePercent;
      return {
        data: snapshot,
        asOf: marketTime,
        warnings: ["Tushare 快照来自最近交易日日线收盘数据，并非实时行情"],
      };
    },
    async history(
      instrument,
      request,
      context
    ): Promise<ProviderEvidence<PriceBar[]>> {
      const code = tsCode(instrument);
      if (!code) return unsupported(context, "日 K");
      const limit = Math.min(Math.max(request.limit ?? 120, 1), 2_000);
      const params: Record<string, unknown> = { ts_code: code };
      if (request.start) params.start_date = compactDate(request.start);
      if (request.end) params.end_date = compactDate(request.end);
      params.limit = limit;
      const result = await query(
        providerToken,
        "daily",
        params,
        "ts_code,trade_date,open,high,low,close,vol",
        context
      );
      const bars = result
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
          const volume = number(row.vol);
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
    async profile(instrument, context): Promise<ProviderEvidence<unknown>> {
      const code = tsCode(instrument);
      if (!code) return unsupported(context, "公司资料");
      const [basicRows, companyRows] = await Promise.all([
        query(
          providerToken,
          "stock_basic",
          { ts_code: code },
          "ts_code,symbol,name,area,industry,market,list_date,exchange",
          context
        ),
        query(
          providerToken,
          "stock_company",
          { ts_code: code },
          "ts_code,chairman,manager,reg_capital,setup_date,province,city,introduction,main_business,business_scope,employees",
          context
        ),
      ]);
      const basic = basicRows[0];
      if (!basic)
        return {
          data: null,
          asOf: context.now().toISOString(),
          warnings: ["Tushare 未返回公司基础资料"],
        };
      const company = companyRows[0];
      const evidence: ProviderEvidence<unknown> = {
        data: {
          name: basic.name,
          area: basic.area,
          industry: basic.industry,
          market: basic.market,
          exchange: basic.exchange,
          listedAt: date(basic.list_date),
          chairman: company?.chairman,
          manager: company?.manager,
          registeredCapital: number(company?.reg_capital),
          establishedAt: date(company?.setup_date),
          province: company?.province,
          city: company?.city,
          introduction: company?.introduction,
          mainBusiness: company?.main_business,
          businessScope: company?.business_scope,
          employees: number(company?.employees),
        },
        asOf: "unknown",
      };
      if (!company)
        evidence.warnings = ["Tushare 公司详情不可用，仅返回基础资料"];
      return evidence;
    },
  };
}
