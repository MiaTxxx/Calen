/**
 * Tencent FX adapter, independently rewritten for Calen's StockProvider seam.
 * Design/field reference: Opptrix
 * `packages/a-stock-layer/src/providers/tencent/api/exchange-rate-service.ts`
 * (Apache-2.0). See ../../NOTICE.md for attribution and modification details.
 */
import type {
  Currency,
  FxRatePairRequest,
  ProviderContext,
  ProviderEvidence,
  StockFxRateQuote,
  StockFxRatesRequest,
  StockProvider,
} from "../types.ts";
import { strictFiniteNumber } from "../numbers.ts";
import { ProviderError } from "./registry.ts";

const TENCENT_FOREX_URL = "https://qt.gtimg.cn/?q=";
const DIRECT_PAIRS = new Set(["USDCNY", "USDHKD", "HKDCNY"]);

interface TencentPairPlan extends FxRatePairRequest {
  directPair: string;
  inverted: boolean;
}

function pairKey(pair: FxRatePairRequest): string {
  return `${pair.fromCurrency}${pair.toCurrency}`;
}

function uniquePairs(pairs: readonly FxRatePairRequest[]): FxRatePairRequest[] {
  const seen = new Set<string>();
  return pairs.filter((pair) => {
    const key = pairKey(pair);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function planPair(pair: FxRatePairRequest): TencentPairPlan | null {
  if (pair.fromCurrency === pair.toCurrency) return null;
  const directPair = pairKey(pair);
  if (DIRECT_PAIRS.has(directPair))
    return { ...pair, directPair, inverted: false };
  const reversed = `${pair.toCurrency}${pair.fromCurrency}`;
  if (DIRECT_PAIRS.has(reversed))
    return { ...pair, directPair: reversed, inverted: true };
  return null;
}

function finitePositive(value: string | undefined): number | null {
  const parsed = strictFiniteNumber(value);
  return parsed !== undefined && parsed > 0 ? parsed : null;
}

function quoteTime(raw: string | undefined): string | null {
  const value = raw?.trim() ?? "";
  if (!/^\d{12}(?:\d{2})?$/.test(value)) return null;
  const seconds = value.length === 14 ? value.slice(12, 14) : "00";
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${seconds}.000+08:00`;
}

function parseTencentQuotes(
  text: string
): Map<string, { rate: number; asOf: string | null }> {
  const quotes = new Map<string, { rate: number; asOf: string | null }>();
  const pattern = /v_(wh[A-Z]{6})="([^"]*)"/g;
  for (const match of text.matchAll(pattern)) {
    const directPair = match[1]?.slice(2);
    const fields = match[2]?.split("~");
    const rate = finitePositive(fields?.[3]);
    if (!directPair || rate === null) continue;
    quotes.set(directPair, { rate, asOf: quoteTime(fields?.[5]) });
  }
  return quotes;
}

async function fxRates(
  request: StockFxRatesRequest,
  context: ProviderContext
): Promise<ProviderEvidence<StockFxRateQuote[]>> {
  const warnings: string[] = [];
  const plans = uniquePairs(request.pairs).flatMap((pair) => {
    const plan = planPair(pair);
    if (!plan) {
      warnings.push(`腾讯外汇不支持 ${pair.fromCurrency}/${pair.toCurrency}`);
      return [];
    }
    return [plan];
  });
  if (!plans.length) {
    return {
      data: null,
      asOf: context.now().toISOString(),
      warnings,
    };
  }

  const symbols = [...new Set(plans.map((plan) => `wh${plan.directPair}`))];
  const init: RequestInit = {
    headers: { Accept: "text/plain", Referer: "https://gu.qq.com/" },
  };
  if (context.signal) init.signal = context.signal;
  const response = await context.fetch(
    `${TENCENT_FOREX_URL}${symbols.join(",")}`,
    init
  );
  if (!response.ok) {
    throw new ProviderError(`HTTP ${response.status}`, {
      status: response.status,
    });
  }
  const quotes = parseTencentQuotes(await response.text());
  const retrievedAt = context.now().toISOString();
  const rates = plans.flatMap((plan): StockFxRateQuote[] => {
    const quote = quotes.get(plan.directPair);
    if (!quote) {
      warnings.push(`腾讯外汇缺少 ${plan.fromCurrency}/${plan.toCurrency}`);
      return [];
    }
    if (!quote.asOf)
      warnings.push(`腾讯外汇 ${plan.directPair} 缺少有效行情时间`);
    const rate = plan.inverted ? 1 / quote.rate : quote.rate;
    if (!Number.isFinite(rate) || rate <= 0) {
      warnings.push(
        `腾讯外汇 ${plan.fromCurrency}/${plan.toCurrency} 汇率无效`
      );
      return [];
    }
    return [{ ...plan, rate, asOf: quote.asOf ?? "unknown" }].map(
      ({ directPair: _directPair, inverted: _inverted, ...value }) => value
    );
  });

  return {
    data: rates.length ? rates : null,
    asOf: rates.some((rate) => rate.asOf === "unknown")
      ? "unknown"
      : (rates
          .map((rate) => rate.asOf)
          .sort()
          .at(0) ?? retrievedAt),
    ...(warnings.length ? { warnings } : {}),
  };
}

export function createTencentFxProvider(): StockProvider {
  return {
    id: "tencent-fx",
    priority: 10,
    free: true,
    capabilities: ["fxRates"],
    fxRates,
  };
}

export const TENCENT_FX_SUPPORTED_CURRENCIES: readonly Currency[] = [
  "CNY",
  "HKD",
  "USD",
];
