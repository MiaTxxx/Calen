import {
  type CandlestickData,
  CandlestickSeries,
  ColorType,
  createChart,
  type LineData,
  LineSeries,
  type Time,
} from "lightweight-charts";
import { useEffect, useMemo, useRef } from "react";

import { cn } from "../../lib/shared/utils";
import { buildSparklinePath } from "../../lib/stock-research";

export type StockChartBar = {
  time: string;
  open?: number;
  high?: number;
  low?: number;
  close: number;
};

export type StockChartPoint = {
  // 字符串为 "YYYY-MM-DD" 业务日；数字为 UNIX 秒时间戳（分时等日内数据）。
  time: string | number;
  value: number;
};

function candleData(bars: readonly StockChartBar[]): CandlestickData<Time>[] {
  return bars.flatMap((bar) => {
    if (
      !bar.time ||
      bar.open === undefined ||
      bar.high === undefined ||
      bar.low === undefined ||
      ![bar.open, bar.high, bar.low, bar.close].every(Number.isFinite)
    ) {
      return [];
    }
    return [
      {
        time: bar.time as Time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      },
    ];
  });
}

function lineData(points: readonly StockChartPoint[]): LineData<Time>[] {
  return points.flatMap((point) =>
    (typeof point.time === "number" ? Number.isFinite(point.time) : point.time) &&
    Number.isFinite(point.value)
      ? [{ time: point.time as Time, value: point.value }]
      : [],
  );
}

function CandlestickChart(props: {
  data: readonly CandlestickData<Time>[];
  height: number;
  className?: string;
  label: string;
}) {
  const { data, height, className, label } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const styles = getComputedStyle(document.documentElement);
    const foreground = styles.getPropertyValue("--foreground").trim() || "#71717a";
    const border = styles.getPropertyValue("--border").trim() || "#d4d4d8";
    const chart = createChart(host, {
      width: Math.max(host.clientWidth, 1),
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: foreground,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: border },
        horzLines: { color: border },
      },
      rightPriceScale: { borderColor: border },
      timeScale: { borderColor: border, timeVisible: false },
      localization: { locale: "zh-CN" },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#dc2626",
      downColor: "#059669",
      borderUpColor: "#dc2626",
      borderDownColor: "#059669",
      wickUpColor: "#dc2626",
      wickDownColor: "#059669",
    });
    series.setData([...data]);
    chart.timeScale().fitContent();
    const resize = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width && Number.isFinite(width)) chart.applyOptions({ width, height });
    });
    resize.observe(host);
    return () => {
      resize.disconnect();
      chart.remove();
    };
  }, [data, height]);

  return (
    <div
      ref={hostRef}
      role="img"
      aria-label={label}
      className={cn("w-full overflow-hidden rounded-xl", className)}
      style={{ height }}
    />
  );
}

function TimeSeriesChart(props: {
  data: readonly LineData<Time>[];
  height: number;
  positive: boolean;
  className?: string;
  label: string;
  timeVisible?: boolean;
}) {
  const { data, height, positive, className, label, timeVisible = false } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const styles = getComputedStyle(document.documentElement);
    const foreground = styles.getPropertyValue("--foreground").trim() || "#71717a";
    const border = styles.getPropertyValue("--border").trim() || "#d4d4d8";
    const chart = createChart(host, {
      width: Math.max(host.clientWidth, 1),
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: foreground,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: border },
        horzLines: { color: border },
      },
      rightPriceScale: { borderColor: border },
      timeScale: { borderColor: border, timeVisible, secondsVisible: false },
      localization: { locale: "zh-CN" },
    });
    const series = chart.addSeries(LineSeries, {
      color: positive ? "#dc2626" : "#059669",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
    });
    series.setData([...data]);
    chart.timeScale().fitContent();
    const resize = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width && Number.isFinite(width)) chart.applyOptions({ width, height });
    });
    resize.observe(host);
    return () => {
      resize.disconnect();
      chart.remove();
    };
  }, [data, height, positive]);

  return (
    <div
      ref={hostRef}
      role="img"
      aria-label={label}
      className={cn("w-full overflow-hidden rounded-xl", className)}
      style={{ height }}
    />
  );
}

function SparklineChart(props: {
  values: readonly number[];
  height: number;
  positive: boolean;
  className?: string;
  label: string;
}) {
  const { values, height, positive, className, label } = props;
  const width = 720;
  const path = buildSparklinePath(values, width, height - 24);
  const color = positive ? "hsl(0 68% 52%)" : "hsl(155 56% 38%)";
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className={cn("w-full overflow-visible", className)}
      style={{ height }}
    >
      <defs>
        <linearGradient id="calen-stock-chart-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((ratio) => (
        <line
          key={ratio}
          x1="0"
          x2={width}
          y1={height * ratio}
          y2={height * ratio}
          stroke="currentColor"
          strokeOpacity="0.08"
        />
      ))}
      <path d={`${path} L${width},${height} L0,${height} Z`} fill="url(#calen-stock-chart-fill)" />
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth="2.2"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function StockChart(props: {
  values?: readonly number[];
  bars?: readonly StockChartBar[];
  points?: readonly StockChartPoint[];
  height?: number;
  positive?: boolean;
  className?: string;
  label?: string;
  // 日内数据（分时）需要在时间轴上显示时刻。
  timeVisible?: boolean;
}) {
  const {
    values = [],
    bars = [],
    points = [],
    height = 180,
    positive = true,
    className,
    label = "价格走势",
    timeVisible = false,
  } = props;
  const candles = useMemo(() => candleData(bars), [bars]);
  const line = useMemo(() => lineData(points), [points]);

  if (candles.length) {
    return <CandlestickChart data={candles} height={height} className={className} label={label} />;
  }

  if (line.length) {
    return (
      <TimeSeriesChart
        data={line}
        height={height}
        positive={positive}
        className={className}
        label={label}
        timeVisible={timeVisible}
      />
    );
  }

  const path = buildSparklinePath(values, 720, height - 24);
  if (!path) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-xl border border-dashed border-border/50 text-xs text-muted-foreground",
          className,
        )}
        style={{ height }}
      >
        暂无可绘制的行情数据
      </div>
    );
  }

  return (
    <SparklineChart
      values={values}
      height={height}
      positive={positive}
      className={className}
      label={label}
    />
  );
}
