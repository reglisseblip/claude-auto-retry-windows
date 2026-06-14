import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const DEFAULT_CONFIG = {
  maxRetries: 5,
  pollIntervalSeconds: 5,
  marginSeconds: 60,
  fallbackWaitHours: 5,
  retryMessage: 'Continue where you left off. The previous attempt was rate limited.',
  customPatterns: [],
  // Auto-reap: kill a session (and stop its monitor) once it has had no console
  // attached for this long. Set to 0 to disable self-reap (keeps detach/reattach).
  reapUnattachedSeconds: 15,
  // Grace before reaping a session that was NEVER attached (covers a failed attach).
  reapStartupSeconds: 60,
  // Sweep stale orphaned clr-* sessions when launching.
  reapOrphansOnLaunch: true,
};

const CONFIG_PATH = join(homedir(), '.claude-auto-retry.json');

function validNumber(val, min, fallback) {
  return typeof val === 'number' && Number.isFinite(val) && val >= min ? val : fallback;
}

function validate(cfg) {
  cfg.maxRetries = validNumber(cfg.maxRetries, 1, DEFAULT_CONFIG.maxRetries);
  cfg.pollIntervalSeconds = validNumber(cfg.pollIntervalSeconds, 1, DEFAULT_CONFIG.pollIntervalSeconds);
  cfg.marginSeconds = validNumber(cfg.marginSeconds, 0, DEFAULT_CONFIG.marginSeconds);
  cfg.fallbackWaitHours = validNumber(cfg.fallbackWaitHours, 0.1, DEFAULT_CONFIG.fallbackWaitHours);
  cfg.reapUnattachedSeconds = validNumber(cfg.reapUnattachedSeconds, 0, DEFAULT_CONFIG.reapUnattachedSeconds);
  cfg.reapStartupSeconds = validNumber(cfg.reapStartupSeconds, 1, DEFAULT_CONFIG.reapStartupSeconds);
  if (typeof cfg.reapOrphansOnLaunch !== 'boolean') cfg.reapOrphansOnLaunch = DEFAULT_CONFIG.reapOrphansOnLaunch;
  if (typeof cfg.retryMessage !== 'string' || !cfg.retryMessage) {
    cfg.retryMessage = DEFAULT_CONFIG.retryMessage;
  }
  if (!Array.isArray(cfg.customPatterns)) {
    cfg.customPatterns = DEFAULT_CONFIG.customPatterns;
  } else {
    cfg.customPatterns = cfg.customPatterns.filter(p => {
      if (typeof p !== 'string') return false;
      try { new RegExp(p); return true; } catch { return false; }
    });
  }
  if (cfg.foregroundCommands !== undefined) {
    if (!Array.isArray(cfg.foregroundCommands) || cfg.foregroundCommands.length === 0) {
      delete cfg.foregroundCommands;
    }
  }
  return cfg;
}

export async function loadConfig(path = CONFIG_PATH) {
  try {
    const raw = await readFile(path, 'utf-8');
    return validate({ ...DEFAULT_CONFIG, ...JSON.parse(raw) });
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
