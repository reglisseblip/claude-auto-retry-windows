import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveMode } from '../src/launcher.js';

test('--monitor forces monitored and is stripped', () => {
  const r = resolveMode(['--monitor', '-p', 'hi'], {}, {});
  assert.equal(r.monitor, true);
  assert.deepEqual(r.args, ['-p', 'hi']);
});

test('--no-monitor forces vanilla and is stripped', () => {
  const r = resolveMode(['--no-monitor', 'foo'], { enabled: true }, {});
  assert.equal(r.monitor, false);
  assert.deepEqual(r.args, ['foo']);
});

test('flag beats env default', () => {
  const r = resolveMode(['--monitor'], {}, { CLAUDE_AUTO_RETRY_DEFAULT: '0' });
  assert.equal(r.monitor, true);
});

test('env CLAUDE_AUTO_RETRY_DEFAULT=1 -> monitored', () => {
  assert.equal(resolveMode([], {}, { CLAUDE_AUTO_RETRY_DEFAULT: '1' }).monitor, true);
});

test('env CLAUDE_AUTO_RETRY_DEFAULT=0 -> vanilla', () => {
  assert.equal(resolveMode([], { enabled: true }, { CLAUDE_AUTO_RETRY_DEFAULT: '0' }).monitor, false);
});

test('fallback to config.enabled when nothing else set', () => {
  assert.equal(resolveMode([], { enabled: true }, {}).monitor, true);
  assert.equal(resolveMode([], { enabled: false }, {}).monitor, false);
});

test('default is monitored when config omits enabled', () => {
  assert.equal(resolveMode([], {}, {}).monitor, true);
});

test('unknown/claude flags are preserved untouched', () => {
  const r = resolveMode(['--dangerously-skip-permissions', '--no-monitor', '-p', 'x'], {}, {});
  assert.equal(r.monitor, false);
  assert.deepEqual(r.args, ['--dangerously-skip-permissions', '-p', 'x']);
});

test('--retry / --no-retry aliases work', () => {
  assert.equal(resolveMode(['--retry'], {}, {}).monitor, true);
  assert.equal(resolveMode(['--no-retry'], {}, {}).monitor, false);
});
