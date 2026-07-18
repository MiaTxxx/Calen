param(
    [string]$OutputDirectory = "crates/agent-gui/src-tauri/resources/translation-runtime",
    [string]$SourceDirectory = ""
)

$ErrorActionPreference = "Stop"

$runtimeTag = "b10066"
$runtimeCommit = "86a9c79f866799eb0e7e89c03578ccfbcc5d808e"
$sourceRepository = "https://github.com/ggml-org/llama.cpp.git"
$requiredNotices = @(
    "NOTICE.md",
    "licenses\llama.cpp-MIT.txt"
)

$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$resolvedOutput = [IO.Path]::GetFullPath((Join-Path $workspaceRoot $OutputDirectory))
$expectedRoot = [IO.Path]::GetFullPath(
    (Join-Path $workspaceRoot "crates/agent-gui/src-tauri/resources/translation-runtime")
)
if ($resolvedOutput -ne $expectedRoot) {
    throw "Translation runtime output must stay inside the managed resource directory: $expectedRoot"
}

$tempRoot = Join-Path ([IO.Path]::GetTempPath()) "calen-translation-runtime-$runtimeTag-$PID"
$sourcePath = if ($SourceDirectory) {
    (Resolve-Path -LiteralPath $SourceDirectory).Path
} else {
    Join-Path $tempRoot "llama.cpp"
}
$buildPath = Join-Path $tempRoot "build"

New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
if (-not $SourceDirectory) {
    git init --quiet "$sourcePath"
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to initialize the pinned llama.cpp source checkout."
    }
    git -C "$sourcePath" remote add origin "$sourceRepository"
    git -C "$sourcePath" fetch --quiet --depth 1 origin "$runtimeCommit"
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to fetch llama.cpp commit $runtimeCommit."
    }
    git -C "$sourcePath" checkout --quiet --detach FETCH_HEAD
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to check out llama.cpp commit $runtimeCommit."
    }
}

$actualCommit = (git -C "$sourcePath" rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $actualCommit -ne $runtimeCommit) {
    throw "llama.cpp source commit mismatch: expected=$runtimeCommit actual=$actualCommit"
}

# Build only llama-server, without OpenMP or shared project DLLs. The upstream
# b10066 Windows ZIP copies libomp from Visual Studio's debug_nonredist tree;
# building this pinned source ourselves avoids redistributing that binary.
cmake -S "$sourcePath" -B "$buildPath" -G "Visual Studio 17 2022" -A x64 `
    -DBUILD_SHARED_LIBS=OFF `
    -DGGML_BACKEND_DL=OFF `
    -DGGML_CPU_ALL_VARIANTS=OFF `
    -DGGML_NATIVE=OFF `
    -DGGML_OPENMP=OFF `
    -DLLAMA_BUILD_APP=OFF `
    -DLLAMA_BUILD_EXAMPLES=OFF `
    -DLLAMA_BUILD_SERVER=ON `
    -DLLAMA_BUILD_TESTS=OFF `
    -DLLAMA_BUILD_TOOLS=ON `
    -DLLAMA_BUILD_UI=OFF `
    -DLLAMA_USE_PREBUILT_UI=OFF `
    -DLLAMA_OPENSSL=OFF `
    -DLLAMA_TESTS_INSTALL=OFF `
    -DLLAMA_TOOLS_INSTALL=OFF `
    -DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded
if ($LASTEXITCODE -ne 0) {
    throw "Failed to configure the pinned llama.cpp translation runtime."
}

cmake --build "$buildPath" --config Release --target llama-server --parallel
if ($LASTEXITCODE -ne 0) {
    throw "Failed to build the pinned llama.cpp translation runtime."
}

$builtServer = Join-Path $buildPath "bin\Release\llama-server.exe"
if (-not (Test-Path -LiteralPath $builtServer -PathType Leaf)) {
    throw "Pinned llama.cpp build did not produce llama-server.exe: $builtServer"
}

$versionOutput = & $builtServer --version 2>&1
if ($LASTEXITCODE -ne 0 -or -not ($versionOutput -match "(?m)\bversion:\s*10066\b")) {
    throw "Built llama-server did not report the pinned b10066 version: $versionOutput"
}

New-Item -ItemType Directory -Force -Path $resolvedOutput | Out-Null
Get-ChildItem -LiteralPath $resolvedOutput -File |
    Where-Object { $_.Extension -in @(".exe", ".dll") -or $_.Name -eq "runtime-manifest.json" } |
    Remove-Item -Force

$stagedServer = Join-Path $resolvedOutput "llama-server.exe"
Copy-Item -LiteralPath $builtServer -Destination $stagedServer
$binarySha256 = (Get-FileHash -LiteralPath $stagedServer -Algorithm SHA256).Hash.ToLowerInvariant()

$manifest = [ordered]@{
    runtime = "llama.cpp"
    version = $runtimeTag
    sourceRepository = $sourceRepository
    sourceCommit = $runtimeCommit
    binarySha256 = $binarySha256
    build = [ordered]@{
        architecture = "windows-x64"
        sharedLibraries = $false
        openmp = $false
        msvcRuntime = "MultiThreaded"
        webUi = $false
        openssl = $false
    }
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (
    Join-Path $resolvedOutput "runtime-manifest.json"
) -Encoding UTF8

foreach ($requiredNotice in $requiredNotices) {
    $noticePath = Join-Path $resolvedOutput $requiredNotice
    if (-not (Test-Path -LiteralPath $noticePath -PathType Leaf)) {
        throw "Translation runtime notice is missing: $noticePath"
    }
}

Write-Host "Staged source-built llama.cpp $runtimeTag translation runtime in $resolvedOutput"
