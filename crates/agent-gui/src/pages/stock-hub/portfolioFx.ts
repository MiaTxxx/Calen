import type {
  StockCurrency,
  StockCurrencyTotals,
  StockFxRateInput,
  StockFxRatePair,
  StockFxRatesResult,
} from "../../lib/stock-research";

function fxKey(value: StockFxRatePair): string {
  return `${value.fromCurrency}/${value.toCurrency}`;
}

export function requiredPortfolioFxPairs(
  totals: readonly StockCurrencyTotals[],
  baseCurrency: StockCurrency,
): StockFxRatePair[] {
  const seen = new Set<StockCurrency>();
  return totals.flatMap(({ currency }) => {
    if (currency === baseCurrency || seen.has(currency)) return [];
    seen.add(currency);
    return [{ fromCurrency: currency, toCurrency: baseCurrency }];
  });
}

export function evidenceFxRates(result: StockFxRatesResult): StockFxRateInput[] {
  return result.rates.map((rate) => ({
    fromCurrency: rate.fromCurrency,
    toCurrency: rate.toCurrency,
    rate: rate.rate,
    asOf: rate.asOf,
  }));
}

export function mergePortfolioFxRates(
  automatic: readonly StockFxRateInput[],
  manual: readonly StockFxRateInput[],
): StockFxRateInput[] {
  const merged = new Map<string, StockFxRateInput>();
  for (const value of [...automatic, ...manual]) {
    if (!Number.isFinite(value.rate) || value.rate <= 0) continue;
    merged.set(fxKey(value), value);
  }
  return [...merged.values()];
}
