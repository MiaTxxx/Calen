/**
 * Adapted and substantially rewritten from Opptrix
 * packages/t-strategy/src/indicators.ts (Apache-2.0).
 * Calen uses typed PriceBar input, undefined for unavailable values, causal
 * rolling windows, and a bounded sidecar-only implementation.
 */
import type { PriceBar } from "../types.ts";

export interface QuantIndicatorRow {
  time: string;
  sma5?: number;
  sma10?: number;
  sma20?: number;
  sma60?: number;
  maWidthPercent?: number;
  rsi14?: number;
  macd?: number;
  macdSignal?: number;
  macdHistogram?: number;
  bollingerUpper?: number;
  bollingerMiddle?: number;
  bollingerLower?: number;
  bollingerPercentB?: number;
  kdjK?: number;
  kdjD?: number;
  kdjJ?: number;
  williamsR?: number;
  cci20?: number;
  adx14?: number;
  plusDi14?: number;
  minusDi14?: number;
  obv?: number;
  volumeMa5?: number;
  volumeMa10?: number;
  forceIndex?: number;
  volumeRatio?: number;
  volatilityAnnualized?: number;
  trend: "bullish" | "neutral" | "bearish";
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: number[]): number | undefined {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : undefined;
}

function windowAt(
  values: number[],
  index: number,
  period: number
): number[] | undefined {
  if (period <= 0 || index < period - 1) return undefined;
  return values.slice(index - period + 1, index + 1);
}

function smaAt(
  values: number[],
  index: number,
  period: number
): number | undefined {
  const valuesWindow = windowAt(values, index, period);
  return valuesWindow ? average(valuesWindow) : undefined;
}

function stddevAt(
  values: number[],
  index: number,
  period: number
): number | undefined {
  const valuesWindow = windowAt(values, index, period);
  const mean = valuesWindow ? average(valuesWindow) : undefined;
  if (!valuesWindow || mean === undefined) return undefined;
  return Math.sqrt(
    valuesWindow.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
      valuesWindow.length
  );
}

function emaSeries(
  values: number[],
  period: number
): Array<number | undefined> {
  const output: Array<number | undefined> = Array.from(
    { length: values.length },
    () => undefined
  );
  if (period <= 0) return output;
  const multiplier = 2 / (period + 1);
  let previous: number | undefined;
  for (let index = 0; index < values.length; index += 1) {
    if (index < period - 1) continue;
    previous =
      previous === undefined
        ? average(values.slice(0, period))
        : values[index]! * multiplier + previous * (1 - multiplier);
    output[index] = previous;
  }
  return output;
}

function optionalEmaSeries(
  values: Array<number | undefined>,
  period: number
): Array<number | undefined> {
  const output: Array<number | undefined> = Array.from(
    { length: values.length },
    () => undefined
  );
  const seen: number[] = [];
  const multiplier = 2 / (period + 1);
  let previous: number | undefined;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined) continue;
    seen.push(value);
    if (seen.length < period) continue;
    previous =
      previous === undefined
        ? average(seen.slice(-period))
        : value * multiplier + previous * (1 - multiplier);
    output[index] = previous;
  }
  return output;
}

function rsiAt(
  closes: number[],
  index: number,
  period: number
): number | undefined {
  if (index < period) return undefined;
  let gains = 0;
  let losses = 0;
  for (let cursor = index - period + 1; cursor <= index; cursor += 1) {
    const change = closes[cursor]! - closes[cursor - 1]!;
    if (change >= 0) gains += change;
    else losses -= change;
  }
  if (losses === 0) return gains === 0 ? 50 : 100;
  return 100 - 100 / (1 + gains / losses);
}

function annualizedVolatility(
  closes: number[],
  index: number
): number | undefined {
  const start = Math.max(1, index - 19);
  const returns: number[] = [];
  for (let cursor = start; cursor <= index; cursor += 1) {
    const previous = closes[cursor - 1];
    const current = closes[cursor];
    if (previous && current !== undefined) returns.push(current / previous - 1);
  }
  const mean = average(returns);
  if (mean === undefined || returns.length < 2) return undefined;
  const variance =
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

function directionalSeries(bars: PriceBar[], period: number) {
  const plusDi: Array<number | undefined> = Array.from(
    { length: bars.length },
    () => undefined
  );
  const minusDi: Array<number | undefined> = Array.from(
    { length: bars.length },
    () => undefined
  );
  const dx: Array<number | undefined> = Array.from(
    { length: bars.length },
    () => undefined
  );
  const adx: Array<number | undefined> = Array.from(
    { length: bars.length },
    () => undefined
  );
  const trueRanges: number[] = Array.from({ length: bars.length }, () => 0);
  const plusMoves: number[] = Array.from({ length: bars.length }, () => 0);
  const minusMoves: number[] = Array.from({ length: bars.length }, () => 0);
  for (let index = 1; index < bars.length; index += 1) {
    const current = bars[index]!;
    const previous = bars[index - 1]!;
    trueRanges[index] = Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close)
    );
    const upMove = current.high - previous.high;
    const downMove = previous.low - current.low;
    plusMoves[index] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusMoves[index] = downMove > upMove && downMove > 0 ? downMove : 0;
    if (index < period) continue;
    const first = index - period + 1;
    const tr = average(trueRanges.slice(first, index + 1));
    const plus = average(plusMoves.slice(first, index + 1));
    const minus = average(minusMoves.slice(first, index + 1));
    if (!tr || plus === undefined || minus === undefined) continue;
    plusDi[index] = (plus / tr) * 100;
    minusDi[index] = (minus / tr) * 100;
    const denominator = plusDi[index]! + minusDi[index]!;
    dx[index] =
      denominator === 0
        ? 0
        : (Math.abs(plusDi[index]! - minusDi[index]!) / denominator) * 100;
    const recentDx = dx
      .slice(Math.max(0, index - period + 1), index + 1)
      .filter((value): value is number => value !== undefined);
    if (recentDx.length === period) adx[index] = average(recentDx);
  }
  return { plusDi, minusDi, adx };
}

export function computeQuantIndicators(bars: PriceBar[]): QuantIndicatorRow[] {
  if (!bars.length) return [];
  const closes = bars.map((bar) => bar.close);
  const highs = bars.map((bar) => bar.high);
  const lows = bars.map((bar) => bar.low);
  const volumes = bars.map((bar) => bar.volume ?? 0);
  const typicalPrices = bars.map((bar) => (bar.high + bar.low + bar.close) / 3);
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const macd = closes.map((_close, index) =>
    ema12[index] !== undefined && ema26[index] !== undefined
      ? ema12[index]! - ema26[index]!
      : undefined
  );
  const macdSignal = optionalEmaSeries(macd, 9);
  const directional = directionalSeries(bars, 14);
  const rows: QuantIndicatorRow[] = [];
  let obv = 0;
  let previousK: number | undefined;
  let previousD: number | undefined;

  for (let index = 0; index < bars.length; index += 1) {
    if (index > 0) {
      if (closes[index]! > closes[index - 1]!) obv += volumes[index]!;
      else if (closes[index]! < closes[index - 1]!) obv -= volumes[index]!;
    }
    const sma5 = smaAt(closes, index, 5);
    const sma10 = smaAt(closes, index, 10);
    const sma20 = smaAt(closes, index, 20);
    const sma60 = smaAt(closes, index, 60);
    const deviation20 = stddevAt(closes, index, 20);
    const bollingerUpper =
      sma20 !== undefined && deviation20 !== undefined
        ? sma20 + 2 * deviation20
        : undefined;
    const bollingerLower =
      sma20 !== undefined && deviation20 !== undefined
        ? sma20 - 2 * deviation20
        : undefined;
    const bollingerPercentB =
      bollingerUpper !== undefined &&
      bollingerLower !== undefined &&
      bollingerUpper !== bollingerLower
        ? ((closes[index]! - bollingerLower) /
            (bollingerUpper - bollingerLower)) *
          100
        : undefined;
    let kdjK: number | undefined;
    let kdjD: number | undefined;
    let kdjJ: number | undefined;
    if (index >= 8) {
      const highest9 = Math.max(...highs.slice(index - 8, index + 1));
      const lowest9 = Math.min(...lows.slice(index - 8, index + 1));
      const rsv =
        highest9 === lowest9
          ? 50
          : ((closes[index]! - lowest9) / (highest9 - lowest9)) * 100;
      kdjK =
        previousK === undefined ? rsv : (2 / 3) * previousK + (1 / 3) * rsv;
      kdjD =
        previousD === undefined ? kdjK : (2 / 3) * previousD + (1 / 3) * kdjK;
      kdjJ = 3 * kdjK - 2 * kdjD;
      previousK = kdjK;
      previousD = kdjD;
    }
    let williamsR: number | undefined;
    if (index >= 13) {
      const highest14 = Math.max(...highs.slice(index - 13, index + 1));
      const lowest14 = Math.min(...lows.slice(index - 13, index + 1));
      williamsR =
        highest14 === lowest14
          ? undefined
          : (-100 * (highest14 - closes[index]!)) / (highest14 - lowest14);
    }
    const typicalWindow = windowAt(typicalPrices, index, 20);
    const typicalMean = typicalWindow ? average(typicalWindow) : undefined;
    const meanDeviation =
      typicalWindow && typicalMean !== undefined
        ? average(typicalWindow.map((value) => Math.abs(value - typicalMean)))
        : undefined;
    const cci20 =
      typicalMean !== undefined && meanDeviation
        ? (typicalPrices[index]! - typicalMean) / (0.015 * meanDeviation)
        : undefined;
    const volumeMa5 = smaAt(volumes, index, 5);
    const volumeMa10 = smaAt(volumes, index, 10);
    const volumeMa20 = smaAt(volumes, index, 20);
    const currentMacd = macd[index];
    const currentSignal = macdSignal[index];
    const trend =
      sma5 !== undefined && sma20 !== undefined
        ? sma5 > sma20 && closes[index]! > sma20
          ? "bullish"
          : sma5 < sma20 && closes[index]! < sma20
            ? "bearish"
            : "neutral"
        : "neutral";
    const row: QuantIndicatorRow = {
      time: bars[index]!.time,
      obv: round(obv),
      trend,
    };
    const optional: Array<[keyof QuantIndicatorRow, number | undefined]> = [
      ["sma5", sma5],
      ["sma10", sma10],
      ["sma20", sma20],
      ["sma60", sma60],
      [
        "maWidthPercent",
        sma5 !== undefined && sma20
          ? ((sma5 - sma20) / sma20) * 100
          : undefined,
      ],
      ["rsi14", rsiAt(closes, index, 14)],
      ["macd", currentMacd],
      ["macdSignal", currentSignal],
      [
        "macdHistogram",
        currentMacd !== undefined && currentSignal !== undefined
          ? currentMacd - currentSignal
          : undefined,
      ],
      ["bollingerUpper", bollingerUpper],
      ["bollingerMiddle", sma20],
      ["bollingerLower", bollingerLower],
      ["bollingerPercentB", bollingerPercentB],
      ["kdjK", kdjK],
      ["kdjD", kdjD],
      ["kdjJ", kdjJ],
      ["williamsR", williamsR],
      ["cci20", cci20],
      ["adx14", directional.adx[index]],
      ["plusDi14", directional.plusDi[index]],
      ["minusDi14", directional.minusDi[index]],
      ["volumeMa5", volumeMa5],
      ["volumeMa10", volumeMa10],
      [
        "forceIndex",
        index > 0
          ? (closes[index]! - closes[index - 1]!) * volumes[index]!
          : undefined,
      ],
      [
        "volumeRatio",
        volumeMa5 !== undefined && volumeMa20
          ? volumeMa5 / volumeMa20
          : undefined,
      ],
      ["volatilityAnnualized", annualizedVolatility(closes, index)],
    ];
    for (const [key, value] of optional) {
      if (value !== undefined)
        (row as unknown as Record<string, unknown>)[key] = round(value);
    }
    rows.push(row);
  }
  return rows;
}

export function latestIndicator(
  rows: QuantIndicatorRow[]
): QuantIndicatorRow | undefined {
  return rows.at(-1);
}
