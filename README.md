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

One-shot installer (checks node, installs psmux via winget if missing, wires all four
commands, runs doctor). From the repo root:

```bash
# Git Bash
bash scripts/install.sh
```

```powershell
# PowerShell
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

or do it by hand:

```bash
winget install --id marlocarlo.psmux     # if psmux isn't installed
node bin/cli.js install                  # wires claude / claude+ / claudem / claudem+
```

Then open a **new** shell (bash: `source ~/.bashrc`). You now have four commands (see below).

## Verify

```powershell
node bin\cli.js doctor
```

You should see `All checks passed — interactive auto-retry is supported on this machine.`

## Commands & modes

Monitoring is **opt-in**: choose it by the command name or a flag. No prompt.

| Command    | Monitoring (psmux + auto-retry) | Permissions |
|------------|---------------------------------|-------------|
| `claude`   | off (vanilla)                   | normal |
| `claude+`  | off (vanilla)                   | `--dangerously-skip-permissions` |
| `claudem`  | **on**                          | normal |
| `claudem+` | **on**                          | `--dangerously-skip-permissions` |

Per-launch override (works on any of them, stripped before reaching Claude):

```
claude  --monitor      # this run IS monitored, despite the name
claudem --no-monitor   # this run is vanilla, despite the name
```

How the choice is resolved, highest priority first: `--monitor`/`--no-monitor` flag →
`CLAUDE_AUTO_RETRY_DEFAULT` env (set by each command's wrapper) → `enabled` in config.

Wiring: `claude` / `claudem` are shell functions (bash + PowerShell); `claude+` / `claudem+`
are `.cmd` shims next to `claude.exe` (a `.cmd` can't shadow `claude` itself, but the
+variants are new names). `claude -p` / `claudem -p` (print mode) never use psmux.

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

## Auto-cleanup (no orphaned sessions)

The monitor and session are launched automatically — you never start anything by hand.
They're also torn down automatically:

- **Normal quit** (you exit Claude): the session ends, the monitor logs *"Session ended"* and exits.
- **Hard-closed terminal / detach**: the session would otherwise linger detached. Each monitor
  watches `#{session_attached}` and, once its session has **no console attached for
  `reapUnattachedSeconds` (default 15s)**, it kills the session and exits.
- **Leftovers from before**: every launch also sweeps stale orphaned `clr-*` sessions
  (unattached, older than 60s) — see `reapOrphansOnLaunch`.

Inspect or force it anytime:

```powershell
node bin\cli.js sessions   # attached vs orphan
node bin\cli.js reap       # kill all unattached clr-* sessions now (keeps attached ones)
```

Set `reapUnattachedSeconds` to `0` if you'd rather keep detached sessions alive for reattaching.

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

- `CLAUDE_AUTO_RETRY_MUX` — multiplexer binary (default `psmux` on Windows, `tmux` elsewhere). E.g. set to `tmux` to reuse this code under WSL.
- `CLAUDE_BIN` — explicit path to the Claude executable.
- `CLAUDE_AUTO_RETRY_DEFAULT` — `1`/`0` to default a launch to monitored/vanilla (set automatically by the `claude` vs `claudem` wrappers; a `--monitor`/`--no-monitor` flag overrides it).

## Commands

```
node bin\cli.js install     Add the PowerShell `claude` wrapper to your profile(s)
node bin\cli.js uninstall   Remove it
node bin\cli.js doctor      Live-test psmux session / capture / send-keys
node bin\cli.js sessions    List claude-auto-retry sessions (attached / orphan)
node bin\cli.js reap        Kill orphaned (unattached) sessions right now
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
