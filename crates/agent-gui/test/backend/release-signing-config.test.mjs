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

test("desktop release publishes only Windows installers and a Windows updater manifest", () => {
  assert.doesNotMatch(releaseWorkflow, /^\s{2}macos:/m);
  assert.doesNotMatch(releaseWorkflow, /^\s{2}linux:/m);
  assert.doesNotMatch(releaseWorkflow, /portable\.zip|Windows-x64-portable/);
  assert.match(releaseWorkflow, /NODE_VERSION: 24/);
  assert.match(
    releaseWorkflow,
    /Calen-\$\{LIVEAGENT_RELEASE_TAG\}-Windows-x64-Setup\.exe/
  );
  assert.match(
    releaseWorkflow,
    /Calen-\$\{LIVEAGENT_RELEASE_TAG\}-Windows-x64\.msi/
  );
  assert.match(
    releaseWorkflow,
    /release-artifacts\/Calen-\*-Windows-x64-Setup\.exe\.sig/
  );
  assert.match(
    releaseWorkflow,
    /release-artifacts\/Calen-\*-Windows-x64\.msi\.sig/
  );
  assert.match(releaseWorkflow, /needs\.windows\.result == 'success'/);
  assert.match(releaseWorkflow, /some\(k=>!k\.startsWith\("windows-"\)\)/);
});

test("desktop release resolves metadata, builds, and publishes from the same tag", () => {
  assert.match(
    releaseWorkflow,
    /ref: \$\{\{ github\.event\.inputs\.tag \|\| github\.ref \}\}/
  );

  const resolvedTagCheckouts = releaseWorkflow.match(
    /ref: \$\{\{ needs\.release-metadata\.outputs\.release_tag \}\}/g
  );
  assert.equal(resolvedTagCheckouts?.length, 2);
});

test("desktop release grants write access only to the publishing job", () => {
  assert.match(releaseWorkflow, /^permissions:\n  contents: read$/m);
  assert.match(
    releaseWorkflow,
    /^  publish:\n(?:.*\n){0,4}    permissions:\n      contents: write$/m
  );
});

test("desktop release is blocked until stock provider terms are explicitly approved", () => {
  assert.match(releaseWorkflow, /CALEN_STOCK_PROVIDER_TERMS_APPROVED/);
  assert.match(releaseWorkflow, /written provider terms approval/);
  assert.match(releaseWorkflow, /exit 1/);
});
