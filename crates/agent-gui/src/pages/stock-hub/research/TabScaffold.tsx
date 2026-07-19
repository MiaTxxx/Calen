import type { ReactNode } from "react";
import { GlassPanel } from "../../../components/hub/HubChrome";
import type {
  AsyncResource,
  ResearchBundle,
  StockEvidenceResult,
} from "../../../lib/stock-research";
import { EvidenceHeader, LoadingCard, ResourceError, UnavailableCard } from "../shared";
import { RawJsonAudit } from "./RawJsonAudit";

export type ResearchTabResource = AsyncResource<StockEvidenceResult<ResearchBundle>>;

// 子页签统一骨架：加载/错误/不可用状态 + 证据头（来源、时效、警告）+ 右上角原始字段审计。
export function ResearchTabPanel({
  resource,
  title,
  loadingText,
  auditSections,
  children,
}: {
  resource: ResearchTabResource;
  title: string;
  loadingText: string;
  auditSections: (bundle: ResearchBundle) => Array<{ label: string; data: unknown }>;
  children: (bundle: ResearchBundle) => ReactNode;
}) {
  if (resource.state === "idle") return null;
  if (resource.state === "loading") return <LoadingCard text={loadingText} />;
  if (resource.state === "error") return <ResourceError resource={resource} panel />;
  const result = resource.data;
  if (!result.data) return <UnavailableCard result={result} />;
  const bundle = result.data;
  return (
    <GlassPanel>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <EvidenceHeader result={result} title={title} />
        </div>
        <RawJsonAudit sections={auditSections(bundle)} />
      </div>
      {children(bundle)}
    </GlassPanel>
  );
}
