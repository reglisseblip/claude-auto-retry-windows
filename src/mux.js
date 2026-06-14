// Mux abstraction layer for the Windows port.
//
// The upstream tool drives `tmux`. On Windows there is no tmux, but `psmux`
// (https://github.com/psmux/psmux) is a native Windows terminal multiplexer that
// speaks the tmux command language over ConPTY. Every primitive this port needs
// — new-session, has-session, kill-session, capture-pane -p, send-keys, and
// display-message — has been verified working against psmux 3.3.5.
//
// The binary is configurable via CLAUDE_AUTO_RETRY_MUX so the same code can drive
// tmux (on a Unix box) or psmux (on Windows). Default: psmux on win32, tmux else.

import { execFileSync, execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFileCb);

// CRITICAL on Windows: psmux.exe is a console app. The monitor (a background
// process) shells out to it every few seconds; without windowsHide each call
// flashes a console window. windowsHide forces CREATE_NO_WINDOW so nothing pops.
const HIDE = process.platform === 'win32' ? { windowsHide: true } : {};

export function getMuxBinary() {
  return process.env.CLAUDE_AUTO_RETRY_MUX
    || (process.platform === 'win32' ? 'psmux' : 'tmux');
}

// --- arg builders (kept pure so they can be unit-tested) ---

export function buildCaptureArgs(target, lines = 200) {
  return ['capture-pane', '-t', target, '-p', '-S', `-${lines}`];
}

export function buildSendKeysArgs(target, text) {
  return ['send-keys', '-t', target, text, 'Enter'];
}

export function buildDisplayArgs(target, format) {
  return ['display-message', '-t', target, '-p', format];
}

export function buildNewSessionArgs(name, cmd, args) {
  // psmux: new-session -d -s NAME -- <cmd> [args...]
  return ['new-session', '-d', '-s', name, '--', cmd, ...args];
}

export function parseMuxVersion(versionString) {
  const match = versionString.match(/(\d+\.\d+)/);
  return match ? parseFloat(match[1]) : 0;
}

// --- runtime helpers ---

export function getMuxVersion() {
  try {
    return parseMuxVersion(execFileSync(getMuxBinary(), ['-V'], { encoding: 'utf-8', ...HIDE }).trim());
  } catch {
    return 0;
  }
}

export function muxAvailable() {
  try {
    execFileSync(getMuxBinary(), ['-V'], { stdio: 'ignore', ...HIDE });
    return true;
  } catch {
    return false;
  }
}

export async function capturePane(target, lines = 200) {
  const { stdout } = await execFileAsync(getMuxBinary(), buildCaptureArgs(target, lines), { maxBuffer: 4 * 1024 * 1024, ...HIDE });
  return stdout;
}

export async function sendKeys(target, text) {
  await execFileAsync(getMuxBinary(), buildSendKeysArgs(target, text), { ...HIDE });
}

export async function getPaneCommand(target) {
  try {
    const { stdout } = await execFileAsync(getMuxBinary(), buildDisplayArgs(target, '#{pane_current_command}'), { ...HIDE });
    return stdout.trim();
  } catch {
    // display-message may be unavailable for a given target; caller treats
    // an empty result as "unknown" and proceeds rather than blocking.
    return '';
  }
}

// Number of clients (consoles) attached to the session. 0 = nobody is looking at
// it (terminal closed / detached). Used to auto-reap orphaned sessions. On any
// error we return 0; the monitor checks hasSession() first, so a truly-gone
// session is handled as 'exit' before this matters.
export async function sessionAttached(target) {
  try {
    const { stdout } = await execFileAsync(getMuxBinary(), buildDisplayArgs(target, '#{session_attached}'), { ...HIDE });
    const n = parseInt(stdout.trim(), 10);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export function newSessionDetached(name, cmd, args) {
  execFileSync(getMuxBinary(), buildNewSessionArgs(name, cmd, args), { stdio: 'ignore', ...HIDE });
}

export function hasSession(target) {
  try {
    execFileSync(getMuxBinary(), ['has-session', '-t', target], { stdio: 'ignore', ...HIDE });
    return true;
  } catch {
    return false;
  }
}

export function killSession(target) {
  try {
    execFileSync(getMuxBinary(), ['kill-session', '-t', target], { stdio: 'ignore', ...HIDE });
  } catch { /* already gone */ }
}

// Pure parser (unit-tested): "name attached=N" lines -> [{name, attached}].
export function parseSessionList(text) {
  return text
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(line => {
      const [name, att] = line.split(/\s+/);
      return { name, attached: parseInt(att, 10) || 0 };
    })
    .filter(s => s.name);
}

export function listSessions() {
  try {
    const out = execFileSync(getMuxBinary(), ['list-sessions', '-F', '#{session_name} #{session_attached}'], { encoding: 'utf-8', ...HIDE });
    return parseSessionList(out);
  } catch {
    // No server running / no sessions.
    return [];
  }
}

// We set CLAUDE_AUTO_RETRY_SESSION ourselves when spawning the inner process, so
// detection never depends on whether psmux exports $TMUX.
export function isInsideMux() {
  return !!process.env.CLAUDE_AUTO_RETRY_SESSION || !!process.env.TMUX;
}
