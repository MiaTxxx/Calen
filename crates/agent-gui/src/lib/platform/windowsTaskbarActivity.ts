export type WindowsTaskbarActivityController = {
  setActive(active: boolean): void;
  dispose(): void;
};

export function createWindowsTaskbarActivityController(options: {
  apply: (active: boolean) => Promise<void>;
  onError?: (error: unknown) => void;
}): WindowsTaskbarActivityController {
  let requestedActive = false;
  let disposed = false;
  let queue = Promise.resolve();

  const enqueue = (active: boolean) => {
    queue = queue
      .then(() => options.apply(active))
      .catch((error) => {
        options.onError?.(error);
      });
  };

  return {
    setActive(active) {
      if (disposed || active === requestedActive) return;
      requestedActive = active;
      enqueue(active);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (!requestedActive) return;
      requestedActive = false;
      enqueue(false);
    },
  };
}

export function isWindowsTauriRuntime(
  runtimeWindow: Window & { __TAURI__?: unknown; __TAURI_INTERNALS__?: unknown },
  userAgent: string,
  platform: string,
): boolean {
  return (
    (runtimeWindow.__TAURI__ !== undefined || runtimeWindow.__TAURI_INTERNALS__ !== undefined) &&
    /Windows|Win32|Win64|WOW64/i.test(`${userAgent} ${platform}`)
  );
}
