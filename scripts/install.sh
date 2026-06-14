#!/usr/bin/env bash
# One-shot installer for claude-auto-retry-windows (Git Bash / bash on Windows).
#
#   bash scripts/install.sh
#
# Checks node, installs psmux via winget if missing, wires the four commands
# (claude / claude+ / claudem / claudem+), and runs doctor.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
WINGET_LINKS="$HOME/AppData/Local/Microsoft/WinGet/Links"
export PATH="$PATH:$WINGET_LINKS"

say()  { printf '\033[36m%s\033[0m\n' "$*"; }
ok()   { printf '\033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

say 'claude-auto-retry-windows installer'

# --- node ---
command -v node >/dev/null 2>&1 || die 'node is required but was not found on PATH (https://nodejs.org).'
ok "node $(node --version)"

# --- psmux ---
if ! command -v psmux >/dev/null 2>&1; then
  warn 'psmux not found — installing via winget...'
  command -v winget >/dev/null 2>&1 || die 'winget not found. Install psmux manually: https://github.com/psmux/psmux'
  winget install --id marlocarlo.psmux -e --accept-source-agreements --accept-package-agreements || true
  export PATH="$PATH:$WINGET_LINKS"
fi
if command -v psmux >/dev/null 2>&1; then
  ok "psmux $(psmux -V 2>/dev/null || echo present)"
else
  warn 'psmux still not visible in this shell — open a new shell and re-run if install fails.'
fi

# --- wire the commands ---
node "$ROOT/bin/cli.js" install || die 'installer failed.'

# --- verify ---
echo
node "$ROOT/bin/cli.js" doctor || warn 'doctor reported issues (see above).'

echo
ok 'Done. Reload your shell:  source ~/.bashrc   (or open a new terminal)'
echo '  claude   = vanilla         claudem   = monitored (auto-retry)'
echo '  claude+  = vanilla + skip   claudem+  = monitored + skip'
echo '  override per launch with  --monitor / --no-monitor'
