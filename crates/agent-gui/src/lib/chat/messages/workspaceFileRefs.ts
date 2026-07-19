import { invokeFs } from "../../tools/fsBackend";

export type WorkspacePathStatus = {
  path: string;
  exists: boolean;
  kind?: string | null;
};

export type WorkspaceGlobResult = {
  paths: string[];
};

const FILE_LIKE_EXTENSION = /\.[A-Za-z0-9]{1,16}$/;
// Captures bare basenames, relative paths, Windows drive paths, and UNC paths.
const FILE_REF_IN_TEXT =
  /(?:[A-Za-z]:[\\/][^\s'"`<>|?*]+|(?:~|\.{1,2})?(?:[\\/][^\s'"`<>|?*]+)+|[A-Za-z0-9_./\\-]+\.[A-Za-z0-9]{1,16})/g;

/** Strip surrounding quotes that models often wrap around file names. */
export function normalizeWorkspaceFileRef(text: string): string {
  return text
    .trim()
    .replace(/^['"`“”‘’]+/, "")
    .replace(/['"`“”‘’]+$/, "")
    .trim();
}

/**
 * Heuristic: does this inline code look like a workspace file/path rather than
 * a short code token (e.g. `const`, `npm`, `v1.2.3`)?
 */
export function looksLikeWorkspaceFileRef(text: string): boolean {
  const value = normalizeWorkspaceFileRef(text);
  if (!value || value.length > 260) return false;
  if (/\s/.test(value)) return false;
  if (/^(https?:|mailto:|data:|javascript:)/i.test(value)) return false;
  // Bare version numbers / pure digits / pure identifiers without extension.
  if (/^v?\d+(\.\d+)+([-+][\w.]+)?$/i.test(value)) return false;
  if (/^[A-Za-z_][\w.-]{0,24}$/.test(value) && !FILE_LIKE_EXTENSION.test(value)) {
    return false;
  }
  // Absolute Windows path, UNC, POSIX absolute, relative path, or basename.ext
  if (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\") || value.startsWith("/")) {
    return true;
  }
  if (value.includes("/") || value.includes("\\")) return true;
  return FILE_LIKE_EXTENSION.test(value);
}

/**
 * Extract the most likely file reference under a double-click caret offset in
 * plain text (models often say "double-click weather-ios18.html" without code
 * fencing).
 */
export function extractWorkspaceFileRefAt(text: string, offset: number): string | null {
  if (!text || offset < 0 || offset > text.length) return null;
  FILE_REF_IN_TEXT.lastIndex = 0;
  for (const match of text.matchAll(FILE_REF_IN_TEXT)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (offset >= start && offset <= end) {
      const candidate = normalizeWorkspaceFileRef(match[0]);
      return looksLikeWorkspaceFileRef(candidate) ? candidate : null;
    }
  }
  return null;
}

function pathDepth(path: string) {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).length;
}

function basenameOf(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

/**
 * Resolve a chat-mentioned file ref against the current workspace.
 * Tries the path as written first, then a recursive basename search.
 * Returns a workspace-relative path suitable for preview/editor openers.
 */
export async function resolveWorkspaceFilePath(
  workdir: string,
  ref: string,
): Promise<string | null> {
  const cleaned = normalizeWorkspaceFileRef(ref);
  const root = workdir.trim();
  if (!cleaned || !root) return null;

  // 1) Direct relative path (or path that fs_path_status can resolve under workdir).
  try {
    const status = await invokeFs<WorkspacePathStatus>("fs_path_status", {
      workdir: root,
      path: cleaned,
    });
    if (status.exists && status.kind === "file") {
      return status.path || cleaned;
    }
  } catch {
    // Outside workdir / invalid path — fall through to basename search.
  }

  // 2) Basename search anywhere under the workspace.
  const base = basenameOf(cleaned);
  if (!base || base === "." || base === "..") return null;

  try {
    const glob = await invokeFs<WorkspaceGlobResult>("fs_glob", {
      workdir: root,
      pattern: `**/${base}`,
      max_results: 30,
      sort_by: "path",
    });
    const paths = (glob.paths ?? []).filter((path) => typeof path === "string" && path.trim());
    if (paths.length === 0) return null;
    if (paths.length === 1) return paths[0];

    const ranked = paths
      .map((path) => {
        const name = basenameOf(path);
        return {
          path,
          exact: name === base ? 0 : 1,
          depth: pathDepth(path),
        };
      })
      .sort(
        (left, right) =>
          left.exact - right.exact ||
          left.depth - right.depth ||
          left.path.localeCompare(right.path),
      );
    return ranked[0]?.path ?? null;
  } catch {
    return null;
  }
}
