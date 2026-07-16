import assert from "node:assert/strict";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const temporaryRoot = await mkdtemp(join(tmpdir(), "calen-stock-sidecar-"));
const isolatedRoot = join(temporaryRoot, "Calen 股票 sidecar 空格");
const isolatedEntry = join(isolatedRoot, "stdio.mjs");
const isolatedNode = join(
  isolatedRoot,
  process.platform === "win32" ? "node.exe" : "node"
);

try {
  assert.match(await readFile("dist/NOTICE.md", "utf8"), /PDF\.js 5\.6\.205/);
  assert.match(
    await readFile("dist/licenses/unpdf-MIT.txt", "utf8"),
    /MIT License/
  );
  assert.match(
    await readFile("dist/licenses/pdfjs-Apache-2.0.txt", "utf8"),
    /Apache License/
  );
  const opptrixLicense = await readFile(
    "licenses/opptrix-Apache-2.0.txt",
    "utf8"
  );
  assert.match(opptrixLicense, /Apache License/);
  assert.equal(
    await readFile("dist/licenses/opptrix-Apache-2.0.txt", "utf8"),
    opptrixLicense
  );
  await mkdir(isolatedRoot, { recursive: true });
  await copyFile("dist/stdio.mjs", isolatedEntry);
  await copyFile(process.execPath, isolatedNode);
  await chmod(isolatedNode, 0o755);
  const child = spawn(isolatedNode, [isolatedEntry], {
    cwd: isolatedRoot,
    env: { ...process.env, PATH: "" },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdin.end(
    `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "status", params: {} })}\n`
  );
  const exitCode = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("isolated sidecar status request timed out"));
    }, 10_000);
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  assert.equal(exitCode, 0, stderr);
  const response = JSON.parse(stdout.trim());
  assert.equal(response.jsonrpc, "2.0");
  assert.equal(response.id, 1);
  assert.equal(response.result.service, "calen-stock-sidecar");
  assert.ok(Array.isArray(response.result.providers));

  const source = await readFile(isolatedEntry, "utf8");
  assert.doesNotMatch(source, /from\s+["'](?:unpdf|pdfjs-dist)["']/);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
