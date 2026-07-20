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
        if (event.button !== 0 || !payload) return;
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
      {/* 未框选时轻微压暗提示可框选；框选后由选区阴影负责压暗外部区域 */}
      {rect ? (
        <div
          className="pointer-events-none absolute border border-sky-400"
          style={{
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
            boxShadow: "0 0 0 100000px rgba(0, 0, 0, 0.45)",
          }}
        >
          <div className="absolute -top-7 left-0 whitespace-nowrap rounded bg-black/70 px-2 py-0.5 text-xs text-white">
            {Math.round(rect.width)} × {Math.round(rect.height)}
          </div>
        </div>
      ) : (
        <div className="pointer-events-none absolute inset-0 bg-black/35" />
      )}
      <div className="pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 rounded-full bg-black/70 px-4 py-1.5 text-sm text-white shadow">
        {t("quickAsk.overlayHint", locale)}
      </div>
    </div>
  );
}
