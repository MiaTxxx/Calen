[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SetupPath,

    [Parameter(Mandatory = $true)]
    [string]$MsiPath,

    [string]$Repository = $env:GITHUB_REPOSITORY,
    [string]$CurrentTag = $env:LIVEAGENT_RELEASE_TAG,
    [string]$CurrentVersion = $env:LIVEAGENT_APP_VERSION,
    [string]$GitHubToken = $env:GH_TOKEN,
    [string]$PreviousSetupPath,
    [string]$PreviousMsiPath,
    [string]$PreviousVersion
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "msiexec-arguments.ps1")

if (-not $IsWindows) {
    throw "Windows installer validation must run on Windows."
}

$SetupPath = (Resolve-Path -LiteralPath $SetupPath).Path
$MsiPath = (Resolve-Path -LiteralPath $MsiPath).Path
if ($PreviousSetupPath) {
    $PreviousSetupPath = (Resolve-Path -LiteralPath $PreviousSetupPath).Path
}
if ($PreviousMsiPath) {
    $PreviousMsiPath = (Resolve-Path -LiteralPath $PreviousMsiPath).Path
}
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) "Calen 安装验收 空格"
$nsisInstallRoot = Join-Path $testRoot "NSIS 中文 安装目录"
$nsisUpgradeRoot = Join-Path $testRoot "NSIS 中文 升级目录"
$msiRequestedRoot = Join-Path $testRoot "MSI 中文 安装目录"
$logsRoot = Join-Path ([System.IO.Path]::GetTempPath()) "calen-msi-logs-$PID"
New-Item -ItemType Directory -Force -Path $testRoot | Out-Null
New-Item -ItemType Directory -Force -Path $logsRoot | Out-Null

function Write-Step([string]$Message) {
    Write-Host "`n==> $Message"
}

function Get-OptionalProperty {
    param(
        [Parameter(Mandatory = $true)]$InputObject,
        [Parameter(Mandatory = $true)][string]$Name
    )
    $property = $InputObject.PSObject.Properties[$Name]
    if ($null -eq $property -or $null -eq $property.Value) { return $null }
    return $property.Value
}

function Invoke-CheckedProcess {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$Arguments = @(),
        [string]$RawArguments,
        [int[]]$AllowedExitCodes = @(0),
        [int]$TimeoutSeconds = 180
    )

    if ($RawArguments -and $Arguments.Count -gt 0) {
        throw "Use either Arguments or RawArguments, not both: $FilePath"
    }

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $FilePath
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    if ($RawArguments) {
        $startInfo.Arguments = $RawArguments
    } else {
        foreach ($argument in $Arguments) {
            $startInfo.ArgumentList.Add($argument)
        }
    }

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    if (-not $process.Start()) {
        throw "Failed to start process: $FilePath"
    }
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
        $process.Kill($true)
        throw "Process timed out after ${TimeoutSeconds}s: $FilePath"
    }
    if ($AllowedExitCodes -notcontains $process.ExitCode) {
        $displayArguments = if ($RawArguments) { $RawArguments } else { $Arguments -join ' ' }
        throw "Process exited with code $($process.ExitCode): $FilePath $displayArguments"
    }
    return $process.ExitCode
}

function Find-SidecarRoot {
    param([Parameter(Mandatory = $true)][string]$InstallRoot)

    $direct = Join-Path $InstallRoot "stock-sidecar"
    if (
        (Test-Path -LiteralPath (Join-Path $direct "node.exe") -PathType Leaf) -and
        (Test-Path -LiteralPath (Join-Path $direct "dist\stdio.mjs") -PathType Leaf)
    ) {
        return $direct
    }

    $node = Get-ChildItem -LiteralPath $InstallRoot -Filter node.exe -File -Recurse -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Directory.Name -eq "stock-sidecar" -and
            (Test-Path -LiteralPath (Join-Path $_.Directory.FullName "dist\stdio.mjs") -PathType Leaf)
        } |
        Select-Object -First 1
    if ($null -eq $node) {
        throw "Installed stock sidecar was not found under: $InstallRoot"
    }
    return $node.Directory.FullName
}

function Invoke-SidecarSmoke {
    param([Parameter(Mandatory = $true)][string]$InstallRoot)

    $sidecarRoot = Find-SidecarRoot -InstallRoot $InstallRoot
    $nodePath = Join-Path $sidecarRoot "node.exe"
    $entryPath = Join-Path $sidecarRoot "dist\stdio.mjs"
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $nodePath
    $startInfo.WorkingDirectory = $sidecarRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.ArgumentList.Add($entryPath)
    $startInfo.Environment["PATH"] = ""

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    if (-not $process.Start()) {
        throw "Failed to start installed stock sidecar: $nodePath"
    }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.StandardInput.WriteLine('{"jsonrpc":"2.0","id":"install-smoke","method":"status","params":{}}')
    $process.StandardInput.Close()
    if (-not $process.WaitForExit(15000)) {
        $process.Kill($true)
        throw "Installed stock sidecar status request timed out: $sidecarRoot"
    }
    $stdout = $stdoutTask.GetAwaiter().GetResult().Trim()
    $stderr = $stderrTask.GetAwaiter().GetResult().Trim()
    if ($process.ExitCode -ne 0) {
        throw "Installed stock sidecar exited with $($process.ExitCode): $stderr"
    }
    if (-not $stdout) {
        throw "Installed stock sidecar returned no JSON-RPC response. stderr: $stderr"
    }
    $response = $stdout | ConvertFrom-Json
    if ($response.id -ne "install-smoke" -or $response.result.service -ne "calen-stock-sidecar") {
        throw "Installed stock sidecar returned an unexpected response: $stdout"
    }
    Write-Host "Installed sidecar smoke passed with PATH empty: $sidecarRoot"
    return $sidecarRoot
}

function Get-CalenUninstallEntries {
    $patterns = @(
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
    )
    return @(
        foreach ($pattern in $patterns) {
            Get-ItemProperty -Path $pattern -ErrorAction SilentlyContinue |
                Where-Object {
                    $displayName = Get-OptionalProperty -InputObject $_ -Name "DisplayName"
                    $displayName -eq "Calen" -or $displayName -like "Calen *"
                }
        }
    )
}

function Get-InstallRootFromEntry {
    param(
        [Parameter(Mandatory = $true)]$Entry,
        [string]$PreferredRoot
    )

    $candidates = [System.Collections.Generic.List[string]]::new()
    if ($PreferredRoot) { $candidates.Add($PreferredRoot) }
    $installLocation = Get-OptionalProperty -InputObject $Entry -Name "InstallLocation"
    if ($installLocation) { $candidates.Add([string]$installLocation) }
    $entryDisplayIcon = Get-OptionalProperty -InputObject $Entry -Name "DisplayIcon"
    if ($entryDisplayIcon) {
        $displayIcon = ([string]$entryDisplayIcon) -replace ',\d+$', ''
        if (Test-Path -LiteralPath $displayIcon -PathType Leaf) {
            $candidates.Add((Split-Path -Parent $displayIcon))
        }
    }
    if ($env:ProgramFiles) { $candidates.Add((Join-Path $env:ProgramFiles "Calen")) }
    if (${env:ProgramFiles(x86)}) { $candidates.Add((Join-Path ${env:ProgramFiles(x86)} "Calen")) }
    if ($env:LOCALAPPDATA) {
        $candidates.Add((Join-Path $env:LOCALAPPDATA "Calen"))
        $candidates.Add((Join-Path $env:LOCALAPPDATA "Programs\Calen"))
    }

    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if (-not $candidate -or -not (Test-Path -LiteralPath $candidate -PathType Container)) {
            continue
        }
        try {
            Find-SidecarRoot -InstallRoot $candidate | Out-Null
            return (Resolve-Path -LiteralPath $candidate).Path
        } catch {
            continue
        }
    }
    throw "Could not resolve the Calen install directory from Windows Installer metadata."
}

function Wait-InstallRootReleased {
    param([Parameter(Mandatory = $true)][string]$InstallRoot)

    $fullRoot = [System.IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
    if ($fullRoot.Length -lt 10 -or (Split-Path -Leaf $fullRoot) -notmatch "Calen|NSIS|MSI|安装目录|升级目录") {
        throw "Refusing to validate or remove an unsafe install root: $fullRoot"
    }

    for ($attempt = 1; $attempt -le 30; $attempt++) {
        $liveProcesses = @(
            Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
                Where-Object {
                    $_.ExecutablePath -and
                    [string]$_.ExecutablePath -like "$fullRoot*"
                }
        )
        if ($liveProcesses.Count -eq 0) {
            if (Test-Path -LiteralPath $fullRoot) {
                try {
                    Remove-Item -LiteralPath $fullRoot -Recurse -Force -ErrorAction Stop
                } catch {
                    Start-Sleep -Milliseconds 500
                    continue
                }
            }
            if (-not (Test-Path -LiteralPath $fullRoot)) {
                Write-Host "Install root is released: $fullRoot"
                return
            }
        }
        Start-Sleep -Milliseconds 500
    }
    $remaining = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.ExecutablePath -and [string]$_.ExecutablePath -like "$fullRoot*" } |
        Select-Object ProcessId, Name, ExecutablePath |
        Format-Table -AutoSize |
        Out-String
    throw "Install root remained locked after uninstall: $fullRoot`n$remaining"
}

function Invoke-NsisInstall {
    param(
        [Parameter(Mandatory = $true)][string]$PackagePath,
        [Parameter(Mandatory = $true)][string]$InstallRoot,
        [string]$ExpectedVersion,
        [switch]$PreserveExisting
    )

    if (-not $PreserveExisting -and (Test-Path -LiteralPath $InstallRoot)) {
        Remove-Item -LiteralPath $InstallRoot -Recurse -Force
    }
    # NSIS requires /D= to be the final raw command-line parameter and explicitly
    # forbids quoting it, even when the absolute path contains spaces. ArgumentList
    # quotes the complete /D= value, causing Tauri's NSIS installer to ignore it.
    $absoluteInstallRoot = [System.IO.Path]::GetFullPath($InstallRoot)
    Invoke-CheckedProcess -FilePath $PackagePath -RawArguments "/S /D=$absoluteInstallRoot" | Out-Null
    if (-not (Test-Path -LiteralPath $InstallRoot -PathType Container)) {
        throw "NSIS did not honor the requested install directory: $InstallRoot"
    }
    $entry = Get-CalenUninstallEntries |
        Where-Object {
            [string](Get-OptionalProperty -InputObject $_ -Name "PSChildName") -notmatch '^\{[0-9A-Fa-f-]+\}$' -and
            (-not $ExpectedVersion -or
                [string](Get-OptionalProperty -InputObject $_ -Name "DisplayVersion") -eq $ExpectedVersion)
        } |
        Select-Object -First 1
    if ($ExpectedVersion -and $null -eq $entry) {
        throw "NSIS completed but did not register Calen version $ExpectedVersion."
    }
    return $entry
}

function Invoke-NsisUninstall {
    param([Parameter(Mandatory = $true)][string]$InstallRoot)

    $uninstaller = Get-ChildItem -LiteralPath $InstallRoot -Filter "uninstall.exe" -File -Recurse |
        Select-Object -First 1
    if ($null -eq $uninstaller) {
        throw "NSIS uninstaller was not found under: $InstallRoot"
    }
    Invoke-CheckedProcess -FilePath $uninstaller.FullName -Arguments @("/S") | Out-Null
    Wait-InstallRootReleased -InstallRoot $InstallRoot
}

function Invoke-MsiInstall {
    param(
        [Parameter(Mandatory = $true)][string]$PackagePath,
        [string]$RequestedRoot,
        [string]$ExpectedVersion,
        [string]$LogName
    )

    $logPath = Join-Path $logsRoot $LogName
    $rawArguments = New-MsiInstallRawArguments `
        -PackagePath $PackagePath `
        -LogPath $logPath `
        -RequestedRoot $RequestedRoot
    try {
        Invoke-CheckedProcess `
            -FilePath "$env:SystemRoot\System32\msiexec.exe" `
            -RawArguments $rawArguments `
            -AllowedExitCodes @(0, 3010) `
            -TimeoutSeconds 300 | Out-Null
    } catch {
        $logTail = if (Test-Path -LiteralPath $logPath -PathType Leaf) {
            (Get-Content -LiteralPath $logPath -Tail 80 -ErrorAction SilentlyContinue) -join "`n"
        } else {
            "MSI log was not created."
        }
        throw "$($_.Exception.Message)`nMSI log: $logPath`n$logTail"
    }

    $entries = Get-CalenUninstallEntries
    $entry = if ($ExpectedVersion) {
        $entries |
            Where-Object {
                [string](Get-OptionalProperty -InputObject $_ -Name "PSChildName") -match '^\{[0-9A-Fa-f-]+\}$' -and
                [string](Get-OptionalProperty -InputObject $_ -Name "DisplayVersion") -eq $ExpectedVersion
            } |
            Select-Object -First 1
    } else {
        $entries |
            Where-Object { [string](Get-OptionalProperty -InputObject $_ -Name "PSChildName") -match '^\{[0-9A-Fa-f-]+\}$' } |
            Select-Object -First 1
    }
    if ($null -eq $entry) {
        throw "MSI completed but no matching Calen uninstall entry was registered. Log: $logPath"
    }
    return $entry
}

function Invoke-MsiUninstall {
    param(
        [Parameter(Mandatory = $true)]$Entry,
        [string]$FallbackPackage
    )

    $productCode = [string](Get-OptionalProperty -InputObject $Entry -Name "PSChildName")
    $target = if ($productCode -match '^\{[0-9A-Fa-f-]+\}$') { $productCode } else { $FallbackPackage }
    Invoke-CheckedProcess `
        -FilePath "$env:SystemRoot\System32\msiexec.exe" `
        -Arguments @("/x", $target, "/qn", "/norestart") `
        -AllowedExitCodes @(0, 1605, 3010) `
        -TimeoutSeconds 600 | Out-Null
}

function ConvertTo-CoreVersion {
    param([string]$TagOrVersion)
    if (-not $TagOrVersion) { return $null }
    $core = $TagOrVersion.Trim().TrimStart('v').Split('-', 2)[0]
    try { return [System.Version]::Parse($core) } catch { return $null }
}

function Find-PreviousStableInstallers {
    if ($PreviousMsiPath -or $PreviousSetupPath) {
        if (-not $PreviousMsiPath -or -not $PreviousSetupPath) {
            throw "Deterministic upgrade validation requires both PreviousMsiPath and PreviousSetupPath."
        }
        Write-Step "Using explicit previous installers for deterministic upgrade validation"
        return [pscustomobject]@{
            Path = $PreviousMsiPath
            SetupPath = $PreviousSetupPath
            Tag = if ($PreviousVersion) { "v$PreviousVersion" } else { "explicit previous MSI" }
            Version = $PreviousVersion
        }
    }

    if (-not $Repository -or -not $CurrentTag) {
        Write-Host "::notice::Upgrade validation skipped: repository or current tag is unavailable."
        return $null
    }

    $headers = @{ "User-Agent" = "Calen-Windows-Installer-Validation" }
    if ($GitHubToken) { $headers["Authorization"] = "Bearer $GitHubToken" }
    try {
        $releases = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repository/releases?per_page=30" -Headers $headers
    } catch {
        throw "Upgrade validation could not determine whether previous stable Windows installers exist because the GitHub release lookup failed: $($_.Exception.Message)"
    }

    $currentCoreVersion = ConvertTo-CoreVersion -TagOrVersion $CurrentTag
    foreach ($release in $releases) {
        if ($release.draft -or $release.prerelease -or $release.tag_name -eq $CurrentTag) { continue }
        $releaseCoreVersion = ConvertTo-CoreVersion -TagOrVersion ([string]$release.tag_name)
        if (
            $null -ne $currentCoreVersion -and
            $null -ne $releaseCoreVersion -and
            $releaseCoreVersion -ge $currentCoreVersion
        ) {
            continue
        }
        $msiAsset = $release.assets |
            Where-Object { $_.name -match '^Calen-.+-Windows-x64\.msi$' } |
            Select-Object -First 1
        $setupAsset = $release.assets |
            Where-Object { $_.name -match '^Calen-.+-Windows-x64-Setup\.exe$' } |
            Select-Object -First 1
        if ($null -eq $msiAsset -or $null -eq $setupAsset) { continue }
        $downloadPath = if ($null -ne $msiAsset) {
            Join-Path $testRoot ([string]$msiAsset.name)
        } else { $null }
        $downloadSetupPath = if ($null -ne $setupAsset) {
            Join-Path $testRoot ([string]$setupAsset.name)
        } else { $null }
        Write-Step "Downloading previous stable Windows installers $($release.tag_name) for upgrade validation"
        if ($downloadPath) {
            Invoke-WebRequest -Uri $msiAsset.browser_download_url -Headers $headers -OutFile $downloadPath
        }
        if ($downloadSetupPath) {
            Invoke-WebRequest -Uri $setupAsset.browser_download_url -Headers $headers -OutFile $downloadSetupPath
        }
        return [pscustomobject]@{
            Path = $downloadPath
            SetupPath = $downloadSetupPath
            Tag = [string]$release.tag_name
            Version = ([string]$release.tag_name).TrimStart('v')
        }
    }

    Write-Host "::notice::Upgrade validation skipped: no previous stable Calen Windows x64 installer was found."
    return $null
}

$preexistingEntries = @(Get-CalenUninstallEntries)
if ($preexistingEntries.Count -gt 0) {
    $descriptions = $preexistingEntries | ForEach-Object {
        "$(Get-OptionalProperty -InputObject $_ -Name 'DisplayName') $(Get-OptionalProperty -InputObject $_ -Name 'DisplayVersion')"
    }
    throw "Windows installer validation requires a clean runner without Calen installed: $($descriptions -join ', ')"
}
$previous = Find-PreviousStableInstallers

try {
    # Tauri's MSI imports the last NSIS install directory from the product
    # registry key, so validate an explicit MSI directory while the runner is clean.
    Write-Step "Installing MSI into the required Chinese and space-containing directory"
    if (Test-Path -LiteralPath $msiRequestedRoot) {
        Remove-Item -LiteralPath $msiRequestedRoot -Recurse -Force
    }
    $msiEntry = Invoke-MsiInstall -PackagePath $MsiPath -RequestedRoot $msiRequestedRoot -ExpectedVersion $CurrentVersion -LogName "current-msi-install.log"
    $msiInstallRoot = Get-InstallRootFromEntry -Entry $msiEntry -PreferredRoot $msiRequestedRoot
    if ([System.IO.Path]::GetFullPath($msiInstallRoot).TrimEnd('\') -ne [System.IO.Path]::GetFullPath($msiRequestedRoot).TrimEnd('\')) {
        throw "MSI did not honor the required Chinese and space-containing INSTALLDIR: requested=$msiRequestedRoot actual=$msiInstallRoot"
    }
    Write-Host "MSI honored the Chinese and space-containing INSTALLDIR: $msiInstallRoot"
    Invoke-SidecarSmoke -InstallRoot $msiInstallRoot | Out-Null
    Invoke-MsiUninstall -Entry $msiEntry -FallbackPackage $MsiPath
    Wait-InstallRootReleased -InstallRoot $msiInstallRoot

    Write-Step "Installing NSIS silently into a Chinese and space-containing path"
    Invoke-NsisInstall -PackagePath $SetupPath -InstallRoot $nsisInstallRoot -ExpectedVersion $CurrentVersion | Out-Null
    Invoke-SidecarSmoke -InstallRoot $nsisInstallRoot | Out-Null
    Invoke-NsisUninstall -InstallRoot $nsisInstallRoot

    if ($null -ne $previous -and $previous.SetupPath) {
        Write-Step "Installing $($previous.Tag) NSIS, upgrading in place, smoking sidecar, and uninstalling"
        try {
            $oldNsisEntry = Invoke-NsisInstall `
                -PackagePath $previous.SetupPath `
                -InstallRoot $nsisUpgradeRoot `
                -ExpectedVersion $previous.Version
            $oldNsisRoot = (Resolve-Path -LiteralPath $nsisUpgradeRoot).Path
            # Legacy releases can predate the stock sidecar; smoke it only after the current installer replaces them.
            $currentNsisEntry = Invoke-NsisInstall `
                -PackagePath $SetupPath `
                -InstallRoot $nsisUpgradeRoot `
                -ExpectedVersion $CurrentVersion `
                -PreserveExisting
            $nsisEntriesAfterUpgrade = @(Get-CalenUninstallEntries | Where-Object {
                [string](Get-OptionalProperty -InputObject $_ -Name "PSChildName") -notmatch '^\{[0-9A-Fa-f-]+\}$'
            })
            if ($nsisEntriesAfterUpgrade | Where-Object {
                [string](Get-OptionalProperty -InputObject $_ -Name "DisplayVersion") -eq $previous.Version
            }) {
                throw "Previous NSIS version $($previous.Version) remained registered after current NSIS upgrade."
            }
            if (-not ($nsisEntriesAfterUpgrade | Where-Object {
                [string](Get-OptionalProperty -InputObject $_ -Name "DisplayVersion") -eq $CurrentVersion
            })) {
                throw "Current NSIS did not register version $CurrentVersion after upgrade."
            }
            $currentNsisRoot = Get-InstallRootFromEntry -Entry $currentNsisEntry -PreferredRoot $nsisUpgradeRoot
            if (
                [System.IO.Path]::GetFullPath($oldNsisRoot).TrimEnd('\') -ne
                [System.IO.Path]::GetFullPath($currentNsisRoot).TrimEnd('\')
            ) {
                throw "NSIS upgrade did not reuse the previous install root: old=$oldNsisRoot current=$currentNsisRoot"
            }
            Invoke-SidecarSmoke -InstallRoot $nsisUpgradeRoot | Out-Null
            Invoke-NsisUninstall -InstallRoot $nsisUpgradeRoot
        } finally {
            if (Test-Path -LiteralPath $nsisUpgradeRoot) {
                try { Invoke-NsisUninstall -InstallRoot $nsisUpgradeRoot } catch { Write-Warning $_ }
            }
        }
    }

    if ($null -ne $previous -and $previous.Path) {
        Write-Step "Installing $($previous.Tag), upgrading with current MSI, smoking sidecar, and uninstalling"
        $upgradeRoots = [System.Collections.Generic.List[string]]::new()
        try {
            $oldEntry = Invoke-MsiInstall `
                -PackagePath $previous.Path `
                -ExpectedVersion $previous.Version `
                -LogName "upgrade-old-install.log"
            $oldInstallLocation = Get-OptionalProperty -InputObject $oldEntry -Name "InstallLocation"
            if ($oldInstallLocation) { $upgradeRoots.Add([string]$oldInstallLocation) }
            $oldProductCode = [string](Get-OptionalProperty -InputObject $oldEntry -Name "PSChildName")

            $currentEntry = Invoke-MsiInstall -PackagePath $MsiPath -ExpectedVersion $CurrentVersion -LogName "upgrade-current-install.log"
            $currentEntries = @(Get-CalenUninstallEntries)
            if (-not ($currentEntries | Where-Object { [string](Get-OptionalProperty -InputObject $_ -Name "DisplayVersion") -eq $CurrentVersion })) {
                throw "Current MSI did not register version $CurrentVersion after upgrade."
            }
            $oldStillRegistered = $currentEntries | Where-Object {
                [string](Get-OptionalProperty -InputObject $_ -Name "PSChildName") -eq $oldProductCode -and
                [string](Get-OptionalProperty -InputObject $_ -Name "DisplayVersion") -ne $CurrentVersion
            }
            if ($oldStillRegistered) {
                throw "Previous MSI remained registered after current MSI upgrade."
            }
            $upgradeRoot = Get-InstallRootFromEntry -Entry $currentEntry
            $upgradeRoots.Add($upgradeRoot)
            Invoke-SidecarSmoke -InstallRoot $upgradeRoot | Out-Null
            Invoke-MsiUninstall -Entry $currentEntry -FallbackPackage $MsiPath
        } finally {
            foreach ($entry in @(Get-CalenUninstallEntries)) {
                Invoke-MsiUninstall -Entry $entry -FallbackPackage $MsiPath
            }
            foreach ($root in ($upgradeRoots | Select-Object -Unique)) {
                if ($root -and (Test-Path -LiteralPath $root)) {
                    Wait-InstallRootReleased -InstallRoot $root
                }
            }
        }
    }

    Write-Host "`nWindows installer lifecycle validation passed."
} finally {
    $cleanupRoots = [System.Collections.Generic.List[string]]::new()
    $cleanupRoots.Add($nsisInstallRoot)
    $cleanupRoots.Add($nsisUpgradeRoot)
    $cleanupRoots.Add($msiRequestedRoot)
    foreach ($nsisRoot in @($nsisInstallRoot, $nsisUpgradeRoot)) {
        if (Test-Path -LiteralPath $nsisRoot) {
            try { Invoke-NsisUninstall -InstallRoot $nsisRoot } catch { Write-Warning $_ }
        }
    }
    foreach ($entry in @(Get-CalenUninstallEntries)) {
        try {
            $cleanupRoots.Add((Get-InstallRootFromEntry -Entry $entry))
        } catch {
            Write-Warning "Could not resolve cleanup root for installed Calen entry: $_"
        }
        $productCode = [string](Get-OptionalProperty -InputObject $entry -Name "PSChildName")
        if ($productCode -match '^\{[0-9A-Fa-f-]+\}$') {
            try { Invoke-MsiUninstall -Entry $entry -FallbackPackage $MsiPath } catch { Write-Warning $_ }
        }
    }
    foreach ($root in ($cleanupRoots | Select-Object -Unique)) {
        if (Test-Path -LiteralPath $root) {
            try { Wait-InstallRootReleased -InstallRoot $root } catch { Write-Warning $_ }
        }
    }
    Remove-Item -LiteralPath $logsRoot -Recurse -Force -ErrorAction SilentlyContinue
}
