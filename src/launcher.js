import { spawn, fork, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  getMuxBinary, muxAvailable, isInsideMux,
  newSessionDetached, hasSession, killSession,
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

// --- Run Claude directly in this terminal, no monitoring (fallback when the
//     multiplexer is unavailable).
function runClaudeDirect(claudeBin, args) {
  const claude = spawn(claudeBin, args, {
    stdio: 'inherit',
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
  const monitor = fork(MONITOR_PATH, [sessionName], {
    detached: true,
    stdio: 'ignore',
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

// --- Main ---
const args = process.argv.slice(2);

let exitCode;
if (isPrintMode(args)) {
  exitCode = await launchPrintMode(args);
} else if (isInsideMux()) {
  // Already inside a mux pane: just run Claude (the outer invocation owns the
  // monitor). Prevents nested sessions.
  exitCode = await runClaudeDirect(findClaudeBinary(), args);
} else {
  exitCode = await launchInteractive(args);
}

process.exit(exitCode);
