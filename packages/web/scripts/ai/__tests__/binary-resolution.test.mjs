import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveBinary, hasBinary } from '../lib/ai-client.mjs';

function makeExecutable(dir, name) {
  fs.mkdirSync(dir, { recursive: true });
  const full = path.join(dir, name);
  fs.writeFileSync(full, '#!/bin/sh\necho hi\n');
  fs.chmodSync(full, 0o755);
  return full;
}

test('resolveBinary: AI_BRAIN_<NAME>_PATH override wins and needs no PATH', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-bin-'));
  const bin = makeExecutable(dir, 'claude');
  const env = { AI_BRAIN_CLAUDE_PATH: bin, PATH: '' };
  assert.equal(resolveBinary('claude', env), bin);
  assert.equal(hasBinary('claude', env), true);
});

test('resolveBinary: an override pointing at a missing file resolves to undefined', () => {
  const env = { AI_BRAIN_CLAUDE_PATH: '/no/such/claude', PATH: '' };
  assert.equal(resolveBinary('claude', env), undefined);
});

test('resolveBinary: found on PATH', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-bin-'));
  makeExecutable(dir, 'codex');
  const env = { PATH: dir };
  assert.equal(resolveBinary('codex', env), path.join(dir, 'codex'));
});

test('resolveBinary: found in a common off-PATH location (~/.claude/local/claude)', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-home-'));
  const bin = makeExecutable(path.join(home, '.claude', 'local'), 'claude');
  const env = { PATH: '', HOME: home };
  assert.equal(resolveBinary('claude', env), bin);
  assert.equal(hasBinary('claude', env), true);
});

test('resolveBinary: undefined when nothing is resolvable', () => {
  const env = { PATH: '', HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'brain-empty-')) };
  assert.equal(resolveBinary('claude', env), undefined);
  assert.equal(hasBinary('claude', env), false);
});
