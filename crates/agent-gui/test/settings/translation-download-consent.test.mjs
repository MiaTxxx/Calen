import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const guiRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const loader = createTsModuleLoader();
const consent = loader.loadModule(
  "src/pages/settings/translationDownloadConsent.ts"
);
const i18n = loader.loadModule("src/i18n/config.ts");

function model(overrides = {}) {
  return {
    id: "model-id",
    displayName: "Model",
    source: "builtIn",
    inferenceProfile: "generic",
    fileName: "model.gguf",
    sizeBytes: 1,
    sha256: "hash",
    installed: false,
    recommended: false,
    downloadable: true,
    downloadLicenseAcceptanceRequired: false,
    downloadLicenseAcceptanceSatisfied: true,
    ...overrides,
  };
}

test("only built-in HY-MT downloads require explicit license consent", () => {
  assert.equal(
    consent.requiresTranslationDownloadConsent(
      model({
        id: "hy-mt1.5-1.8b-q4-k-m",
        inferenceProfile: "hy-mt",
        downloadLicenseAcceptanceRequired: true,
        downloadLicenseAcceptanceSatisfied: false,
      })
    ),
    true
  );
  assert.equal(
    consent.requiresTranslationDownloadConsent(
      model({
        id: "hy-mt1.5-1.8b-q8-0",
        inferenceProfile: "hy-mt",
        downloadLicenseAcceptanceRequired: true,
        downloadLicenseAcceptanceSatisfied: false,
      })
    ),
    true
  );
  assert.equal(
    consent.requiresTranslationDownloadConsent(
      model({ id: "qwen3-0.6b-q8-0", inferenceProfile: "qwen3" })
    ),
    false
  );
  assert.equal(
    consent.requiresTranslationDownloadConsent(
      model({
        source: "userImport",
        inferenceProfile: "hy-mt",
        downloadLicenseAcceptanceRequired: true,
        downloadLicenseAcceptanceSatisfied: false,
      })
    ),
    false
  );
  assert.equal(
    consent.requiresTranslationDownloadConsent(
      model({
        inferenceProfile: "hy-mt",
        downloadLicenseAcceptanceRequired: true,
        downloadLicenseAcceptanceSatisfied: true,
      })
    ),
    true
  );
});

test("installed HY-MT models require a license review until acceptance is satisfied", () => {
  assert.equal(
    consent.requiresTranslationDownloadConsent(
      model({
        id: "hy-mt1.5-1.8b-q4-k-m",
        installed: true,
        downloadLicenseAcceptanceRequired: true,
        downloadLicenseAcceptanceSatisfied: false,
      })
    ),
    true
  );
  assert.equal(
    consent.requiresTranslationDownloadConsent(
      model({
        id: "hy-mt1.5-1.8b-q4-k-m",
        installed: true,
        downloadLicenseAcceptanceRequired: true,
        downloadLicenseAcceptanceSatisfied: true,
      })
    ),
    false
  );
});

test("known built-in model descriptions are resolved by model id instead of backend prose", () => {
  assert.equal(
    consent.translationModelDescriptionKey("hy-mt1.5-1.8b-q4-k-m"),
    "settings.translationModelDescriptionHyMtQ4"
  );
  assert.equal(
    consent.translationModelDescriptionKey("hy-mt1.5-1.8b-q8-0"),
    "settings.translationModelDescriptionHyMtQ8"
  );
  assert.equal(
    consent.translationModelDescriptionKey("qwen3-0.6b-q8-0"),
    "settings.translationModelDescriptionQwen"
  );
  assert.equal(
    consent.translationModelDescriptionKey("user-import-custom"),
    null
  );
  assert.equal(
    consent.translationModelDescriptionKey("user-import-custom", "userImport"),
    "settings.translationModelDescriptionUserImport"
  );
  assert.equal(
    consent.translationModelLicenseKey("hy-mt1.5-1.8b-q4-k-m", "builtIn"),
    "settings.translationModelLicenseHyMt"
  );
  assert.equal(
    consent.translationModelLicenseKey("qwen3-0.6b-q8-0", "builtIn"),
    "settings.translationModelLicenseQwen"
  );
  assert.equal(
    consent.translationModelLicenseKey("user-import-custom", "userImport"),
    "settings.translationModelLicenseUserImport"
  );
});

test("licensed downloads stay blocked until consent is checked and no action is running", () => {
  assert.equal(
    consent.canStartLicensedTranslationDownload(false, false),
    false
  );
  assert.equal(consent.canStartLicensedTranslationDownload(true, true), false);
  assert.equal(consent.canStartLicensedTranslationDownload(true, false), true);
  assert.equal(
    consent.canStartLicensedTranslationDownload(true, false, false),
    false
  );
  assert.equal(
    consent.canStartLicensedTranslationDownload(true, false, true),
    true
  );
});

test("dialog focus wraps at both edges and recovers if focus escapes", () => {
  assert.equal(consent.resolveDialogFocusWrap(3, 0, true), 2);
  assert.equal(consent.resolveDialogFocusWrap(3, 2, false), 0);
  assert.equal(consent.resolveDialogFocusWrap(3, 1, false), null);
  assert.equal(consent.resolveDialogFocusWrap(3, -1, false), 0);
  assert.equal(consent.resolveDialogFocusWrap(3, -1, true), 2);
  assert.equal(consent.resolveDialogFocusWrap(0, -1, false), -1);
});

test("download size labels use the official decimal HY-MT sizes", () => {
  assert.equal(consent.formatTranslationModelSize(1_133_080_512), "1.13 GB");
  assert.equal(consent.formatTranslationModelSize(1_908_528_288), "1.91 GB");
  assert.equal(consent.formatTranslationModelSize(639_446_688), "639 MB");
});

test("the download command forwards structured consent to Tauri", async () => {
  const calls = [];
  const commandLoader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command, payload) {
          calls.push({ command, payload });
          return {
            modelId: payload.modelId,
            phase: "queued",
            bytesDownloaded: 0,
            totalBytes: 1,
            resumed: false,
          };
        },
      },
    },
  });
  const tauri = commandLoader.loadModule("src/lib/translation/tauri.ts");

  const hyConsent = {
    licenseRevision: "265b2e615a7dc9b06c435dc878829ad99a512ba2",
    licenseAccepted: true,
    acceptableUsePolicyAccepted: true,
    territoryEligible: true,
  };
  await tauri.startOfflineTranslationDownload(
    "hy-mt1.5-1.8b-q4-k-m",
    hyConsent
  );
  await tauri.startOfflineTranslationDownload("qwen3-0.6b-q8-0", undefined);

  assert.deepEqual(calls, [
    {
      command: "translation_download_start",
      payload: { modelId: "hy-mt1.5-1.8b-q4-k-m", consent: hyConsent },
    },
    {
      command: "translation_download_start",
      payload: { modelId: "qwen3-0.6b-q8-0", consent: undefined },
    },
  ]);
});

test("HY-MT consent copy identifies the license, territories, publisher, and independence", () => {
  const zh = i18n.translations["zh-CN"];
  const en = i18n.translations["en-US"];

  assert.match(
    zh["settings.translationHyMtConsentIntro"],
    /Tencent HY Community License Agreement/
  );
  assert.match(
    zh["settings.translationHyMtConsentCheckbox"],
    /Acceptable Use Policy.*AUP/
  );
  assert.match(zh["settings.translationHyMtConsentRegion"], /欧盟.*英国.*韩国/);
  assert.equal(
    zh["settings.translationHyMtConsentPublisher"],
    "发布主体：Tioms"
  );
  assert.match(
    zh["settings.translationHyMtConsentSource"],
    /Tencent.*HY-MT.*官方模型仓库/
  );
  assert.match(
    zh["settings.translationHyMtConsentNoAffiliation"],
    /Tencent.*Tioms\/Calen.*无关联.*赞助.*背书/
  );
  assert.match(
    en["settings.translationHyMtConsentRegion"],
    /European Union.*United Kingdom.*South Korea/
  );
  assert.match(
    en["settings.translationHyMtConsentCheckbox"],
    /Acceptable Use Policy.*AUP/
  );
  assert.equal(
    en["settings.translationHyMtConsentPublisher"],
    "Publisher: Tioms"
  );
  assert.match(
    en["settings.translationHyMtConsentSource"],
    /Tencent.*HY-MT.*official model repository/i
  );
  assert.match(
    en["settings.translationHyMtConsentNoAffiliation"],
    /Tencent.*Tioms\/Calen.*not affiliated.*sponsor.*endorse/i
  );
  assert.match(
    zh["settings.translationModelDescriptionHyMtQ4"],
    /推荐.*1\.13 GB/
  );
  assert.match(
    zh["settings.translationModelDescriptionHyMtQ8"],
    /高质量.*1\.91 GB/
  );
  assert.match(zh["settings.translationModelDescriptionQwen"], /兼容.*兜底/);
  assert.match(
    zh["settings.translationModelDescriptionUserImport"],
    /用户导入/
  );
  assert.match(zh["settings.translationModelLicenseUserImport"], /用户.*确认/);
  assert.match(
    en["settings.translationModelDescriptionHyMtQ4"],
    /Recommended.*1\.13 GB/
  );
  assert.match(
    en["settings.translationModelDescriptionHyMtQ8"],
    /Higher quality.*1\.91 GB/
  );
  assert.match(
    en["settings.translationModelDescriptionQwen"],
    /compatibility.*fallback/i
  );
  assert.match(
    en["settings.translationModelDescriptionUserImport"],
    /user-imported/i
  );
  assert.match(
    en["settings.translationModelLicenseUserImport"],
    /verified by the user/i
  );
  assert.doesNotMatch(
    en["settings.translationModelDescriptionHyMtQ4"],
    /[\u3400-\u9fff]/u
  );
  assert.doesNotMatch(
    en["settings.translationModelDescriptionHyMtQ8"],
    /[\u3400-\u9fff]/u
  );
  assert.doesNotMatch(
    en["settings.translationModelDescriptionQwen"],
    /[\u3400-\u9fff]/u
  );
  assert.doesNotMatch(
    en["settings.translationModelDescriptionUserImport"],
    /[\u3400-\u9fff]/u
  );
  assert.doesNotMatch(
    en["settings.translationModelLicenseUserImport"],
    /[\u3400-\u9fff]/u
  );
});

test("the settings download flow renders an explicit HY-MT consent gate", async () => {
  const formSource = await readFile(
    path.join(guiRoot, "src/pages/settings/TranslationSettingsForm.tsx"),
    "utf8"
  );
  const dialogSource = await readFile(
    path.join(guiRoot, "src/pages/settings/HyMtDownloadConsentDialog.tsx"),
    "utf8"
  );

  assert.match(formSource, /requiresTranslationDownloadConsent\(model\)/);
  assert.match(
    formSource,
    /startOfflineTranslationDownload\(model\.id, undefined\)/
  );
  assert.match(formSource, /const licenseRevision = model\.revision/);
  assert.match(formSource, /licenseRevision,/);
  assert.match(formSource, /acceptableUsePolicyAccepted:\s*true/);
  assert.match(formSource, /territoryEligible:\s*true/);
  assert.match(formSource, /if \(started\) setLicenseConsentModel\(null\)/);
  assert.match(formSource, /settings\.translationReviewLicense/);
  assert.match(
    formSource,
    /translationModelDescriptionKey\(model\.id, model\.source\)/
  );
  assert.match(
    formSource,
    /translationModelLicenseKey\(model\.id, model\.source\)/
  );
  assert.doesNotMatch(formSource, /\{model\.description\}/);
  assert.doesNotMatch(formSource, /model\.licenseName\s*\?/);
  assert.match(formSource, /<HyMtDownloadConsentDialog/);
  assert.match(dialogSource, /type="checkbox"/);
  assert.match(
    dialogSource,
    /canStartLicensedTranslationDownload\([\s\S]*?Boolean\(model\.revision\)/
  );
  assert.match(dialogSource, /event\.key === "Tab"/);
  assert.match(dialogSource, /appRoot\.inert = true/);
  assert.match(dialogSource, /previouslyFocusedElement\?\.focus\(\)/);
  assert.match(dialogSource, /onError\(message\)/);
  assert.match(dialogSource, /model\.licenseUrl/);
  assert.match(dialogSource, /model\.sourceUrl/);
  assert.match(dialogSource, /formatTranslationModelSize\(model\.sizeBytes\)/);
  assert.match(dialogSource, /model\.revision/);
  assert.match(dialogSource, /model\.sha256/);
  assert.match(dialogSource, /settings\.translationHyMtConsentMissingRevision/);
  assert.match(dialogSource, /select-text break-all font-mono/);
});
