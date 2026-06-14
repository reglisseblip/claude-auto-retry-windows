# claude-auto-retry-windows

> Native **Windows** port of [`claude-auto-retry`](https://github.com/cheapestinference/claude-auto-retry) — auto-resume Claude Code after you hit a subscription rate limit, **without WSL or tmux**.

When Claude Code shows:

```
You've hit your limit · resets 3pm (Europe/Dublin)
```

…this tool detects the message, waits until the limit resets (+ a small margin), and sends `continue` for you. You come back to find your task finished.

The upstream tool is Linux/macOS only because it drives **tmux**. This port swaps tmux for **[psmux](https://github.com/psmux/psmux)** — a native Windows terminal multiplexer (Rust + ConPTY) that speaks the tmux command language — so the whole thing runs in PowerShell / Windows Terminal with no WSL.

---

## Status: verified on this machine

Every multiplexer primitive the tool relies on was probed live against **psmux 3.3.5** and passed:

| Primitive | Used for | Result |
|---|---|---|
| `new-session -d -s … -- <cmd>` | run Claude in a background session | ✅ |
| `has-session` | know when Claude exited | ✅ |
| `capture-pane -t … -p -S -N` | read Claude's TUI to detect the limit | ✅ |
| `send-keys -t … "continue" Enter` | type `continue` for you | ✅ (child received it on stdin) |
| `display-message -p '#{pane_current_command}'` | safety: only send to Claude | ✅ (returns `claude`) |
| `kill-session` | cleanup | ✅ |

Run `node bin/cli.js doctor` to re-run this probe on your machine at any time.

> **One caveat to test in real use:** `attach-session` (joining your terminal to the
> session) needs an interactive console, so it can't be exercised by an automated
> probe. Everything *around* it is verified. If attach ever misbehaves, the launcher
> falls back to running Claude directly (you simply lose the auto-retry for that run).

---

## Requirements

- Windows 10/11, PowerShell 7+ recommended (Windows PowerShell 5.1 also works)
- [Node.js](https://nodejs.org) ≥ 18
- [psmux](https://github.com/psmux/psmux): `winget install --id marlocarlo.psmux`
- Claude Code (`claude` on your PATH)

## Install

```powershell
# from the repo root
winget install --id marlocarlo.psmux        # if not already installed
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

or directly:

```powershell
node bin\cli.js install      # adds a `claude` function to your PowerShell $PROFILE
```

Then open a **new** PowerShell window and use `claude` exactly as before.

## Verify

```powershell
node bin\cli.js doctor
```

You should see `All checks passed — interactive auto-retry is supported on this machine.`

## How it works

```
You type `claude`  (PowerShell function from your $PROFILE)
        │
        ▼
  node src/launcher.js
        │
        ├── interactive run:
        │     psmux new-session -d -s clr-… -- claude <your args>   (Claude runs here)
        │     fork  src/monitor.js  ── polls capture-pane every 5s
        │     psmux attach-session  ── your terminal joins the session
        │
        └── `claude -p` (print) run: no multiplexer needed — the command is
              re-run on rate limit by buffering stdout/stderr.

  monitor.js loop:
     capture-pane → strip ANSI → detect "limit … resets …"
        → parse reset time (timezone-aware, DST-safe)
        → wait until reset + margin
        → send-keys "continue" Enter
```

`claude -p`/`--print` (non-interactive) mode doesn't use psmux at all and works on
any platform: the launcher just re-runs the command after the limit resets.

## Configuration

Optional `~/.claude-auto-retry.json` (i.e. `C:\Users\<you>\.claude-auto-retry.json`):

```json
{
  "maxRetries": 5,
  "pollIntervalSeconds": 5,
  "marginSeconds": 60,
  "fallbackWaitHours": 5,
  "retryMessage": "Continue where you left off. The previous attempt was rate limited.",
  "customPatterns": [],
  "foregroundCommands": ["claude", "node"]
}
```

Environment overrides:

- `CLAUDE_AUTO_RETRY_MUX` — multiplexer binary (default `psmux` on Windows, `tmux` elsewhere). E.g. set to `tmux` to reuse this code under WSL.
- `CLAUDE_BIN` — explicit path to the Claude executable.

## Commands

```
node bin\cli.js install     Add the PowerShell `claude` wrapper to your profile(s)
node bin\cli.js uninstall   Remove it
node bin\cli.js doctor      Live-test psmux session / capture / send-keys
node bin\cli.js status      Recent monitor log entries
node bin\cli.js logs        Today's full log
node bin\cli.js version     Print version
```

Logs: `C:\Users\<you>\.claude-auto-retry\logs\<date>.log`.

## Tests

```powershell
npm test      # node --test: pattern detection, time parsing, mux arg builders
```

## Uninstall

```powershell
node bin\cli.js uninstall
```

## Credits

- Original tool & detection/timing logic: [cheapestinference/claude-auto-retry](https://github.com/cheapestinference/claude-auto-retry) (MIT)
- Windows multiplexer: [psmux](https://github.com/psmux/psmux)

MIT licensed. See `LICENSE`.
