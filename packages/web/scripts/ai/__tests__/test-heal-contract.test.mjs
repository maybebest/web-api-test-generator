import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveHealContract, reviewHealContract } from '../lib/test-heal-contract.mjs';

function makeWebRoot() {
  const webRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'heal-contract-'));
  fs.mkdirSync(path.join(webRoot, 'tests', 'regression'), { recursive: true });
  return webRoot;
}

test('recording header selects the recorded reviewer', () => {
  const webRoot = makeWebRoot();
  const contract = resolveHealContract({
    testPath: 'tests/recorded/save.spec.ts',
    source: `/* recording: recordings/save.json title:Save sha256:${'a'.repeat(64)} */`,
    webRoot,
    discoverSpec: () => null
  });
  assert.equal(contract.kind, 'recording');
  assert.equal(contract.recordingPath, 'recordings/save.json');

  const calls = [];
  const result = reviewHealContract({
    contract,
    candidatePath: 'tests/recorded/.save.candidate.spec.ts',
    recordedReviewer: (input) => (calls.push(input), { passed: true, issues: [] })
  });
  assert.equal(result.passed, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    recordingPath: 'recordings/save.json',
    testPath: 'tests/recorded/.save.candidate.spec.ts'
  });
});

test('a regression test without spec header or allowlist entry fails closed', () => {
  const webRoot = makeWebRoot();
  assert.throws(() => resolveHealContract({
    testPath: 'tests/regression/unbound.spec.ts',
    source: 'import { test } from "@playwright/test";',
    webRoot,
    discoverSpec: () => null
  }), /no-header allowlist/i);
});

test('an exact portable allowlist entry permits a handwritten spec-bound test', () => {
  const webRoot = makeWebRoot();
  fs.writeFileSync(
    path.join(webRoot, 'tests', '.no-header-allowlist'),
    'tests/regression/handwritten.spec.ts\n'
  );

  const contract = resolveHealContract({
    testPath: 'tests/regression/handwritten.spec.ts',
    source: 'import { test } from "@playwright/test";',
    webRoot,
    discoverSpec: () => null
  });
  assert.deepEqual(contract, {
    kind: 'handwritten',
    testPath: 'tests/regression/handwritten.spec.ts'
  });
});

test('recording and spec contracts cannot be combined', () => {
  const webRoot = makeWebRoot();
  assert.throws(() => resolveHealContract({
    testPath: 'tests/regression/conflicted.spec.ts',
    source: `/* recording: recordings/save.json title:Save sha256:${'a'.repeat(64)} */`,
    webRoot,
    discoverSpec: () => ({ specPath: 'specs/save.md', validation: {} })
  }), /both recording and spec contracts/i);
});

test('recording paths must already be portable and normalized', () => {
  const webRoot = makeWebRoot();
  for (const recordingPath of ['recordings\\save.json', 'recordings/../save.json', '../recordings/save.json']) {
    assert.throws(() => resolveHealContract({
      testPath: 'tests/recorded/save.spec.ts',
      source: `/* recording: ${recordingPath} title:Save sha256:${'a'.repeat(64)} */`,
      webRoot,
      discoverSpec: () => null
    }), /portable repository-relative path|normalized portable repository-relative path/i);
  }
});
