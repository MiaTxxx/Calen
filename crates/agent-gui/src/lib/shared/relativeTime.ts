// 轻量相对时间格式化：分钟/小时/天粒度用 Intl.RelativeTimeFormat，
// 超过 30 天回退到本地化日期。侧栏搜索结果与悬停预览共用。
export function formatRelativeTime(timestampMs: number, locale: string): string {
  const deltaMs = timestampMs - Date.now();
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "always" });
  const minutes = Math.round(deltaMs / 60_000);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(deltaMs / 3_600_000);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  const days = Math.round(deltaMs / 86_400_000);
  if (Math.abs(days) < 30) return formatter.format(days, "day");
  return new Date(timestampMs).toLocaleDateString(locale);
}
