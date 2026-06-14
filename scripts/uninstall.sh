#!/usr/bin/env bash
# Uninstaller for claude-auto-retry-windows (Git Bash / bash on Windows).
#
#   bash scripts/uninstall.sh
#
# Removes the claude / claudem functions from your shell profiles and the
# claude+ / claudem+ .cmd shims (restoring any backed-up original claude+.cmd).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"

command -v node >/dev/null 2>&1 || { printf '\033[31m✗ node not found on PATH\033[0m\n' >&2; exit 1; }

node "$ROOT/bin/cli.js" uninstall

echo
printf '\033[32m✓\033[0m Done. Open a new shell to finish removal.\n'
