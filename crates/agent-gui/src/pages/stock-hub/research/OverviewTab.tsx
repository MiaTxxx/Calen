import { Loader2, Sparkles } from "../../../components/icons";
import { Button } from "../../../components/ui/button";
import type { AsyncResource, StockAiResearchBrief } from "../../../lib/stock-research";
import { BulletSection, Disclaimer, formatCompactAmount } from "../shared";
import { parseEtf, parseProfile, sectionFor } from "./evidence";
import { ResearchTabPanel, type ResearchTabResource } from "./TabScaffold";

export function OverviewTab({
  resource,
  aiBrief,
  onGenerateBrief,
}: {
  resource: ResearchTabResource;
  aiBrief: AsyncResource<StockAiResearchBrief>;
  onGenerateBrief: () => void;
}) {
  return (
    <ResearchTabPanel
      resource={resource}
      title="概览"
      loadingText="正在聚合公司资料与来源…"
      auditSections={(bundle) =>
        bundle.evidenceSections.map((section) => ({
          label: section.capability,
          data: section.data,
        }))
      }
    >
      {(bundle) => {
        const profile = parseProfile(sectionFor(bundle, "profile")?.data);
        const etf = parseEtf(sectionFor(bundle, "etf")?.data);
        return (
          <>
            <AiBriefSection resource={aiBrief} onGenerate={onGenerateBrief} />
            {profile ? <ProfileCard profile={profile} /> : null}
            {etf ? <EtfCard etf={etf} /> : null}
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <BulletSection title="Provider 关键事实" items={bundle.facts} />
              <BulletSection title="Provider 数据缺口" items={bundle.risks} warning />
              <BulletSection title="Provider 待验证事项" items={bundle.openQuestions} />
            </div>
            <Disclaimer />
          </>
        );
      }}
    </ResearchTabPanel>
  );
}

// AI 研究简报：概览页手动触发；模型只读取证据包，不联网、不改持仓。
function AiBriefSection({
  resource,
  onGenerate,
}: {
  resource: AsyncResource<StockAiResearchBrief>;
  onGenerate: () => void;
}) {
  if (resource.state === "idle") {
    return (
      <section className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/15 bg-primary/[0.035] p-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4" />
            AI 研究简报
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            先拉取全量研究证据，再由所选模型生成简报；模型只能读取证据包，不启用联网搜索。
          </p>
        </div>
        <Button onClick={onGenerate} className="gap-2">
          <Sparkles className="h-4 w-4" />
          生成 AI 简报
        </Button>
      </section>
    );
  }
  if (resource.state === "loading") {
    return (
      <section className="mt-4 rounded-2xl border border-primary/15 bg-primary/[0.035] p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在聚合全量证据并调用所选模型生成 AI 研究简报…
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          模型只能读取证据包，不启用联网搜索，也不会修改持仓。
        </p>
      </section>
    );
  }
  if (resource.state === "error") {
    return (
      <section className="mt-4 rounded-2xl border border-destructive/25 bg-destructive/5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold text-destructive">AI 研究简报生成失败</div>
          <Button variant="outline" size="sm" onClick={onGenerate}>
            重试
          </Button>
        </div>
        <p className="mt-2 text-[11px] leading-5 text-muted-foreground">{resource.message}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          各页签的 Provider 证据仍可核验；Calen 不会用 sidecar 空字段伪装成模型结论。
        </p>
      </section>
    );
  }
  const brief = resource.data;
  return (
    <section className="mt-4 rounded-2xl border border-primary/15 bg-primary/[0.035] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          <h3 className="text-sm font-semibold">AI 研究简报</h3>
        </div>
        <span className="text-[10px] text-muted-foreground">
          {brief.model.providerId} / {brief.model.model} · {brief.generatedAt}
        </span>
      </div>
      <p className="mt-3 text-[13px] leading-6 text-foreground/85">{brief.summary}</p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <BulletSection title="可核验事实" items={brief.facts} />
        <BulletSection title="支持论据" items={brief.supportingCases} />
        <BulletSection title="反面论据" items={brief.counterCases} warning />
        <BulletSection title="主要风险" items={brief.risks} warning />
        <BulletSection title="待验证事项" items={brief.openQuestions} />
      </div>
    </section>
  );
}

function ProfileCard({ profile }: { profile: NonNullable<ReturnType<typeof parseProfile>> }) {
  const facts: Array<{ label: string; value: string }> = [];
  if (profile.industry) facts.push({ label: "所属行业", value: profile.industry });
  if (profile.listingDate) facts.push({ label: "上市日期", value: profile.listingDate });
  if (profile.registeredCapital !== null)
    facts.push({ label: "注册资本", value: formatCompactAmount(profile.registeredCapital) });
  if (profile.employees !== null)
    facts.push({ label: "员工人数", value: profile.employees.toLocaleString("zh-CN") });
  if (profile.chairman) facts.push({ label: "董事长", value: profile.chairman });
  if (profile.legalRepresentative)
    facts.push({ label: "法定代表人", value: profile.legalRepresentative });
  if (profile.province) facts.push({ label: "所在地", value: profile.province });
  return (
    <section className="mt-4 rounded-2xl border border-border/40 bg-background/45 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{profile.companyName ?? "公司资料"}</h3>
        {profile.website ? (
          <a
            href={
              profile.website.startsWith("http") ? profile.website : `https://${profile.website}`
            }
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-primary hover:underline"
          >
            公司网站
          </a>
        ) : null}
      </div>
      {facts.length ? (
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          {facts.map((fact) => (
            <div key={fact.label} className="rounded-xl bg-muted/40 px-3 py-2">
              <div className="text-[11px] text-muted-foreground">{fact.label}</div>
              <div className="mt-1 text-xs font-medium">{fact.value}</div>
            </div>
          ))}
        </div>
      ) : null}
      {profile.description ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
            公司简介
          </summary>
          <p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-muted-foreground">
            {profile.description}
          </p>
        </details>
      ) : null}
      {profile.businessScope ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
            经营范围
          </summary>
          <p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-muted-foreground">
            {profile.businessScope}
          </p>
        </details>
      ) : null}
    </section>
  );
}

function EtfCard({ etf }: { etf: NonNullable<ReturnType<typeof parseEtf>> }) {
  const maxRatio = Math.max(...etf.holdings.map((item) => item.ratioPercent ?? 0), 1);
  return (
    <section className="mt-4 rounded-2xl border border-border/40 bg-background/45 p-4">
      <h3 className="text-sm font-semibold">ETF 净值与持仓</h3>
      {etf.fields.length ? (
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          {etf.fields.slice(0, 8).map((field) => (
            <div key={field.label} className="rounded-xl bg-muted/40 px-3 py-2">
              <div className="text-[11px] text-muted-foreground">{field.label}</div>
              <div className="mt-1 break-words text-xs font-medium">{field.value}</div>
            </div>
          ))}
        </div>
      ) : null}
      {etf.holdings.length ? (
        <div className="mt-3 space-y-1.5">
          {etf.holdings.slice(0, 10).map((holding) => (
            <div key={`${holding.code ?? holding.name}`} className="flex items-center gap-3">
              <span className="w-36 truncate text-xs">{holding.name}</span>
              <span className="w-16 shrink-0 font-mono text-[11px] text-muted-foreground">
                {holding.code ?? ""}
              </span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted/40">
                <div
                  className="h-full rounded-full bg-primary/55"
                  style={{ width: `${((holding.ratioPercent ?? 0) / maxRatio) * 100}%` }}
                />
              </div>
              <span className="w-14 shrink-0 text-right text-xs tabular-nums">
                {holding.ratioPercent === null ? "—" : `${holding.ratioPercent}%`}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
