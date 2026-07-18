function Test-CalenPinnedLlamaRuntimeVersion {
    param(
        [AllowNull()]
        [object[]]$VersionOutput,

        [AllowEmptyString()]
        [string]$SourceCommit,

        [int]$ExitCode = 0
    )

    if ($ExitCode -ne 0 -or $SourceCommit -notmatch '^[0-9a-fA-F]{40}$') {
        return $false
    }

    $renderedVersionOutput = @($VersionOutput) -join "`n"
    $versionMatch = [Regex]::Match(
        $renderedVersionOutput,
        '(?im)^\s*version:\s+\d+\s+\(([0-9a-f]{7,40})\)(?:\s|$)'
    )
    if (-not $versionMatch.Success) {
        return $false
    }

    return $SourceCommit.StartsWith(
        $versionMatch.Groups[1].Value,
        [StringComparison]::OrdinalIgnoreCase
    )
}
