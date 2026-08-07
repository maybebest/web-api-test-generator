import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateRecordingDirectory } from '../validate-recording.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// packages/web/scripts/ai/__tests__ -> packages/web/recordings/_example.json
const repoExample = path.resolve(here, '../../../recordings/_example.json');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rec-validate-'));
}

test('a missing recordings directory is a hard validation error', () => {
  const dir = path.join(tmpDir(), 'does-not-exist');
  const result = validateRecordingDirectory(dir);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => /not found/i.test(issue)), result.issues.join('; '));
});

test('an existing but template-only recordings directory fails closed', () => {
  const dir = tmpDir();
  // Only a `_`-prefixed template (skipped by listRecordingFiles) — mirrors a fresh checkout that
  // has the recording -> UI pipeline wired but no app-specific recordings authored yet.
  fs.copyFileSync(repoExample, path.join(dir, '_example.json'));
  const result = validateRecordingDirectory(dir);
  assert.equal(result.valid, false);
  assert.equal(result.checked.length, 0);
  assert.ok(
    result.issues.some((issue) => /zero-recording/i.test(issue)),
    result.issues.join('; ')
  );
});

test('a real recording in the directory is validated', () => {
  const dir = tmpDir();
  fs.copyFileSync(repoExample, path.join(dir, 'checkout-flow.json'));
  const result = validateRecordingDirectory(dir);
  assert.equal(result.valid, true, result.issues.join('; '));
  assert.equal(result.checked.length, 1);
});
