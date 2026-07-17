export function strictFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}
