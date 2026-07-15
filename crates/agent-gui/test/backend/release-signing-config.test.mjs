import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const guiRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const repoRoot = path.resolve(guiRoot, "../..");
const validationScript = path.join(
  repoRoot,
  "scripts/release/validate-updater-signing-env.mjs"
);
const releaseWorkflow = readFileSync(
  path.join(repoRoot, ".github/workflows/desktop-release.yml"),
  "utf8"
);

function runValidation(env = {}) {
  return spawnSync(process.execPath, [validationScript], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      TAURI_SIGNING_PRIVATE_KEY: "",
      CALEN_UPDATER_PUBLIC_KEY: "",
      ...env,
    },
  });
}

test("base Tauri config embeds the Calen updater public key", () => {
  const config = JSON.parse(
    readFileSync(path.join(guiRoot, "src-tauri/tauri.conf.json"), "utf8")
  );

  const decodedPublicKey = Buffer.from(
    config.plugins.updater.pubkey,
    "base64"
  ).toString("utf8");
  assert.match(decodedPublicKey, /^untrusted comment: minisign public key:/);
  assert.match(decodedPublicKey, /\nRW/);
  assert.deepEqual(config.plugins.updater.endpoints, []);
});

test("release validation requires explicit updater signing keys", () => {
  const missingPublicKey = runValidation({
    TAURI_SIGNING_PRIVATE_KEY: "private-key",
  });
  assert.notEqual(missingPublicKey.status, 0);
  assert.match(missingPublicKey.stderr, /CALEN_UPDATER_PUBLIC_KEY/);

  const missingPrivateKey = runValidation({
    CALEN_UPDATER_PUBLIC_KEY: "public-key",
  });
  assert.notEqual(missingPrivateKey.status, 0);
  assert.match(missingPrivateKey.stderr, /TAURI_SIGNING_PRIVATE_KEY/);

  const configured = runValidation({
    TAURI_SIGNING_PRIVATE_KEY: "private-key",
    CALEN_UPDATER_PUBLIC_KEY: "public-key",
  });
  assert.equal(configured.status, 0, configured.stderr);
});

test("desktop release treats macOS as an explicit opt-in platform", () => {
  assert.match(
    releaseWorkflow,
    /macos:\s*\n\s+if: \$\{\{ vars\.CALEN_ENABLE_MACOS_RELEASE == 'true' \}\}/
  );
  assert.match(
    releaseWorkflow,
    /needs\.macos\.result == 'success' \|\| needs\.macos\.result == 'skipped'/
  );
  assert.match(releaseWorkflow, /needs\.windows\.result == 'success'/);
  assert.match(releaseWorkflow, /needs\.linux\.result == 'success'/);
});
