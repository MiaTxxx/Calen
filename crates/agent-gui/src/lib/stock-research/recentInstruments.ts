import type { InstrumentRef, StockAssetType, StockMarket } from "./types";

// 「最近查看」历史:记录用户实际打开过的标的,点一下即可免搜索直接回到研究页。
// 存 localStorage 而非后端设置,历史属于本机使用痕迹,不参与同步。
export const RECENT_INSTRUMENTS_STORAGE_KEY = "stock-research.recent-instruments.v1";
export const RECENT_INSTRUMENTS_LIMIT = 10;

const MARKETS: ReadonlySet<StockMarket> = new Set(["CN", "HK", "US", "UNKNOWN"]);
const ASSET_TYPES: ReadonlySet<StockAssetType> = new Set([
  "stock",
  "etf",
  "index",
  "fund",
  "unknown",
]);

function isInstrumentRef(value: unknown): value is InstrumentRef {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    item.id.length > 0 &&
    typeof item.symbol === "string" &&
    typeof item.name === "string" &&
    MARKETS.has(item.market as StockMarket) &&
    typeof item.exchange === "string" &&
    ASSET_TYPES.has(item.assetType as StockAssetType) &&
    typeof item.currency === "string"
  );
}

// 解析持久化内容;损坏或形状不符的条目直接丢弃,不让脏数据阻断整个历史。
export function parseRecentInstruments(raw: string | null): InstrumentRef[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const result: InstrumentRef[] = [];
    for (const item of parsed) {
      if (!isInstrumentRef(item) || seen.has(item.id)) continue;
      seen.add(item.id);
      result.push(item);
      if (result.length >= RECENT_INSTRUMENTS_LIMIT) break;
    }
    return result;
  } catch {
    return [];
  }
}

// 新记录置顶、按 id 去重、超限截断;返回新数组,不修改入参。
export function pushRecentInstrument(
  list: InstrumentRef[],
  instrument: InstrumentRef,
): InstrumentRef[] {
  return [instrument, ...list.filter((item) => item.id !== instrument.id)].slice(
    0,
    RECENT_INSTRUMENTS_LIMIT,
  );
}

export function loadRecentInstruments(): InstrumentRef[] {
  try {
    return parseRecentInstruments(
      globalThis.localStorage?.getItem(RECENT_INSTRUMENTS_STORAGE_KEY) ?? null,
    );
  } catch {
    return [];
  }
}

export function saveRecentInstruments(list: InstrumentRef[]): void {
  try {
    globalThis.localStorage?.setItem(RECENT_INSTRUMENTS_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // 存储不可用(隐私模式、配额满)时静默降级为仅会话内历史。
  }
}

export function clearRecentInstruments(): void {
  try {
    globalThis.localStorage?.removeItem(RECENT_INSTRUMENTS_STORAGE_KEY);
  } catch {
    // 同上,清空失败不影响界面状态。
  }
}
