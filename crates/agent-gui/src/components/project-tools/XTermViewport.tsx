import "@xterm/xterm/css/xterm.css";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import { type CSSProperties, useEffect, useRef } from "react";
import { cn } from "../../lib/shared/utils";
import type {
  TerminalClient,
  TerminalSession,
  TerminalSnapshot,
  TerminalStreamChunk,
  TerminalStreamHandle,
  TerminalStreamInputState,
} from "../../lib/terminal/types";

type XTermViewportProps = {
  client: TerminalClient;
  session: TerminalSession;
  theme: "light" | "dark";
  isActive: boolean;
  initialSnapshot?: TerminalSnapshot;
  className?: string;
  onError: (sessionId: string, message: string | null) => void;
  onInitialSnapshotConsumed?: (sessionId: string) => void;
};

const SNAPSHOT_ATTACH_RETRY_MIN_MS = 500;
const SNAPSHOT_ATTACH_RETRY_MAX_MS = 5_000;

function terminalTheme(theme: "light" | "dark") {
  if (theme === "dark") {
    return {
      background: "#0b0f14",
      foreground: "#4ade80",
      cursor: "#f8fafc",
      cursorAccent: "#0b0f14",
      selectionBackground: "#2c3e57",
      selectionInactiveBackground: "#22304a",
      scrollbarSliderBackground: "rgba(148, 163, 184, 0.18)",
      scrollbarSliderHoverBackground: "rgba(148, 163, 184, 0.3)",
      scrollbarSliderActiveBackground: "rgba(148, 163, 184, 0.42)",
      overviewRulerBorder: "transparent",
      black: "#1b2733",
      red: "#ef4444",
      green: "#22c55e",
      yellow: "#eab308",
      blue: "#38bdf8",
      magenta: "#c084fc",
      cyan: "#2dd4bf",
      white: "#cbd5e1",
      brightBlack: "#64748b",
      brightRed: "#f87171",
      brightGreen: "#4ade80",
      brightYellow: "#fde047",
      brightBlue: "#7dd3fc",
      brightMagenta: "#d8b4fe",
      brightCyan: "#5eead4",
      brightWhite: "#f8fafc",
    };
  }
  return {
    background: "#fcfcfd",
    foreground: "#1f2933",
    cursor: "#111827",
    cursorAccent: "#fcfcfd",
    selectionBackground: "#bfdbfe",
    selectionInactiveBackground: "#dbeafe",
    scrollbarSliderBackground: "rgba(100, 116, 139, 0.16)",
    scrollbarSliderHoverBackground: "rgba(100, 116, 139, 0.26)",
    scrollbarSliderActiveBackground: "rgba(100, 116, 139, 0.36)",
    overviewRulerBorder: "transparent",
    black: "#1f2933",
    red: "#dc2626",
    green: "#16a34a",
    yellow: "#b45309",
    blue: "#2563eb",
    magenta: "#9333ea",
    cyan: "#0891b2",
    white: "#e2e8f0",
    brightBlack: "#64748b",
    brightRed: "#ef4444",
    brightGreen: "#22c55e",
    brightYellow: "#d97706",
    brightBlue: "#3b82f6",
    brightMagenta: "#a855f7",
    brightCyan: "#06b6d4",
    brightWhite: "#f8fafc",
  };
}

function terminalContainerHasSize(container: HTMLElement) {
  const rect = container.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function XTermViewport({
  client,
  session,
  theme,
  isActive,
  initialSnapshot,
  className,
  onError,
  onInitialSnapshotConsumed,
}: XTermViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const resizeTimerRef = useRef<number | null>(null);
  const sessionRef = useRef(session);
  const themeRef = useRef(theme);
  const onErrorRef = useRef(onError);
  const initialSnapshotRef = useRef(initialSnapshot);
  const onInitialSnapshotConsumedRef = useRef(onInitialSnapshotConsumed);
  sessionRef.current = session;
  themeRef.current = theme;
  onErrorRef.current = onError;
  onInitialSnapshotConsumedRef.current = onInitialSnapshotConsumed;

  const termRef = useRef<XTerm | null>(null);
  const fitAndResizeRef = useRef<(() => void) | null>(null);
  const viewportStyle = {
    "--project-terminal-background": terminalTheme(theme).background,
  } as CSSProperties;

  useEffect(() => {
    if (!termRef.current) return;
    termRef.current.options.theme = terminalTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (!isActive) {
      termRef.current?.blur();
      return;
    }
    termRef.current?.focus();
    window.setTimeout(() => {
      fitAndResizeRef.current?.();
    }, 0);
  }, [isActive]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let snapshotLoaded = false;
    let loadingSnapshot = false;
    let renderedOutput = false;
    let lastOutputOffset = 0;
    let streamHandle: TerminalStreamHandle | null = null;
    let inputPausedByStream = false;
    let inputBackpressureMessageActive = false;
    let snapshotRetryTimer: number | null = null;
    let snapshotRetryDelayMs = SNAPSHOT_ATTACH_RETRY_MIN_MS;
    const bufferedChunks: TerminalStreamChunk[] = [];
    const encoder = new TextEncoder();
    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: "block",
      cursorInactiveStyle: "outline",
      disableStdin: true,
      fontFamily:
        '"SF Mono", SFMono-Regular, Menlo, Monaco, "Cascadia Code", Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      fontWeight: "normal",
      fontWeightBold: "bold",
      lineHeight: 1.3,
      letterSpacing: 0,
      scrollback: 5000,
      overviewRuler: {
        width: 8,
      },
      theme: terminalTheme(themeRef.current),
    });
    termRef.current = term;
    // xterm 不内置复制/粘贴快捷键。宿主实现：
    // - Ctrl+Shift+C / Ctrl+Insert：复制选区
    // - Ctrl+C：有选区时复制（Windows Terminal 惯例），无选区放行给 SIGINT
    // - Ctrl+Shift+V / Shift+Insert：粘贴
    // 剪贴板写入优先同步 execCommand 回退：Tauri/WebView2 上 async clipboard
    // 常在 keydown 里失败，且原先 .catch(() => undefined) 会静默吞掉。
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown" || event.altKey || event.metaKey) {
        return true;
      }

      const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
      const isKeyC = event.code === "KeyC" || key === "c";
      const isKeyV = event.code === "KeyV" || key === "v";
      const isInsert = event.code === "Insert" || key === "insert";

      // Ctrl+C with an active selection copies instead of sending SIGINT.
      if (event.ctrlKey && !event.shiftKey && isKeyC) {
        const selection = term.getSelection();
        if (selection) {
          writeTerminalClipboardText(selection);
          // execCommand path focuses a temporary textarea; restore terminal focus.
          window.setTimeout(() => {
            if (!disposed) term.focus();
          }, 0);
          event.preventDefault();
          return false;
        }
        return true;
      }

      if (event.ctrlKey && event.shiftKey && isKeyC) {
        const selection = term.getSelection();
        if (selection) {
          writeTerminalClipboardText(selection);
          window.setTimeout(() => {
            if (!disposed) term.focus();
          }, 0);
        }
        event.preventDefault();
        return false;
      }

      // Ctrl+Insert → copy (classic Windows terminal binding)
      if (event.ctrlKey && !event.shiftKey && isInsert) {
        const selection = term.getSelection();
        if (selection) {
          writeTerminalClipboardText(selection);
          window.setTimeout(() => {
            if (!disposed) term.focus();
          }, 0);
        }
        event.preventDefault();
        return false;
      }

      if (event.ctrlKey && event.shiftKey && isKeyV) {
        void readTerminalClipboardText().then((text) => {
          if (text && !disposed) {
            term.paste(text);
          }
        });
        event.preventDefault();
        return false;
      }

      // Shift+Insert → paste
      if (!event.ctrlKey && event.shiftKey && isInsert) {
        void readTerminalClipboardText().then((text) => {
          if (text && !disposed) {
            term.paste(text);
          }
        });
        event.preventDefault();
        return false;
      }

      return true;
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    let touchScrollActive = false;
    let touchScrollCancelled = false;
    let lastTouchX = 0;
    let lastTouchY = 0;
    let touchScrollRemainder = 0;

    const reportError = (message: string | null) => {
      onErrorRef.current(sessionRef.current.id, message);
    };

    const focusTerminal = () => {
      if (disposed || !sessionRef.current.running) return;
      term.focus();
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      focusTerminal();
    };

    const fitAndResize = () => {
      if (disposed) return;
      if (!terminalContainerHasSize(container)) return;
      try {
        fit.fit();
        streamHandle?.resize(term.cols, term.rows);
      } catch {
        // xterm fit can throw while the panel is hidden or measuring at zero size.
      }
    };
    fitAndResizeRef.current = fitAndResize;

    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
      }
      resizeTimerRef.current = window.setTimeout(fitAndResize, 40);
    });
    resizeObserver.observe(container);
    window.setTimeout(fitAndResize, 0);

    const applyStdinState = () => {
      term.options.disableStdin = !sessionRef.current.running || inputPausedByStream;
    };

    const applyInputState = (state: TerminalStreamInputState) => {
      inputPausedByStream = state.paused;
      applyStdinState();
      if (state.paused) {
        inputBackpressureMessageActive = true;
        reportError(terminalInputPausedMessage(state));
      } else if (inputBackpressureMessageActive) {
        inputBackpressureMessageActive = false;
        reportError(null);
      }
    };

    const dataDisposable = term.onData((data) => {
      if (!streamHandle || term.options.disableStdin) return;
      const accepted = streamHandle.write(encoder.encode(data));
      if (!accepted && !inputPausedByStream) {
        applyInputState({
          paused: true,
          queuedBytes: 0,
          highWaterBytes: 256 * 1024,
          reason: "slow",
        });
      }
    });

    const getTouchScrollRowHeight = () =>
      Math.max(8, Math.floor(container.clientHeight / Math.max(1, term.rows)));

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        touchScrollCancelled = true;
        touchScrollActive = false;
        touchScrollRemainder = 0;
        return;
      }
      const touch = event.touches[0];
      if (!touch) return;
      touchScrollCancelled = false;
      touchScrollActive = false;
      touchScrollRemainder = 0;
      lastTouchX = touch.clientX;
      lastTouchY = touch.clientY;
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (touchScrollCancelled || event.touches.length !== 1) return;
      const touch = event.touches[0];
      if (!touch) return;

      const deltaX = touch.clientX - lastTouchX;
      const deltaY = touch.clientY - lastTouchY;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);
      if (!touchScrollActive) {
        if (absX > absY && absX > 8) {
          touchScrollCancelled = true;
          return;
        }
        if (absY < 8) return;
        touchScrollActive = true;
      }

      lastTouchX = touch.clientX;
      lastTouchY = touch.clientY;
      touchScrollRemainder += -deltaY;
      const rowHeight = getTouchScrollRowHeight();
      const rows = Math.trunc(touchScrollRemainder / rowHeight);
      if (rows !== 0) {
        term.scrollLines(rows);
        touchScrollRemainder -= rows * rowHeight;
      }
      event.preventDefault();
    };

    const resetTouchScroll = () => {
      touchScrollActive = false;
      touchScrollCancelled = false;
      touchScrollRemainder = 0;
    };

    const handleTouchEnd = () => {
      const shouldFocus = !touchScrollActive && !touchScrollCancelled;
      resetTouchScroll();
      if (shouldFocus) {
        focusTerminal();
      }
    };

    const handleTouchCancel = () => {
      resetTouchScroll();
    };

    container.addEventListener("pointerdown", handlePointerDown);
    container.addEventListener("touchstart", handleTouchStart, {
      passive: true,
    });
    container.addEventListener("touchmove", handleTouchMove, {
      passive: false,
    });
    container.addEventListener("touchend", handleTouchEnd);
    container.addEventListener("touchcancel", handleTouchCancel);

    const snapshotBytes = (snapshot: TerminalSnapshot) => {
      if (snapshot.outputBytes) return snapshot.outputBytes;
      return encoder.encode(snapshot.output);
    };

    const writeChunk = (chunk: TerminalStreamChunk) => {
      const result = writeTerminalChunk(
        term,
        chunk,
        (nextOffset) => {
          lastOutputOffset = nextOffset;
        },
        lastOutputOffset,
      );
      if (result !== "skipped") {
        renderedOutput = true;
      }
    };

    const applySnapshot = (snapshot: TerminalSnapshot) => {
      const bytes = snapshotBytes(snapshot);
      const startOffset = terminalSnapshotStartOffset(snapshot);
      const endOffset = terminalSnapshotEndOffset(snapshot);
      if (!renderedOutput) {
        if (bytes.byteLength > 0) {
          term.write(bytes);
          renderedOutput = true;
        }
        lastOutputOffset = endOffset;
      } else if (startOffset > lastOutputOffset || snapshot.truncated) {
        // The snapshot no longer lines up with what is already on screen
        // (output was dropped while detached, or the agent ring truncated):
        // replay from scratch instead of appending duplicated/garbled bytes.
        term.reset();
        if (bytes.byteLength > 0) {
          term.write(bytes);
        }
        lastOutputOffset = endOffset;
      } else if (endOffset > lastOutputOffset) {
        const alreadyWritten = lastOutputOffset - startOffset;
        const pending = alreadyWritten > 0 ? bytes.subarray(alreadyWritten) : bytes;
        if (pending.byteLength > 0) {
          term.write(pending);
        }
        lastOutputOffset = endOffset;
      }
      snapshotLoaded = true;
      loadingSnapshot = false;
      applyStdinState();
      replayBufferedChunks();
      window.setTimeout(fitAndResize, 0);
    };

    const replayBufferedChunks = () => {
      const chunks = bufferedChunks.splice(0);
      for (const chunk of chunks) {
        writeChunk(chunk);
      }
    };

    const clearSnapshotRetryTimer = () => {
      if (snapshotRetryTimer !== null) {
        window.clearTimeout(snapshotRetryTimer);
        snapshotRetryTimer = null;
      }
    };

    const scheduleSnapshotRetry = () => {
      if (disposed || streamHandle || snapshotRetryTimer !== null) return;
      const delay = snapshotRetryDelayMs;
      snapshotRetryDelayMs = Math.min(snapshotRetryDelayMs * 2, SNAPSHOT_ATTACH_RETRY_MAX_MS);
      snapshotRetryTimer = window.setTimeout(() => {
        snapshotRetryTimer = null;
        loadSnapshot();
      }, delay);
    };

    const loadSnapshot = () => {
      if (disposed || loadingSnapshot) return;
      loadingSnapshot = true;
      const s = sessionRef.current;
      void client.stream
        .attach(s)
        .then((handle) => {
          if (disposed) {
            handle.dispose();
            return;
          }
          streamHandle = handle;
          clearSnapshotRetryTimer();
          snapshotRetryDelayMs = SNAPSHOT_ATTACH_RETRY_MIN_MS;
          reportError(null);
          streamOutputUnsubscribe = handle.subscribeOutput((chunk) => {
            if (disposed || chunk.sessionId !== sessionRef.current.id) return;
            if (snapshotLoaded && !loadingSnapshot) {
              writeChunk(chunk);
            } else {
              bufferedChunks.push(chunk);
            }
          });
          streamInputUnsubscribe = handle.subscribeInputState((state) => {
            if (disposed) return;
            applyInputState(state);
          });
          const snapshot: TerminalSnapshot = {
            session: handle.snapshot.session,
            output: "",
            outputBytes: handle.snapshot.bytes,
            truncated: handle.snapshot.truncated,
            outputStartOffset: handle.snapshot.outputStartOffset,
            outputEndOffset: handle.snapshot.outputEndOffset,
          };
          const initial = initialSnapshotRef.current;
          if (initial?.session.id === sessionRef.current.id) {
            initialSnapshotRef.current = undefined;
            onInitialSnapshotConsumedRef.current?.(initial.session.id);
          }
          applySnapshot(snapshot);
        })
        .catch((error) => {
          loadingSnapshot = false;
          if (!disposed) {
            reportError(error instanceof Error ? error.message : String(error));
            snapshotLoaded = false;
            applyStdinState();
            scheduleSnapshotRetry();
          }
        });
    };

    let streamOutputUnsubscribe: (() => void) | null = null;
    let streamInputUnsubscribe: (() => void) | null = null;
    const unsubscribe = client.subscribe((event) => {
      if (disposed || event.sessionId !== session.id) return;
      if (event.kind === "exit" || event.kind === "closed" || event.kind === "reconnecting") {
        term.options.disableStdin = true;
      }
      if (event.kind === "reconnected") {
        applyStdinState();
        window.setTimeout(fitAndResize, 0);
      }
    });

    // Offline-first: paint the cached snapshot immediately so the terminal has
    // content while attach is pending or retrying; a successful attach then
    // trims by offset (or resets on gap/truncation). The snapshot is only
    // consumed — and its owner notified — once attach succeeds.
    const initial = initialSnapshotRef.current;
    if (initial && initial.session.id === sessionRef.current.id) {
      applySnapshot(initial);
    }

    loadSnapshot();

    return () => {
      disposed = true;
      termRef.current = null;
      fitAndResizeRef.current = null;
      unsubscribe();
      dataDisposable.dispose();
      resizeObserver.disconnect();
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = null;
      }
      clearSnapshotRetryTimer();
      container.removeEventListener("pointerdown", handlePointerDown);
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEnd);
      container.removeEventListener("touchcancel", handleTouchCancel);
      streamOutputUnsubscribe?.();
      streamInputUnsubscribe?.();
      streamHandle?.dispose();
      term.dispose();
    };
  }, [client, session.id, session.projectPathKey]);

  return (
    <div
      ref={containerRef}
      style={viewportStyle}
      className={cn("project-terminal-viewport h-full min-h-0 w-full overflow-hidden", className)}
    />
  );
}

/**
 * Write text to the system clipboard from a terminal key handler.
 * Prefer a synchronous execCommand path first: async clipboard.writeText often
 * fails or loses user-activation in Tauri WebView2, and a silent catch made
 * Ctrl+Shift+C look broken.
 */
function writeTerminalClipboardText(text: string) {
  if (!text) return;
  if (fallbackWriteTextToClipboard(text)) return;
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text).catch(() => undefined);
  }
}

function fallbackWriteTextToClipboard(text: string): boolean {
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    // Keep it in-viewport but invisible so execCommand('copy') is allowed.
    textarea.style.position = "fixed";
    textarea.style.left = "0";
    textarea.style.top = "0";
    textarea.style.width = "1px";
    textarea.style.height = "1px";
    textarea.style.padding = "0";
    textarea.style.border = "none";
    textarea.style.outline = "none";
    textarea.style.boxShadow = "none";
    textarea.style.background = "transparent";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

async function readTerminalClipboardText(): Promise<string> {
  try {
    if (navigator.clipboard?.readText) {
      return (await navigator.clipboard.readText()) ?? "";
    }
  } catch {
    // Permission or insecure-context failures fall through to empty.
  }
  return "";
}

function terminalInputPausedMessage(state: TerminalStreamInputState) {
  if (state.reason === "offline") {
    return "终端连接正在恢复，已暂停输入以避免过期按键。";
  }
  if (state.reason === "closed") {
    return "终端输入已关闭。";
  }
  return "终端连接较慢，已暂停输入以避免输入队列过大。";
}

function terminalSnapshotStartOffset(snapshot: TerminalSnapshot) {
  if (
    typeof snapshot.outputStartOffset === "number" &&
    Number.isFinite(snapshot.outputStartOffset) &&
    snapshot.outputStartOffset >= 0
  ) {
    return snapshot.outputStartOffset;
  }
  return 0;
}

function terminalSnapshotEndOffset(snapshot: TerminalSnapshot) {
  if (
    typeof snapshot.outputEndOffset === "number" &&
    Number.isFinite(snapshot.outputEndOffset) &&
    snapshot.outputEndOffset >= 0
  ) {
    return snapshot.outputEndOffset;
  }
  return (
    terminalSnapshotStartOffset(snapshot) +
    (snapshot.outputBytes?.byteLength ?? new TextEncoder().encode(snapshot.output).byteLength)
  );
}

// Exported for tests: offset bookkeeping for live terminal chunks, including
// the reconnect-gap reset path.
export function writeTerminalChunk(
  term: Pick<XTerm, "write" | "reset">,
  chunk: TerminalStreamChunk,
  setLastOutputOffset: (offset: number) => void,
  lastOutputOffset: number,
): "written" | "skipped" | "reset" {
  const data = chunk.bytes;
  if (data.byteLength === 0) return "skipped";
  const startOffset = chunk.startOffset;
  const endOffset = chunk.endOffset;
  if (
    typeof startOffset === "number" &&
    Number.isFinite(startOffset) &&
    typeof endOffset === "number" &&
    Number.isFinite(endOffset) &&
    endOffset >= startOffset
  ) {
    if (endOffset <= lastOutputOffset) return "skipped";
    if (startOffset > lastOutputOffset) {
      // A hole in the byte stream: the transport replayed a snapshot after a
      // reconnect (the stream client injects the full buffered content as one
      // chunk) or the agent ring dropped bytes. Appending would duplicate or
      // garble the screen, so redraw from the authoritative chunk instead.
      term.reset();
      term.write(data);
      setLastOutputOffset(endOffset);
      return "reset";
    }
    const alreadyWritten = lastOutputOffset - startOffset;
    term.write(alreadyWritten > 0 ? data.subarray(alreadyWritten) : data);
    setLastOutputOffset(endOffset);
    return "written";
  }
  term.write(data);
  setLastOutputOffset(lastOutputOffset + data.byteLength);
  return "written";
}
