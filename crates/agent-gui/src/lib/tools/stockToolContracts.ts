export type StockSidecarToolOperation =
  | "resolve"
  | "snapshot"
  | "research"
  | "marketBrief"
  | "backtest"
  | "portfolio";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function string(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function normalizeToolInstrument(value: unknown): Record<string, unknown> {
  const instrument = record(value);
  const symbol = string(instrument.symbol) ?? "";
  const market = string(instrument.market) ?? "CN";
  const exchange =
    string(instrument.exchange) ??
    (market === "CN"
      ? /^[68]/.test(symbol)
        ? symbol.startsWith("6")
          ? "SSE"
          : "BSE"
        : "SZSE"
      : market === "HK"
        ? "HKEX"
        : "US");
  const rawAssetType = string(instrument.assetType);
  const assetType =
    rawAssetType === "ETF" || rawAssetType === "etf"
      ? "etf"
      : rawAssetType === "INDEX" || rawAssetType === "index"
        ? "index"
        : rawAssetType === "fund"
          ? "fund"
          : rawAssetType === "unknown"
            ? "unknown"
            : "stock";
  return {
    id:
      string(instrument.id ?? instrument.canonicalId) ?? `${market}:${symbol}`,
    symbol,
    name: string(instrument.name ?? instrument.displayName) ?? symbol,
    market,
    exchange,
    assetType,
    currency:
      string(instrument.currency) ??
      (market === "HK" ? "HKD" : market === "US" ? "USD" : "CNY"),
  };
}

export function toStockSidecarToolPayload(
  operation: StockSidecarToolOperation,
  rawPayload: Record<string, unknown>
): Record<string, unknown> {
  if (operation === "resolve" || operation === "portfolio") return rawPayload;
  if (operation === "marketBrief") return { market: "CN", ...rawPayload };
  const instrument = normalizeToolInstrument(rawPayload.instrument);
  if (operation === "snapshot") {
    const historyDays = finiteNumber(rawPayload.historyDays) ?? 30;
    return {
      ...rawPayload,
      instrument,
      includeHistory: historyDays > 0,
      historyLimit: Math.trunc(historyDays),
      includeProfile: true,
    };
  }
  if (operation === "research") {
    const capabilityMap: Record<string, string> = {
      quote: "snapshot",
      holders: "shareholders",
      dividends: "dividend",
    };
    const capabilities = Array.isArray(rawPayload.capabilities)
      ? rawPayload.capabilities.map(
          (value) => capabilityMap[String(value)] ?? String(value)
        )
      : undefined;
    return {
      ...rawPayload,
      instrument,
      ...(capabilities ? { capabilities } : {}),
      historyLimit: Math.min(
        Math.max(Math.trunc(finiteNumber(rawPayload.maxItems) ?? 120), 20),
        2_000
      ),
    };
  }
  const parameters = record(rawPayload.parameters);
  const period = finiteNumber(parameters.period);
  const shortWindow =
    finiteNumber(parameters.shortWindow) ??
    (period === undefined ? 5 : Math.max(1, Math.floor(period / 4)));
  const longWindow = finiteNumber(parameters.longWindow) ?? period ?? 20;
  const normalizedLongWindow = Math.max(2, Math.trunc(longWindow));
  const normalizedShortWindow = Math.max(
    1,
    Math.min(Math.trunc(shortWindow), normalizedLongWindow - 1)
  );
  return {
    ...rawPayload,
    instrument,
    start: string(rawPayload.startDate),
    end: string(rawPayload.endDate),
    initialCash: finiteNumber(parameters.initialCash),
    feeRate: finiteNumber(rawPayload.feeRate ?? parameters.feeRate),
    strategy: {
      id: "sma-cross",
      shortWindow: normalizedShortWindow,
      longWindow: normalizedLongWindow,
    },
  };
}
