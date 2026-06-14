# One-shot installer for claude-auto-retry-windows.
# Run from the repo root:  powershell -ExecutionPolicy Bypass -File scripts\install.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

Write-Host 'claude-auto-retry-windows installer' -ForegroundColor Cyan

# node
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error 'node is required but was not found on PATH.'
    exit 1
}

# psmux
if (-not (Get-Command psmux -ErrorAction SilentlyContinue)) {
    Write-Host 'psmux not found. Installing via winget...' -ForegroundColor Yellow
    winget install --id marlocarlo.psmux -e --accept-source-agreements --accept-package-agreements
    Write-Host 'Open a new shell if psmux is still not found after this.' -ForegroundColor Yellow
}

# Run the Node installer (writes the PowerShell wrapper into your profile).
& node (Join-Path $root 'bin\cli.js') install

Write-Host ''
Write-Host 'Done. Open a NEW PowerShell window, then run:' -ForegroundColor Green
Write-Host "  node `"$($root)\bin\cli.js`" doctor" -ForegroundColor Green
