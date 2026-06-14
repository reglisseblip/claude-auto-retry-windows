import { spawn, fork, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  getMuxBinary, muxAvailable, isInsideMux,
  newSessionDetached, hasSession, killSession, listSessions,
} from './mux.js';
import { isRateLimited } from './patterns.js';
import { parseResetTime, calculateWaitMs } from './time-parser.js';
import { loadConfig } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MONITOR_PATH = join(__dirname, 'monitor.js');

function findClaudeBinary() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  const finder = process.platform === 'win32' ? 'where' : 'which';
  try {
    const out = execFileSync(finder, ['claude'], { encoding: 'utf-8' });
    const first = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0];
    if (first) return first;
  } catch { /* fall through */ }
  return 'claude';
}

function isPrintMode(args) {
  return args.includes('-p') || args.includes('--print');
}

// Decide whether this launch is monitored (psmux + auto-retry) or vanilla.
// Precedence: explicit --monitor/--no-monitor flag (stripped from args) >
// CLAUDE_AUTO_RETRY_DEFAULT env (set by the per-command wrappers) > config.enabled.
// Exported pure so it can be unit-tested.
export function resolveMode(argv, cfg = {}, env = process.env) {
  let monitor = null;
  const args = [];
  for (const a of argv) {
    if (a === '--monitor' || a === '--retry') { monitor = true; continue; }
    if (a === '--no-monitor' || a === '--no-retry') { monitor = false; continue; }
    args.push(a);
  }
  if (monitor === null) {
    if (env.CLAUDE_AUTO_RETRY_DEFAULT === '1') monitor = true;
    else if (env.CLAUDE_AUTO_RETRY_DEFAULT === '0') monitor = false;
  }
  if (monitor === null) monitor = cfg.enabled !== false; // default: monitored
  return { monitor, args };
}

// --- Print mode: capture stdout/stderr, retry the whole command on rate limit.
//     No multiplexer needed; works on any platform.
async function launchPrintMode(args) {
  const claudeBin = findClaudeBinary();
  const config = await loadConfig();
  let retries = 0;

  while (true) {
    const result = await new Promise((resolve) => {
      const chunks = [];
      const errChunks = [];
      const claude = spawn(claudeBin, args, {
        stdio: ['inherit', 'pipe', 'pipe'],
        windowsHide: true,
        env: { ...process.env, CLAUDE_AUTO_RETRY_ACTIVE: '1' },
      });

      claude.stdout.on('data', (d) => chunks.push(d));
      claude.stderr.on('data', (d) => errChunks.push(d));
      claude.on('error', (err) => resolve({ code: 1, stdout: '', stderr: err.message }));
      claude.on('exit', (code) => resolve({
        code: code ?? 1,
        stdout: Buffer.concat(chunks).toString(),
        stderr: Buffer.concat(errChunks).toString(),
      }));
    });

    const combined = result.stdout + result.stderr;

    if (!isRateLimited(combined, config.customPatterns)) {
      process.stdout.write(result.stdout);
      process.stderr.write(result.stderr);
      return result.code;
    }

    retries++;
    if (retries > config.maxRetries) {
      process.stderr.write(`[claude-auto-retry] Max retries (${config.maxRetries}) reached.\n`);
      return 1;
    }

    const parsed = parseResetTime(combined);
    const waitMs = calculateWaitMs(parsed, config.marginSeconds, config.fallbackWaitHours);
    process.stderr.write(`[claude-auto-retry] Rate limited. Waiting ${Math.round(waitMs / 1000)}s before retry ${retries}/${config.maxRetries}...\n`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

// Kill leftover orphaned clr-* sessions (no console attached) from terminals
// that were hard-closed in the past. Age-gated so a session another terminal is
// still attaching to (created seconds ago) is never touched. Killing the session
// makes its old monitor exit on its next tick (has-session -> false).
function reapStaleOrphans(currentName) {
  const MIN_AGE_MS = 60_000;
  for (const s of listSessions()) {
    if (s.name === currentName) continue;
    if (!s.name.startsWith('clr-')) continue;
    if (s.attached > 0) continue;
    const ts = parseInt(s.name.split('-')[2], 10); // clr-<pid>-<ts>
    if (Number.isFinite(ts) && (Date.now() - ts) < MIN_AGE_MS) continue;
    killSession(s.name);
  }
}

// --- Run Claude directly in this terminal, no monitoring (fallback when the
//     multiplexer is unavailable).
function runClaudeDirect(claudeBin, args) {
  const claude = spawn(claudeBin, args, {
    stdio: 'inherit',
    windowsHide: true,
    env: { ...process.env, CLAUDE_AUTO_RETRY_ACTIVE: '1' },
  });
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => { try { claude.kill(sig); } catch {} });
  }
  return new Promise((resolve) => {
    claude.on('exit', (code) => resolve(code ?? 1));
    claude.on('error', () => resolve(1));
  });
}

// --- Interactive mode: run Claude inside a detached mux session, fork a monitor
//     that watches the pane, then attach this terminal to the session.
async function launchInteractive(args) {
  const mux = getMuxBinary();
  const claudeBin = findClaudeBinary();

  if (!muxAvailable()) {
    process.stderr.write(`[claude-auto-retry] '${mux}' not found — running Claude without auto-retry.\n`);
    process.stderr.write(`[claude-auto-retry] Install it with:  winget install --id marlocarlo.psmux\n`);
    return runClaudeDirect(claudeBin, args);
  }

  const sessionName = `clr-${process.pid}-${Date.now()}`;

  try {
    newSessionDetached(sessionName, claudeBin, args);
  } catch (err) {
    process.stderr.write(`[claude-auto-retry] Failed to create ${mux} session: ${err.message}\n`);
    return runClaudeDirect(claudeBin, args);
  }

  // Detached background monitor, targeting the session by name.
  // windowsHide keeps this hidden node process (and the psmux calls it makes
  // every poll) from flashing console windows on Windows.
  const monitor = fork(MONITOR_PATH, [sessionName], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, CLAUDE_AUTO_RETRY_SESSION: sessionName },
  });
  monitor.unref();

  // Attach the current terminal to the session (blocks until Claude exits or the
  // user detaches).
  const attach = spawn(mux, ['attach-session', '-t', sessionName], { stdio: 'inherit' });
  const code = await new Promise((resolve) => {
    attach.on('exit', (c) => resolve(c ?? 0));
    attach.on('error', (err) => {
      process.stderr.write(`[claude-auto-retry] Failed to attach: ${err.message}\n`);
      resolve(1);
    });
  });

  // Tidy up if the session is still alive (e.g. user detached without quitting).
  if (hasSession(sessionName)) killSession(sessionName);
  return code;
}

// --- Main (only when run directly, so tests can import resolveMode) ---
const isDirectRun = process.argv[1]?.endsWith('launcher.js');
if (isDirectRun) {
  const cfg = await loadConfig();

  // Best-effort sweep of stale orphaned sessions, even on a vanilla launch.
  if (cfg.reapOrphansOnLaunch && muxAvailable()) {
    try { reapStaleOrphans(null); } catch { /* non-fatal */ }
  }

  const { monitor, args } = resolveMode(process.argv.slice(2), cfg);

  let exitCode;
  if (!monitor) {
    // Vanilla: plain Claude, no psmux, no auto-retry.
    exitCode = await runClaudeDirect(findClaudeBinary(), args);
  } else if (isPrintMode(args)) {
    exitCode = await launchPrintMode(args);
  } else if (isInsideMux()) {
    // Already inside a mux pane: just run Claude (the outer invocation owns the
    // monitor). Prevents nested sessions.
    exitCode = await runClaudeDirect(findClaudeBinary(), args);
  } else {
    exitCode = await launchInteractive(args);
  }

  process.exit(exitCode);
}
