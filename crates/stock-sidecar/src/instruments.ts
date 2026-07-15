import type { AssetClass, Currency, InstrumentRef, Market } from "./types.ts";

function cnExchange(symbol: string): string {
  if (/^[48]/.test(symbol)) return "BSE";
  if (/^[569]/.test(symbol)) return "SSE";
  if (/^[0123]/.test(symbol)) return "SZSE";
  return "BSE";
}

function cnAssetClass(symbol: string): AssetClass {
  return /^(1[568]|5[0168])/.test(symbol) ? "ETF" : "EQUITY";
}

export function normalizeInstrument(
  query: string,
  marketHint?: Market
): InstrumentRef | null {
  const raw = query.trim().toUpperCase();
  if (!raw) return null;
  const qualified = /^(CN|HK|US):(.+)$/.exec(raw);
  const market = (qualified?.[1] as Market | undefined) ?? marketHint;
  const symbol = (qualified?.[2] ?? raw).replace(/\.(SH|SZ|SS|HK|US)$/i, "");
  if ((market === "CN" || !market) && /^\d{6}$/.test(symbol)) {
    return makeInstrument(
      "CN",
      symbol,
      cnExchange(symbol),
      cnAssetClass(symbol),
      "CNY"
    );
  }
  if ((market === "HK" || !market) && /^\d{1,5}$/.test(symbol)) {
    const padded = symbol.padStart(5, "0");
    return makeInstrument("HK", padded, "HKEX", "EQUITY", "HKD");
  }
  if ((market === "US" || !market) && /^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) {
    return makeInstrument("US", symbol, "US", "EQUITY", "USD");
  }
  return null;
}

export function makeInstrument(
  market: Market,
  symbol: string,
  exchange: string,
  assetClass: AssetClass,
  currency: Currency,
  displayName = symbol
): InstrumentRef {
  const assetType =
    assetClass === "ETF" ? "etf" : assetClass === "INDEX" ? "index" : "stock";
  return {
    id: `${market}:${symbol}`,
    market,
    exchange,
    assetType,
    currency,
    symbol,
    name: displayName,
  };
}
