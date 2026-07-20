import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import "katex/dist/katex.min.css";
import "streamdown/styles.css";

// 除主窗口外还有两个由 Rust 动态创建的窗口（截屏框选遮罩、快捷提问小窗），
// 三者共用同一个前端入口，按 Tauri 窗口 label 分流；纯浏览器环境回退主界面。
// 三个根组件都按需加载：遮罩窗只拉取自己的小 chunk，尽快变得可交互。
const App = React.lazy(() => import("./App"));
const QuickAskApp = React.lazy(() =>
  import("./pages/quick-ask/QuickAskApp").then((m) => ({ default: m.QuickAskApp })),
);
const SnipOverlayApp = React.lazy(() =>
  import("./pages/quick-ask/SnipOverlayApp").then((m) => ({ default: m.SnipOverlayApp })),
);

function resolveWindowLabel(): string {
  try {
    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } };
      }
    ).__TAURI_INTERNALS__;
    return internals?.metadata?.currentWindow?.label ?? "main";
  } catch {
    return "main";
  }
}

function selectRoot() {
  switch (resolveWindowLabel()) {
    case "snip-overlay":
      return <SnipOverlayApp />;
    case "quick-ask":
      return <QuickAskApp />;
    default:
      return <App />;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Suspense fallback={null}>{selectRoot()}</Suspense>
  </React.StrictMode>,
);
