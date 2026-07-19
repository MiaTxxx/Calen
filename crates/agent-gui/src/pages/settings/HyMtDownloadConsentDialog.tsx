import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, LoaderCircle, Shield, X } from "../../components/icons";
import { Button } from "../../components/ui/button";
import { useLocale } from "../../i18n";
import type { OfflineTranslationModel } from "../../lib/translation/tauri";
import {
  canStartLicensedTranslationDownload,
  formatTranslationModelSize,
  resolveDialogFocusWrap,
} from "./translationDownloadConsent";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

type HyMtDownloadConsentDialogProps = {
  model: OfflineTranslationModel;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onError: (message: string | null) => void;
};

export function HyMtDownloadConsentDialog({
  model,
  busy,
  onCancel,
  onConfirm,
  onError,
}: HyMtDownloadConsentDialogProps) {
  const { t } = useLocale();
  const [accepted, setAccepted] = useState(false);
  const [linkError, setLinkError] = useState<{ message: string; url: string } | null>(null);
  const titleId = useId();
  const consentId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocusedElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const appRoot = document.getElementById("root");
    const previousRootInert = appRoot?.inert ?? false;
    const previousRootAriaHidden = appRoot?.getAttribute("aria-hidden") ?? null;

    if (appRoot) {
      appRoot.inert = true;
      appRoot.setAttribute("aria-hidden", "true");
    }
    panelRef.current?.focus();

    return () => {
      if (appRoot) {
        appRoot.inert = previousRootInert;
        if (previousRootAriaHidden === null) appRoot.removeAttribute("aria-hidden");
        else appRoot.setAttribute("aria-hidden", previousRootAriaHidden);
      }
      previouslyFocusedElement?.focus();
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key === "Tab") {
        const panel = panelRef.current;
        if (!panel) return;
        const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
        const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
        const nextIndex = resolveDialogFocusWrap(focusable.length, activeIndex, event.shiftKey);
        if (nextIndex === null) return;
        event.preventDefault();
        if (nextIndex < 0) panel.focus();
        else focusable[nextIndex]?.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, onCancel]);

  async function openModelLink(url: string) {
    setLinkError(null);
    onError(null);
    try {
      await openUrl(url);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      const message = t("settings.translationHyMtConsentOpenLinkFailed").replace("{error}", detail);
      setLinkError({ message, url });
      onError(message);
    }
  }

  const canConfirm = canStartLicensedTranslationDownload(accepted, busy, Boolean(model.revision));

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label={t("settings.translationHyMtConsentCancel")}
        className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm"
        onClick={busy ? undefined : onCancel}
      />

      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative z-10 flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border/70 bg-background shadow-2xl outline-none"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border/60 px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
              <Shield className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div id={titleId} className="text-base font-semibold text-foreground">
                {t(
                  model.installed
                    ? "settings.translationHyMtConsentReviewTitle"
                    : "settings.translationHyMtConsentTitle",
                )}
              </div>
              <div className="mt-1 text-xs leading-5 text-muted-foreground">
                {model.displayName} · {formatTranslationModelSize(model.sizeBytes)}
              </div>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 rounded-xl text-muted-foreground"
            aria-label={t("settings.translationHyMtConsentCancel")}
            onClick={onCancel}
            disabled={busy}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5 text-sm">
          <p className="leading-6 text-muted-foreground">
            {t("settings.translationHyMtConsentIntro")}
          </p>

          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-900 dark:text-amber-200">
            <div className="text-sm font-semibold">
              {t("settings.translationHyMtConsentRegionTitle")}
            </div>
            <p className="mt-1 text-xs leading-5">{t("settings.translationHyMtConsentRegion")}</p>
          </div>

          <div className="grid gap-2 rounded-xl border border-border/60 bg-muted/20 px-4 py-3 text-xs text-muted-foreground sm:grid-cols-2">
            <div>
              <span className="font-medium text-foreground">
                {t("settings.translationHyMtConsentModelLabel")}:{" "}
              </span>
              {model.displayName}
            </div>
            <div>
              <span className="font-medium text-foreground">
                {t("settings.translationHyMtConsentSizeLabel")}:{" "}
              </span>
              {formatTranslationModelSize(model.sizeBytes)}
            </div>
            <div className="sm:col-span-2">
              <span className="font-medium text-foreground">
                {t("settings.translationHyMtConsentLicenseLabel")}:{" "}
              </span>
              {t("settings.translationModelLicenseHyMt")}
            </div>
            <div className="sm:col-span-2">
              <span className="font-medium text-foreground">
                {t("settings.translationHyMtConsentRevisionLabel")}:{" "}
              </span>
              <span className="select-text break-all font-mono text-[11px]">
                {model.revision || "--"}
              </span>
            </div>
            <div className="sm:col-span-2">
              <span className="font-medium text-foreground">
                {t("settings.translationHyMtConsentSha256Label")}:{" "}
              </span>
              <span className="select-text break-all font-mono text-[11px]">{model.sha256}</span>
            </div>
            <div className="sm:col-span-2">{t("settings.translationHyMtConsentPublisher")}</div>
            <div className="sm:col-span-2">{t("settings.translationHyMtConsentSource")}</div>
          </div>

          {!model.revision ? (
            <div
              role="alert"
              className="rounded-xl border border-destructive/30 bg-destructive/[0.05] px-4 py-3 text-xs leading-5 text-destructive"
            >
              {t("settings.translationHyMtConsentMissingRevision")}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!model.licenseUrl}
              onClick={() => model.licenseUrl && void openModelLink(model.licenseUrl)}
            >
              {t("settings.translationHyMtConsentViewLicense")}
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!model.sourceUrl}
              onClick={() => model.sourceUrl && void openModelLink(model.sourceUrl)}
            >
              {t("settings.translationHyMtConsentViewSource")}
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </div>

          {linkError ? (
            <div
              role="alert"
              className="rounded-xl border border-destructive/30 bg-destructive/[0.05] px-4 py-3 text-xs leading-5 text-destructive"
            >
              <div>{linkError.message}</div>
              <div className="mt-1 select-text break-all text-muted-foreground">
                {linkError.url}
              </div>
            </div>
          ) : null}

          <p className="rounded-xl border border-border/60 px-4 py-3 text-xs leading-5 text-muted-foreground">
            {t("settings.translationHyMtConsentNoAffiliation")}
          </p>

          <label
            htmlFor={consentId}
            className="flex cursor-pointer items-start gap-3 rounded-xl border border-primary/25 bg-primary/[0.04] px-4 py-3"
          >
            <input
              id={consentId}
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
              checked={accepted}
              disabled={busy}
              onChange={(event) => setAccepted(event.currentTarget.checked)}
            />
            <span className="text-xs leading-5 text-foreground">
              {t("settings.translationHyMtConsentCheckbox")}
            </span>
          </label>
        </div>

        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-border/60 bg-muted/20 px-5 py-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            {t("settings.translationHyMtConsentCancel")}
          </Button>
          <Button
            type="button"
            onClick={() => {
              if (canConfirm) onConfirm();
            }}
            disabled={!canConfirm}
          >
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
            {busy
              ? t("settings.translationHyMtConsentStarting")
              : t(
                  model.installed
                    ? "settings.translationHyMtConsentConfirmInstalled"
                    : "settings.translationHyMtConsentConfirm",
                )}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
