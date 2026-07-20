import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../../i18n";
import {
  type DragPoints,
  isSelectionMeaningful,
  normalizeSelectionRect,
  toImageSelection,
} from "../../lib/quick-ask/selection";
import { readQuickAskLocale } from "./quickAskLocal";

type OverlayPayload = {
  imageDataUrl: string;
  width: number;
  height: number;
  scaleFactor: number;
};

/**
 * 截屏框选遮罩窗（label: snip-overlay）。
 * 背景是触发瞬间的整屏截图（冻结画面），拖拽框选后由 Rust 裁剪并打开提问小窗。
 */
export function SnipOverlayApp() {
  const locale = readQuickAskLocale();
  const [payload, setPayload] = useState<OverlayPayload | null>(null);
  const [drag, setDrag] = useState<DragPoints | null>(null);
  const confirmingRef = useRef(false);

  const cancel = useCallback(() => {
    void invoke("quick_ask_cancel_overlay").catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    invoke<OverlayPayload>("quick_ask_overlay_payload")
      .then((loaded) => {
        if (!cancelled) setPayload(loaded);
      })
      .catch(() => cancel());
    return () => {
      cancelled = true;
    };
  }, [cancel]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cancel]);

  const finishSelection = useCallback(
    (points: DragPoints) => {
      if (!payload || confirmingRef.current) return;
      const rect = normalizeSelectionRect(points);
      if (!isSelectionMeaningful(rect)) {
        setDrag(null);
        return;
      }
      confirmingRef.current = true;
      const selection = toImageSelection(
        rect,
        { width: window.innerWidth, height: window.innerHeight },
        { width: payload.width, height: payload.height },
      );
      void invoke("quick_ask_confirm_selection", { selection }).catch(() => {
        confirmingRef.current = false;
        cancel();
      });
    },
    [payload, cancel],
  );

  const rect = drag ? normalizeSelectionRect(drag) : null;
  const handleSize = 7;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 全屏截屏遮罩本质是一块画布，仅支持鼠标框选。
    <div
      className="fixed inset-0 select-none overflow-hidden bg-black"
      style={{ cursor: "crosshair" }}
      onMouseDown={(event) => {
        if (event.button === 2) {
          cancel();
          return;
        }
        if (event.button !== 0 || !payload || confirmingRef.current) return;
        setDrag({
          startX: event.clientX,
          startY: event.clientY,
          endX: event.clientX,
          endY: event.clientY,
        });
      }}
      onMouseMove={(event) => {
        setDrag((prev) => (prev ? { ...prev, endX: event.clientX, endY: event.clientY } : prev));
      }}
      onMouseUp={(event) => {
        if (event.button !== 0 || !drag) return;
        finishSelection({ ...drag, endX: event.clientX, endY: event.clientY });
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        cancel();
      }}
    >
      {payload ? (
        <img
          src={payload.imageDataUrl}
          alt=""
          draggable={false}
          // 截图渲染完成后才让 Rust 显示遮罩窗，保证遮罩一出现就能框选，
          // 不会出现"已显示但前端还没加载完、拖拽无效"的窗口期。
          onLoad={() => {
            void invoke("quick_ask_overlay_ready").catch(() => {});
          }}
          className="pointer-events-none absolute inset-0 h-full w-full"
        />
      ) : null}

      {/* 未框选时轻微压暗；框选后由选区阴影负责压暗外部区域 */}
      {rect ? (
        <div
          className="pointer-events-none absolute"
          style={{
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
            boxShadow: "0 0 0 100000px rgba(0, 0, 0, 0.5)",
          }}
        >
          {/* 选区描边 + 内发光 */}
          <div className="absolute inset-0 rounded-[1px] border border-sky-300/95 shadow-[inset_0_0_0_1px_rgba(56,189,248,0.35),0_0_0_1px_rgba(14,165,233,0.35)]" />
          {/* 四角手柄 */}
          {(
            [
              { left: -handleSize / 2, top: -handleSize / 2 },
              { right: -handleSize / 2, top: -handleSize / 2 },
              { left: -handleSize / 2, bottom: -handleSize / 2 },
              { right: -handleSize / 2, bottom: -handleSize / 2 },
            ] as const
          ).map((pos, index) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: 固定四个角点。
              key={index}
              className="absolute rounded-[1px] border border-sky-200 bg-sky-400 shadow-sm"
              style={{
                width: handleSize,
                height: handleSize,
                ...pos,
              }}
            />
          ))}
          {/* 尺寸徽标 */}
          <div className="absolute -top-8 left-0 whitespace-nowrap rounded-md border border-white/10 bg-black/75 px-2 py-0.5 text-[11px] font-medium tabular-nums tracking-wide text-white shadow-lg backdrop-blur-sm">
            {Math.round(rect.width)} × {Math.round(rect.height)}
          </div>
        </div>
      ) : (
        <div className="pointer-events-none absolute inset-0 bg-black/40" />
      )}

      {/* 顶部引导胶囊 */}
      <div className="pointer-events-none absolute left-1/2 top-7 z-10 -translate-x-1/2">
        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/72 px-4 py-1.5 text-[13px] text-white shadow-[0_10px_30px_-12px_rgba(0,0,0,0.8)] backdrop-blur-md">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-sky-400 shadow-[0_0_0_3px_rgba(56,189,248,0.25)]" />
          <span>{t("quickAsk.overlayHint", locale)}</span>
        </div>
      </div>
    </div>
  );
}
