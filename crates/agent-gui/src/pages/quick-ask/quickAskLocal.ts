import { type Locale, normalizeLocale } from "../../i18n";
import { normalizeTheme, resolveEffectiveTheme, type Theme } from "../../lib/settings";

// 快捷提问相关窗口与主窗口同源，直接读主窗口写入的本地 UI 设置，
// 保证语言/主题一致；键名与 lib/settings/storage.ts 保持同步。
const LOCAL_UI_SETTINGS_STORAGE_KEY = "liveagent.ui-settings.v1";

function readLocalUiSettings(): { locale?: unknown; theme?: unknown } {
  try {
    const raw = localStorage.getItem(LOCAL_UI_SETTINGS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as { locale?: unknown; theme?: unknown }) : {};
  } catch {
    return {};
  }
}

export function readQuickAskLocale(): Locale {
  return normalizeLocale(readLocalUiSettings().locale ?? undefined);
}

export function readQuickAskTheme(): Theme {
  return normalizeTheme(readLocalUiSettings().theme ?? "system");
}

/** 让独立小窗跟随主应用的明暗主题（同步一次 <html> 的 dark class）。 */
export function applyQuickAskTheme(): void {
  const effective = resolveEffectiveTheme(readQuickAskTheme());
  document.documentElement.classList.toggle("dark", effective === "dark");
}
