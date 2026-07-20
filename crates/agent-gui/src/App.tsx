import type { Context } from "@earendil-works/pi-ai";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { CronPromptRunner } from "./components/cron/CronPromptRunner";
import { MemoryOrganizerHost } from "./components/memory/useMemoryOrganizer";
import { WindowsTitleBar } from "./components/WindowsTitleBar";
import { LocaleContext, t as translate } from "./i18n";
import { type AppUpdateController, useAppUpdateController } from "./lib/appUpdates";
import { initAutomation } from "./lib/automation";
import {
  type AppearanceSettings,
  type AppSettings,
  type BackgroundSettings,
  getDefaultSettings,
  getNextTheme,
  normalizeSettings,
  resolveEffectiveTheme,
  resolveWorkspaceProjects,
  subscribeToSystemThemePreference,
} from "./lib/settings";
import {
  loadPersistedSettingsWithDefaults,
  persistSettings,
  publishGatewaySettingsSync,
  type SettingsSaveState,
} from "./lib/settings/storage";
import {
  applyGatewaySettingsSyncPayload,
  buildGatewaySettingsSyncPayload,
  type GatewaySettingsSyncPayload,
} from "./lib/settings/sync";
import { ChatPage } from "./pages/ChatPage";
import { SettingsPage } from "./pages/SettingsPage";
import type { SectionId } from "./pages/settings/types";

function getDefaultContext(): Context {
  return {
    messages: [],
  };
}

function asErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  const text = String(error ?? "").trim();
  return text || fallback;
}

const GATEWAY_SETTINGS_SYNC_EVENT = "gateway:settings-sync";

function AppChrome(props: {
  children: ReactNode;
  appUpdate?: AppUpdateController;
  background?: BackgroundSettings;
  appearance: AppearanceSettings;
  effectiveTheme: "light" | "dark";
}) {
  const background = props.background;
  const backgroundActive = Boolean(background?.enabled && background.imagePath);
  const [backgroundImageFailed, setBackgroundImageFailed] = useState(false);
  // Reset load errors when the source path changes so a new pick can recover.
  useEffect(() => {
    setBackgroundImageFailed(false);
  }, [background?.imagePath]);
  const showBackgroundImage = backgroundActive && Boolean(background) && !backgroundImageFailed;
  const palette = props.appearance[props.effectiveTheme];
  const fontStack =
    props.appearance.fontFamily === "local" && props.appearance.localFontName
      ? `"${props.appearance.localFontName}", sans-serif`
      : props.appearance.fontFamily === "serif"
        ? "Georgia, 'Noto Serif CJK SC', serif"
        : props.appearance.fontFamily === "monospace"
          ? "Cascadia Code, Consolas, monospace"
          : props.appearance.fontFamily === "cjk"
            ? "PingFang SC, Microsoft YaHei, sans-serif"
            : props.appearance.fontFamily === "system"
              ? "system-ui, sans-serif"
              : "OpenAI Sans, PingFang SC, Microsoft YaHei, sans-serif";
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the application shell suppresses the native context menu globally.
    <div
      className="app-chrome-surface calen-themed relative flex h-full w-full flex-col overflow-hidden bg-background"
      style={
        {
          "--calen-app": palette.app,
          "--calen-titlebar": palette.titleBar,
          "--calen-sidebar": palette.sidebar,
          "--calen-chat-canvas": palette.chatCanvas,
          "--calen-composer": palette.composer,
          "--calen-right-dock": palette.rightDock,
          "--calen-card": palette.card,
          "--calen-user-bubble": palette.userBubble,
          "--calen-primary-text": palette.primaryText,
          "--calen-secondary-text": palette.secondaryText,
          "--calen-border": palette.border,
          "--calen-accent": palette.accent,
          "--calen-font-family": fontStack,
        } as CSSProperties
      }
      onContextMenu={(event) => {
        event.preventDefault();
      }}
    >
      {showBackgroundImage && background ? (
        // Paint the photo as a normal absolute layer (z-0), then put chrome
        // content above it (z-10). Negative z-index under a transformed /
        // filtered ancestor is flaky in WebView2 and can "randomly" hide the
        // image after theme toggles, overlays, or page switches.
        <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
          <img
            src={convertFileSrc(background.imagePath)}
            alt=""
            draggable={false}
            className="h-full w-full object-cover"
            onError={() => setBackgroundImageFailed(true)}
          />
          <div
            className="absolute inset-0"
            style={{
              // "opacity" is the cover strength of the theme wash over the photo
              // (higher = less of the photo visible), not CSS opacity of the image.
              backgroundColor: `hsl(var(--background) / ${background.opacity})`,
              backdropFilter: background.blur > 0 ? `blur(${background.blur}px)` : undefined,
            }}
          />
        </div>
      ) : null}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        <WindowsTitleBar appUpdate={props.appUpdate} />
        <div className="app-chrome-surface relative min-h-0 flex-1 overflow-hidden bg-background">
          {props.children}
        </div>
      </div>
    </div>
  );
}

function hasSettingsSyncChanged(prev: AppSettings, next: AppSettings) {
  return (
    JSON.stringify(buildGatewaySettingsSyncPayload(prev)) !==
    JSON.stringify(buildGatewaySettingsSyncPayload(next))
  );
}

function hasSensitiveSettingsUpdates(settings: AppSettings) {
  return (
    settings.customProviders.some((provider) => provider.apiKey.trim().length > 0) ||
    settings.ssh.hosts.some(
      (host) => host.password.trim().length > 0 || host.privateKey.trim().length > 0,
    )
  );
}

function hasSensitiveSettingsUpdatesPayload(payload: unknown) {
  const source =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as {
          providerApiKeyUpdates?: unknown;
          sshSecretUpdates?: unknown;
        })
      : {};
  const providerUpdates = source.providerApiKeyUpdates;
  if (
    providerUpdates &&
    typeof providerUpdates === "object" &&
    !Array.isArray(providerUpdates) &&
    Object.values(providerUpdates).some(
      (value) => typeof value === "string" && value.trim().length > 0,
    )
  ) {
    return true;
  }
  const sshUpdates = source.sshSecretUpdates;
  return Boolean(
    sshUpdates &&
      typeof sshUpdates === "object" &&
      !Array.isArray(sshUpdates) &&
      Object.values(sshUpdates).some((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return false;
        const update = value as { password?: unknown; privateKey?: unknown };
        return (
          (typeof update.password === "string" && update.password.trim().length > 0) ||
          (typeof update.privateKey === "string" && update.privateKey.trim().length > 0)
        );
      }),
  );
}

function applyRuntimeSystemDefaults(settings: AppSettings, defaultWorkdir: string): AppSettings {
  const normalizedDefaultWorkdir = defaultWorkdir.trim();
  const system =
    !normalizedDefaultWorkdir || settings.system.workdir.trim()
      ? settings.system
      : {
          ...settings.system,
          workdir: normalizedDefaultWorkdir,
        };
  return normalizeSettings({
    ...settings,
    system: resolveWorkspaceProjects(system, normalizedDefaultWorkdir),
  });
}

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SectionId>("system");
  const [settingsReady, setSettingsReady] = useState(false);
  const [settings, setSettingsState] = useState<AppSettings>(() => getDefaultSettings());
  const [settingsSaveState, setSettingsSaveState] = useState<SettingsSaveState>({
    status: "idle",
  });
  const [context, setContext] = useState<Context>(() => getDefaultContext());
  const [overlay, setOverlay] = useState<"closed" | "entering" | "open" | "leaving">("closed");

  const saveSequenceRef = useRef(0);
  const saveChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const defaultWorkdirRef = useRef("");
  // Mirrors `settings` so setSettings/queueSettingsSave can read the latest value
  // synchronously without passing a (side-effecting) function into setSettingsState —
  // React 18 StrictMode double-invokes functional state updaters in development,
  // which would otherwise run those side effects (and any non-idempotent work like
  // crypto.randomUUID() inside caller updaters) twice per call.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [, setSystemThemeVersion] = useState(0);
  const effectiveTheme = resolveEffectiveTheme(settings.theme);

  useEffect(() => {
    if (settings.theme !== "system") return;
    return subscribeToSystemThemePreference(() => {
      setSystemThemeVersion((version) => version + 1);
    });
  }, [settings.theme]);

  const backgroundSettings = settings.customSettings.background;
  const customBackgroundActive = Boolean(
    backgroundSettings.enabled && backgroundSettings.imagePath,
  );

  // 同步主题 class 到 <html> 根节点
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", effectiveTheme === "dark");
    root.classList.toggle("has-custom-bg", customBackgroundActive);
  }, [effectiveTheme, customBackgroundActive]);

  useEffect(() => {
    let cancelled = false;

    async function hydrateSettings() {
      try {
        const { settings: loaded, defaultWorkdir } = await loadPersistedSettingsWithDefaults();
        if (!cancelled) {
          defaultWorkdirRef.current = defaultWorkdir;
          const loadedWithDefaults = applyRuntimeSystemDefaults(loaded, defaultWorkdir);
          settingsRef.current = loadedWithDefaults;
          setSettingsState(loadedWithDefaults);
          setSettingsSaveState({ status: "saved" });
          void publishGatewaySettingsSync(loadedWithDefaults).catch((error) => {
            console.error("publish gateway settings sync failed", error);
          });
        }
      } catch (error) {
        if (!cancelled) {
          const fallback = getDefaultSettings();
          settingsRef.current = fallback;
          setSettingsState(fallback);
          setSettingsSaveState({
            status: "error",
            message: asErrorMessage(error, "加载设置失败，已回退到默认配置。"),
          });
        }
      } finally {
        if (!cancelled) {
          setSettingsReady(true);
        }
      }
    }

    void hydrateSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  const queueSettingsSave = useCallback(
    (prev: AppSettings, next: AppSettings, fallback: string, publishSync: boolean) => {
      const saveSequence = ++saveSequenceRef.current;
      setSettingsSaveState({ status: "saving" });

      saveChainRef.current = saveChainRef.current
        .catch(() => undefined)
        .then(() => persistSettings(prev, next))
        .then(async (persistResult) => {
          const publishTarget = persistResult.ssh
            ? normalizeSettings({
                ...next,
                ssh: persistResult.ssh,
              })
            : next;
          if (persistResult.ssh && saveSequenceRef.current === saveSequence) {
            const merged = normalizeSettings({
              ...settingsRef.current,
              ssh: persistResult.ssh,
            });
            settingsRef.current = merged;
            setSettingsState(merged);
          }
          if (persistResult.conflict) {
            throw new Error(persistResult.conflict);
          }
          if (publishSync) {
            await publishGatewaySettingsSync(publishTarget);
          }
        })
        .then(() => {
          if (saveSequenceRef.current === saveSequence) {
            setSettingsSaveState({ status: "saved" });
          }
        })
        .catch((error) => {
          if (saveSequenceRef.current === saveSequence) {
            setSettingsSaveState({
              status: "error",
              message: asErrorMessage(error, fallback),
            });
          }
        });
    },
    [],
  );

  const setSettings = useCallback(
    (updater: (prev: AppSettings) => AppSettings) => {
      const prev = settingsRef.current;
      const updated = updater(prev);
      if (updated === prev) return;
      const next = applyRuntimeSystemDefaults(
        normalizeSettings(updated),
        defaultWorkdirRef.current,
      );
      settingsRef.current = next;
      setSettingsState(next);
      queueSettingsSave(
        prev,
        next,
        "保存设置失败。",
        hasSettingsSyncChanged(prev, next) || hasSensitiveSettingsUpdates(next),
      );
    },
    [queueSettingsSave],
  );

  // Authoritative live read for tool write paths: settingsRef is updated
  // synchronously by setSettings, so read-modify-write sequences that stay in
  // one synchronous segment can never observe a stale snapshot.
  const getMcpSettings = useCallback(() => settingsRef.current.mcp, []);

  const reloadPersistedSettings = useCallback(async () => {
    await saveChainRef.current.catch(() => undefined);
    const { settings: loaded, defaultWorkdir } = await loadPersistedSettingsWithDefaults();
    defaultWorkdirRef.current = defaultWorkdir;
    const loadedWithDefaults = applyRuntimeSystemDefaults(loaded, defaultWorkdir);
    settingsRef.current = loadedWithDefaults;
    setSettingsState(loadedWithDefaults);
    setSettingsSaveState({ status: "saved" });
  }, []);

  const toggleTheme = useCallback(() => {
    setSettings((prev) => ({
      ...prev,
      theme: getNextTheme(prev.theme),
    }));
  }, [setSettings]);

  const openSettings = useCallback(
    (section: SectionId = "system") => {
      setSettingsSection(section);
      setSettingsOpen(true);
      setOverlay("entering");
      requestAnimationFrame(() => requestAnimationFrame(() => setOverlay("open")));
      void reloadPersistedSettings().catch((error) => {
        setSettingsSaveState({
          status: "error",
          message: asErrorMessage(error, "重新加载设置失败，当前显示的是旧配置。"),
        });
      });
    },
    [reloadPersistedSettings],
  );

  const closeSettings = useCallback(() => {
    setOverlay("leaving");
  }, []);

  const handleTransitionEnd = useCallback(() => {
    if (overlay === "leaving") {
      setSettingsOpen(false);
      setOverlay("closed");
    }
  }, [overlay]);

  // 构建 locale context value，避免每次渲染重新创建
  const localeContextValue = useMemo(
    () => ({
      locale: settings.locale,
      t: (key: string) => translate(key, settings.locale),
    }),
    [settings.locale],
  );

  const appUpdateMessages = useMemo(
    () => ({
      checkFailed: translate("settings.aboutUpdateCheckFailed", settings.locale),
      installFailed: translate("settings.aboutUpdateInstallFailed", settings.locale),
      restartFailed: translate("settings.aboutRestartFailed", settings.locale),
    }),
    [settings.locale],
  );

  const appUpdate = useAppUpdateController({
    enabled: settingsReady,
    includePrereleases: settings.updates.includePrereleases,
    messages: appUpdateMessages,
  });

  useEffect(() => {
    if (!settingsReady) return;
    void initAutomation().catch((error) => {
      console.warn("Failed to initialize automation store", error);
    });
  }, [settingsReady]);

  // 截屏即问失败（截屏失败、热键冲突、遮罩创建失败）推到主窗口。
  useEffect(() => {
    if (!settingsReady) return;
    let cancelled = false;
    const unlistenPromise = listen<string>("quick-ask:error", (event) => {
      if (cancelled) return;
      const message = String(event.payload ?? "").trim() || "截屏即问失败";
      console.warn("[quick-ask]", message);
      setSettingsSaveState({
        status: "error",
        message: `截屏即问：${message}`,
      });
    });
    return () => {
      cancelled = true;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [settingsReady]);

  useEffect(() => {
    if (!settingsReady) {
      return;
    }

    let cancelled = false;
    const unlistenPromise = listen<GatewaySettingsSyncPayload>(
      GATEWAY_SETTINGS_SYNC_EVENT,
      (event) => {
        if (cancelled) {
          return;
        }

        const prev = settingsRef.current;
        const next = applyRuntimeSystemDefaults(
          applyGatewaySettingsSyncPayload(prev, event.payload),
          defaultWorkdirRef.current,
        );
        const publicChanged = hasSettingsSyncChanged(prev, next);
        if (!publicChanged && !hasSensitiveSettingsUpdatesPayload(event.payload)) {
          return;
        }
        settingsRef.current = next;
        setSettingsState(next);
        queueSettingsSave(prev, next, "同步 WebUI 设置失败。", publicChanged);
      },
    );

    return () => {
      cancelled = true;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [queueSettingsSave, settingsReady]);

  if (!settingsReady) {
    return (
      <LocaleContext.Provider value={localeContextValue}>
        <AppChrome
          appUpdate={appUpdate}
          background={backgroundSettings}
          appearance={settings.customSettings.appearance}
          effectiveTheme={effectiveTheme}
        >
          <div className="flex h-full w-full items-center justify-center bg-background text-sm text-muted-foreground">
            {translate("chat.loading", settings.locale)}
          </div>
        </AppChrome>
      </LocaleContext.Provider>
    );
  }

  const visible = settingsOpen;
  const active = overlay === "open";

  return (
    <LocaleContext.Provider value={localeContextValue}>
      <AppChrome
        appUpdate={appUpdate}
        background={backgroundSettings}
        appearance={settings.customSettings.appearance}
        effectiveTheme={effectiveTheme}
      >
        <CronPromptRunner settings={settings} />
        <MemoryOrganizerHost settings={settings} setSettings={setSettings} />
        <AppErrorBoundary>
          <ChatPage
            settings={settings}
            setSettings={setSettings}
            getMcpSettings={getMcpSettings}
            context={context}
            setContext={setContext}
            onOpenSettings={openSettings}
            onToggleTheme={toggleTheme}
            appUpdate={appUpdate}
          />
        </AppErrorBoundary>
        {visible && (
          <div
            className={`absolute inset-0 z-50 bg-background transition-all duration-300 ease-out ${
              active ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
            }`}
            onTransitionEnd={handleTransitionEnd}
          >
            <AppErrorBoundary>
              <SettingsPage
                settings={settings}
                setSettings={setSettings}
                saveState={settingsSaveState}
                onBack={closeSettings}
                initialSection={settingsSection}
                appUpdate={appUpdate}
              />
            </AppErrorBoundary>
          </div>
        )}
      </AppChrome>
    </LocaleContext.Provider>
  );
}
