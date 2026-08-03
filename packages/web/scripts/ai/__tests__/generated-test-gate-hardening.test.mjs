import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildPlaywrightStage } from '../generated-test-gate.mjs';
import { executeGeneratedPair } from '../lib/generated-gate-runner.mjs';

const TARGET = 'tests/regression/x.spec.ts';

test('playwright stage serializes an explicitly requested worker count', () => {
  const stage = buildPlaywrightStage({
    packageManager: 'npm',
    testPath: TARGET,
    project: 'chromium',
    jsonReportPath: '.ai-runs/x.json',
    repeatEach: 2,
    workers: 1
  });

  assert.deepEqual(stage.args, [
    'playwright',
    'test',
    TARGET,
    '--project=chromium',
    '--reporter=html,json',
    '--retries=0',
    '--repeat-each=2',
    '--workers=1',
    '--max-failures=1'
  ]);
});

test('playwright stage rejects unsafe worker counts without changing omitted-worker callers', () => {
  const base = {
    packageManager: 'npm',
    testPath: TARGET,
    project: 'chromium',
    jsonReportPath: '.ai-runs/x.json',
    repeatEach: 2
  };
  const stage = buildPlaywrightStage(base);
  assert.equal(stage.args.some((argument) => argument.startsWith('--workers=')), false);

  for (const workers of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => buildPlaywrightStage({ ...base, workers }),
      /workers must be a positive safe integer/
    );
  }
});

test('generated-pair execution forwards the requested worker count to Playwright', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'generated-gate-workers-'));
  const seenArguments = [];
  try {
    const result = executeGeneratedPair({
      specPath: 'specs/x.md',
      testPath: TARGET,
      validation: { metadata: {} }
    }, {
      workers: 1,
      repeatEach: 2,
      runRoot: path.join(workspace, '.ai-runs'),
      packageManager: 'npm',
      projectPlanner: () => [{ project: 'chromium', env: {} }],
      commandRunner(stage) {
        seenArguments.push(...stage.args);
        return 1;
      }
    });

    assert.equal(result.passed, false);
    assert.equal(seenArguments.filter((argument) => argument === '--workers=1').length, 1);
    assert.ok(seenArguments.includes('--retries=0'));
    assert.ok(seenArguments.includes('--repeat-each=2'));
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
