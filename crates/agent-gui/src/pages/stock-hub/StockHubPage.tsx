import { useCallback, useEffect, useState } from "react";
import { GlassPanel, HubBackdrop, HubHeader } from "../../components/hub/HubChrome";
import { AlertTriangle, Zap } from "../../components/icons";
import { cn } from "../../lib/shared/utils";
import {
  type AsyncResource,
  formatStockError,
  getStockServiceFailureMessage,
  type StockResearchModelSettings,
  type StockServiceStatus,
  stockResearch,
  summarizeStockServiceFailure,
} from "../../lib/stock-research";
import { LabView } from "./LabView";
import { MarketView } from "./MarketView";
import { PortfolioWorkspace } from "./PortfolioWorkspace";
import { ResearchView } from "./research/ResearchView";
import { SourcesView } from "./SourcesView";

export type StockHubView = "research" | "market" | "portfolio" | "lab" | "sources";

type Props = {
  sidebarOpen: boolean;
  onOpenSidebar: () => void;
  initialView?: StockHubView;
  modelSettings: StockResearchModelSettings;
};

const views: Array<{ value: StockHubView; label: string; hint: string }> = [
  { value: "research", label: "研究", hint: "行情、财务与证据化研究" },
  { value: "market", label: "市场", hint: "热点、资金流与复盘" },
  { value: "portfolio", label: "自选与持仓", hint: "流水与组合暴露" },
  { value: "lab", label: "实验室", hint: "策略评分与回测" },
  { value: "sources", label: "数据源", hint: "服务状态与能力" },
];

export function StockHubPage({
  sidebarOpen,
  onOpenSidebar,
  initialView = "research",
  modelSettings,
}: Props) {
  const [view, setView] = useState<StockHubView>(initialView);
  const [status, setStatus] = useState<AsyncResource<StockServiceStatus>>({
    state: "idle",
  });

  const refreshStatus = useCallback(async () => {
    setStatus({ state: "loading" });
    try {
      setStatus({ state: "ready", data: await stockResearch.status() });
    } catch (error) {
      setStatus({ state: "error", message: formatStockError(error) });
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  return (
    <div className="hub-page hub-page-enter relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <HubBackdrop tone="neutral" />
      <div className="relative z-10 flex h-full min-h-0 flex-col overflow-hidden">
        <HubHeader
          icon={<Zap className="h-5 w-5" />}
          title="股票研究"
          subtitle="基于来源、时效和不确定性的本地投研工作台"
          sidebarOpen={sidebarOpen}
          onOpenSidebar={onOpenSidebar}
          actions={<ServicePill resource={status} />}
        />
        <div className="hub-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-2 sm:px-6 lg:px-8 xl:px-10">
          <div className="hub-content-stage mx-auto flex w-full max-w-[1320px] flex-col gap-4">
            <nav className="hub-panel-enter grid grid-cols-2 gap-1 rounded-2xl border border-border/40 bg-background/60 p-1 backdrop-blur-xl sm:grid-cols-5">
              {views.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setView(item.value)}
                  className={cn(
                    "rounded-xl px-3 py-2 text-left transition-all",
                    view === item.value
                      ? "bg-background/90 text-foreground shadow-sm ring-1 ring-border/45 dark:bg-white/[0.08]"
                      : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
                  )}
                >
                  <div className="text-[12.5px] font-semibold">{item.label}</div>
                  <div className="mt-0.5 hidden truncate text-[10.5px] opacity-75 lg:block">
                    {item.hint}
                  </div>
                </button>
              ))}
            </nav>
            {view === "research" || view === "market" ? (
              <ServiceFailureNotice resource={status} />
            ) : null}
            {view === "research" ? <ResearchView modelSettings={modelSettings} /> : null}
            {view === "market" ? <MarketView selectedModel={modelSettings.selectedModel} /> : null}
            {view === "portfolio" ? <PortfolioWorkspace /> : null}
            {view === "lab" ? <LabView /> : null}
            {view === "sources" ? (
              <SourcesView
                resource={status}
                onRefresh={refreshStatus}
                onRestarted={(next) => setStatus({ state: "ready", data: next })}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function ServicePill({ resource }: { resource: AsyncResource<StockServiceStatus> }) {
  const ready = resource.state === "ready" && resource.data.state === "ready";
  const partiallyAvailable =
    resource.state === "ready" && resource.data.runtime?.running === true && !ready;
  return (
    <div
      className={cn(
        "hidden items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] sm:flex",
        ready
          ? "border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
          : partiallyAvailable
            ? "border-amber-500/25 bg-amber-500/5 text-amber-700 dark:text-amber-300"
            : "border-border/45 bg-background/60 text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          ready
            ? "bg-emerald-500"
            : partiallyAvailable
              ? "bg-amber-500"
              : resource.state === "loading"
                ? "animate-pulse bg-amber-500"
                : "bg-muted-foreground/50",
        )}
      />
      {ready
        ? "股票服务已就绪"
        : partiallyAvailable
          ? "股票服务部分可用"
          : resource.state === "loading"
            ? "正在连接"
            : "服务未就绪"}
    </div>
  );
}

function ServiceFailureNotice({ resource }: { resource: AsyncResource<StockServiceStatus> }) {
  if (resource.state === "idle" || resource.state === "loading") return null;
  if (
    resource.state === "ready" &&
    (resource.data.state === "ready" || resource.data.runtime?.running === true)
  )
    return null;

  const status = resource.state === "ready" ? resource.data : null;
  const specificMessage = status
    ? getStockServiceFailureMessage(status)
    : resource.state === "error"
      ? summarizeStockServiceFailure(resource.message)
      : undefined;
  return (
    <GlassPanel tone="error">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">股票服务异常</h2>
          <p className="mt-1 break-words text-xs text-destructive">
            {specificMessage ?? "股票服务当前不可用，请前往数据源页面查看诊断并重启服务。"}
          </p>
        </div>
      </div>
    </GlassPanel>
  );
}
