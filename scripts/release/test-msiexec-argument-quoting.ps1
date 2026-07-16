[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT") {
    Write-Host "Windows Installer argument probe skipped on a non-Windows host."
    exit 0
}

. (Join-Path $PSScriptRoot "msiexec-arguments.ps1")

$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) "calen msiexec argument probe $PID"
$logPath = Join-Path $testRoot "probe.log"
$missingPackage = Join-Path $testRoot "missing package.msi"
$requestedRoot = Join-Path $testRoot "install root"
New-Item -ItemType Directory -Force -Path $testRoot | Out-Null

$startInfo = [System.Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = "$env:SystemRoot\System32\msiexec.exe"
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
$startInfo.Arguments = New-MsiInstallRawArguments `
    -PackagePath $missingPackage `
    -LogPath $logPath `
    -RequestedRoot $requestedRoot
$expectedArguments = "/L*v `"$logPath`" /i `"$missingPackage`" /qn /norestart INSTALLDIR=`"$requestedRoot`""
if ($startInfo.Arguments -ne $expectedArguments) {
    throw "Unexpected Windows Installer raw arguments: $($startInfo.Arguments)"
}

$process = [System.Diagnostics.Process]::new()
$process.StartInfo = $startInfo
try {
    if (-not $process.Start()) {
        throw "Failed to start Windows Installer argument probe."
    }
    if (-not $process.WaitForExit(15000)) {
        try { $process.Kill($true) } catch { $process.Kill() }
        $process.WaitForExit(5000) | Out-Null
        throw "Windows Installer argument probe timed out; raw quoting regressed."
    }
    if ($process.ExitCode -ne 1619) {
        throw "Expected missing-package exit code 1619, got $($process.ExitCode)."
    }
    if (-not (Test-Path -LiteralPath $logPath -PathType Leaf)) {
        throw "Windows Installer did not create the probe log."
    }
    Write-Host "Windows Installer raw argument quoting probe passed."
} finally {
    $process.Dispose()
    Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}
