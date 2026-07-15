/**
 * Quality calibration and multi-dimensional rating adapted and substantially
 * rewritten from Opptrix packages/institutions/src/evaluator.ts and registry.ts
 * (Apache-2.0). Calen does not impersonate named institutions; it exposes a
 * transparent research-style model with evidence quality and limitations.
 */
import type { PriceBar, StockSnapshot } from "../types.ts";
import type { QuantIndicatorRow } from "./indicators.ts";
import type { StrategySignal } from "./strategies.ts";

export interface EvaluatorQuality {
  dataCompleteness: number;
  dataTimeliness: number;
  dimensionsPlanned: number;
  dimensionsActual: number;
  hasRealtime: boolean;
  hasKline: boolean;
  hasFinancials: boolean;
  klineDays: number;
  financialPeriods: number;
}

export interface EvaluatorDimension {
  id: "trend" | "momentum" | "volume" | "risk" | "fundamental";
  name: string;
  score: number;
  weight: number;
  evidence: string[];
}

export type EvaluatorRating =
  "strong-positive" | "positive" | "neutral" | "cautious" | "negative";

export interface EvaluatorInput {
  snapshot?: StockSnapshot;
  bars: PriceBar[];
  indicator?: QuantIndicatorRow;
  signals: StrategySignal[];
  financials?: unknown;
}

const DIMENSION_WEIGHTS: Record<EvaluatorDimension["id"], number> = {
  trend: 0.25,
  momentum: 0.2,
  volume: 0.15,
  risk: 0.2,
  fundamental: 0.2,
};

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, round(value)));
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function finite(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function financialDimension(value: unknown): EvaluatorDimension | undefined {
  const financials = record(value);
  const statements = record(financials?.statements);
  const income = record(statements?.income);
  const balance = record(statements?.balance);
  const cashFlow = record(statements?.cashFlow);
  if (!income && !balance && !cashFlow) return undefined;
  let score = 50;
  const evidence: string[] = [];
  const netProfit = finite(income?.netProfit);
  const operatingCashFlow = finite(cashFlow?.operatingCashFlow);
  const debtAssetRatio = finite(balance?.debtAssetRatio);
  if (netProfit !== undefined) {
    score += netProfit > 0 ? 15 : -20;
    evidence.push(
      netProfit > 0 ? "最近报告期净利润为正" : "最近报告期净利润非正"
    );
  }
  if (operatingCashFlow !== undefined) {
    score += operatingCashFlow > 0 ? 15 : -15;
    evidence.push(operatingCashFlow > 0 ? "经营现金流为正" : "经营现金流为负");
  }
  if (debtAssetRatio !== undefined) {
    score += debtAssetRatio <= 60 ? 10 : debtAssetRatio >= 80 ? -15 : 0;
    evidence.push(`资产负债率 ${round(debtAssetRatio)}%`);
  }
  return {
    id: "fundamental",
    name: "财务质量",
    score: clampScore(score),
    weight: DIMENSION_WEIGHTS.fundamental,
    evidence,
  };
}

function financialPeriodCount(value: unknown): number {
  const financials = record(value);
  if (!financials) return 0;
  const periods = Array.isArray(financials?.periods) ? financials.periods : [];
  return Math.min(4, periods.length || 1);
}

function recentDrawdown(bars: PriceBar[]): number {
  let peak = 0;
  let drawdown = 0;
  for (const bar of bars.slice(-60)) {
    peak = Math.max(peak, bar.close);
    if (peak > 0) drawdown = Math.max(drawdown, (peak - bar.close) / peak);
  }
  return drawdown * 100;
}

export function buildEvaluatorQuality(input: EvaluatorInput): EvaluatorQuality {
  const hasRealtime = input.snapshot !== undefined;
  const hasKline = input.bars.length > 0;
  const hasFinancials = financialDimension(input.financials) !== undefined;
  const dimensionsPlanned = 5;
  const dimensionsActual = 4 + (hasFinancials ? 1 : 0);
  let completeness = 0;
  if (hasRealtime) completeness += 0.2;
  if (input.bars.length >= 250) completeness += 0.3;
  else if (input.bars.length >= 60) completeness += 0.2;
  else if (hasKline) completeness += 0.1;
  if (hasFinancials) completeness += 0.2;
  completeness += 0.3 * (dimensionsActual / dimensionsPlanned);
  return {
    dataCompleteness: round(Math.min(1, completeness)),
    dataTimeliness: hasRealtime ? 1 : hasKline ? 0.7 : 0.3,
    dimensionsPlanned,
    dimensionsActual,
    hasRealtime,
    hasKline,
    hasFinancials,
    klineDays: input.bars.length,
    financialPeriods: hasFinancials
      ? financialPeriodCount(input.financials)
      : 0,
  };
}

export function evaluateDimensions(input: EvaluatorInput) {
  const row = input.indicator;
  if (!row) return [] as EvaluatorDimension[];
  const dimensions: EvaluatorDimension[] = [];
  const trendScore =
    row.trend === "bullish" ? 75 : row.trend === "bearish" ? 25 : 50;
  dimensions.push({
    id: "trend",
    name: "趋势结构",
    score: clampScore(
      trendScore +
        (row.adx14 !== undefined && row.adx14 >= 25
          ? row.plusDi14 !== undefined && row.minusDi14 !== undefined
            ? row.plusDi14 >= row.minusDi14
              ? 10
              : -10
            : 0
          : 0)
    ),
    weight: DIMENSION_WEIGHTS.trend,
    evidence: [
      `趋势 ${row.trend}`,
      ...(row.adx14 === undefined ? [] : [`ADX14 ${round(row.adx14)}`]),
    ],
  });

  let momentumScore = 50;
  if (row.rsi14 !== undefined)
    momentumScore +=
      row.rsi14 >= 45 && row.rsi14 <= 70
        ? 10
        : row.rsi14 > 80
          ? -10
          : row.rsi14 < 20
            ? 10
            : 0;
  if (row.macdHistogram !== undefined)
    momentumScore += row.macdHistogram > 0 ? 15 : -15;
  if (row.cci20 !== undefined)
    momentumScore += row.cci20 > 100 ? 10 : row.cci20 < -100 ? -10 : 0;
  dimensions.push({
    id: "momentum",
    name: "价格动量",
    score: clampScore(momentumScore),
    weight: DIMENSION_WEIGHTS.momentum,
    evidence: [
      ...(row.rsi14 === undefined ? [] : [`RSI14 ${round(row.rsi14)}`]),
      ...(row.macdHistogram === undefined
        ? []
        : [`MACD 柱 ${round(row.macdHistogram)}`]),
      ...(row.cci20 === undefined ? [] : [`CCI20 ${round(row.cci20)}`]),
    ],
  });

  const buySignals = input.signals.filter(
    (item) => item.direction === "BUY"
  ).length;
  const sellSignals = input.signals.filter(
    (item) => item.direction === "SELL"
  ).length;
  const volumeScore =
    50 +
    (row.volumeRatio !== undefined
      ? row.volumeRatio >= 1.5
        ? buySignals >= sellSignals
          ? 15
          : -15
        : 0
      : 0) +
    (row.forceIndex !== undefined ? (row.forceIndex >= 0 ? 10 : -10) : 0);
  dimensions.push({
    id: "volume",
    name: "量价确认",
    score: clampScore(volumeScore),
    weight: DIMENSION_WEIGHTS.volume,
    evidence: [
      ...(row.volumeRatio === undefined
        ? []
        : [`量比 ${round(row.volumeRatio)}`]),
      `策略信号 买 ${buySignals} / 卖 ${sellSignals}`,
    ],
  });

  const drawdown = recentDrawdown(input.bars);
  const volatility = row.volatilityAnnualized;
  let riskScore = 70;
  if (volatility !== undefined)
    riskScore += volatility <= 25 ? 10 : volatility >= 60 ? -25 : -5;
  riskScore += drawdown <= 10 ? 10 : drawdown >= 30 ? -25 : -5;
  dimensions.push({
    id: "risk",
    name: "波动与回撤",
    score: clampScore(riskScore),
    weight: DIMENSION_WEIGHTS.risk,
    evidence: [
      ...(volatility === undefined ? [] : [`年化波动 ${round(volatility)}%`]),
      `近 60 根最大回撤 ${round(drawdown)}%`,
    ],
  });

  const fundamental = financialDimension(input.financials);
  if (fundamental) dimensions.push(fundamental);
  return dimensions;
}

function ratingFromScore(score: number): EvaluatorRating {
  if (score >= 75) return "strong-positive";
  if (score >= 60) return "positive";
  if (score >= 45) return "neutral";
  if (score >= 30) return "cautious";
  return "negative";
}

export function evaluateResearchQuality(input: EvaluatorInput) {
  const dimensions = evaluateDimensions(input);
  const quality = buildEvaluatorQuality(input);
  const totalWeight = dimensions.reduce((sum, item) => sum + item.weight, 0);
  const rawScore =
    totalWeight > 0
      ? dimensions.reduce((sum, item) => sum + item.score * item.weight, 0) /
        totalWeight
      : 50;
  const calibratedScore =
    50 + (rawScore - 50) * (0.5 + quality.dataCompleteness / 2);
  const score = clampScore(calibratedScore);
  return {
    id: "calen.multi-factor-evaluator",
    version: "2.0.0",
    modelName: "Calen transparent multi-factor research evaluator",
    methodSource: "research-style",
    parameters: { dimensionWeights: DIMENSION_WEIGHTS },
    rating: ratingFromScore(score),
    score,
    confidence: round(
      Math.min(1, Math.abs(score - 50) / 50) * quality.dataCompleteness
    ),
    quality,
    dimensions,
    summary: dimensions.map((item) => `${item.name} ${item.score}`).join(" · "),
    disclaimer: "实验性多维研究评价，不代表任何机构观点，不构成买卖建议。",
  };
}
