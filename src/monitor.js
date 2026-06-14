import { stripAnsi, isRateLimited, findRateLimitMessage } from './patterns.js';
import { parseResetTime, calculateWaitMs } from './time-parser.js';
import { capturePane, sendKeys, getPaneCommand, hasSession, sessionAttached, killSession } from './mux.js';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';

const DEFAULT_FOREGROUND_COMMANDS = ['claude', 'node', 'npx', 'tsx', 'bun', 'deno'];

export function createMonitorState() {
  return {
    status: 'monitoring', waitUntil: 0, attempts: 0, lastRateLimitMessage: null,
    everAttached: false, unattachedSince: 0, startedAt: Date.now(),
  };
}

// processOneTick is pure with respect to its injected `muxAdapter` and `isAlive`,
// so it can be unit-tested without a real session.
export async function processOneTick(state, muxAdapter, target, config, isAlive) {
  if (!isAlive()) return 'exit';

  // Auto-reap: once the session loses its console (terminal closed / detached),
  // kill it and stop monitoring. Disabled when reapUnattachedSeconds is 0
  // (preserves detach/reattach). 'exit' (session already gone) takes priority above.
  if (config.reapUnattachedSeconds > 0 && muxAdapter.sessionAttached) {
    const now = Date.now();
    const attached = await muxAdapter.sessionAttached(target);
    if (attached > 0) {
      state.everAttached = true;
      state.unattachedSince = 0;
    } else if (state.everAttached) {
      if (!state.unattachedSince) state.unattachedSince = now;
      if (now - state.unattachedSince >= config.reapUnattachedSeconds * 1000) return 'reap';
    } else if (now - state.startedAt >= config.reapStartupSeconds * 1000) {
      // Never attached within the startup grace — treat as a failed/abandoned launch.
      return 'reap';
    }
  }

  const raw = await muxAdapter.capturePane(target, 20);
  const stripped = stripAnsi(raw);

  if (state.status === 'waiting') {
    if (Date.now() < state.waitUntil) return 'waiting';
    if (!isAlive()) return 'exit';

    // Always check if the rate limit cleared FIRST — even when maxRetries is
    // exhausted, time passing (or the user) may have resolved it.
    if (!isRateLimited(stripped, config.customPatterns)) {
      state.status = 'monitoring'; state.attempts = 0;
      return 'user-continued';
    }

    if (state.attempts >= config.maxRetries) {
      // Stay in 'waiting' to avoid re-detecting the stale rate limit on the
      // next tick and creating an infinite max-retries loop.
      state.waitUntil = Date.now() + (config.pollIntervalSeconds * 1000 * 12);
      return 'max-retries';
    }

    // Foreground safety: make sure the session is still running Claude and not a
    // shell the user dropped into. psmux's display-message reports the pane's
    // current command (verified to return "claude"/"node"). If it can't tell us
    // (empty string), we proceed rather than block forever — the session was
    // created by us specifically to run Claude.
    const fg = await muxAdapter.getPaneCommand(target);
    const fgCommands = config.foregroundCommands || DEFAULT_FOREGROUND_COMMANDS;
    if (fg && !fgCommands.some(c => fg.toLowerCase().includes(c))) {
      state.waitUntil = Date.now() + (config.pollIntervalSeconds * 1000 * 6);
      state._lastForeground = fg;
      return 'skipped-not-claude';
    }

    // Increment attempts and set a cooldown BEFORE sendKeys so that a failure
    // (e.g. session destroyed) still consumes a retry and avoids a tight loop.
    state.attempts++;
    state.waitUntil = Date.now() + 30_000;
    await muxAdapter.sendKeys(target, config.retryMessage);
    return 'retried';
  }

  if (isRateLimited(stripped, config.customPatterns)) {
    const message = findRateLimitMessage(stripped, config.customPatterns);
    state.lastRateLimitMessage = message;
    const parsed = message ? parseResetTime(message) : null;
    state.waitUntil = Date.now() + calculateWaitMs(parsed, config.marginSeconds, config.fallbackWaitHours);
    state.status = 'waiting';
    return 'waiting';
  }

  return 'monitoring';
}

export async function startMonitor(target) {
  const config = await loadConfig();
  const logger = createLogger();
  const state = createMonitorState();
  let consecutiveErrors = 0;
  const MAX_CONSECUTIVE_ERRORS = 10;

  await logger.info(`Monitor started for session ${target} (mux: ${process.env.CLAUDE_AUTO_RETRY_MUX || 'psmux'})`);

  const muxAdapter = { capturePane, sendKeys, getPaneCommand, sessionAttached };
  // Liveness is tied to the mux session, not a pid: when Claude exits the pane
  // closes and the session disappears.
  const isAlive = () => hasSession(target);

  const loop = async () => {
    try {
      const result = await processOneTick(state, muxAdapter, target, config, isAlive);
      consecutiveErrors = 0;

      if (result === 'exit') { await logger.info('Session ended. Monitor shutting down.'); process.exit(0); }
      if (result === 'reap') {
        killSession(target);
        await logger.info('Session has no attached console — reaped (killed session, monitor exiting).');
        process.exit(0);
      }
      if (result === 'waiting' && state.lastRateLimitMessage) {
        const secs = Math.round((state.waitUntil - Date.now()) / 1000);
        await logger.info(`Rate limit detected: "${state.lastRateLimitMessage}". Waiting ${secs}s...`);
        state.lastRateLimitMessage = null;
      }
      if (result === 'retried') await logger.info(`Sent retry message (attempt ${state.attempts})`);
      if (result === 'user-continued') await logger.info('Rate limit cleared. Attempt counter reset.');
      if (result === 'max-retries') await logger.warn(`Max retries (${config.maxRetries}) reached. Monitor still active but will not send further retries until the rate limit clears.`);
      if (result === 'skipped-not-claude') await logger.warn(`Foreground is "${state._lastForeground}", not Claude. Skipping send-keys. (Add to foregroundCommands in ~/.claude-auto-retry.json if this is wrong)`);
    } catch (err) {
      consecutiveErrors++;
      await logger.error(`Monitor tick error: ${err.message}`).catch(() => {});
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        await logger.error(`${MAX_CONSECUTIVE_ERRORS} consecutive errors. Session likely destroyed. Exiting.`).catch(() => {});
        process.exit(1);
      }
    }
  };

  // Recursive setTimeout (not setInterval) to prevent overlapping ticks when one
  // tick runs longer than the poll interval.
  const scheduleNext = () => {
    setTimeout(async () => {
      await loop();
      scheduleNext();
    }, config.pollIntervalSeconds * 1000);
  };
  loop().then(scheduleNext);
}

// Direct execution: node monitor.js <sessionName>
const isDirectRun = process.argv[1]?.endsWith('monitor.js') && process.argv.length >= 3;
if (isDirectRun) {
  startMonitor(process.argv[2]);
}
