import {
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useState,
} from "react";
import type { ExtraProps } from "streamdown";
import {
  looksLikeWorkspaceFileRef,
  normalizeWorkspaceFileRef,
  resolveWorkspaceFilePath,
} from "../../lib/chat/messages/workspaceFileRefs";
import { cn } from "../../lib/shared/utils";

type WorkspaceFileInlineCodeProps = ComponentProps<"code"> &
  ExtraProps & {
    workdir?: string;
    onOpenWorkspaceFile?: (path: string) => void;
  };

function extractText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && node !== null && "props" in node) {
    const element = node as { props?: { children?: ReactNode } };
    return extractText(element.props?.children);
  }
  return "";
}

/**
 * Streamdown inline-code renderer that turns workspace file references
 * (e.g. `weather-ios18.html`, `src/app.ts`) into one-click open actions.
 */
export function WorkspaceFileInlineCode(props: WorkspaceFileInlineCodeProps) {
  const { children, className, workdir, onOpenWorkspaceFile, node: _node, ...rest } = props;
  const text = useMemo(() => extractText(children), [children]);
  const cleaned = useMemo(() => normalizeWorkspaceFileRef(text), [text]);
  const canOpen = Boolean(
    workdir?.trim() && onOpenWorkspaceFile && looksLikeWorkspaceFileRef(cleaned),
  );
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(false);

  const handleActivate = useCallback(
    async (event: MouseEvent<HTMLElement>) => {
      if (!canOpen || !workdir?.trim() || !onOpenWorkspaceFile) return;
      event.preventDefault();
      event.stopPropagation();
      if (busy) return;
      setBusy(true);
      setMissing(false);
      try {
        const resolved = await resolveWorkspaceFilePath(workdir, cleaned);
        if (!resolved) {
          setMissing(true);
          return;
        }
        onOpenWorkspaceFile(resolved);
      } finally {
        setBusy(false);
      }
    },
    [busy, canOpen, cleaned, onOpenWorkspaceFile, workdir],
  );

  if (!canOpen) {
    return (
      <code className={className} {...rest}>
        {children}
      </code>
    );
  }

  const title = missing
    ? `未在当前工作区找到：${cleaned}`
    : busy
      ? `正在打开 ${cleaned}…`
      : `在应用内打开 ${cleaned}`;

  return (
    <button
      type="button"
      title={title}
      data-liveagent-workspace-file={cleaned}
      data-state={missing ? "missing" : busy ? "busy" : "ready"}
      className={cn(
        "chat-markdown-file-link group m-0 inline cursor-pointer border-0 bg-transparent p-0 font-inherit text-inherit align-baseline",
        missing && "text-amber-700 dark:text-amber-300",
        busy && "opacity-70",
      )}
      onClick={(event) => {
        void handleActivate(event);
      }}
      onDoubleClick={(event) => {
        // Models say "double-click the file"; honor that gesture too.
        void handleActivate(event);
      }}
    >
      <code
        {...rest}
        className={cn(
          className,
          "rounded-[0.3em] px-1 py-0.5 font-medium text-primary underline decoration-primary/35 underline-offset-2 transition-colors group-hover:bg-primary/10 group-hover:decoration-primary/70",
          missing && "text-amber-700 decoration-amber-500/50 dark:text-amber-300",
        )}
      >
        {children}
      </code>
    </button>
  );
}
