import { test } from 'node:test';
import assert from 'node:assert/strict';

import { processOneTick, createMonitorState } from '../src/monitor.js';
import { parseSessionList } from '../src/mux.js';

function adapter(attached) {
  return {
    sessionAttached: async () => attached,
    capturePane: async () => '',            // no rate-limit text
    getPaneCommand: async () => 'claude',
    sendKeys: async () => {},
  };
}

const CONFIG = {
  customPatterns: [], maxRetries: 5, pollIntervalSeconds: 5, marginSeconds: 60, fallbackWaitHours: 5,
  retryMessage: 'continue', reapUnattachedSeconds: 15, reapStartupSeconds: 60,
};

const alive = () => true;

test('reap: never attached past the startup grace -> reap', async () => {
  const state = createMonitorState();
  state.startedAt = Date.now() - 999_999;            // long ago, still never attached
  const r = await processOneTick(state, adapter(0), 'sess', { ...CONFIG, reapStartupSeconds: 1 }, alive);
  assert.equal(r, 'reap');
});

test('reap: was attached, then unattached past the grace -> reap', async () => {
  const state = createMonitorState();
  state.everAttached = true;
  state.unattachedSince = Date.now() - 999_999;
  const r = await processOneTick(state, adapter(0), 'sess', CONFIG, alive);
  assert.equal(r, 'reap');
});

test('reap: currently attached -> no reap, marks everAttached', async () => {
  const state = createMonitorState();
  const r = await processOneTick(state, adapter(1), 'sess', CONFIG, alive);
  assert.notEqual(r, 'reap');
  assert.equal(state.everAttached, true);
  assert.equal(state.unattachedSince, 0);
});

test('reap: unattached but within grace -> no reap (starts the timer)', async () => {
  const state = createMonitorState();
  state.everAttached = true;            // just lost the client this tick
  const r = await processOneTick(state, adapter(0), 'sess', CONFIG, alive);
  assert.notEqual(r, 'reap');
  assert.ok(state.unattachedSince > 0);
});

test('reap: disabled when reapUnattachedSeconds is 0', async () => {
  const state = createMonitorState();
  state.everAttached = true;
  state.unattachedSince = Date.now() - 999_999;
  const r = await processOneTick(state, adapter(0), 'sess', { ...CONFIG, reapUnattachedSeconds: 0 }, alive);
  assert.notEqual(r, 'reap');
});

test('parseSessionList parses "name N" lines from list-sessions', () => {
  const out = 'clr-1-100 0\r\nclr-2-200 1\r\nother 0\r\n';
  assert.deepEqual(parseSessionList(out), [
    { name: 'clr-1-100', attached: 0 },
    { name: 'clr-2-200', attached: 1 },
    { name: 'other', attached: 0 },
  ]);
});
