import { useCallback, useEffect, useState } from "react";
import { GlassPanel } from "../../components/hub/HubChrome";
import { RefreshCw } from "../../components/icons";
import { Button } from "../../components/ui/button";
import { applyCronOps, getAutomationState, initAutomation } from "../../lib/automation/store";
import { cn } from "../../lib/shared/utils";
import {
  type AsyncResource,
  formatStockError,
  type MarketBrief,
  type StockEvidenceResult,
  type StockResearchModelSettings,
  stockResearch,
} from "../../lib/stock-research";
import { Disclaimer, EvidenceHeader, LoadingCard, ResourceError, UnavailableCard } from "./shared";

export function MarketView({
  selectedModel,
}: {
  selectedModel?: StockResearchModelSettings["selectedModel"];
}) {
  const [brief, setBrief] = useState<AsyncResource<StockEvidenceResult<MarketBrief>>>({
    state: "idle",
  });
  const [scheduleMessage, setScheduleMessage] = useState<string | null>(null);
  const load = useCallback(async () => {
    setBrief({ state: "loading" });
    try {
      setBrief({
        state: "ready",
        data: await stockResearch.marketBrief({
          market: "CN",
          session: "on_demand",
        }),
      });
    } catch (error) {
      setBrief({ state: "error", message: formatStockError(error) });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function createMarketSchedule(kind: "pre-open" | "close") {
    setScheduleMessage(null);
    if (!selectedModel) {
      setScheduleMessage("请先在主对话中选择一个可用模型，再创建定时报告。");
      return;
    }
    try {
      await initAutomation();
      const preset =
        kind === "pre-open"
          ? {
              id: "calen-stock-pre-open",
              name: "股票盘前报告",
              description: "工作日盘前生成 A 股证据化市场报告",
              cron: "0 30 8 * * 1-5",
              prompt:
                "请调用 StockMarketBrief 生成 A 股盘前报告。必须展示数据来源、截至时间、获取时间和警告；缺失板块、资金流或情绪数据时明确标记 partial，不得补造，也不得输出买卖指令。",
            }
          : {
              id: "calen-stock-close-review",
              name: "股票收盘复盘",
              description: "工作日收盘后生成 A 股证据化复盘",
              cron: "0 30 15 * * 1-5",
              prompt:
                "请调用 StockMarketBrief 生成 A 股收盘复盘，覆盖涨跌停、热股、板块、资金流、龙虎榜、异动和市场情绪。必须展示来源和截至时间；任何缺失数据均标记 partial，不得补造或给出确定性交易建议。",
            };
      const existing = getAutomationState().cron.tasks.find((task) => task.id === preset.id);
      await applyCronOps([
        existing
          ? {
              op: "update",
              id: preset.id,
              patch: {
                ...preset,
                enabled: true,
                type: "prompt",
                selectedModel,
              },
            }
          : {
              op: "create",
              item: {
                ...preset,
                enabled: true,
                type: "prompt",
                selectedModel,
              },
            },
      ]);
      setScheduleMessage(
        kind === "pre-open"
          ? "盘前报告任务已保存：工作日 08:30 执行。"
          : "收盘复盘任务已保存：工作日 15:30 执行。",
      );
    } catch (error) {
      setScheduleMessage(`创建定时报告失败：${formatStockError(error)}`);
    }
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => void createMarketSchedule("pre-open")}>
          创建盘前任务
        </Button>
        <Button variant="outline" size="sm" onClick={() => void createMarketSchedule("close")}>
          创建收盘复盘
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={brief.state === "loading"}
          className="gap-2"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", brief.state === "loading" && "animate-spin")} />
          刷新市场
        </Button>
      </div>
      {scheduleMessage ? (
        <div className="rounded-xl border border-border/40 bg-background/55 px-3 py-2 text-[11px] text-muted-foreground">
          {scheduleMessage}
        </div>
      ) : null}
      {brief.state === "loading" ? <LoadingCard text="正在生成 A 股市场概览…" /> : null}
      <ResourceError resource={brief} panel />
      {brief.state === "ready" && brief.data.data ? (
        <GlassPanel>
          <EvidenceHeader result={brief.data} title={brief.data.data.title} />
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{brief.data.data.summary}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {brief.data.data.highlights.map((item) => (
              <div
                key={`${item.title}-${item.value ?? ""}`}
                className="rounded-2xl border border-border/40 bg-background/55 p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold">{item.title}</span>
                  {item.value ? (
                    <span
                      className={cn(
                        "text-sm font-semibold tabular-nums",
                        item.tone === "up"
                          ? "text-red-600"
                          : item.tone === "down"
                            ? "text-emerald-600"
                            : "",
                      )}
                    >
                      {item.value}
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{item.detail}</p>
              </div>
            ))}
          </div>
          <MarketBriefSections sections={brief.data.data.sections} />
          <Disclaimer />
        </GlassPanel>
      ) : null}
      {brief.state === "ready" && !brief.data.data ? <UnavailableCard result={brief.data} /> : null}
    </div>
  );
}

function MarketBriefSections({ sections }: { sections: MarketBrief["sections"] }) {
  if (!sections.length) return null;
  return (
    <section className="mt-5 space-y-3">
      <div>
        <h3 className="text-xs font-semibold">市场专题明细</h3>
        <p className="mt-1 text-[11px] text-muted-foreground">
          涨跌停、板块、资金流、龙虎榜与异动均展示真实返回条目；缺失分项不会补造。
        </p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {sections.map((section) => (
          <div
            key={section.key}
            className="rounded-2xl border border-border/40 bg-background/50 p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs font-semibold">{section.label}</h4>
              <span className="text-[10.5px] text-muted-foreground">
                {section.total !== undefined
                  ? `共 ${section.total} 条`
                  : `${section.items.length} 条`}
              </span>
            </div>
            <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
              {section.items.map((item, index) => (
                <div
                  key={`${section.key}-${item.title}-${index}`}
                  className="rounded-xl bg-muted/30 px-3 py-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[11px] font-medium">{item.title}</span>
                    {item.value ? (
                      <span className="shrink-0 text-[11px] font-semibold tabular-nums">
                        {item.value}
                      </span>
                    ) : null}
                  </div>
                  {item.detail ? (
                    <p className="mt-1 text-[10.5px] leading-4 text-muted-foreground">
                      {item.detail}
                    </p>
                  ) : null}
                  {item.fields.length ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {item.fields.slice(0, 10).map((field) => (
                        <span
                          key={`${field.label}-${field.value}`}
                          className="rounded-md bg-background/65 px-1.5 py-1 text-[10px] text-muted-foreground"
                        >
                          {field.label}: {field.value}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
