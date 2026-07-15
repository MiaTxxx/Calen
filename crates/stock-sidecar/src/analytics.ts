import type { PriceBar, StockSnapshot } from "./types.ts";

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: number[]): number | undefined {
  if (!values.length) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function simpleMovingAverage(
  values: number[],
  window: number
): number | undefined {
  if (window <= 0 || values.length < window) return undefined;
  return average(values.slice(-window));
}

function exponentialMovingAverage(
  values: number[],
  window: number
): number | undefined {
  if (!values.length || window <= 0) return undefined;
  const multiplier = 2 / (window + 1);
  let value = values[0]!;
  for (let index = 1; index < values.length; index += 1) {
    value = values[index]! * multiplier + value * (1 - multiplier);
  }
  return value;
}

export function relativeStrengthIndex(
  values: number[],
  period = 14
): number | undefined {
  if (values.length <= period) return undefined;
  const changes = values
    .slice(-period - 1)
    .slice(1)
    .map((value, index) => value - values.slice(-period - 1)[index]!);
  const gains = changes.map((change) => Math.max(change, 0));
  const losses = changes.map((change) => Math.max(-change, 0));
  const gain = average(gains) ?? 0;
  const loss = average(losses) ?? 0;
  if (loss === 0) return gain === 0 ? 50 : 100;
  return round(100 - 100 / (1 + gain / loss), 2);
}

export interface TechnicalAnalysis {
  sma5?: number;
  sma20?: number;
  rsi14?: number;
  macd?: number;
  volatilityAnnualized?: number;
  trend: "bullish" | "neutral" | "bearish";
}

export interface ResearchAnalysisMetadata {
  algorithm: {
    id: "calen.research-analytics";
    version: "1.0.0";
    parameters: Record<string, unknown>;
  };
  sample: {
    start: string | null;
    end: string | null;
    bars: number;
    coverage: number;
  };
  benchmark: {
    name: "buy-and-hold";
    returnPercent: number | null;
  };
  limitations: string[];
}

export function createResearchAnalysisMetadata(
  bars: PriceBar[],
  requestedBars: number
): ResearchAnalysisMetadata {
  const firstClose = bars[0]?.close;
  const lastClose = bars.at(-1)?.close;
  const benchmarkReturn =
    firstClose !== undefined && lastClose !== undefined && firstClose !== 0
      ? round((lastClose / firstClose - 1) * 100, 2)
      : null;
  return {
    algorithm: {
      id: "calen.research-analytics",
      version: "1.0.0",
      parameters: {
        smaWindows: [5, 20],
        rsiPeriod: 14,
        emaWindows: [12, 26],
        volatilityAnnualizationPeriods: 252,
        scoreFactors: ["trend", "rsi14", "macd", "20-bar-momentum"],
        minimumBars: 20,
      },
    },
    sample: {
      start: bars[0]?.time ?? null,
      end: bars.at(-1)?.time ?? null,
      bars: bars.length,
      coverage:
        requestedBars > 0 ? round(Math.min(1, bars.length / requestedBars)) : 0,
    },
    benchmark: {
      name: "buy-and-hold",
      returnPercent: benchmarkReturn,
    },
    limitations: [
      "实验性量化研究结果，不构成投资建议。",
      "结果仅基于本次返回的历史 K 线样本，不代表完整市场周期。",
      "基准为同一样本区间的买入并持有，不包含税费、滑点和公司行动调整。",
    ],
  };
}

export function analyzeTechnicals(bars: PriceBar[]): TechnicalAnalysis {
  const closes = bars.map((bar) => bar.close);
  const sma5 = simpleMovingAverage(closes, 5);
  const sma20 = simpleMovingAverage(closes, 20);
  const rsi14 = relativeStrengthIndex(closes, 14);
  const ema12 = exponentialMovingAverage(closes, 12);
  const ema26 = exponentialMovingAverage(closes, 26);
  const macd =
    ema12 !== undefined && ema26 !== undefined ? ema12 - ema26 : undefined;
  const returns = closes
    .slice(1)
    .map((close, index) => close / closes[index]! - 1);
  const mean = average(returns);
  const variance =
    mean === undefined || returns.length < 2
      ? undefined
      : returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
        (returns.length - 1);
  const volatility =
    variance === undefined
      ? undefined
      : Math.sqrt(variance) * Math.sqrt(252) * 100;
  const current = closes.at(-1);
  const trend =
    current !== undefined && sma5 !== undefined && sma20 !== undefined
      ? sma5 > sma20 && current > sma20
        ? "bullish"
        : sma5 < sma20 && current < sma20
          ? "bearish"
          : "neutral"
      : "neutral";
  const result: TechnicalAnalysis = { trend };
  if (sma5 !== undefined) result.sma5 = round(sma5);
  if (sma20 !== undefined) result.sma20 = round(sma20);
  if (rsi14 !== undefined) result.rsi14 = rsi14;
  if (macd !== undefined) result.macd = round(macd);
  if (volatility !== undefined)
    result.volatilityAnnualized = round(volatility, 2);
  return result;
}

export function evaluateResearch(
  snapshot: StockSnapshot | undefined,
  bars: PriceBar[]
) {
  const technical = analyzeTechnicals(bars);
  let score = 50;
  if (technical.trend === "bullish") score += 20;
  if (technical.trend === "bearish") score -= 20;
  if (technical.rsi14 !== undefined) {
    if (technical.rsi14 >= 45 && technical.rsi14 <= 70) score += 10;
    else if (technical.rsi14 > 70) score += 5;
    else if (technical.rsi14 < 30) score -= 10;
  }
  if ((technical.macd ?? 0) > 0) score += 10;
  const first = bars.at(-20)?.close;
  const last = snapshot?.price ?? bars.at(-1)?.close;
  if (first !== undefined && last !== undefined)
    score += last >= first ? 10 : -10;
  score = Math.max(0, Math.min(100, score));
  const rating = score >= 65 ? "positive" : score < 40 ? "cautious" : "neutral";
  return {
    technical,
    score: {
      value: score,
      algorithm: {
        id: "calen.technical-score",
        version: "1.0.0",
        parameters: {
          factors: ["trend", "rsi14", "macd", "20-bar-momentum"],
        },
      },
      factors: ["trend", "rsi14", "macd", "20-bar-momentum"],
    },
    evaluator: {
      id: "calen.rule-evaluator",
      version: "1.0.0",
      parameters: {
        positiveThreshold: 65,
        cautiousThreshold: 40,
      },
      rating,
      confidence: round(Math.min(1, Math.abs(score - 50) / 50), 2),
      disclaimer: "实验性量化研究结果，不构成投资建议。",
    },
  };
}
