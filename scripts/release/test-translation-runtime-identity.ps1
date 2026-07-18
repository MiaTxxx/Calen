$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "translation-runtime-identity.ps1")

$runtimeCommit = "86a9c79f866799eb0e7e89c03578ccfbcc5d808e"
$acceptedOutputs = @(
    "version: 1 (86a9c79) built with MSVC 19.51.36248.0 for Windows AMD64",
    "version: 10066 ($runtimeCommit) built with MSVC"
)

foreach ($output in $acceptedOutputs) {
    if (-not (Test-CalenPinnedLlamaRuntimeVersion `
        -VersionOutput $output `
        -SourceCommit $runtimeCommit `
        -ExitCode 0
    )) {
        throw "Pinned runtime version output was rejected: $output"
    }
}

$observedShallowBuild = $acceptedOutputs[0]

$rejectedCases = @(
    @{
        Name = "wrong commit"
        Output = "version: 1 (deadbee) built with MSVC"
        Commit = $runtimeCommit
        ExitCode = 0
    },
    @{
        Name = "wrong extended commit prefix"
        Output = "version: 1 (86a9c70) built with MSVC"
        Commit = $runtimeCommit
        ExitCode = 0
    },
    @{
        Name = "missing commit"
        Output = "version: 1 built with MSVC"
        Commit = $runtimeCommit
        ExitCode = 0
    },
    @{
        Name = "non-numeric version"
        Output = "version: garbage (86a9c79) built with MSVC"
        Commit = $runtimeCommit
        ExitCode = 0
    },
    @{
        Name = "non-zero exit"
        Output = $observedShallowBuild
        Commit = $runtimeCommit
        ExitCode = 1
    },
    @{
        Name = "invalid source commit"
        Output = $observedShallowBuild
        Commit = "86a9c79"
        ExitCode = 0
    }
)

foreach ($case in $rejectedCases) {
    if (Test-CalenPinnedLlamaRuntimeVersion `
        -VersionOutput $case.Output `
        -SourceCommit $case.Commit `
        -ExitCode $case.ExitCode
    ) {
        throw "Translation runtime identity matcher accepted $($case.Name)."
    }
}

Write-Host "Translation runtime identity matcher regression probe passed."
