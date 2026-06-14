# Uninstaller for claude-auto-retry-windows (PowerShell).
#   powershell -ExecutionPolicy Bypass -File scripts\uninstall.ps1
#
# Removes the claude / claudem functions from your profiles and the
# claude+ / claudem+ .cmd shims (restoring any backed-up original claude+.cmd).

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error 'node not found on PATH.'
    exit 1
}

& node (Join-Path $root 'bin\cli.js') uninstall

Write-Host ''
Write-Host 'Done. Open a new shell to finish removal.' -ForegroundColor Green
