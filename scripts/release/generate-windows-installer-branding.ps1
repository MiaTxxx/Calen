param(
    [string]$SourceIcon,
    [string]$OutputDirectory
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
if (-not $SourceIcon) {
    $SourceIcon = Join-Path $repoRoot "crates/agent-gui/src-tauri/icons/icon-windows.png"
}
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $repoRoot "crates/agent-gui/src-tauri/icons"
}

Add-Type -AssemblyName System.Drawing

function New-InstallerBitmap {
    param(
        [Parameter(Mandatory = $true)][int]$Width,
        [Parameter(Mandatory = $true)][int]$Height,
        [Parameter(Mandatory = $true)][string]$OutputPath,
        [Parameter(Mandatory = $true)][System.Drawing.Image]$Icon,
        [Parameter(Mandatory = $true)][int]$BrandPanelWidth
    )

    $bitmap = New-Object System.Drawing.Bitmap(
        $Width,
        $Height,
        [System.Drawing.Imaging.PixelFormat]::Format24bppRgb
    )
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)

    try {
        $graphics.Clear([System.Drawing.Color]::White)
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality

        $panelBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
            (New-Object System.Drawing.Point(0, 0)),
            (New-Object System.Drawing.Point($BrandPanelWidth, $Height)),
            ([System.Drawing.Color]::FromArgb(247, 250, 255)),
            ([System.Drawing.Color]::FromArgb(225, 237, 255))
        )
        try {
            $graphics.FillRectangle($panelBrush, 0, 0, $BrandPanelWidth, $Height)
        }
        finally {
            $panelBrush.Dispose()
        }

        $iconSize = 124
        $iconX = [int](($BrandPanelWidth - $iconSize) / 2)
        $graphics.DrawImage($Icon, $iconX, 58, $iconSize, $iconSize)

        $font = New-Object System.Drawing.Font("Segoe UI", 19, [System.Drawing.FontStyle]::Regular)
        $textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(21, 57, 105))
        $format = New-Object System.Drawing.StringFormat
        try {
            $format.Alignment = [System.Drawing.StringAlignment]::Center
            $graphics.DrawString(
                "Calen",
                $font,
                $textBrush,
                (New-Object System.Drawing.RectangleF(0, 200, $BrandPanelWidth, 40)),
                $format
            )
        }
        finally {
            $format.Dispose()
            $textBrush.Dispose()
            $font.Dispose()
        }

        if ($BrandPanelWidth -lt $Width) {
            $divider = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(210, 220, 235))
            try {
                $graphics.DrawLine($divider, $BrandPanelWidth - 1, 0, $BrandPanelWidth - 1, $Height)
            }
            finally {
                $divider.Dispose()
            }
        }

        $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Bmp)
    }
    finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$source = [System.Drawing.Image]::FromFile((Resolve-Path $SourceIcon).Path)
try {
    New-InstallerBitmap `
        -Width 164 `
        -Height 314 `
        -BrandPanelWidth 164 `
        -Icon $source `
        -OutputPath (Join-Path $OutputDirectory "nsis-sidebar.bmp")
    New-InstallerBitmap `
        -Width 493 `
        -Height 312 `
        -BrandPanelWidth 164 `
        -Icon $source `
        -OutputPath (Join-Path $OutputDirectory "wix-dialog.bmp")
}
finally {
    $source.Dispose()
}
