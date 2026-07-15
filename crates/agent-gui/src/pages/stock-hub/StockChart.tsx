import { buildSparklinePath } from "../../lib/stock-research";
import { cn } from "../../lib/shared/utils";

export function StockChart(props: {
  values: readonly number[];
  height?: number;
  positive?: boolean;
  className?: string;
  label?: string;
}) {
  const {
    values,
    height = 180,
    positive = true,
    className,
    label = "价格走势",
  } = props;
  const width = 720;
  const path = buildSparklinePath(values, width, height - 24);

  if (!path) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-xl border border-dashed border-border/50 text-xs text-muted-foreground",
          className
        )}
        style={{ height }}
      >
        暂无可绘制的行情数据
      </div>
    );
  }

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
      <path
        d={`${path} L${width},${height} L0,${height} Z`}
        fill="url(#calen-stock-chart-fill)"
      />
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
