/**
 * Strategy registry adapted and substantially rewritten from Opptrix
 * packages/t-strategy/src/strategies.ts (Apache-2.0).
 * Calen keeps only deterministic, evidence-backed research signals and does
 * not emit positions, orders, or investment instructions.
 */
import type { PriceBar, QuantStrategyId } from "../types.ts";
import type { QuantIndicatorRow } from "./indicators.ts";

export const STRATEGY_ALGORITHM_VERSION = "1.0.0";

export type StrategyDirection = "BUY" | "SELL" | "HOLD";

export interface StrategySignal {
  strategyId: QuantStrategyId;
  strategyLabel: string;
  signalId: string;
  direction: StrategyDirection;
  strength: number;
  weight: number;
  reason: string;
  source: string;
}

export interface StrategyContext {
  bars: PriceBar[];
  indicators: QuantIndicatorRow[];
  index: number;
}

export interface StrategyDefinition {
  id: QuantStrategyId;
  label: string;
  source: string;
  weight: number;
  analyze(context: StrategyContext): StrategySignal[];
}

function signal(
  strategy: StrategyDefinition,
  signalId: string,
  direction: StrategyDirection,
  strength: number,
  reason: string
): StrategySignal {
  return {
    strategyId: strategy.id,
    strategyLabel: strategy.label,
    signalId,
    direction,
    strength: Math.max(0, Math.min(1, strength)),
    weight: strategy.weight,
    reason,
    source: strategy.source,
  };
}

const trend: StrategyDefinition = {
  id: "trend",
  label: "趋势跟踪",
  source: "causal moving-average trend model",
  weight: 0.25,
  analyze(context) {
    const row = context.indicators[context.index];
    const bar = context.bars[context.index];
    if (!row || !bar) return [];
    const signals: StrategySignal[] = [];
    if (
      row.sma5 !== undefined &&
      row.sma10 !== undefined &&
      row.sma20 !== undefined
    ) {
      if (row.sma5 > row.sma10 && row.sma10 > row.sma20)
        signals.push(
          signal(
            trend,
            "trend-bull-alignment",
            "BUY",
            0.55,
            "短中期均线多头排列"
          )
        );
      else if (row.sma5 < row.sma10 && row.sma10 < row.sma20)
        signals.push(
          signal(
            trend,
            "trend-bear-alignment",
            "SELL",
            0.55,
            "短中期均线空头排列"
          )
        );
    }
    if (row.sma60 !== undefined)
      signals.push(
        signal(
          trend,
          bar.close >= row.sma60 ? "trend-above-sma60" : "trend-below-sma60",
          bar.close >= row.sma60 ? "BUY" : "SELL",
          row.adx14 !== undefined && row.adx14 >= 25 ? 0.45 : 0.25,
          bar.close >= row.sma60
            ? "收盘价位于 SMA60 上方"
            : "收盘价位于 SMA60 下方"
        )
      );
    return signals;
  },
};

const meanReversion: StrategyDefinition = {
  id: "mean-reversion",
  label: "均值回归",
  source: "Bollinger-RSI-Williams research model",
  weight: 0.22,
  analyze(context) {
    const row = context.indicators[context.index];
    const bar = context.bars[context.index];
    if (!row || !bar) return [];
    const signals: StrategySignal[] = [];
    if (
      row.bollingerLower !== undefined &&
      row.rsi14 !== undefined &&
      bar.close <= row.bollingerLower * 1.01 &&
      row.rsi14 < 35
    )
      signals.push(
        signal(
          meanReversion,
          "mean-reversion-oversold",
          "BUY",
          0.65,
          "接近布林下轨且 RSI 偏低"
        )
      );
    if (
      row.bollingerUpper !== undefined &&
      row.rsi14 !== undefined &&
      bar.close >= row.bollingerUpper * 0.99 &&
      row.rsi14 > 65
    )
      signals.push(
        signal(
          meanReversion,
          "mean-reversion-overbought",
          "SELL",
          0.65,
          "接近布林上轨且 RSI 偏高"
        )
      );
    if (row.williamsR !== undefined && row.williamsR < -80)
      signals.push(
        signal(
          meanReversion,
          "williams-oversold",
          "BUY",
          0.4,
          "Williams %R 进入超卖区"
        )
      );
    if (row.williamsR !== undefined && row.williamsR > -20)
      signals.push(
        signal(
          meanReversion,
          "williams-overbought",
          "SELL",
          0.4,
          "Williams %R 进入超买区"
        )
      );
    return signals;
  },
};

const breakout: StrategyDefinition = {
  id: "breakout",
  label: "区间突破",
  source: "causal 20-bar breakout model",
  weight: 0.2,
  analyze(context) {
    const bar = context.bars[context.index];
    const row = context.indicators[context.index];
    const prior = context.bars.slice(
      Math.max(0, context.index - 20),
      context.index
    );
    if (!bar || !row || prior.length < 20) return [];
    const priorHigh = Math.max(...prior.map((item) => item.high));
    const priorLow = Math.min(...prior.map((item) => item.low));
    const volumeStrength = Math.min(
      1,
      Math.max(0.35, (row.volumeRatio ?? 1) / 2)
    );
    if (bar.close > priorHigh)
      return [
        signal(
          breakout,
          "breakout-up",
          "BUY",
          volumeStrength,
          "收盘价突破此前 20 根 K 线高点"
        ),
      ];
    if (bar.close < priorLow)
      return [
        signal(
          breakout,
          "breakout-down",
          "SELL",
          volumeStrength,
          "收盘价跌破此前 20 根 K 线低点"
        ),
      ];
    return [];
  },
};

const momentum: StrategyDefinition = {
  id: "momentum",
  label: "动量交叉",
  source: "MACD-KDJ-CCI momentum model",
  weight: 0.2,
  analyze(context) {
    const row = context.indicators[context.index];
    const previous = context.indicators[context.index - 1];
    if (!row) return [];
    const signals: StrategySignal[] = [];
    if (
      previous?.macd !== undefined &&
      previous.macdSignal !== undefined &&
      row.macd !== undefined &&
      row.macdSignal !== undefined
    ) {
      if (previous.macd <= previous.macdSignal && row.macd > row.macdSignal)
        signals.push(
          signal(
            momentum,
            "macd-golden-cross",
            "BUY",
            0.7,
            "MACD 在当前收盘形成金叉"
          )
        );
      else if (
        previous.macd >= previous.macdSignal &&
        row.macd < row.macdSignal
      )
        signals.push(
          signal(
            momentum,
            "macd-death-cross",
            "SELL",
            0.7,
            "MACD 在当前收盘形成死叉"
          )
        );
    }
    if (row.kdjJ !== undefined && row.kdjK !== undefined) {
      if (row.kdjJ < 0 && row.kdjK < 20)
        signals.push(
          signal(momentum, "kdj-oversold", "BUY", 0.45, "KDJ 进入超卖区")
        );
      if (row.kdjJ > 100 && row.kdjK > 80)
        signals.push(
          signal(momentum, "kdj-overbought", "SELL", 0.45, "KDJ 进入超买区")
        );
    }
    if (row.cci20 !== undefined && Math.abs(row.cci20) >= 100)
      signals.push(
        signal(
          momentum,
          row.cci20 > 0 ? "cci-positive-momentum" : "cci-negative-momentum",
          row.cci20 > 0 ? "BUY" : "SELL",
          Math.min(0.5, Math.abs(row.cci20) / 400),
          `CCI20=${row.cci20.toFixed(1)}`
        )
      );
    return signals;
  },
};

const volumePrice: StrategyDefinition = {
  id: "volume-price",
  label: "量价确认",
  source: "volume-price and OBV confirmation model",
  weight: 0.13,
  analyze(context) {
    const row = context.indicators[context.index];
    const bar = context.bars[context.index];
    const previousBar = context.bars[context.index - 1];
    const previousObv = context.indicators[Math.max(0, context.index - 5)]?.obv;
    if (!row || !bar || !previousBar || previousBar.close <= 0) return [];
    const changePercent = (bar.close / previousBar.close - 1) * 100;
    const signals: StrategySignal[] = [];
    if ((row.volumeRatio ?? 0) >= 1.5 && Math.abs(changePercent) >= 1.5)
      signals.push(
        signal(
          volumePrice,
          changePercent > 0 ? "volume-price-up" : "volume-price-down",
          changePercent > 0 ? "BUY" : "SELL",
          Math.min(0.7, (row.volumeRatio ?? 1) / 3),
          `量比 ${(row.volumeRatio ?? 0).toFixed(2)}，涨跌 ${changePercent.toFixed(2)}%`
        )
      );
    if (row.obv !== undefined && previousObv !== undefined) {
      if (row.obv > previousObv && changePercent > 0)
        signals.push(
          signal(
            volumePrice,
            "obv-confirm-up",
            "BUY",
            0.3,
            "OBV 与价格同步上行"
          )
        );
      if (row.obv < previousObv && changePercent < 0)
        signals.push(
          signal(
            volumePrice,
            "obv-confirm-down",
            "SELL",
            0.3,
            "OBV 与价格同步下行"
          )
        );
    }
    return signals;
  },
};

export const STRATEGY_REGISTRY: Readonly<
  Record<QuantStrategyId, StrategyDefinition>
> = {
  trend,
  "mean-reversion": meanReversion,
  breakout,
  momentum,
  "volume-price": volumePrice,
};

export function listStrategies() {
  return Object.values(STRATEGY_REGISTRY).map((strategy) => ({
    id: strategy.id,
    label: strategy.label,
    source: strategy.source,
    weight: strategy.weight,
  }));
}

export function analyzeStrategies(
  context: StrategyContext,
  strategyIds: readonly QuantStrategyId[] = Object.keys(
    STRATEGY_REGISTRY
  ) as QuantStrategyId[]
): StrategySignal[] {
  return strategyIds.flatMap((id) => STRATEGY_REGISTRY[id].analyze(context));
}

export function fuseSignals(signals: readonly StrategySignal[]) {
  let signedScore = 0;
  let activeWeight = 0;
  for (const item of signals) {
    if (item.direction === "HOLD") continue;
    const direction = item.direction === "BUY" ? 1 : -1;
    const contribution = item.strength * item.weight;
    signedScore += direction * contribution;
    activeWeight += contribution;
  }
  const normalized = activeWeight > 0 ? signedScore / activeWeight : 0;
  return {
    algorithm: {
      id: "calen.signal-fusion",
      version: STRATEGY_ALGORITHM_VERSION,
      parameters: { buyThreshold: 0.15, sellThreshold: -0.15 },
    },
    score: Math.round(normalized * 10_000) / 100,
    verdict:
      normalized > 0.15
        ? ("BUY" as const)
        : normalized < -0.15
          ? ("SELL" as const)
          : ("HOLD" as const),
    confidence: Math.round(Math.min(1, Math.abs(normalized)) * 100) / 100,
    reasons: signals.map((item) => item.reason).slice(0, 8),
  };
}
