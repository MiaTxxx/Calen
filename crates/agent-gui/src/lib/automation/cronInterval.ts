// Helpers that map a user-facing "every N units" interval to the six-field
// cron expression the automation scheduler understands (sec min hour day month weekday).
// This is a pure UI/compile layer — the backend continues to store only `cron`.

export type CronIntervalUnit = "minutes" | "hours" | "days";

export type CronInterval = {
  value: number;
  unit: CronIntervalUnit;
};

export const CRON_INTERVAL_UNITS: CronIntervalUnit[] = ["minutes", "hours", "days"];

export const MIN_CRON_INTERVAL_VALUE = 1;
export const MAX_CRON_INTERVAL_VALUE = 999;

/** Build a six-field cron expression for "every N minutes/hours/days". */
export function intervalToCronExpression(interval: CronInterval): string {
  if (!Number.isFinite(interval.value) || !Number.isInteger(interval.value)) {
    throw new Error("Interval must be an integer");
  }
  const value = interval.value;
  if (value < MIN_CRON_INTERVAL_VALUE) {
    throw new Error(`Interval must be an integer >= ${MIN_CRON_INTERVAL_VALUE}`);
  }
  if (value > MAX_CRON_INTERVAL_VALUE) {
    throw new Error(`Interval must be <= ${MAX_CRON_INTERVAL_VALUE}`);
  }

  switch (interval.unit) {
    case "minutes":
      // Every N minutes, at second 0.
      return `0 */${value} * * * *`;
    case "hours":
      // Every N hours, at minute 0.
      return `0 0 */${value} * * *`;
    case "days":
      // Every N days, at 00:00:00.
      return `0 0 0 */${value} * *`;
    default:
      throw new Error(`Unsupported interval unit: ${String((interval as CronInterval).unit)}`);
  }
}

/**
 * Best-effort reverse parse of cron expressions produced by `intervalToCronExpression`.
 * Returns null for hand-written / non-interval expressions so the UI can fall back
 * to the advanced cron editor.
 */
export function parseIntervalFromCronExpression(expression: string): CronInterval | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 6) return null;
  const [sec, min, hour, day, month, weekday] = fields;
  if (sec !== "0" || month !== "*" || weekday !== "*") return null;

  const step = (field: string, starPrefix = true) => {
    const match = starPrefix ? /^\*\/(\d+)$/.exec(field) : null;
    if (!match) return null;
    const value = Number(match[1]);
    if (!Number.isSafeInteger(value) || value < MIN_CRON_INTERVAL_VALUE) return null;
    return value;
  };

  // every N minutes: 0 */N * * * *
  if (hour === "*" && day === "*") {
    const value = step(min);
    if (value != null) return { value, unit: "minutes" };
  }

  // every N hours: 0 0 */N * * *
  if (min === "0" && day === "*") {
    const value = step(hour);
    if (value != null) return { value, unit: "hours" };
  }

  // every N days: 0 0 0 */N * *
  if (min === "0" && hour === "0") {
    const value = step(day);
    if (value != null) return { value, unit: "days" };
  }

  return null;
}

export function formatCronIntervalLabel(
  interval: CronInterval,
  labels: { minutes: string; hours: string; days: string },
): string {
  const unitLabel =
    interval.unit === "minutes"
      ? labels.minutes
      : interval.unit === "hours"
        ? labels.hours
        : labels.days;
  return `${interval.value} ${unitLabel}`;
}
