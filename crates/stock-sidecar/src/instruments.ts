import type { AssetClass, Currency, InstrumentRef, Market } from "./types.ts";

const MARKETS = new Set<Market>(["CN", "HK", "US"]);
const CURRENCIES = new Set<Currency>(["CNY", "HKD", "USD"]);
const ASSET_TYPES = new Set<InstrumentRef["assetType"]>([
  "stock",
  "etf",
  "index",
  "fund",
  "unknown",
]);

function cnExchange(symbol: string): string {
  if (/^(?:[48]|920)/.test(symbol)) return "BSE";
  if (/^[569]/.test(symbol)) return "SSE";
  if (/^[0123]/.test(symbol)) return "SZSE";
  return "BSE";
}

function cnAssetClass(symbol: string): AssetClass {
  return /^(1[568]|5[01268])/.test(symbol) ? "ETF" : "EQUITY";
}

const US_EXCHANGE_SUFFIXES: Readonly<Record<string, string>> = {
  OQ: "NASDAQ",
  N: "NYSE",
  AM: "NYSEAMERICAN",
  PS: "OTC",
  PK: "OTC",
  OB: "OTC",
};

export function normalizeInstrument(
  query: string,
  marketHint?: Market
): InstrumentRef | null {
  const input = query.trim();
  if (!input) return null;
  const raw = input.toUpperCase();
  const qualified = /^(CN|HK|US):(.+)$/i.exec(raw);
  let market = (qualified?.[1] as Market | undefined) ?? marketHint;
  let symbol = qualified?.[2] ?? raw;
  let exchange: string | undefined;

  const cnPrefixed = /^(SH|SZ|BJ)(\d{6})$/.exec(symbol);
  const hkPrefixed = /^HK(\d{1,5})$/.exec(symbol);
  const usPrefixed = /^US(.+)$/.exec(symbol);
  if (cnPrefixed) {
    market = "CN";
    symbol = cnPrefixed[2]!;
    exchange =
      cnPrefixed[1] === "SH" ? "SSE" : cnPrefixed[1] === "SZ" ? "SZSE" : "BSE";
  } else if (hkPrefixed) {
    market = "HK";
    symbol = hkPrefixed[1]!;
  } else if (usPrefixed) {
    market = "US";
    symbol = usPrefixed[1]!;
  }

  const marketSuffix = /\.(SH|SZ|SS|BJ|HK|US)$/.exec(symbol)?.[1];
  if (marketSuffix) {
    market = marketSuffix === "HK" ? "HK" : marketSuffix === "US" ? "US" : "CN";
    exchange =
      marketSuffix === "SH" || marketSuffix === "SS"
        ? "SSE"
        : marketSuffix === "SZ"
          ? "SZSE"
          : marketSuffix === "BJ"
            ? "BSE"
            : marketSuffix === "HK"
              ? "HKEX"
              : "US";
    symbol = symbol.slice(0, -(marketSuffix.length + 1));
  }

  const usSuffix = /\.([A-Z]{1,3})$/.exec(symbol)?.[1];
  const usExchange = usSuffix ? US_EXCHANGE_SUFFIXES[usSuffix] : undefined;
  if (usExchange) {
    market = "US";
    exchange = usExchange;
    symbol = symbol.slice(0, -(usSuffix!.length + 1));
  }

  const explicitIdentity = Boolean(
    qualified ||
    cnPrefixed ||
    hkPrefixed ||
    usPrefixed ||
    marketSuffix ||
    usExchange
  );
  const mixedCaseCompanyName =
    !explicitIdentity && /[A-Z]/.test(input) && /[a-z]/.test(input);

  if ((market === "CN" || !market) && /^\d{6}$/.test(symbol)) {
    return makeInstrument(
      "CN",
      symbol,
      exchange ?? cnExchange(symbol),
      cnAssetClass(symbol),
      "CNY"
    );
  }
  if ((market === "HK" || !market) && /^\d{1,5}$/.test(symbol)) {
    const padded = symbol.padStart(5, "0");
    return makeUnclassifiedInstrument("HK", padded, "HKEX", "HKD");
  }
  if (mixedCaseCompanyName) return null;
  if ((market === "US" || !market) && /^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) {
    return makeUnclassifiedInstrument("US", symbol, exchange ?? "US", "USD");
  }
  return null;
}

export function isInstrumentRef(value: unknown): value is InstrumentRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.market !== "string" ||
    typeof candidate.exchange !== "string" ||
    typeof candidate.assetType !== "string" ||
    typeof candidate.currency !== "string" ||
    typeof candidate.symbol !== "string" ||
    typeof candidate.name !== "string"
  )
    return false;
  if (
    !candidate.id ||
    !candidate.exchange ||
    !candidate.symbol ||
    !candidate.name ||
    !MARKETS.has(candidate.market as Market) ||
    !CURRENCIES.has(candidate.currency as Currency) ||
    !ASSET_TYPES.has(candidate.assetType as InstrumentRef["assetType"])
  )
    return false;
  return candidate.id === `${candidate.market}:${candidate.symbol}`;
}

function makeUnclassifiedInstrument(
  market: "HK" | "US",
  symbol: string,
  exchange: string,
  currency: "HKD" | "USD"
): InstrumentRef {
  return {
    id: `${market}:${symbol}`,
    market,
    exchange,
    assetType: "unknown",
    currency,
    symbol,
    name: symbol,
  };
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
