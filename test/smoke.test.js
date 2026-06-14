import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isRateLimited, findRateLimitMessage, stripAnsi } from '../src/patterns.js';
import { parseResetTime, calculateWaitMs } from '../src/time-parser.js';
import { buildCaptureArgs, buildSendKeysArgs, buildNewSessionArgs, parseMuxVersion } from '../src/mux.js';

const FAKE_TUI = `
  Working on your task...

  ⚠ You've hit your limit
  · resets 3pm (UTC)
`;

test('isRateLimited detects the multi-line Claude rate-limit block', () => {
  assert.equal(isRateLimited(FAKE_TUI), true);
});

test('isRateLimited is false for normal output', () => {
  assert.equal(isRateLimited('Editing src/index.ts ... done. Running tests.'), false);
});

test('findRateLimitMessage returns the resets line', () => {
  assert.match(findRateLimitMessage(FAKE_TUI), /resets 3pm/i);
});

test('stripAnsi removes CSI colour codes', () => {
  assert.equal(stripAnsi('\x1b[31mred\x1b[0m'), 'red');
});

test('parseResetTime parses "resets 3pm (UTC)" to hour 15 UTC', () => {
  const p = parseResetTime('resets 3pm (UTC)');
  assert.equal(p.hour, 15);
  assert.equal(p.timezone, 'UTC');
});

test('parseResetTime parses relative "try again in 5 minutes"', () => {
  const p = parseResetTime('try again in 5 minutes');
  assert.equal(p.relative, true);
  assert.equal(p.waitMs, 5 * 60_000);
});

test('calculateWaitMs adds the margin for relative times', () => {
  const ms = calculateWaitMs({ relative: true, waitMs: 60_000 }, 60);
  assert.equal(ms, 120_000);
});

test('mux arg builders produce the expected psmux/tmux argv', () => {
  assert.deepEqual(buildCaptureArgs('sess', 20), ['capture-pane', '-t', 'sess', '-p', '-S', '-20']);
  assert.deepEqual(buildSendKeysArgs('sess', 'continue'), ['send-keys', '-t', 'sess', 'continue', 'Enter']);
  assert.deepEqual(
    buildNewSessionArgs('sess', 'claude.exe', ['--foo']),
    ['new-session', '-d', '-s', 'sess', '--', 'claude.exe', '--foo'],
  );
});

test('parseMuxVersion reads "tmux 3.3.5"', () => {
  assert.equal(parseMuxVersion('tmux 3.3.5'), 3.3);
});
