#!/usr/bin/env node

import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  getMuxBinary, muxAvailable, getMuxVersion,
  newSessionDetached, hasSession, killSession, buildCaptureArgs, buildSendKeysArgs,
} from '../src/mux.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC_DIR = join(__dirname, '..', 'src');
const LAUNCHER_PATH = join(SRC_DIR, 'launcher.js');
const PS_WRAPPER_TEMPLATE = join(SRC_DIR, 'wrapper.ps1');
const SH_WRAPPER_TEMPLATE = join(SRC_DIR, 'wrapper.sh');

export const MARKER_START = '# >>> claude-auto-retry-windows >>>';
export const MARKER_END = '# <<< claude-auto-retry-windows <<<';

// --- helpers -------------------------------------------------------------

function ok(s) { return `\x1b[32m✓\x1b[0m ${s}`; }
function bad(s) { return `\x1b[31m✗\x1b[0m ${s}`; }
function warn(s) { return `\x1b[33m!\x1b[0m ${s}`; }

// Ask a PowerShell host for its CurrentUserAllHosts profile path.
function profilePathFor(psExe) {
  try {
    const out = execFileSync(psExe, ['-NoProfile', '-Command', '$PROFILE.CurrentUserAllHosts'], { encoding: 'utf-8' });
    return out.trim();
  } catch {
    return null;
  }
}

// Every PowerShell host available on this machine (pwsh 7+, Windows PowerShell 5).
function powershellHosts() {
  const hosts = [];
  for (const exe of ['pwsh', 'powershell']) {
    const profile = profilePathFor(exe);
    if (profile) hosts.push({ exe, profile });
  }
  return hosts;
}

async function injectWrapper(rcFile, templatePath, launcherPath, { bash = false } = {}) {
  let content = '';
  try { content = await readFile(rcFile, 'utf-8'); } catch { /* new file */ }

  const template = await readFile(templatePath, 'utf-8');
  // bash + node accept forward slashes; PowerShell strings need escaped backslashes.
  const launcherForTemplate = bash
    ? launcherPath.replace(/\\/g, '/')
    : launcherPath.replace(/\\/g, '\\\\');
  const wrapper = template.replace(/__LAUNCHER_PATH__/g, launcherForTemplate);

  const startIdx = content.indexOf(MARKER_START);
  const endIdx = content.indexOf(MARKER_END);
  if (startIdx !== -1 && endIdx !== -1) {
    const afterMarker = endIdx + MARKER_END.length;
    const skipTo = content[afterMarker] === '\n' ? afterMarker + 1
                 : content.slice(afterMarker, afterMarker + 2) === '\r\n' ? afterMarker + 2
                 : afterMarker;
    content = content.slice(0, startIdx) + content.slice(skipTo);
  }

  const eol = bash ? '\n' : '\r\n';
  content = content.trimEnd() + eol + eol + wrapper.trimEnd() + eol;
  const dir = dirname(rcFile);
  if (!existsSync(dir)) execFileSync('node', ['-e', `require('fs').mkdirSync(${JSON.stringify(dir)},{recursive:true})`]);
  await writeFile(rcFile, content);
}

// bash/zsh rc files that exist (so Git Bash / WSL users get the wrapper too).
function bashRcFiles() {
  const files = [];
  for (const name of ['.bashrc', '.zshrc']) {
    const p = join(homedir(), name);
    if (existsSync(p)) files.push(p);
  }
  return files;
}

async function removeWrapper(rcFile) {
  let content;
  try { content = await readFile(rcFile, 'utf-8'); } catch { return; }
  const startIdx = content.indexOf(MARKER_START);
  const endIdx = content.indexOf(MARKER_END);
  if (startIdx === -1 || endIdx === -1) return;
  const before = content.slice(0, startIdx).trimEnd();
  const after = content.slice(endIdx + MARKER_END.length).trimStart();
  content = before + (after ? '\r\n' + after : '\r\n');
  await writeFile(rcFile, content);
}

function findClaude() {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  try {
    const out = execFileSync(finder, ['claude'], { encoding: 'utf-8' });
    return out.split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0] || null;
  } catch { return null; }
}

// --- commands ------------------------------------------------------------

async function cmdInstall() {
  console.log('claude-auto-retry-windows: installing...\n');

  const mux = getMuxBinary();
  if (!muxAvailable()) {
    console.log(bad(`'${mux}' not found.`));
    console.log(`  Install it first:  winget install --id marlocarlo.psmux`);
    console.log(`  (or: cargo install psmux)  then re-run this installer.`);
    process.exit(1);
  }
  console.log(ok(`${mux} ${getMuxVersion()} found`));

  const claude = findClaude();
  if (claude) console.log(ok(`claude found at ${claude}`));
  else console.log(warn('claude not found on PATH (the wrapper will still install; make sure `claude` works in a new shell)'));

  let targets = 0;

  // PowerShell hosts (pwsh 7 / Windows PowerShell 5)
  for (const { exe, profile } of powershellHosts()) {
    await injectWrapper(profile, PS_WRAPPER_TEMPLATE, LAUNCHER_PATH);
    console.log(ok(`Wrapper added to ${exe} profile: ${profile}`));
    targets++;
  }

  // bash / zsh (Git Bash on Windows, or WSL)
  for (const rc of bashRcFiles()) {
    await injectWrapper(rc, SH_WRAPPER_TEMPLATE, LAUNCHER_PATH, { bash: true });
    console.log(ok(`Wrapper added to ${rc}`));
    targets++;
  }

  if (targets === 0) {
    console.log(bad('No shell profile found (no PowerShell host, no ~/.bashrc or ~/.zshrc).'));
    process.exit(1);
  }

  console.log(`\nInstalled into ${targets} shell profile(s). Launcher: ${LAUNCHER_PATH}`);
  console.log('\nOpen a NEW shell (PowerShell: new window; bash: `source ~/.bashrc`) and use `claude` as usual.');
  console.log('Verify everything with:  node bin/cli.js doctor');
}

async function cmdUninstall() {
  for (const { exe, profile } of powershellHosts()) {
    await removeWrapper(profile);
    console.log(ok(`Wrapper removed from ${exe} profile: ${profile}`));
  }
  for (const rc of bashRcFiles()) {
    await removeWrapper(rc);
    console.log(ok(`Wrapper removed from ${rc}`));
  }
  console.log('\nOpen a new shell to complete removal.');
}

// Live end-to-end probe of the mux primitives the tool depends on.
async function cmdDoctor() {
  console.log('claude-auto-retry-windows: doctor\n');
  let failures = 0;

  // node
  console.log(ok(`node ${process.version}`));

  // claude
  const claude = findClaude();
  if (claude) console.log(ok(`claude: ${claude}`));
  else { console.log(bad('claude not found on PATH')); failures++; }

  // mux present
  const mux = getMuxBinary();
  if (!muxAvailable()) {
    console.log(bad(`${mux} not found — install: winget install --id marlocarlo.psmux`));
    console.log('\nCannot probe session primitives without the multiplexer.');
    process.exit(1);
  }
  console.log(ok(`${mux} version ${getMuxVersion()}`));

  // wrapper installed?
  const profilesToCheck = [
    ...powershellHosts().map(h => ({ label: `${h.exe} profile`, file: h.profile })),
    ...bashRcFiles().map(f => ({ label: f, file: f })),
  ];
  for (const { label, file } of profilesToCheck) {
    let installed = false;
    try { installed = (await readFile(file, 'utf-8')).includes(MARKER_START); } catch {}
    console.log(installed ? ok(`wrapper installed in ${label}`) : warn(`wrapper NOT in ${label} (run: node bin/cli.js install)`));
  }

  // --- live primitive probe ---
  console.log('\nProbing session primitives with a scratch session...');
  const dir = await mkdtemp(join(tmpdir(), 'car-doctor-'));
  const marker = join(dir, 'mark.txt');
  const scratch = join(dir, 'scratch.mjs');
  await writeFile(scratch, SCRATCH_SRC);
  await writeFile(marker, '');
  const session = `cardoctor-${process.pid}`;

  const step = (label, fn) => {
    try { const r = fn(); console.log(ok(label)); return r; }
    catch (e) { console.log(bad(`${label} — ${e.message}`)); failures++; return null; }
  };

  try {
    step('new-session (detached)', () => newSessionDetached(session, process.execPath, [scratch, marker]));
    await sleep(1500);

    step('has-session', () => { if (!hasSession(session)) throw new Error('session not alive'); });

    const cap = step('capture-pane reads the fake rate-limit block', () => {
      const out = execFileSync(mux, buildCaptureArgs(session, 30), { encoding: 'utf-8' });
      if (!/hit your limit/i.test(out) || !/resets/i.test(out)) throw new Error('expected text not captured');
      return out;
    });

    step('send-keys delivers "continue" to the child', () => {
      execFileSync(mux, buildSendKeysArgs(session, 'continue'), { stdio: 'ignore' });
    });
    await sleep(800);
    step('child received the injected keystrokes', () => {
      const m = execFileSync('node', ['-e', `process.stdout.write(require('fs').readFileSync(${JSON.stringify(marker)},'utf-8'))`], { encoding: 'utf-8' });
      if (!/GOT:continue/.test(m)) throw new Error('marker did not record the keystrokes');
    });

    step('display-message reports the pane command', () => {
      const out = execFileSync(mux, ['display-message', '-t', session, '-p', '#{pane_current_command}'], { encoding: 'utf-8' }).trim();
      if (!out) throw new Error('empty pane command');
    });
  } finally {
    killSession(session);
  }

  console.log(failures === 0
    ? `\n\x1b[32mAll checks passed — interactive auto-retry is supported on this machine.\x1b[0m`
    : `\n\x1b[31m${failures} check(s) failed.\x1b[0m`);
  process.exit(failures === 0 ? 0 : 1);
}

async function cmdStatus() {
  const logDir = join(homedir(), '.claude-auto-retry', 'logs');
  const today = new Date().toISOString().split('T')[0];
  const logFile = join(logDir, `${today}.log`);
  try {
    const content = await readFile(logFile, 'utf-8');
    const lines = content.trim().split('\n');
    console.log(`Log file: ${logFile}\n\nLast 10 entries:`);
    console.log(lines.slice(-10).join('\n'));
  } catch {
    console.log('No activity today. Log directory:', logDir);
  }
}

async function cmdLogs() {
  const logDir = join(homedir(), '.claude-auto-retry', 'logs');
  const today = new Date().toISOString().split('T')[0];
  const logFile = join(logDir, `${today}.log`);
  if (!existsSync(logFile)) { console.log(`No log file for today: ${logFile}`); return; }
  console.log(await readFile(logFile, 'utf-8'));
}

async function cmdVersion() {
  try {
    const pkg = JSON.parse(await readFile(join(__dirname, '..', 'package.json'), 'utf-8'));
    console.log(pkg.version);
  } catch { console.log('unknown'); }
}

// --- scratch process used by `doctor` ------------------------------------
const SCRATCH_SRC = `import { appendFileSync, writeFileSync } from 'node:fs';
const marker = process.argv[2];
writeFileSync(marker, '');
process.stdout.write("\\n  Working on your task...\\n");
process.stdout.write("\\n  ⚠ You've hit your limit\\n");
process.stdout.write("  · resets 3pm (UTC)\\n\\n");
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { appendFileSync(marker, 'GOT:' + d); });
setInterval(() => {}, 1000);
`;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// --- main ----------------------------------------------------------------
const command = process.argv[2];
switch (command) {
  case 'install': await cmdInstall(); break;
  case 'uninstall': await cmdUninstall(); break;
  case 'doctor': await cmdDoctor(); break;
  case 'status': await cmdStatus(); break;
  case 'logs': await cmdLogs(); break;
  case 'version': case '--version': case '-v': await cmdVersion(); break;
  default:
    console.log('claude-auto-retry-windows — auto-resume Claude Code after rate limits (psmux-based)\n');
    console.log('Usage:');
    console.log('  node bin/cli.js install     Add the PowerShell `claude` wrapper');
    console.log('  node bin/cli.js uninstall   Remove the wrapper');
    console.log('  node bin/cli.js doctor      Live-test psmux session/capture/send-keys');
    console.log('  node bin/cli.js status      Show recent monitor log entries');
    console.log('  node bin/cli.js logs        Print today\'s log');
    console.log('  node bin/cli.js version     Print version');
    break;
}
