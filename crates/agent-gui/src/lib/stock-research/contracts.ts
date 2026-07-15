export type AsyncResource<T> =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; data: T }
  | { state: "error"; message: string };

export function isStockResultStatus(
  value: unknown
): value is "ok" | "partial" | "unavailable" {
  return value === "ok" || value === "partial" || value === "unavailable";
}

export function normalizeWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0
  );
}

export function formatStockError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "股票服务暂时不可用，请稍后重试。";
}

export function sanitizeCsvFileName(value: string): string {
  const normalized = Array.from(value.trim(), (character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || '<>:"/\\|?*'.includes(character) ? "-" : character;
  }).join("");
  return normalized || "calen-portfolio.csv";
}

export function parseFiniteNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildSparklinePath(
  values: readonly number[],
  width: number,
  height: number
): string {
  if (values.length === 0 || width <= 0 || height <= 0) return "";
  const finiteValues = values.filter(Number.isFinite);
  if (finiteValues.length !== values.length) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const xStep = values.length === 1 ? 0 : width / (values.length - 1);
  return values
    .map((value, index) => {
      const x = index * xStep;
      const y = height - ((value - min) / range) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}
