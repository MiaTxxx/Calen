Set-StrictMode -Version Latest

function ConvertTo-MsiQuotedPath {
    param([Parameter(Mandatory = $true)][string]$PathValue)

    if ($PathValue.Contains('"')) {
        throw "MSI paths cannot contain a double quote: $PathValue"
    }
    if ($PathValue.EndsWith('\') -or $PathValue.EndsWith('/')) {
        throw "MSI paths must not end with a directory separator: $PathValue"
    }
    return '"' + $PathValue + '"'
}

function New-MsiInstallRawArguments {
    param(
        [Parameter(Mandatory = $true)][string]$PackagePath,
        [Parameter(Mandatory = $true)][string]$LogPath,
        [string]$RequestedRoot
    )

    $quotedPackagePath = ConvertTo-MsiQuotedPath -PathValue $PackagePath
    $quotedLogPath = ConvertTo-MsiQuotedPath -PathValue $LogPath
    $rawArguments = "/L*v $quotedLogPath /i $quotedPackagePath /qn /norestart"
    if ($RequestedRoot) {
        $quotedRequestedRoot = ConvertTo-MsiQuotedPath -PathValue $RequestedRoot
        # Windows Installer parses PROPERTY="value with spaces" from the raw
        # command line; ProcessStartInfo.ArgumentList quotes it incorrectly.
        $rawArguments += " INSTALLDIR=$quotedRequestedRoot"
    }
    return $rawArguments
}
