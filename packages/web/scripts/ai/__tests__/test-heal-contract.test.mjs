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

test('dev mirror uses the canonical no-header allowlist identity', () => {
  const webRoot = makeWebRoot();
  fs.mkdirSync(path.join(webRoot, 'tests-dev', 'regression'), { recursive: true });
  fs.writeFileSync(
    path.join(webRoot, 'tests', '.no-header-allowlist'),
    'tests/regression/handwritten.spec.ts\n'
  );
  const contract = resolveHealContract({
    testPath: 'tests-dev/regression/handwritten.spec.ts',
    source: 'import { test } from "@playwright/test";',
    webRoot,
    discoverSpec: () => null
  });
  assert.equal(contract.kind, 'handwritten');
  assert.equal(contract.testPath, 'tests-dev/regression/handwritten.spec.ts');
});

test('explicit spec compares with the canonical dev identity', () => {
  const webRoot = makeWebRoot();
  const validation = { metadata: { 'Target Test File': 'tests/regression/save.spec.ts' } };
  const contract = resolveHealContract({
    testPath: 'tests-dev/regression/save.spec.ts',
    source: '/* spec: specs/save.md version:1.0.0 sha256:' + 'b'.repeat(64) + ' */',
    explicitSpecPath: 'specs/save.md',
    specDir: 'specs',
    webRoot,
    validateDirectory: () => ({
      valid: true,
      results: [{ specPath: 'specs/save.md', result: validation }]
    })
  });
  assert.equal(contract.kind, 'spec');
  assert.equal(contract.testPath, 'tests-dev/regression/save.spec.ts');
});

test('dev recorded layout keeps the canonical recording requirement', () => {
  const webRoot = makeWebRoot();
  assert.throws(() => resolveHealContract({
    testPath: 'tests-dev/recorded/save.spec.ts',
    source: 'import { test } from "@playwright/test";',
    webRoot,
    discoverSpec: () => null
  }), /recording contract/i);

  const contract = resolveHealContract({
    testPath: 'tests-dev/recorded/save.spec.ts',
    source: `/* recording: recordings/save.json title:Save sha256:${'a'.repeat(64)} */`,
    webRoot,
    discoverSpec: () => null
  });
  assert.equal(contract.kind, 'recording');
  assert.equal(contract.testPath, 'tests-dev/recorded/save.spec.ts');
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

test('recording markers fail closed when malformed, ambiguous, or missing under the recorded layout', () => {
  const webRoot = makeWebRoot();
  const recordingHeader = `/* recording: recordings/save.json title:Save sha256:${'a'.repeat(64)} */`;
  for (const source of [
    `/* recording: recordings/save.json title:Save sha256:not-a-hash */`,
    `${recordingHeader}\n${recordingHeader}`,
    'import { test } from "@playwright/test";'
  ]) {
    assert.throws(() => resolveHealContract({
      testPath: 'tests/recorded/save.spec.ts',
      source,
      webRoot,
      discoverSpec: () => null
    }), /recording (?:contract|header)|malformed|ambiguous/i);
  }
});

test('source spec and recording markers conflict even when no spec can be discovered', () => {
  const webRoot = makeWebRoot();
  assert.throws(() => resolveHealContract({
    testPath: 'tests/recorded/save.spec.ts',
    source: `/* spec: specs/save.md version:1.0.0 sha256:${'b'.repeat(64)} */\n/* recording: recordings/save.json title:Save sha256:${'a'.repeat(64)} */`,
    webRoot,
    discoverSpec: () => null
  }), /both recording and spec contracts/i);
});

test('discovered spec paths must already be portable and normalized', () => {
  const webRoot = makeWebRoot();
  for (const specPath of ['/tmp/save.md', 'specs/../save.md']) {
    assert.throws(() => resolveHealContract({
      testPath: 'tests/regression/save.spec.ts',
      source: 'import { test } from "@playwright/test";',
      webRoot,
      discoverSpec: () => ({ specPath, validation: {} })
    }), /Spec path.*portable repository-relative path|Spec path.*normalized portable repository-relative path/i);
  }
});

test('spec markers fail closed when malformed, duplicated, missing a binding, or mismatched', () => {
  const webRoot = makeWebRoot();
  const validHeader = `/* spec: specs/save.md version:1.0.0 sha256:${'b'.repeat(64)} */`;
  const cases = [
    {
      label: 'malformed',
      source: '/* spec: specs/save.md version:1.0.0 sha256:not-a-hash */',
      discoverSpec: () => null
    },
    {
      label: 'unterminated marker',
      source: `/* spec: specs/save.md version:1.0.0 sha256:${'b'.repeat(64)}`,
      discoverSpec: () => null
    },
    {
      label: 'JSDoc marker',
      source: `/** spec: specs/save.md version:1.0.0 sha256:${'b'.repeat(64)} */`,
      discoverSpec: () => null
    },
    {
      label: 'line marker',
      source: `// spec: specs/save.md version:1.0.0 sha256:${'b'.repeat(64)}`,
      discoverSpec: () => null
    },
    {
      label: 'duplicate',
      source: `${validHeader}\n${validHeader}`,
      discoverSpec: () => ({ specPath: 'specs/save.md', validation: {} })
    },
    {
      label: 'missing binding',
      source: validHeader,
      discoverSpec: () => null
    },
    {
      label: 'mismatched binding',
      source: validHeader,
      discoverSpec: () => ({ specPath: 'specs/other.md', validation: {} })
    }
  ];

  for (const { label, source, discoverSpec } of cases) {
    assert.throws(
      () => resolveHealContract({
        testPath: 'tests/helpers/save.spec.ts',
        source,
        webRoot,
        discoverSpec
      }),
      /spec (?:header|marker|contract|binding)|malformed|duplicate|ambiguous|mismatch/i,
      label
    );
  }
});

test('a discovered or explicit spec binding requires exactly one matching source marker', () => {
  const webRoot = makeWebRoot();
  assert.throws(
    () => resolveHealContract({
      testPath: 'tests/regression/save.spec.ts',
      source: 'import { test } from "@playwright/test";',
      webRoot,
      discoverSpec: () => ({ specPath: 'specs/save.md', validation: {} })
    }),
    /missing.*spec|spec.*marker|spec.*header/i
  );
});
