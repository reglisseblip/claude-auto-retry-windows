<div align="center">

# claude-auto-retry-windows

### Auto-resume Claude Code after subscription rate limits — on **native Windows**, no WSL, no tmux.

[![CI](https://github.com/reglisseblip/claude-auto-retry-windows/actions/workflows/test.yml/badge.svg)](https://github.com/reglisseblip/claude-auto-retry-windows/actions/workflows/test.yml)
[![Release](https://img.shields.io/github/v/release/reglisseblip/claude-auto-retry-windows?logo=github&color=blue)](https://github.com/reglisseblip/claude-auto-retry-windows/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/platform-Windows-0078D6?logo=windows&logoColor=white)](#requirements)
[![Node ≥18](https://img.shields.io/badge/node-%E2%89%A518-5FA04E?logo=node.js&logoColor=white)](#requirements)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)

</div>

When Claude Code stops with *“You've hit your limit · resets 3pm”*, this tool waits for the
reset and types **`continue`** for you. You come back to finished work — no babysitting.

It's a Windows port of [`claude-auto-retry`](https://github.com/cheapestinference/claude-auto-retry)
(which requires **tmux**), rebuilt on [**psmux**](https://github.com/psmux/psmux) — a native
Windows terminal multiplexer — so everything runs in **Git Bash, PowerShell, or cmd** with no WSL.

---

## Table of contents

- [Why](#why)
- [Features](#features)
- [Install](#install)
- [Commands & modes](#commands--modes)
- [How it works](#how-it-works)
- [Configuration](#configuration)
- [CLI reference](#cli-reference)
- [Auto-cleanup](#auto-cleanup)
- [Requirements](#requirements)
- [How it's verified](#how-its-verified)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [Credits & license](#credits--license)

## Why

You're mid-task with Claude Code and hit the 5-hour / usage limit:

```
You've hit your limit · resets 3pm (Europe/Dublin)
```

Claude stops. You wait hours, come back, and type “continue”. Overnight or AFK runs stall.
This tool detects that message, parses the reset time (timezone- and DST-aware), waits, and
sends `continue` automatically.

## Features

- 🔁 **Auto-continue** after the rate limit resets — accurate, timezone/DST-aware reset parsing.
- 🪟 **100 % native Windows** — uses **psmux**, not tmux; works in Git Bash, PowerShell and cmd, **no WSL**.
- 🎚️ **Opt-in monitoring** — `claude` (vanilla) vs `claudem` (monitored), or override any launch with `--monitor` / `--no-monitor`.
- 🧹 **Self-cleaning** — orphaned sessions are auto-reaped; no leftover background processes flashing console windows.
- 🩺 **`doctor`** — live-tests every psmux primitive on *your* machine before you trust it.
- 🖨️ **Print mode too** — `claude -p` retries headlessly with no multiplexer.
- 📦 **No dependencies** — just Node ≥ 18 and psmux.

## Install

One-shot installer (checks Node, installs psmux via winget if missing, wires the four commands,
runs `doctor`). From the repo root:

```bash
# Git Bash
bash scripts/install.sh
```

```powershell
# PowerShell
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

<details>
<summary>…or do it by hand</summary>

```bash
winget install --id marlocarlo.psmux     # if psmux isn't installed
node bin/cli.js install                  # wires claude / claude+ / claudem / claudem+
```
</details>

Then open a **new** shell (bash: `source ~/.bashrc`). Verify with `node bin/cli.js doctor`.

## Commands & modes

Monitoring is **opt-in** — choose it by command name or a flag. No prompts.

| Command    | Monitoring (psmux + auto-retry) | Permissions |
|------------|:-------------------------------:|-------------|
| `claude`   | ⚪ off (vanilla)                | normal |
| `claude+`  | ⚪ off (vanilla)                | `--dangerously-skip-permissions` |
| `claudem`  | 🟢 **on**                       | normal |
| `claudem+` | 🟢 **on**                       | `--dangerously-skip-permissions` |

Per-launch override (works on any of them, stripped before reaching Claude):

```bash
claude  --monitor      # this run IS monitored, despite the name
claudem --no-monitor   # this run is vanilla, despite the name
```

Resolution order: `--monitor`/`--no-monitor` flag → `CLAUDE_AUTO_RETRY_DEFAULT` env (set by each
wrapper) → `enabled` in config. In a monitored session you'll see the green **psmux status bar** at
the bottom — that's how you know auto-retry is armed.

## How it works

```
You type `claudem`  (shell function / .cmd shim)
        │
        ▼
  node src/launcher.js   ──►  resolveMode(): vanilla vs monitored
        │
        ├─ vanilla:    run claude.exe directly (no psmux, no monitor)
        │
        └─ monitored interactive:
              psmux new-session -d -s clr-…  -- claude …   (Claude runs here)
              fork  src/monitor.js  ── polls capture-pane every 5s
              psmux attach-session  ── your terminal joins the session

  monitor loop:  capture-pane → strip ANSI → detect "limit … resets …"
                 → parse reset time → wait until reset + margin
                 → send-keys "continue"   → back to work
```

`claude -p` / `claudem -p` (print mode) never use psmux: the command is simply re-run after the
limit resets.

## Configuration

Optional `~/.claude-auto-retry.json` (i.e. `C:\Users\<you>\.claude-auto-retry.json`):

```json
{
  "enabled": true,
  "maxRetries": 5,
  "pollIntervalSeconds": 5,
  "marginSeconds": 60,
  "fallbackWaitHours": 5,
  "retryMessage": "Continue where you left off. The previous attempt was rate limited.",
  "customPatterns": [],
  "foregroundCommands": ["claude", "node"],
  "reapUnattachedSeconds": 15,
  "reapStartupSeconds": 60,
  "reapOrphansOnLaunch": true
}
```

Environment overrides:

| Variable | Effect |
|---|---|
| `CLAUDE_AUTO_RETRY_DEFAULT` | `1`/`0` to default a launch to monitored/vanilla (set by the wrappers; a flag overrides it). |
| `CLAUDE_AUTO_RETRY_MUX` | Multiplexer binary (default `psmux` on Windows, `tmux` elsewhere — e.g. reuse under WSL). |
| `CLAUDE_BIN` | Explicit path to the Claude executable. |

## CLI reference

```
node bin/cli.js install      Wire claude / claude+ / claudem / claudem+ (+ .cmd shims)
node bin/cli.js uninstall    Remove the wrappers and shims
node bin/cli.js doctor       Live-test psmux session / capture / send-keys
node bin/cli.js sessions     List sessions (attached / orphan)
node bin/cli.js reap         Kill orphaned (unattached) sessions now
node bin/cli.js status       Recent monitor log entries
node bin/cli.js logs         Today's full log
node bin/cli.js version      Print version
```

Logs live in `C:\Users\<you>\.claude-auto-retry\logs\<date>.log`.

To remove everything: `bash scripts/uninstall.sh` (or `powershell -ExecutionPolicy Bypass -File scripts\uninstall.ps1`).

## Auto-cleanup

You never start the monitor by hand — and nothing is left running:

- **Normal quit:** the session ends, the monitor logs *“Session ended”* and exits.
- **Hard-closed terminal / detach:** each monitor watches `#{session_attached}`; once its session has
  had **no console for `reapUnattachedSeconds` (15s default)** it kills the session and exits.
- **Old leftovers:** every launch also sweeps stale orphaned `clr-*` sessions (unattached, >60s old).

```bash
node bin/cli.js sessions   # attached vs orphan
node bin/cli.js reap       # kill all unattached sessions now (keeps attached ones)
```

Set `reapUnattachedSeconds` to `0` to keep detached sessions alive for reattaching.

## Requirements

- Windows 10/11 — PowerShell 7+ recommended (Windows PowerShell 5.1 also works), Git Bash, or cmd
- [Node.js](https://nodejs.org) ≥ 18
- [psmux](https://github.com/psmux/psmux) ≥ 3 — `winget install --id marlocarlo.psmux`
- Claude Code (`claude` on your PATH)

## How it's verified

`node bin/cli.js doctor` spins up a scratch psmux session and live-tests every primitive the tool
relies on, so you can trust it on your exact setup:

| Primitive | Used for |
|---|---|
| `new-session -d … -- <cmd>` | run Claude in a background session |
| `has-session` | detect when Claude exits |
| `capture-pane -t … -p` | read Claude's TUI to detect the limit |
| `send-keys -t … "continue"` | type `continue` for you |
| `display-message '#{…}'` | only send to Claude, never the wrong process |
| `kill-session` | cleanup |

The unit tests (`npm test`) cover the pure logic — rate-limit detection, timezone/DST reset parsing,
mode resolution and the reap state machine — and run in CI on every push.

> **Note:** interactive `attach-session` needs a real console, so it's the one thing the automated
> probe can't exercise. It works best in **Windows Terminal / PowerShell**; if it ever fails the
> launcher falls back to running Claude directly (you only lose auto-retry for that run).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `claude` / `claudem` “not found” after install | Open a **new** shell, or `source ~/.bashrc`. |
| `psmux` not found | `winget install --id marlocarlo.psmux`, then open a new shell. |
| Console windows flicker | Update psmux; this is fixed via `windowsHide` on all psmux calls. |
| Interactive session glitches in plain Git Bash (mintty) | Use **Windows Terminal** or PowerShell (real ConPTY console). |
| Want plain Claude, just this once | `claudem --no-monitor`, or just use `claude`. |
| Orphaned sessions piling up | `node bin/cli.js reap` (and they self-reap after 15s anyway). |

## Contributing

Issues and PRs welcome. To hack on it:

```bash
git clone https://github.com/reglisseblip/claude-auto-retry-windows
cd claude-auto-retry-windows
npm test          # node --test (pure-logic unit tests, no psmux needed)
node bin/cli.js doctor   # full live check (needs psmux on Windows)
```

The platform-specific code lives in `src/mux.js` (psmux/tmux adapter), `src/launcher.js`
(mode + routing) and `src/monitor.js` (detect → retry → reap). Detection and timing logic
(`patterns.js`, `time-parser.js`) is shared with upstream and unit-tested.

## Credits & license

- Original tool & detection/timing logic: [cheapestinference/claude-auto-retry](https://github.com/cheapestinference/claude-auto-retry) (MIT)
- Windows multiplexer: [psmux](https://github.com/psmux/psmux)

Author: **reglisseblip** · MIT licensed — see [`LICENSE`](LICENSE).
