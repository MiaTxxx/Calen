import { simpleMovingAverage } from "./analytics.ts";
import { computeQuantIndicators } from "./quant/indicators.ts";
import {
  STRATEGY_ALGORITHM_VERSION,
  analyzeStrategies,
  fuseSignals,
} from "./quant/strategies.ts";
import type {
  BacktestEquityPoint,
  BacktestSampleWindow,
  BacktestTrade,
  EvidenceStatus,
  PriceBar,
  QuantStrategyId,
  StockBacktestRequest,
  StockBacktestResult,
  StockBacktestStrategyId,
} from "./types.ts";

const MAX_BARS = 2_000;
const DEFAULT_EVALUATION_RATIO = 0.3;
const MIN_EVALUATION_RATIO = 0.1;
const MAX_EVALUATION_RATIO = 0.8;
const MIN_EVALUATION_BARS = 2;
const QUANT_CALIBRATION_BARS = 20;
const SEVERE_COVERAGE_THRESHOLD = 0.5;
const BACKTEST_ALGORITHM_VERSION = "2.0.0";

const QUANT_STRATEGY_IDS = new Set<QuantStrategyId>([
  "trend",
  "mean-reversion",
  "breakout",
  "momentum",
  "volume-price",
]);

interface CoverageEstimate {
  coverage: number;
  warnings: string[];
}

interface BacktestSplit {
  evaluationBars: PriceBar[];
  evaluationStartIndex: number;
  sample: StockBacktestResult["sample"];
  effectiveCoverage: number;
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function dayKey(value: string): string {
  return value.slice(0, 10);
}

function parseDay(value: string): Date | undefined {
  const day = dayKey(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  const date = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function isWeekday(date: Date): boolean {
  const day = date.getUTCDay();
  return day !== 0 && day !== 6;
}

function countWeekdaysInclusive(start: string, end: string): number {
  const first = parseDay(start);
  const last = parseDay(end);
  if (!first || !last || first > last) return 0;
  const spanDays = Math.floor((last.getTime() - first.getTime()) / 86_400_000);
  if (spanDays > 3_660) return Math.round((spanDays + 1) * (5 / 7));
  let count = 0;
  for (
    let date = first;
    date <= last;
    date = new Date(date.getTime() + 86_400_000)
  ) {
    if (isWeekday(date)) count += 1;
  }
  return count;
}

function coverageForRange(
  start: string,
  end: string,
  bars: readonly PriceBar[]
): number {
  const expected = countWeekdaysInclusive(start, end);
  if (expected <= 0) return 0;
  const observed = new Set(
    bars
      .map((bar) => dayKey(bar.time))
      .filter((day) => {
        const parsed = parseDay(day);
        return parsed !== undefined && isWeekday(parsed);
      })
  ).size;
  return round(Math.min(1, observed / expected));
}

function estimateCoverage(
  request: StockBacktestRequest,
  bars: PriceBar[]
): CoverageEstimate {
  if (!bars.length) return { coverage: 0, warnings: [] };
  const first = request.start ?? bars[0]!.time;
  const last = request.end ?? bars.at(-1)!.time;
  const expected = countWeekdaysInclusive(first, last);
  if (expected <= 0)
    return {
      coverage: 0,
      warnings: ["无法按日期估算回测数据覆盖率：请求区间不是有效的日线范围"],
    };
  const coverage = coverageForRange(first, last, bars);
  const observed = Math.round(expected * coverage);
  const warnings = ["数据覆盖率按工作日估算，未使用交易所节假日日历。"];
  if (coverage < 1)
    warnings.push(
      `回测样本估算缺少 ${Math.max(0, expected - observed)} 个工作日数据（请求区间 ${dayKey(first)} 至 ${dayKey(last)}）`
    );
  return { coverage, warnings };
}

function emptyWindow(): BacktestSampleWindow {
  return { start: "", end: "", bars: 0, coverage: 0 };
}

function emptySample(): StockBacktestResult["sample"] {
  return {
    ...emptyWindow(),
    calibration: emptyWindow(),
    evaluation: emptyWindow(),
  };
}

function strategyIdFor(
  request: StockBacktestRequest
): StockBacktestStrategyId | string {
  return request.strategy?.id ?? "sma-cross";
}

function algorithmFor(request: StockBacktestRequest) {
  const strategyId = strategyIdFor(request);
  const initialCash = request.initialCash ?? 100_000;
  const feeRate = request.feeRate ?? 0.0003;
  const evaluationRatio = request.evaluationRatio ?? DEFAULT_EVALUATION_RATIO;
  const parameters: Record<string, unknown> = {
    strategyId,
    initialCash,
    feeRate,
    evaluationRatio,
  };
  if (strategyId === "sma-cross") {
    parameters.shortWindow = request.strategy?.shortWindow ?? 5;
    parameters.longWindow = request.strategy?.longWindow ?? 20;
  } else {
    parameters.signalAlgorithmVersion = STRATEGY_ALGORITHM_VERSION;
    for (const [key, value] of Object.entries(request.strategy ?? {})) {
      if (key !== "id" && value !== undefined) parameters[key] = value;
    }
  }
  return {
    id:
      strategyId === "sma-cross"
        ? "calen.sma-cross"
        : `calen.strategy.${strategyId}`,
    version: BACKTEST_ALGORITHM_VERSION,
    parameters,
  };
}

function unavailableResult(
  request: StockBacktestRequest,
  now: string,
  warnings: string[],
  sample: StockBacktestResult["sample"] = emptySample()
): StockBacktestResult {
  return {
    status: "unavailable",
    ...(request.instrument ? { instrument: request.instrument } : {}),
    sources: [],
    asOf: sample.evaluation.end || now,
    retrievedAt: now,
    cached: false,
    warnings,
    algorithm: algorithmFor(request),
    sample,
    benchmark: { name: "buy-and-hold", returnPercent: 0 },
    metrics: { finalEquity: 0, returnPercent: 0, maxDrawdownPercent: 0 },
    trades: [],
    equityCurve: [],
    limitations: ["仅用于研究，不构成投资建议。"],
  };
}

function makeSampleWindow(
  bars: PriceBar[],
  coverageStart?: string,
  coverageEnd?: string
): BacktestSampleWindow {
  const first = bars[0];
  const last = bars.at(-1);
  if (!first || !last) return emptyWindow();
  return {
    start: first.time,
    end: last.time,
    bars: bars.length,
    coverage: coverageForRange(
      coverageStart ?? first.time,
      coverageEnd ?? last.time,
      bars
    ),
  };
}

function splitSample(
  request: StockBacktestRequest,
  bars: PriceBar[],
  coverage: CoverageEstimate,
  requiredCalibrationBars: number
): { split?: BacktestSplit; warning?: string } {
  const evaluationRatio = request.evaluationRatio ?? DEFAULT_EVALUATION_RATIO;
  const evaluationBarsCount = Math.max(
    MIN_EVALUATION_BARS,
    Math.ceil(bars.length * evaluationRatio)
  );
  const calibrationBarsCount = bars.length - evaluationBarsCount;
  if (calibrationBarsCount < requiredCalibrationBars) {
    return {
      warning:
        `时间切分后校准/预热区间只有 ${calibrationBarsCount} 根 K 线，` +
        `当前策略至少需要 ${requiredCalibrationBars} 根；请扩大样本或降低 evaluationRatio`,
    };
  }
  const calibrationBars = bars.slice(0, calibrationBarsCount);
  const evaluationBars = bars.slice(calibrationBarsCount);
  if (evaluationBars.length < MIN_EVALUATION_BARS) {
    return { warning: "样本外评估区间至少需要 2 根 K 线" };
  }
  const calibration = makeSampleWindow(
    calibrationBars,
    request.start,
    calibrationBars.at(-1)!.time
  );
  const evaluation = makeSampleWindow(
    evaluationBars,
    evaluationBars[0]!.time,
    request.end
  );
  const sample: StockBacktestResult["sample"] = {
    start: bars[0]!.time,
    end: bars.at(-1)!.time,
    bars: bars.length,
    coverage: coverage.coverage,
    calibration,
    evaluation,
  };
  return {
    split: {
      evaluationBars,
      evaluationStartIndex: calibrationBarsCount,
      sample,
      effectiveCoverage: Math.min(
        coverage.coverage,
        calibration.coverage,
        evaluation.coverage
      ),
    },
  };
}

function statusForCoverage(coverage: number): EvidenceStatus {
  if (coverage < SEVERE_COVERAGE_THRESHOLD) return "unavailable";
  if (coverage < 1) return "partial";
  return "ok";
}

function recordEquity(
  curve: BacktestEquityPoint[],
  time: string,
  equity: number
): void {
  curve.push({ time, equity: round(equity) });
}

function resultEnvelope(
  request: StockBacktestRequest,
  now: string,
  status: Exclude<EvidenceStatus, "unavailable">,
  warnings: string[],
  sample: StockBacktestResult["sample"],
  benchmarkReturnPercent: number,
  finalEquity: number,
  maxDrawdown: number,
  trades: BacktestTrade[],
  equityCurve: BacktestEquityPoint[]
): StockBacktestResult {
  const last = sample.evaluation.end;
  const initialCash = request.initialCash ?? 100_000;
  return {
    status,
    ...(request.instrument ? { instrument: request.instrument } : {}),
    sources: [
      {
        id: "calen-backtest",
        name: "Calen 回测引擎",
        provider: "calen-backtest",
        capability: "backtest",
        asOf: last,
        retrievedAt: now,
        cached: false,
      },
    ],
    asOf: last,
    retrievedAt: now,
    cached: false,
    warnings,
    algorithm: algorithmFor(request),
    sample,
    benchmark: {
      name: "buy-and-hold",
      returnPercent: round(benchmarkReturnPercent),
    },
    metrics: {
      finalEquity: round(finalEquity),
      returnPercent: round((finalEquity / initialCash - 1) * 100),
      maxDrawdownPercent: round(maxDrawdown * 100),
    },
    trades,
    equityCurve,
    limitations: [
      "前段数据仅用于校准和指标预热；收益、基准、回撤、交易与权益曲线仅统计后段样本外评估区间。",
      "策略信号只使用当根及更早的 K 线，并按下一根 K 线开盘价执行，避免未来函数。",
      "未模拟涨跌停、停牌、滑点、税费差异和成交量约束。",
      "数据覆盖率按工作日估算，未使用交易所节假日日历；缺口可能包含合法休市日。",
      "实验性量化研究结果，不构成投资建议。",
    ],
  };
}

function runQuantStrategyBacktest(
  request: StockBacktestRequest,
  bars: PriceBar[],
  split: BacktestSplit,
  now: string,
  status: Exclude<EvidenceStatus, "unavailable">,
  warnings: string[],
  strategyId: QuantStrategyId | "fused"
): StockBacktestResult {
  const initialCash = request.initialCash ?? 100_000;
  const feeRate = request.feeRate ?? 0.0003;
  const indicators = computeQuantIndicators(bars);
  let cash = initialCash;
  let quantity = 0;
  let peak = initialCash;
  let maxDrawdown = 0;
  const trades: BacktestTrade[] = [];
  const equityCurve: BacktestEquityPoint[] = [];
  const firstEvaluationBar = split.evaluationBars[0]!;
  recordEquity(equityCurve, firstEvaluationBar.time, initialCash);

  for (
    let signalIndex = split.evaluationStartIndex;
    signalIndex < bars.length - 1;
    signalIndex += 1
  ) {
    const strategySignals =
      strategyId === "fused"
        ? analyzeStrategies({ bars, indicators, index: signalIndex })
        : analyzeStrategies({ bars, indicators, index: signalIndex }, [
            strategyId,
          ]);
    const verdict =
      strategyId === "fused"
        ? fuseSignals(strategySignals).verdict
        : strategySignals.some((item) => item.direction === "BUY")
          ? "BUY"
          : strategySignals.some((item) => item.direction === "SELL")
            ? "SELL"
            : "HOLD";
    const signalBar = bars[signalIndex]!;
    const executionBar = bars[signalIndex + 1]!;
    if (quantity === 0 && verdict === "BUY") {
      const unitCost = executionBar.open * (1 + feeRate);
      const bought = Math.floor(cash / unitCost);
      if (bought > 0) {
        const fee = bought * executionBar.open * feeRate;
        cash -= bought * executionBar.open + fee;
        quantity = bought;
        trades.push({
          side: "buy",
          signalTime: signalBar.time,
          executionTime: executionBar.time,
          price: executionBar.open,
          quantity: bought,
          fee: round(fee),
        });
      }
    } else if (quantity > 0 && verdict === "SELL") {
      const fee = quantity * executionBar.open * feeRate;
      cash += quantity * executionBar.open - fee;
      trades.push({
        side: "sell",
        signalTime: signalBar.time,
        executionTime: executionBar.time,
        price: executionBar.open,
        quantity,
        fee: round(fee),
      });
      quantity = 0;
    }
    const equity = cash + quantity * executionBar.close;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(
      maxDrawdown,
      peak === 0 ? 0 : (peak - equity) / peak
    );
    recordEquity(equityCurve, executionBar.time, equity);
  }

  const lastEvaluationBar = split.evaluationBars.at(-1)!;
  const finalEquity = cash + quantity * lastEvaluationBar.close;
  return resultEnvelope(
    request,
    now,
    status,
    warnings,
    split.sample,
    (lastEvaluationBar.close / firstEvaluationBar.open - 1) * 100,
    finalEquity,
    maxDrawdown,
    trades,
    equityCurve
  );
}

function runSmaBacktest(
  request: StockBacktestRequest,
  bars: PriceBar[],
  split: BacktestSplit,
  now: string,
  status: Exclude<EvidenceStatus, "unavailable">,
  warnings: string[]
): StockBacktestResult {
  const initialCash = request.initialCash ?? 100_000;
  const feeRate = request.feeRate ?? 0.0003;
  const shortWindow = request.strategy?.shortWindow ?? 5;
  const longWindow = request.strategy?.longWindow ?? 20;
  let cash = initialCash;
  let quantity = 0;
  let peak = initialCash;
  let maxDrawdown = 0;
  const trades: BacktestTrade[] = [];
  const equityCurve: BacktestEquityPoint[] = [];
  const closes = bars.map((bar) => bar.close);
  const firstEvaluationBar = split.evaluationBars[0]!;
  recordEquity(equityCurve, firstEvaluationBar.time, initialCash);

  for (
    let signalIndex = split.evaluationStartIndex;
    signalIndex < bars.length - 1;
    signalIndex += 1
  ) {
    const previous = closes.slice(0, signalIndex);
    const current = closes.slice(0, signalIndex + 1);
    const previousShort = simpleMovingAverage(previous, shortWindow);
    const previousLong = simpleMovingAverage(previous, longWindow);
    const currentShort = simpleMovingAverage(current, shortWindow);
    const currentLong = simpleMovingAverage(current, longWindow);
    if (
      [previousShort, previousLong, currentShort, currentLong].some(
        (value) => value === undefined
      )
    )
      continue;
    const signalBar = bars[signalIndex]!;
    const executionBar = bars[signalIndex + 1]!;
    if (
      quantity === 0 &&
      previousShort! <= previousLong! &&
      currentShort! > currentLong!
    ) {
      const unitCost = executionBar.open * (1 + feeRate);
      const bought = Math.floor(cash / unitCost);
      if (bought > 0) {
        const fee = bought * executionBar.open * feeRate;
        cash -= bought * executionBar.open + fee;
        quantity = bought;
        trades.push({
          side: "buy",
          signalTime: signalBar.time,
          executionTime: executionBar.time,
          price: executionBar.open,
          quantity: bought,
          fee: round(fee),
        });
      }
    } else if (
      quantity > 0 &&
      previousShort! >= previousLong! &&
      currentShort! < currentLong!
    ) {
      const fee = quantity * executionBar.open * feeRate;
      cash += quantity * executionBar.open - fee;
      trades.push({
        side: "sell",
        signalTime: signalBar.time,
        executionTime: executionBar.time,
        price: executionBar.open,
        quantity,
        fee: round(fee),
      });
      quantity = 0;
    }
    const equity = cash + quantity * executionBar.close;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(
      maxDrawdown,
      peak === 0 ? 0 : (peak - equity) / peak
    );
    recordEquity(equityCurve, executionBar.time, equity);
  }

  const lastEvaluationBar = split.evaluationBars.at(-1)!;
  const finalEquity = cash + quantity * lastEvaluationBar.close;
  return resultEnvelope(
    request,
    now,
    status,
    warnings,
    split.sample,
    (lastEvaluationBar.close / firstEvaluationBar.open - 1) * 100,
    finalEquity,
    maxDrawdown,
    trades,
    equityCurve
  );
}

export function runBacktest(
  request: StockBacktestRequest,
  inputBars: PriceBar[],
  now: string
): StockBacktestResult {
  const warnings: string[] = [];
  const initialCash = request.initialCash ?? 100_000;
  const feeRate = request.feeRate ?? 0.0003;
  const evaluationRatio = request.evaluationRatio ?? DEFAULT_EVALUATION_RATIO;
  if (!Number.isFinite(initialCash) || initialCash <= 0)
    return unavailableResult(request, now, ["initialCash 必须是正的有限数"]);
  if (!Number.isFinite(feeRate) || feeRate < 0 || feeRate >= 1)
    return unavailableResult(request, now, ["feeRate 必须在 [0, 1) 范围内"]);
  if (
    !Number.isFinite(evaluationRatio) ||
    evaluationRatio < MIN_EVALUATION_RATIO ||
    evaluationRatio > MAX_EVALUATION_RATIO
  )
    return unavailableResult(request, now, [
      `evaluationRatio 必须在 [${MIN_EVALUATION_RATIO}, ${MAX_EVALUATION_RATIO}] 范围内`,
    ]);

  const seenTimes = new Set<string>();
  for (const bar of inputBars) {
    const prices = [bar.open, bar.high, bar.low, bar.close];
    if (
      !bar.time ||
      seenTimes.has(bar.time) ||
      prices.some((price) => !Number.isFinite(price) || price <= 0) ||
      bar.high < Math.max(bar.open, bar.close) ||
      bar.low > Math.min(bar.open, bar.close) ||
      bar.high < bar.low
    ) {
      return unavailableResult(request, now, [
        "K 线必须具有唯一时间、正的有限 OHLC，且 high/low 边界合法",
      ]);
    }
    seenTimes.add(bar.time);
  }

  let bars = [...inputBars]
    .filter(
      (bar) =>
        (!request.start || bar.time >= request.start) &&
        (!request.end || bar.time <= request.end)
    )
    .sort((left, right) => left.time.localeCompare(right.time));
  if (bars.length > MAX_BARS) {
    bars = bars.slice(-MAX_BARS);
    warnings.push(`历史数据已限制为最近 ${MAX_BARS} 根 K 线`);
  }

  const strategyId = strategyIdFor(request);
  const shortWindow = request.strategy?.shortWindow ?? 5;
  const longWindow = request.strategy?.longWindow ?? 20;
  let requiredCalibrationBars: number;
  if (strategyId === "sma-cross") {
    if (
      !Number.isInteger(shortWindow) ||
      !Number.isInteger(longWindow) ||
      shortWindow < 1 ||
      longWindow <= shortWindow
    )
      return unavailableResult(request, now, [
        "策略参数必须满足 1 <= shortWindow < longWindow",
      ]);
    requiredCalibrationBars = longWindow;
  } else if (
    strategyId === "fused" ||
    QUANT_STRATEGY_IDS.has(strategyId as QuantStrategyId)
  ) {
    requiredCalibrationBars = QUANT_CALIBRATION_BARS;
  } else {
    return unavailableResult(request, now, [`未知回测策略：${strategyId}`]);
  }

  const coverage = estimateCoverage(request, bars);
  warnings.push(...coverage.warnings);
  const splitResult = splitSample(
    request,
    bars,
    coverage,
    requiredCalibrationBars
  );
  if (!splitResult.split)
    return unavailableResult(request, now, [
      ...warnings,
      splitResult.warning ?? "无法切分回测样本",
    ]);
  const split = splitResult.split;
  const status = statusForCoverage(split.effectiveCoverage);
  if (status === "unavailable")
    return unavailableResult(
      request,
      now,
      [
        ...warnings,
        `数据覆盖率 ${round(split.effectiveCoverage * 100, 2)}% 严重不足，未生成回测指标`,
      ],
      split.sample
    );
  if (status === "partial")
    warnings.push(
      `数据覆盖率 ${round(split.effectiveCoverage * 100, 2)}%，回测结果仅部分可用`
    );

  if (strategyId === "sma-cross")
    return runSmaBacktest(request, bars, split, now, status, warnings);
  return runQuantStrategyBacktest(
    request,
    bars,
    split,
    now,
    status,
    warnings,
    strategyId as QuantStrategyId | "fused"
  );
}

export function unavailableBacktestResult(
  now: string,
  warnings: string[],
  request: StockBacktestRequest = {}
): StockBacktestResult {
  return unavailableResult(request, now, warnings);
}
