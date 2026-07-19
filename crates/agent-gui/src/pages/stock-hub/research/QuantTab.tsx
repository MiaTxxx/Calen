import { ExperimentalResearchSection } from "../ExperimentalResearchSection";
import { Disclaimer } from "../shared";
import { ResearchTabPanel, type ResearchTabResource } from "./TabScaffold";

export function QuantTab({ resource }: { resource: ResearchTabResource }) {
  return (
    <ResearchTabPanel
      resource={resource}
      title="量化实验"
      loadingText="正在计算技术指标、评分卡、策略信号和 Evaluator…"
      auditSections={(bundle) =>
        bundle.experimentalAnalysis.map((analysis) => ({
          label: analysis.capability,
          data: analysis.data,
        }))
      }
    >
      {(bundle) => (
        <>
          {bundle.experimentalAnalysis.length || bundle.analysisMetadata ? (
            <ExperimentalResearchSection data={bundle} />
          ) : (
            <p className="mt-4 text-xs text-muted-foreground">
              当前样本未返回可展示的实验分析结果。
            </p>
          )}
          <Disclaimer />
        </>
      )}
    </ResearchTabPanel>
  );
}
