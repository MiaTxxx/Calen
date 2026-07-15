import { simpleMovingAverage } from "./analytics.ts";
import type {
  BacktestTrade,
  PriceBar,
  StockBacktestRequest,
  StockBacktestResult,
} from "./types.ts";

const MAX_BARS = 2_000;

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function emptyResult(now: string, warnings: string[]): StockBacktestResult {
  return {
    status: "unavailable",
    sources: [],
    asOf: now,
    retrievedAt: now,
    cached: false,
    warnings,
    algorithm: { id: "calen.sma-cross", version: "1.0.0", parameters: {} },
    sample: { start: "", end: "", bars: 0, coverage: 0 },
    benchmark: { name: "buy-and-hold", returnPercent: 0 },
    metrics: { finalEquity: 0, returnPercent: 0, maxDrawdownPercent: 0 },
    trades: [],
    limitations: ["仅用于研究，不构成投资建议。"],
  };
}

export function runBacktest(
  request: StockBacktestRequest,
  inputBars: PriceBar[],
  now: string
): StockBacktestResult {
  const warnings: string[] = [];
  const initialCash = request.initialCash ?? 100_000;
  const feeRate = request.feeRate ?? 0.0003;
  if (!Number.isFinite(initialCash) || initialCash <= 0)
    return emptyResult(now, ["initialCash 必须是正的有限数"]);
  if (!Number.isFinite(feeRate) || feeRate < 0 || feeRate >= 1)
    return emptyResult(now, ["feeRate 必须在 [0, 1) 范围内"]);
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
      return emptyResult(now, [
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
  const shortWindow = request.strategy?.shortWindow ?? 5;
  const longWindow = request.strategy?.longWindow ?? 20;
  if (
    !Number.isInteger(shortWindow) ||
    !Number.isInteger(longWindow) ||
    shortWindow < 1 ||
    longWindow <= shortWindow
  ) {
    return emptyResult(now, ["策略参数必须满足 1 <= shortWindow < longWindow"]);
  }
  if (bars.length <= longWindow)
    return emptyResult(now, [`回测至少需要 ${longWindow + 1} 根 K 线`]);

  let cash = initialCash;
  let quantity = 0;
  let peak = initialCash;
  let maxDrawdown = 0;
  const trades: BacktestTrade[] = [];
  const closes = bars.map((bar) => bar.close);

  for (
    let signalIndex = longWindow - 1;
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
  }

  const first = bars[0]!;
  const last = bars.at(-1)!;
  const finalEquity = cash + quantity * last.close;
  const retrievedAt = now;
  return {
    status: "ok",
    sources: [
      {
        id: "calen-backtest",
        name: "Calen 回测引擎",
        provider: "calen-backtest",
        capability: "backtest",
        asOf: last.time,
        retrievedAt,
        cached: false,
      },
    ],
    asOf: last.time,
    retrievedAt,
    cached: false,
    warnings,
    algorithm: {
      id: "calen.sma-cross",
      version: "1.0.0",
      parameters: { shortWindow, longWindow, initialCash, feeRate },
    },
    sample: {
      start: first.time,
      end: last.time,
      bars: bars.length,
      coverage: 1,
    },
    benchmark: {
      name: "buy-and-hold",
      returnPercent: round((last.close / first.open - 1) * 100),
    },
    metrics: {
      finalEquity: round(finalEquity),
      returnPercent: round((finalEquity / initialCash - 1) * 100),
      maxDrawdownPercent: round(maxDrawdown * 100),
    },
    trades,
    limitations: [
      "信号仅使用当根及更早的收盘数据，并按下一根 K 线开盘价执行，避免未来函数。",
      "未模拟涨跌停、停牌、滑点、税费差异和成交量约束。",
      "实验性量化研究结果，不构成投资建议。",
    ],
  };
}

export { emptyResult as unavailableBacktestResult };
