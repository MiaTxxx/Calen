import {
  computeQuantIndicators,
  latestIndicator,
  type QuantIndicatorRow,
} from "./quant/indicators.ts";
import {
  STRATEGY_ALGORITHM_VERSION,
  analyzeStrategies,
  fuseSignals,
  listStrategies,
} from "./quant/strategies.ts";
import { evaluateResearchQuality } from "./quant/evaluator.ts";
import type { PriceBar, QuantStrategyId, StockSnapshot } from "./types.ts";

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

export function relativeStrengthIndex(
  values: number[],
  period = 14
): number | undefined {
  if (values.length <= period) return undefined;
  const sample = values.slice(-period - 1);
  let gains = 0;
  let losses = 0;
  for (let index = 1; index < sample.length; index += 1) {
    const change = sample[index]! - sample[index - 1]!;
    if (change >= 0) gains += change;
    else losses -= change;
  }
  if (losses === 0) return gains === 0 ? 50 : 100;
  return round(100 - 100 / (1 + gains / losses), 2);
}

export type TechnicalAnalysis = Omit<QuantIndicatorRow, "time">;

export interface ResearchAnalysisMetadata {
  algorithm: {
    id: "calen.research-analytics";
    version: "2.0.0";
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
      version: "2.0.0",
      parameters: {
        movingAverageWindows: [5, 10, 20, 60],
        rsiPeriod: 14,
        macdWindows: [12, 26, 9],
        bollingerWindow: 20,
        bollingerDeviations: 2,
        kdjWindow: 9,
        williamsWindow: 14,
        cciWindow: 20,
        adxWindow: 14,
        volatilityAnnualizationPeriods: 252,
        strategyRegistryVersion: STRATEGY_ALGORITHM_VERSION,
        strategies: listStrategies().map((item) => item.id),
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
      "所有指标与策略仅使用当根及更早的 K 线；样本不足时部分指标会缺失。",
      "结果仅基于本次返回的历史 K 线样本，不代表完整市场周期。",
      "基准为同一样本区间的买入并持有，不包含税费、滑点和公司行动调整。",
    ],
  };
}

export function analyzeTechnicals(bars: PriceBar[]): TechnicalAnalysis {
  const latest = latestIndicator(computeQuantIndicators(bars));
  if (!latest) return { trend: "neutral" };
  const { time: _time, ...technical } = latest;
  return technical;
}

export interface ResearchEvaluationOptions {
  financials?: unknown;
  strategyIds?: readonly QuantStrategyId[];
}

export function evaluateResearch(
  snapshot: StockSnapshot | undefined,
  bars: PriceBar[],
  options: ResearchEvaluationOptions = {}
) {
  const indicatorRows = computeQuantIndicators(bars);
  const latest = latestIndicator(indicatorRows);
  const selectedStrategies =
    options.strategyIds ?? listStrategies().map((item) => item.id);
  const signals = latest
    ? analyzeStrategies(
        { bars, indicators: indicatorRows, index: indicatorRows.length - 1 },
        selectedStrategies
      )
    : [];
  const fusion = fuseSignals(signals);
  const evaluator = evaluateResearchQuality({
    ...(snapshot ? { snapshot } : {}),
    bars,
    ...(latest ? { indicator: latest } : {}),
    signals,
    ...(options.financials !== undefined
      ? { financials: options.financials }
      : {}),
  });
  const technical = latest
    ? (({ time: _time, ...value }) => value)(latest)
    : null;
  return {
    technical,
    score: {
      value: evaluator.score,
      algorithm: {
        id: "calen.multi-factor-score",
        version: "2.0.0",
        parameters: evaluator.parameters,
      },
      factors: evaluator.dimensions.map((item) => ({
        id: item.id,
        score: item.score,
        weight: item.weight,
      })),
    },
    evaluator,
    strategy: {
      algorithm: {
        id: "calen.strategy-registry",
        version: STRATEGY_ALGORITHM_VERSION,
        parameters: { selectedStrategies },
      },
      registry: listStrategies(),
      signals,
      fusion,
      action: "research-only",
      disclaimer: "仅描述历史数据形成的实验性信号，不构成买卖建议。",
    },
  };
}
