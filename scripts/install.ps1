# One-shot installer for claude-auto-retry-windows (PowerShell).
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1
#
# Checks node, installs psmux via winget if missing, wires the four commands
# (claude / claude+ / claudem / claudem+), and runs doctor.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$wingetLinks = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links'
if (Test-Path $wingetLinks) { $env:PATH = "$env:PATH;$wingetLinks" }

Write-Host 'claude-auto-retry-windows installer' -ForegroundColor Cyan

# node
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error 'node is required but was not found on PATH (https://nodejs.org).'
    exit 1
}
Write-Host "node $(node --version)" -ForegroundColor Green

# psmux
if (-not (Get-Command psmux -ErrorAction SilentlyContinue)) {
    Write-Host 'psmux not found - installing via winget...' -ForegroundColor Yellow
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Write-Error 'winget not found. Install psmux manually: https://github.com/psmux/psmux'
        exit 1
    }
    winget install --id marlocarlo.psmux -e --accept-source-agreements --accept-package-agreements
    if (Test-Path $wingetLinks) { $env:PATH = "$env:PATH;$wingetLinks" }
}

# Wire the commands (PowerShell functions + bash + .cmd shims).
& node (Join-Path $root 'bin\cli.js') install

# Verify.
Write-Host ''
& node (Join-Path $root 'bin\cli.js') doctor

Write-Host ''
Write-Host 'Done. Open a NEW PowerShell window, then use:' -ForegroundColor Green
Write-Host '  claude   = vanilla         claudem   = monitored (auto-retry)'
Write-Host '  claude+  = vanilla + skip   claudem+  = monitored + skip'
Write-Host '  override per launch with  --monitor / --no-monitor'
