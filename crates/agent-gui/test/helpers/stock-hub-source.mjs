import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

// StockHubPage 已拆分为壳 + 独立视图文件；契约测试对整个 stock-hub 目录的
// 聚合源码做模式断言，避免因文件再拆分而反复改测试。
export async function readStockHubSource() {
  const root = fileURLToPath(
    new URL("../../src/pages/stock-hub/", import.meta.url)
  );
  const entries = await readdir(root, { recursive: true });
  const files = entries
    .filter((entry) => entry.endsWith(".tsx") || entry.endsWith(".ts"))
    .sort();
  const sources = await Promise.all(
    files.map((entry) => readFile(path.join(root, entry), "utf8"))
  );
  return sources.join("\n");
}
