import { useState } from "react";
import { FileText, X } from "../../../components/icons";
import { cn } from "../../../lib/shared/utils";

// 审计入口：每个研究子页签右上角的小图标，展开该页签的 Provider 原始字段。
// 保持「证据可核验」不变量，同时不占用正文版面。
export function RawJsonAudit({ sections }: { sections: Array<{ label: string; data: unknown }> }) {
  const [open, setOpen] = useState(false);
  const available = sections.filter(
    (section) => section.data !== null && section.data !== undefined,
  );
  if (!available.length) return null;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        title="原始字段（审计）"
        aria-label="查看 Provider 原始字段"
        aria-expanded={open}
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-lg border border-border/40 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground",
          open && "bg-muted/60 text-foreground",
        )}
      >
        {open ? <X className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
      </button>
      {open ? (
        <div className="absolute right-0 top-9 z-20 w-[min(560px,80vw)] rounded-2xl border border-border/50 bg-background/95 p-3 shadow-xl backdrop-blur-xl">
          <div className="text-[11px] font-semibold text-muted-foreground">
            Provider 原始字段 · 仅展示 sidecar 返回内容
          </div>
          <div className="mt-2 max-h-[420px] space-y-2 overflow-auto pr-1">
            {available.map((section) => (
              <details
                key={section.label}
                className="rounded-xl border border-border/35 px-3 py-2"
                open={available.length === 1}
              >
                <summary className="cursor-pointer text-[11px] font-medium">
                  {section.label}
                </summary>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all text-[10px] leading-4 text-muted-foreground">
                  {JSON.stringify(section.data, null, 2)}
                </pre>
              </details>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
