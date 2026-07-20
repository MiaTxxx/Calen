import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import {
  CheckCircle2,
  Cpu,
  Folder,
  ImageIcon,
  MessageSquare,
  MonitorSmartphone,
  Moon,
  ScanText,
  Sun,
  Terminal,
  Trash2,
  Wrench,
} from "../../components/icons";

import { SUPPORTED_LOCALES, useLocale } from "../../i18n";
import {
  APPEARANCE_SURFACES,
  DEFAULT_APPEARANCE_SETTINGS,
  DEFAULT_BACKGROUND_SETTINGS,
  DEFAULT_QUICK_ASK_HOTKEY,
  DEFAULT_WORKSPACE_PROJECT_ID,
  type DefaultShellPreference,
  type ExecutionMode,
  type FontScaleSettings,
  parseAppearanceSettingsJson,
  THEME_OPTIONS,
  type Theme,
  updateCustomSettings,
  updateSystem,
} from "../../lib/settings";
import { NetworkProxySettingsCard } from "./NetworkProxySettingsCard";
import { AgentActivationSwitch } from "./shared";
import type { SettingsSectionProps } from "./types";

export function SystemSettingsForm(props: SettingsSectionProps) {
  const { settings, setSettings } = props;
  const { t } = useLocale();

  const executionMode = settings.system.executionMode;
  const isClassicAgentMode = executionMode === "tools";
  const isAgentDevMode = executionMode === "agent-dev";
  const defaultShell = settings.system.defaultShell ?? "auto";
  const canHideDefaultWorkspaceProject = settings.system.workspaceProjects.some(
    (project) => project.id !== DEFAULT_WORKSPACE_PROJECT_ID,
  );
  const hideDefaultWorkspaceProjectDisabled =
    !settings.system.hideDefaultWorkspaceProject && !canHideDefaultWorkspaceProject;
  const appearanceIcon =
    settings.theme === "system" ? (
      <MonitorSmartphone className="h-4 w-4 text-muted-foreground" />
    ) : settings.theme === "dark" ? (
      <Moon className="h-4 w-4 text-muted-foreground" />
    ) : (
      <Sun className="h-4 w-4 text-muted-foreground" />
    );

  function getThemeLabel(theme: Theme) {
    if (theme === "light") return t("settings.light");
    if (theme === "dark") return t("settings.dark");
    return t("settings.auto");
  }

  function renderThemeIcon(theme: Theme) {
    if (theme === "light") return <Sun className="h-4.5 w-4.5" />;
    if (theme === "dark") return <Moon className="h-4.5 w-4.5" />;
    return <MonitorSmartphone className="h-4.5 w-4.5" />;
  }

  const fontScale = settings.customSettings.fontScale;
  const fontScaleZones: Array<{ key: keyof FontScaleSettings; label: string }> = [
    { key: "sidebar", label: t("settings.fontSizeSidebar") },
    { key: "chat", label: t("settings.fontSizeChat") },
    { key: "rightDock", label: t("settings.fontSizeRightDock") },
  ];

  function setZoneFontScale(zone: keyof FontScaleSettings, value: number) {
    setSettings((prev) =>
      updateCustomSettings(prev, {
        fontScale: { ...prev.customSettings.fontScale, [zone]: value },
      }),
    );
  }

  const background = settings.customSettings.background;
  const [appearanceMode, setAppearanceMode] = useState<"light" | "dark">("light");
  const [appearanceJson, setAppearanceJson] = useState("");
  const [appearanceError, setAppearanceError] = useState("");
  const appearance = settings.customSettings.appearance;
  const appearancePalette = appearance[appearanceMode];

  function updateAppearance(patch: Partial<typeof appearance>) {
    setSettings((prev) =>
      updateCustomSettings(prev, {
        appearance: { ...prev.customSettings.appearance, ...patch },
      }),
    );
  }

  function importAppearance() {
    try {
      updateAppearance(parseAppearanceSettingsJson(appearanceJson));
      setAppearanceError("");
    } catch (error) {
      setAppearanceError(error instanceof Error ? error.message : String(error));
    }
  }
  const [backgroundPicking, setBackgroundPicking] = useState(false);
  const [backgroundError, setBackgroundError] = useState("");

  async function pickBackgroundImage() {
    setBackgroundPicking(true);
    setBackgroundError("");
    try {
      const path = await invoke<string | null>("system_pick_background_image");
      if (path) {
        setSettings((prev) =>
          updateCustomSettings(prev, {
            background: { ...prev.customSettings.background, enabled: true, imagePath: path },
          }),
        );
      }
    } catch (error) {
      setBackgroundError(error instanceof Error ? error.message : String(error));
    } finally {
      setBackgroundPicking(false);
    }
  }

  function updateBackground(patch: Partial<typeof background>) {
    setSettings((prev) =>
      updateCustomSettings(prev, {
        background: { ...prev.customSettings.background, ...patch },
      }),
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Terminal className="h-4 w-4 text-muted-foreground" />
          {t("settings.executionMode")}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("settings.executionModeDesc")}
        </p>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <button
            type="button"
            onClick={() =>
              setSettings((prev) => updateSystem(prev, { executionMode: "text" as ExecutionMode }))
            }
            className={`group relative flex flex-col items-start gap-3 rounded-xl border-2 p-4 text-left transition-all ${
              executionMode === "text"
                ? "border-primary bg-primary/5 shadow-sm shadow-primary/10"
                : "border-transparent bg-muted/40 hover:border-border hover:bg-muted/60"
            }`}
          >
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
                executionMode === "text"
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground group-hover:bg-accent"
              }`}
            >
              <MessageSquare className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold">{t("settings.chatMode")}</div>
              <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {t("settings.chatModeDesc")}
              </div>
            </div>
            {executionMode === "text" ? (
              <div className="absolute right-3 top-3">
                <CheckCircle2 className="h-4.5 w-4.5 text-primary" />
              </div>
            ) : null}
          </button>

          <button
            type="button"
            onClick={() =>
              setSettings((prev) => updateSystem(prev, { executionMode: "tools" as ExecutionMode }))
            }
            className={`group relative flex flex-col items-start gap-3 rounded-xl border-2 p-4 text-left transition-all ${
              isClassicAgentMode
                ? "border-primary bg-primary/5 shadow-sm shadow-primary/10"
                : "border-transparent bg-muted/40 hover:border-border hover:bg-muted/60"
            }`}
          >
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
                isClassicAgentMode
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground group-hover:bg-accent"
              }`}
            >
              <Wrench className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold">{t("settings.agentMode")}</div>
              <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {t("settings.agentModeDesc")}
              </div>
            </div>
            {isClassicAgentMode ? (
              <div className="absolute right-3 top-3">
                <CheckCircle2 className="h-4.5 w-4.5 text-primary" />
              </div>
            ) : null}
          </button>

          <button
            type="button"
            onClick={() =>
              setSettings((prev) =>
                updateSystem(prev, { executionMode: "agent-dev" as ExecutionMode }),
              )
            }
            className={`group relative flex flex-col items-start gap-3 rounded-xl border-2 p-4 text-left transition-all ${
              isAgentDevMode
                ? "border-primary bg-primary/5 shadow-sm shadow-primary/10"
                : "border-transparent bg-muted/40 hover:border-border hover:bg-muted/60"
            }`}
          >
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
                isAgentDevMode
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground group-hover:bg-accent"
              }`}
            >
              <Cpu className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold">{t("settings.agentDevMode")}</div>
              <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {t("settings.agentDevModeDesc")}
              </div>
            </div>
            {isAgentDevMode ? (
              <div className="absolute right-3 top-3">
                <CheckCircle2 className="h-4.5 w-4.5 text-primary" />
              </div>
            ) : null}
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Terminal className="h-4 w-4 text-muted-foreground" />
          {t("settings.defaultShell")}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("settings.defaultShellDesc")}
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {(
            [
              {
                id: "auto" as DefaultShellPreference,
                title: t("settings.defaultShellAuto"),
                desc: t("settings.defaultShellAutoDesc"),
              },
              {
                id: "bash" as DefaultShellPreference,
                title: t("settings.defaultShellBash"),
                desc: t("settings.defaultShellBashDesc"),
              },
              {
                id: "powershell" as DefaultShellPreference,
                title: t("settings.defaultShellPowerShell"),
                desc: t("settings.defaultShellPowerShellDesc"),
              },
            ] as const
          ).map((option) => {
            const selected = defaultShell === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() =>
                  setSettings((prev) => updateSystem(prev, { defaultShell: option.id }))
                }
                className={`group relative flex flex-col items-start gap-3 rounded-xl border-2 p-4 text-left transition-all ${
                  selected
                    ? "border-primary bg-primary/5 shadow-sm shadow-primary/10"
                    : "border-transparent bg-muted/40 hover:border-border hover:bg-muted/60"
                }`}
              >
                <div className="min-w-0 pr-6">
                  <div className="text-sm font-semibold">{option.title}</div>
                  <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {option.desc}
                  </div>
                </div>
                {selected ? (
                  <div className="absolute right-3 top-3">
                    <CheckCircle2 className="h-4.5 w-4.5 text-primary" />
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="border-t" />

      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <ScanText className="h-4 w-4 text-muted-foreground" />
          {t("settings.quickAskHotkey")}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("settings.quickAskHotkeyDesc")}
        </p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={settings.system.quickAskHotkey}
            placeholder={t("settings.quickAskHotkeyPlaceholder")}
            onChange={(event) =>
              setSettings((prev) => updateSystem(prev, { quickAskHotkey: event.target.value }))
            }
            className="w-64 rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
          {settings.system.quickAskHotkey !== DEFAULT_QUICK_ASK_HOTKEY ? (
            <button
              type="button"
              onClick={() =>
                setSettings((prev) =>
                  updateSystem(prev, { quickAskHotkey: DEFAULT_QUICK_ASK_HOTKEY }),
                )
              }
              className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {t("settings.quickAskHotkeyReset")}
            </button>
          ) : null}
        </div>
      </div>

      <div className="border-t" />

      <div className="grid gap-4 md:grid-cols-2">
        <section className="space-y-3 rounded-2xl border border-border/60 bg-card p-4">
          <div className="flex items-start gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                {appearanceIcon}
                {t("settings.appearance")}
              </div>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            {THEME_OPTIONS.map((theme) => {
              const selected = settings.theme === theme;
              return (
                <button
                  key={theme}
                  type="button"
                  onClick={() => setSettings((prev) => ({ ...prev, theme }))}
                  className={`group relative flex h-full items-start gap-3 rounded-xl border px-3.5 py-3.5 text-left transition-all ${
                    selected
                      ? "border-primary bg-primary/5 shadow-sm shadow-primary/10"
                      : "border-border/60 bg-background/80 hover:border-border hover:bg-muted/35"
                  }`}
                >
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
                      selected
                        ? "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground group-hover:bg-accent/80"
                    }`}
                  >
                    {renderThemeIcon(theme)}
                  </div>
                  <div className="min-w-0 pr-6">
                    <div className="text-sm font-semibold">{getThemeLabel(theme)}</div>
                  </div>
                  {selected ? (
                    <div className="absolute right-3 top-3">
                      <CheckCircle2 className="h-4.5 w-4.5 text-primary" />
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        </section>

        <section className="space-y-3 rounded-2xl border border-border/60 bg-card p-4">
          <div className="flex items-start gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
                {t("settings.language")}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {SUPPORTED_LOCALES.map((locale) => {
              const selected = settings.locale === locale;
              const localeLabel =
                locale === "zh-CN"
                  ? t("settings.chinese")
                  : locale === "en-US"
                    ? t("settings.english")
                    : locale;
              return (
                <button
                  key={locale}
                  type="button"
                  onClick={() => setSettings((prev) => ({ ...prev, locale }))}
                  className={`group relative flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-all ${
                    selected
                      ? "border-primary bg-primary/5 shadow-sm shadow-primary/10"
                      : "border-border/60 bg-background/80 hover:border-border hover:bg-muted/35"
                  }`}
                >
                  <span className="text-base leading-none">{locale === "zh-CN" ? "🇨🇳" : "🇺🇸"}</span>
                  <div className="min-w-0 flex-1 pr-5">
                    <div className="truncate text-sm font-semibold">{localeLabel}</div>
                    <div className="mt-0.5 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                      {locale}
                    </div>
                  </div>
                  {selected ? (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <CheckCircle2 className="h-4.5 w-4.5 text-primary" />
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        </section>
      </div>

      <details className="rounded-2xl border border-border/60 bg-card p-4">
        <summary className="cursor-pointer text-sm font-medium text-foreground">
          {t("settings.themeEditor")}
        </summary>
        <div className="mt-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex rounded-lg bg-muted/50 p-0.5">
              {(["light", "dark"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setAppearanceMode(mode)}
                  className={`rounded-md px-3 py-1 text-xs ${appearanceMode === mode ? "bg-background shadow-sm" : "text-muted-foreground"}`}
                >
                  {mode === "light" ? t("settings.light") : t("settings.dark")}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => updateAppearance(DEFAULT_APPEARANCE_SETTINGS)}
              className="rounded-lg border px-3 py-1.5 text-xs"
            >
              {t("settings.resetAll")}
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {APPEARANCE_SURFACES.map((surface) => (
              <label
                key={surface}
                className="flex items-center gap-2 rounded-lg border p-2 text-xs"
              >
                <input
                  type="color"
                  value={appearancePalette[surface].slice(0, 7)}
                  onChange={(event) =>
                    updateAppearance({
                      [appearanceMode]: { ...appearancePalette, [surface]: event.target.value },
                    })
                  }
                  className="h-7 w-9 cursor-pointer border-0 bg-transparent"
                />
                <span className="min-w-0 flex-1 truncate">{surface}</span>
                <button
                  type="button"
                  onClick={() =>
                    updateAppearance({
                      [appearanceMode]: {
                        ...appearancePalette,
                        [surface]: DEFAULT_APPEARANCE_SETTINGS[appearanceMode][surface],
                      },
                    })
                  }
                  className="text-muted-foreground hover:text-foreground"
                  title={t("settings.reset")}
                >
                  R
                </button>
              </label>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <select
              value={appearance.fontFamily}
              onChange={(event) =>
                updateAppearance({ fontFamily: event.target.value as typeof appearance.fontFamily })
              }
              className="rounded-lg border bg-background px-3 py-2 text-xs"
            >
              {["system", "openai", "cjk", "serif", "monospace", "local"].map((font) => (
                <option key={font} value={font}>
                  {font}
                </option>
              ))}
            </select>
            <input
              value={appearance.localFontName}
              disabled={appearance.fontFamily !== "local"}
              onChange={(event) => updateAppearance({ localFontName: event.target.value })}
              placeholder={t("settings.localFontName")}
              className="rounded-lg border bg-background px-3 py-2 text-xs"
            />
          </div>
          <textarea
            value={appearanceJson}
            onChange={(event) => setAppearanceJson(event.target.value)}
            placeholder={t("settings.themeJson")}
            className="min-h-24 w-full rounded-lg border bg-background p-2 font-mono text-xs"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAppearanceJson(JSON.stringify(appearance, null, 2))}
              className="rounded-lg border px-3 py-1.5 text-xs"
            >
              {t("settings.export")}
            </button>
            <button
              type="button"
              onClick={importAppearance}
              className="rounded-lg border px-3 py-1.5 text-xs"
            >
              {t("settings.import")}
            </button>
          </div>
          {appearanceError ? <p className="text-xs text-destructive">{appearanceError}</p> : null}
        </div>
      </details>

      <section className="space-y-4 rounded-2xl border border-border/60 bg-card p-4">
        <div>
          <div className="text-sm font-medium text-foreground">{t("settings.chatLayout")}</div>
          <p className="mt-1 text-xs text-muted-foreground">{t("settings.chatLayoutDesc")}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            [640, false, t("settings.chatLayoutNarrow")],
            [768, false, t("settings.chatLayoutStandard")],
            [1024, false, t("settings.chatLayoutWide")],
            [768, true, t("settings.chatLayoutFull")],
          ].map(([width, fullWidth, label]) => (
            <button
              key={String(label)}
              type="button"
              onClick={() =>
                setSettings((prev) =>
                  updateCustomSettings(prev, {
                    chatLayout: {
                      ...prev.customSettings.chatLayout,
                      contentWidth: Number(width),
                      fullWidth: Boolean(fullWidth),
                    },
                  }),
                )
              }
              className="rounded-lg border border-border/60 bg-background/80 px-3 py-2 text-xs hover:bg-muted/40"
            >
              {String(label)}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-3 text-xs">
          <span className="w-24">{t("settings.chatLayoutWidth")}</span>
          <input
            type="range"
            min={560}
            max={1400}
            step={8}
            disabled={settings.customSettings.chatLayout.fullWidth}
            value={settings.customSettings.chatLayout.contentWidth}
            onChange={(event) =>
              setSettings((prev) =>
                updateCustomSettings(prev, {
                  chatLayout: {
                    ...prev.customSettings.chatLayout,
                    contentWidth: Number(event.target.value),
                  },
                }),
              )
            }
            className="min-w-0 flex-1 accent-primary"
          />
          <span className="w-14 text-right tabular-nums">
            {settings.customSettings.chatLayout.fullWidth
              ? t("settings.chatLayoutFull")
              : `${settings.customSettings.chatLayout.contentWidth}px`}
          </span>
        </label>
        <label className="flex items-center gap-3 text-xs">
          <span className="w-24">{t("settings.chatLayoutHeight")}</span>
          <input
            type="range"
            min={70}
            max={480}
            step={5}
            value={settings.customSettings.chatLayout.composerHeight}
            onChange={(event) =>
              setSettings((prev) =>
                updateCustomSettings(prev, {
                  chatLayout: {
                    ...prev.customSettings.chatLayout,
                    composerHeight: Number(event.target.value),
                  },
                }),
              )
            }
            className="min-w-0 flex-1 accent-primary"
          />
          <span className="w-14 text-right tabular-nums">
            {settings.customSettings.chatLayout.composerHeight}px
          </span>
        </label>
      </section>

      <section className="space-y-3 rounded-2xl border border-border/60 bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
              {t("settings.saveDrafts")}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("settings.saveDraftsDesc")}
            </p>
          </div>
          <AgentActivationSwitch
            checked={settings.customSettings.draftPersistence.enabled}
            title={t("settings.saveDrafts")}
            onToggle={() =>
              setSettings((prev) =>
                updateCustomSettings(prev, {
                  draftPersistence: {
                    enabled: !prev.customSettings.draftPersistence.enabled,
                  },
                }),
              )
            }
          />
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-border/60 bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <ImageIcon className="h-4 w-4 text-muted-foreground" />
              {t("settings.background")}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("settings.backgroundDesc")}
            </p>
          </div>
          {background.imagePath ? (
            <AgentActivationSwitch
              checked={background.enabled}
              title={t("settings.backgroundEnable")}
              onToggle={() => updateBackground({ enabled: !background.enabled })}
            />
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {background.imagePath ? (
            <img
              src={convertFileSrc(background.imagePath)}
              alt=""
              className="h-16 w-28 shrink-0 rounded-lg border border-border/60 object-cover"
            />
          ) : (
            <div className="flex h-16 w-28 shrink-0 items-center justify-center rounded-lg border border-dashed border-border/80 text-muted-foreground">
              <ImageIcon className="h-5 w-5" />
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={backgroundPicking}
              onClick={() => void pickBackgroundImage()}
              className="rounded-lg border border-border/60 bg-background/80 px-3 py-1.5 text-xs text-foreground transition-colors hover:border-border hover:bg-muted/35 disabled:opacity-60"
            >
              {t("settings.backgroundPick")}
            </button>
            {background.imagePath ? (
              <button
                type="button"
                onClick={() => updateBackground({ ...DEFAULT_BACKGROUND_SETTINGS })}
                className="flex items-center gap-1 rounded-lg border border-border/60 bg-background/80 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-red-500/40 hover:text-red-500"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t("settings.backgroundRemove")}
              </button>
            ) : null}
          </div>
        </div>
        {backgroundError ? (
          <p className="text-xs text-red-500 dark:text-red-400">{backgroundError}</p>
        ) : null}

        {background.imagePath ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-background/80 px-3.5 py-2.5">
              <div className="text-sm font-medium text-foreground">
                {t("settings.backgroundOpacity")}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={10}
                  max={90}
                  step={5}
                  value={Math.round(background.opacity * 100)}
                  onChange={(event) =>
                    updateBackground({ opacity: Number(event.target.value) / 100 })
                  }
                  className="w-40 accent-primary"
                />
                <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
                  {Math.round(background.opacity * 100)}%
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-background/80 px-3.5 py-2.5">
              <div className="text-sm font-medium text-foreground">
                {t("settings.backgroundBlur")}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={24}
                  step={1}
                  value={background.blur}
                  onChange={(event) => updateBackground({ blur: Number(event.target.value) })}
                  className="w-40 accent-primary"
                />
                <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
                  {background.blur}px
                </span>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <section className="space-y-3 rounded-2xl border border-border/60 bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <ScanText className="h-4 w-4 text-muted-foreground" />
              {t("settings.fontSize")}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("settings.fontSizeDesc")}
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              setSettings((prev) =>
                updateCustomSettings(prev, { fontScale: { sidebar: 1, chat: 1, rightDock: 1 } }),
              )
            }
            className="shrink-0 rounded-lg border border-border/60 bg-background/80 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-border hover:bg-muted/35 hover:text-foreground"
          >
            {t("settings.fontSizeReset")}
          </button>
        </div>

        <div className="space-y-2">
          {fontScaleZones.map((zone) => (
            <div
              key={zone.key}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-background/80 px-3.5 py-2.5"
            >
              <div className="text-sm font-medium text-foreground">{zone.label}</div>
              <div className="flex min-w-[220px] items-center gap-2">
                <input
                  type="range"
                  min={0.8}
                  max={1.4}
                  step={0.01}
                  value={fontScale[zone.key]}
                  onChange={(event) => setZoneFontScale(zone.key, Number(event.target.value))}
                  className="min-w-0 flex-1 accent-primary"
                />
                <span className="w-10 text-right text-xs tabular-nums">
                  {fontScale[zone.key].toFixed(2)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-border/60 bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Folder className="h-4 w-4 text-muted-foreground" />
              {t("settings.showDefaultWorkspaceProject")}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("settings.showDefaultWorkspaceProjectDesc")}
              {hideDefaultWorkspaceProjectDisabled ? (
                <span className="mt-1 block text-amber-600 dark:text-amber-400">
                  {t("chat.workspaceHideDefaultDisabledHint")}
                </span>
              ) : null}
            </p>
          </div>
          <span
            title={
              hideDefaultWorkspaceProjectDisabled
                ? t("chat.workspaceHideDefaultDisabledHint")
                : undefined
            }
          >
            <AgentActivationSwitch
              checked={!settings.system.hideDefaultWorkspaceProject}
              title={t("settings.showDefaultWorkspaceProject")}
              disabled={hideDefaultWorkspaceProjectDisabled}
              onToggle={() =>
                setSettings((prev) =>
                  updateSystem(prev, {
                    hideDefaultWorkspaceProject: !prev.system.hideDefaultWorkspaceProject,
                  }),
                )
              }
            />
          </span>
        </div>
      </section>

      <NetworkProxySettingsCard />
    </div>
  );
}
