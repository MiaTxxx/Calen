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
).replaceAll("\r\n", "\n");
const ciWorkflow = readFileSync(
  path.join(repoRoot, ".github/workflows/ci.yml"),
  "utf8"
).replaceAll("\r\n", "\n");
const updateCommandSource = readFileSync(
  path.join(guiRoot, "src-tauri/src/commands/app/update.rs"),
  "utf8"
);
const tauriMainSource = readFileSync(
  path.join(guiRoot, "src-tauri/src/lib.rs"),
  "utf8"
);
const windowsInstallerValidation = readFileSync(
  path.join(repoRoot, "scripts/release/test-windows-installers.ps1"),
  "utf8"
);
const windowsInstallerArguments = readFileSync(
  path.join(repoRoot, "scripts/release/msiexec-arguments.ps1"),
  "utf8"
);
const windowsInstallerArgumentProbe = readFileSync(
  path.join(repoRoot, "scripts/release/test-msiexec-argument-quoting.ps1"),
  "utf8"
);
const updaterSignatureVerifier = readFileSync(
  path.join(guiRoot, "src-tauri/examples/verify-updater-signature.rs"),
  "utf8"
);
const v112ReleaseNotes = readFileSync(
  path.join(repoRoot, "docs/releases/v1.1.2.md"),
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

test("Windows installers use Calen branding and Simplified Chinese", () => {
  const configPaths = [
    "src-tauri/tauri.windows.conf.json",
    "src-tauri/tauri.windows.release.conf.json",
  ];

  for (const configPath of configPaths) {
    const config = JSON.parse(
      readFileSync(path.join(guiRoot, configPath), "utf8")
    );
    const windows = config.bundle.windows;

    assert.equal(windows.nsis.installerIcon, "icons/icon-windows.ico");
    assert.equal(windows.nsis.uninstallerIcon, "icons/icon-windows.ico");
    assert.equal(windows.nsis.sidebarImage, "icons/nsis-sidebar.bmp");
    assert.deepEqual(windows.nsis.languages, ["SimpChinese"]);
    assert.equal(windows.nsis.displayLanguageSelector, false);
    assert.equal(windows.nsis.installerHooks, "windows/nsis-hooks.nsh");
    assert.equal(windows.wix.language, "zh-CN");
    assert.equal(windows.wix.dialogImagePath, "icons/wix-dialog.bmp");
    assert.equal(
      config.bundle.resources["icons/icon-windows.ico"],
      "calen-icon.ico"
    );
  }

  const nsisSidebar = readFileSync(
    path.join(guiRoot, "src-tauri/icons/nsis-sidebar.bmp")
  );
  assert.equal(nsisSidebar.subarray(0, 2).toString("ascii"), "BM");
  assert.equal(nsisSidebar.readInt32LE(18), 164);
  assert.equal(nsisSidebar.readInt32LE(22), 314);

  const wixDialog = readFileSync(
    path.join(guiRoot, "src-tauri/icons/wix-dialog.bmp")
  );
  assert.equal(wixDialog.subarray(0, 2).toString("ascii"), "BM");
  assert.equal(wixDialog.readInt32LE(18), 493);
  assert.equal(wixDialog.readInt32LE(22), 312);

  const nsisHooks = readFileSync(
    path.join(guiRoot, "src-tauri/windows/nsis-hooks.nsh"),
    "utf8"
  );
  assert.match(nsisHooks, /calen-icon\.ico/);
  assert.match(nsisHooks, /FileExists/);
  assert.match(nsisHooks, /CreateShortcut/);
  assert.match(nsisHooks, /SHChangeNotify/);
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
  assert.match(releaseWorkflow, /NODE_VERSION: 24\.17\.0/);
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

test("desktop release prefers curated tag notes for GitHub and updater metadata", () => {
  assert.match(
    releaseWorkflow,
    /curated_notes_path="docs\/releases\/\$\{RELEASE_TAG\}\.md"/
  );
  assert.match(
    releaseWorkflow,
    /if \[ -s "\$curated_notes_path" \]; then[\s\S]*?cp "\$curated_notes_path" "\$notes_path"/
  );
  assert.match(v112ReleaseNotes, /^# Calen v1\.1\.2/m);
  assert.match(v112ReleaseNotes, /Windows 安装版股票研究服务/);
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

test("update and restart paths stop the stock sidecar before replacing the app", () => {
  assert.match(
    updateCommandSource,
    /pub async fn app_update_install[\s\S]*?stock\.stop\(\)\.await\?/
  );
  assert.match(
    updateCommandSource,
    /pub async fn app_restart[\s\S]*?stock\.stop\(\)\.await\?/
  );
  assert.match(tauriMainSource, /stock_manager\.shutdown_cleanup\(\)/);
});

test("desktop release blocks on real Windows installer lifecycle validation", () => {
  assert.match(
    releaseWorkflow,
    /Validate Windows install, upgrade, sidecar, and uninstall lifecycle/
  );
  assert.match(releaseWorkflow, /test-windows-installers\.ps1/);
  assert.match(releaseWorkflow, /--example verify-updater-signature/);
  assert.match(
    windowsInstallerValidation,
    /throw "Upgrade validation could not determine whether previous stable Windows installers exist/
  );
  assert.doesNotMatch(
    windowsInstallerValidation,
    /Upgrade validation skipped: GitHub release lookup failed/
  );
  assert.match(windowsInstallerValidation, /function Invoke-NsisInstall/);
  assert.match(windowsInstallerValidation, /function Assert-CalenShortcutIcon/);
  assert.match(
    windowsInstallerValidation,
    /Calen desktop shortcut still relies on the executable icon cache/
  );
  assert.match(
    windowsInstallerValidation,
    /Assert-CalenShortcutIcon -InstallRoot \$currentNsisRoot/
  );
  assert.match(
    windowsInstallerValidation,
    /-RawArguments "\/S \/D=\$absoluteInstallRoot"/
  );
  assert.doesNotMatch(
    windowsInstallerValidation,
    /-Arguments @\("\/S", "\/D=\$InstallRoot"\)/
  );
  assert.match(windowsInstallerValidation, /msiexec\.exe/);
  assert.match(windowsInstallerValidation, /-TimeoutSeconds 300/);
  assert.match(windowsInstallerValidation, /New-MsiInstallRawArguments/);
  assert.match(windowsInstallerValidation, /-RawArguments \$rawArguments/);
  assert.doesNotMatch(
    windowsInstallerValidation,
    /-Arguments \$arguments[\s\S]*?AllowedExitCodes @\(0, 3010\)/
  );
  assert.match(windowsInstallerArguments, /INSTALLDIR=\$quotedRequestedRoot/);
  assert.match(windowsInstallerValidation, /MSI log: \$logPath/);
  assert.match(
    windowsInstallerValidation,
    /throw "MSI did not honor the required Chinese and space-containing INSTALLDIR/
  );
  assert.doesNotMatch(
    windowsInstallerValidation,
    /verified registered default directory instead/
  );
  assert.match(
    windowsInstallerValidation,
    /try \{[\s\S]*?Installing MSI into the required Chinese and space-containing directory[\s\S]*?Installing NSIS silently into a Chinese and space-containing path/
  );
  assert.match(
    windowsInstallerValidation,
    /\$startInfo\.Environment\["PATH"\] = ""/
  );
  assert.match(windowsInstallerValidation, /dist\\stdio\.mjs/);
  assert.match(windowsInstallerValidation, /Wait-InstallRootReleased/);
  assert.match(
    windowsInstallerValidation,
    /no previous stable Calen Windows x64 installer was found/
  );
});

test("pull request CI builds temporary-signed Windows installers and runs lifecycle smoke", () => {
  assert.match(ciWorkflow, /Generate ephemeral updater signing key/);
  assert.match(ciWorkflow, /tauri signer generate --ci/);
  assert.match(ciWorkflow, /TAURI_SIGNING_PRIVATE_KEY=/);
  assert.doesNotMatch(ciWorkflow, /TAURI_SIGNING_PRIVATE_KEY_PATH=/);
  assert.doesNotMatch(ciWorkflow, /--bundles nsis,msi/);
  assert.match(ciWorkflow, /--bundles nsis msi/);
  assert.match(
    ciWorkflow,
    /\$bundleRoot = "target\/x86_64-pc-windows-msvc\/release\/bundle"/
  );
  assert.match(
    ciWorkflow,
    /Build previous Windows installers for upgrade smoke/
  );
  assert.match(ciWorkflow, /Build current Windows installer smoke artifacts/);
  assert.match(ciWorkflow, /tauri\.windows\.release\.conf\.json/);
  assert.match(ciWorkflow, /v0\.0\.1/);
  assert.match(ciWorkflow, /v0\.0\.2/);
  assert.match(ciWorkflow, /CALEN_CI_PREVIOUS_MSI/);
  assert.match(ciWorkflow, /CALEN_CI_PREVIOUS_SETUP/);
  assert.match(ciWorkflow, /test-windows-installers\.ps1/);
  assert.match(ciWorkflow, /STOCK_NODE_VERSION: 24\.17\.0/);
  assert.match(
    ciWorkflow,
    /Smoke packaged stock sidecar through the production launch runtime/
  );
  assert.match(
    ciWorkflow,
    /cargo test --manifest-path crates\/stock-sidecar-runtime\/Cargo\.toml packaged_sidecar_uses_production_launch_and_stdio -- --ignored/
  );
  assert.match(
    ciWorkflow,
    /cargo test --manifest-path crates\/stock-sidecar-runtime\/Cargo\.toml/
  );
  assert.doesNotMatch(
    ciWorkflow,
    /cargo test --manifest-path crates\/agent-gui\/src-tauri\/Cargo\.toml node_launch_paths --lib/
  );
  assert.match(ciWorkflow, /Common Controls/);
  assert.match(ciWorkflow, /CALEN_STOCK_WINDOWS_INSTALL_ROOT/);
  assert.match(ciWorkflow, /--example verify-updater-signature/);
  assert.match(ciWorkflow, /test-msiexec-argument-quoting\.ps1/);
  assert.match(ciWorkflow, /if \(\$LASTEXITCODE -ne 0\)/);
  assert.match(ciWorkflow, /-PreviousMsiPath/);
  assert.match(ciWorkflow, /-PreviousSetupPath/);
  assert.match(
    ciWorkflow,
    /Calen installer smoke artifacts must not be uploaded/
  );
  assert.match(windowsInstallerValidation, /\[string\]\$PreviousMsiPath/);
  assert.match(windowsInstallerValidation, /\[string\]\$PreviousSetupPath/);
  assert.match(
    ciWorkflow,
    /cargo test --manifest-path crates\/agent-gui\/src-tauri\/Cargo\.toml stock_portfolio::tests --lib/
  );
  assert.match(
    releaseWorkflow,
    /Smoke packaged stock sidecar through the production launch runtime/
  );
  assert.match(
    releaseWorkflow,
    /cargo test --manifest-path crates\/stock-sidecar-runtime\/Cargo\.toml packaged_sidecar_uses_production_launch_and_stdio -- --ignored/
  );
});

test("Windows updater verification avoids stack overflow and fails workflows fast", () => {
  assert.match(updaterSignatureVerifier, /vec!\[0_u8; 64 \* 1024\]/);
  assert.doesNotMatch(updaterSignatureVerifier, /\[0_u8; 1024 \* 1024\]/);
  assert.match(updaterSignatureVerifier, /STANDARD\.decode/);
  assert.match(updaterSignatureVerifier, /PublicKey::decode/);
  assert.match(updaterSignatureVerifier, /Signature::decode/);
  assert.doesNotMatch(updaterSignatureVerifier, /Signature::from_file/);
  assert.match(
    releaseWorkflow,
    /cargo run --release --locked[\s\S]*?--target x86_64-pc-windows-msvc[\s\S]*?--example verify-updater-signature/
  );
  assert.match(
    ciWorkflow,
    /cargo run --release --locked[\s\S]*?--target x86_64-pc-windows-msvc[\s\S]*?--example verify-updater-signature/
  );
  assert.match(releaseWorkflow, /test-msiexec-argument-quoting\.ps1/);
  assert.match(releaseWorkflow, /if \(\$LASTEXITCODE -ne 0\)/);
});

test("Windows lifecycle creates its localized download directory before fetching installers", () => {
  const testRootDefinition = windowsInstallerValidation.indexOf(
    "$testRoot = Join-Path"
  );
  const testRootCreation = windowsInstallerValidation.indexOf(
    "New-Item -ItemType Directory -Force -Path $testRoot"
  );
  const previousInstallerDownload = windowsInstallerValidation.indexOf(
    "Invoke-WebRequest -Uri $msiAsset.browser_download_url"
  );

  assert.notEqual(testRootDefinition, -1);
  assert.notEqual(previousInstallerDownload, -1);
  assert.ok(testRootCreation > testRootDefinition);
  assert.ok(testRootCreation < previousInstallerDownload);
});

test("Windows Installer raw quoting has an executable regression probe", () => {
  assert.match(windowsInstallerArgumentProbe, /missing package\.msi/);
  assert.match(windowsInstallerArgumentProbe, /\$expectedArguments/);
  assert.match(windowsInstallerArgumentProbe, /INSTALLDIR=`"\$requestedRoot`"/);
  assert.match(windowsInstallerArgumentProbe, /WaitForExit\(15000\)/);
  assert.match(windowsInstallerArgumentProbe, /ExitCode -ne 1619/);
  assert.match(
    windowsInstallerArgumentProbe,
    /Test-Path -LiteralPath \$logPath/
  );
});

test("NSIS upgrade accepts legacy releases without a stock sidecar", () => {
  const nsisInstallFunction = windowsInstallerValidation.slice(
    windowsInstallerValidation.indexOf("function Invoke-NsisInstall"),
    windowsInstallerValidation.indexOf("function Invoke-NsisUninstall")
  );
  const legacyInstall = windowsInstallerValidation.indexOf(
    "$oldNsisEntry = Invoke-NsisInstall"
  );
  const currentInstall = windowsInstallerValidation.indexOf(
    "$currentNsisEntry = Invoke-NsisInstall",
    legacyInstall
  );

  assert.doesNotMatch(
    nsisInstallFunction,
    /Find-SidecarRoot|Invoke-SidecarSmoke|Get-InstallRootFromEntry/
  );
  assert.notEqual(legacyInstall, -1);
  assert.notEqual(currentInstall, -1);
  const legacyInstallSlice = windowsInstallerValidation.slice(
    legacyInstall,
    currentInstall
  );
  assert.doesNotMatch(
    legacyInstallSlice,
    /Invoke-SidecarSmoke|Get-InstallRootFromEntry/
  );
  assert.match(
    legacyInstallSlice,
    /\$oldNsisRoot = \(Resolve-Path -LiteralPath \$nsisUpgradeRoot\)\.Path/
  );
  assert.match(
    windowsInstallerValidation.slice(currentInstall),
    /\$currentNsisRoot = Get-InstallRootFromEntry -Entry \$currentNsisEntry -PreferredRoot \$nsisUpgradeRoot/
  );
  assert.match(
    windowsInstallerValidation.slice(currentInstall),
    /Invoke-SidecarSmoke -InstallRoot \$nsisUpgradeRoot/
  );
});

test("Windows MSI cleanup is typed, idempotent, and diagnosable", () => {
  assert.match(
    windowsInstallerValidation,
    /\$attemptedMsiProductCodes\s*=\s*\[System\.Collections\.Generic\.HashSet\[string\]\]::new\(\[System\.StringComparer\]::OrdinalIgnoreCase\)/
  );

  const uninstallFunction = windowsInstallerValidation.slice(
    windowsInstallerValidation.indexOf("function Invoke-MsiUninstall"),
    windowsInstallerValidation.indexOf("function ConvertTo-CoreVersion")
  );
  assert.doesNotMatch(uninstallFunction, /FallbackPackage/);
  assert.match(uninstallFunction, /Test-MsiProductCode/);
  assert.match(
    uninstallFunction,
    /\$attemptedMsiProductCodes\.Add\(\$productCode\)/
  );
  assert.ok(
    uninstallFunction.indexOf("$attemptedMsiProductCodes.Add($productCode)") <
      uninstallFunction.indexOf("Invoke-CheckedProcess")
  );
  assert.match(uninstallFunction, /-RawArguments \$rawArguments/);
  assert.match(uninstallFunction, /\/L\*v/);
  assert.match(uninstallFunction, /MSIRESTARTMANAGERCONTROL=Disable/);
  assert.match(uninstallFunction, /REBOOT=ReallySuppress/);
  assert.match(uninstallFunction, /-TimeoutSeconds 180/);
  assert.match(
    windowsInstallerValidation,
    /Get-Content -LiteralPath \$LogPath -Tail 80/
  );
  const diagnosticsFunction = windowsInstallerValidation.slice(
    windowsInstallerValidation.indexOf("function Get-MsiUninstallDiagnostics"),
    windowsInstallerValidation.indexOf("function Get-InstallRootFromEntry")
  );
  assert.doesNotMatch(
    diagnosticsFunction,
    /CommandLine|ExecutablePath|UninstallString|InstallLocation/
  );
  assert.match(uninstallFunction, /Get-MsiUninstallDiagnostics/);
  assert.match(uninstallFunction, /Wait-MsiUninstallEntryRemoved/);
  assert.match(uninstallFunction, /\$script:msiUninstallAttemptNumber \+= 1/);

  const installFunction = windowsInstallerValidation.slice(
    windowsInstallerValidation.indexOf("function Invoke-MsiInstall"),
    windowsInstallerValidation.indexOf("function Invoke-MsiUninstall")
  );
  assert.match(installFunction, /Reset-MsiUninstallAttempt -Entry \$entry/);
  assert.match(
    installFunction,
    /\(Test-MsiProductCode[\s\S]*?\) -and[\s\S]*?DisplayVersion/
  );

  const arpWaitFunction = windowsInstallerValidation.slice(
    windowsInstallerValidation.indexOf(
      "function Wait-MsiUninstallEntryRemoved"
    ),
    windowsInstallerValidation.indexOf("function Get-MsiUninstallDiagnostics")
  );
  assert.match(arpWaitFunction, /Get-MsiUninstallEntriesByProductCode/);
  assert.doesNotMatch(arpWaitFunction, /Get-CalenUninstallEntries/);
  assert.match(
    windowsInstallerValidation,
    /function Get-MsiUninstallEntriesByProductCode[\s\S]*?Join-Path \$root \$ProductCode/
  );

  assert.doesNotMatch(windowsInstallerValidation, /FallbackPackage/);
  const nsisUninstallFunction = windowsInstallerValidation.slice(
    windowsInstallerValidation.indexOf("function Invoke-NsisUninstall"),
    windowsInstallerValidation.indexOf("function Invoke-MsiInstall")
  );
  assert.match(nsisUninstallFunction, /\$uninstaller\.FullName/);
  assert.doesNotMatch(nsisUninstallFunction, /msiexec/);

  const upgradeCleanup = windowsInstallerValidation.slice(
    windowsInstallerValidation.indexOf(
      "if ($null -ne $previous -and $previous.Path)"
    ),
    windowsInstallerValidation.indexOf(
      'Write-Host "`nWindows installer lifecycle validation passed."'
    )
  );
  assert.match(
    upgradeCleanup,
    /Where-Object\s*\{[\s\S]*?Test-MsiProductCode[\s\S]*?\}[\s\S]*?Invoke-MsiUninstall/
  );
  const upgradeTry = upgradeCleanup.slice(
    upgradeCleanup.indexOf("try {"),
    upgradeCleanup.indexOf("} finally {")
  );
  assert.match(
    upgradeTry,
    /Invoke-MsiUninstall -Entry \$currentEntry[\s\S]*?Wait-InstallRootReleased -InstallRoot \$upgradeRoot/
  );
  assert.equal(windowsInstallerValidation.includes("[0-9A-Fa-f-]+"), false);
});
