import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildPlaywrightStage, copyEvidence, verifyPlaywrightJsonReport } from '../generated-test-gate.mjs';

const TARGET = 'tests/regression/example-flow.spec.ts';

function reportFixture(tests, file = 'regression/example-flow.spec.ts') {
  return {
    suites: [
      {
        title: 'example-flow.spec.ts',
        file,
        specs: tests.map((status, index) => ({
          title: `spec ${index + 1}`,
          file,
          tests: [{ status }]
        }))
      }
    ],
    stats: {}
  };
}

test('JSON report verdict passes when the target file has passing tests only', () => {
  const verdict = verifyPlaywrightJsonReport(reportFixture(['expected', 'expected']), TARGET);

  assert.equal(verdict.passed, true, verdict.issues.join('\n'));
  assert.deepEqual(verdict.counts, { expected: 2, unexpected: 0, flaky: 0, skipped: 0 });
});

test('JSON report verdict fails when the run only skipped the target tests', () => {
  // The end-to-end self-skip hole: Playwright exits 0 on skips, so the gate
  // must fail on the parsed report instead.
  const verdict = verifyPlaywrightJsonReport(reportFixture(['skipped']), TARGET);

  assert.equal(verdict.passed, false);
  assert.match(verdict.issues.join('\n'), /no passing test/);
  assert.match(verdict.issues.join('\n'), /1 skipped test\(s\).*Skipped tests exit 0/);
});

test('JSON report verdict fails when a passing run still skips one target test', () => {
  const verdict = verifyPlaywrightJsonReport(reportFixture(['expected', 'skipped']), TARGET);

  assert.equal(verdict.passed, false);
  assert.match(verdict.issues.join('\n'), /1 skipped test\(s\)/);
  assert.doesNotMatch(verdict.issues.join('\n'), /no passing test/);
});

test('JSON report verdict fails on unexpected (failed) tests', () => {
  const verdict = verifyPlaywrightJsonReport(reportFixture(['expected', 'unexpected']), TARGET);

  assert.equal(verdict.passed, false);
  assert.match(verdict.issues.join('\n'), /1 unexpected \(failed\) test\(s\)/);
});

test('JSON report verdict fails when the report has no tests for the target file', () => {
  const verdict = verifyPlaywrightJsonReport(reportFixture(['expected'], 'regression/other-flow.spec.ts'), TARGET);

  assert.equal(verdict.passed, false);
  assert.match(verdict.issues.join('\n'), /no passing test for tests\/regression\/example-flow\.spec\.ts/);
});

test('JSON report verdict counts flaky tests but does not treat them as passing', () => {
  const verdict = verifyPlaywrightJsonReport(reportFixture(['flaky']), TARGET);

  assert.equal(verdict.passed, false);
  assert.equal(verdict.counts.flaky, 1);
  assert.match(verdict.issues.join('\n'), /no passing test/);
  assert.match(verdict.issues.join('\n'), /passed only after retry \(flaky\)/);
});

test('JSON report verdict fails a run where the target test passed only after retry (flaky)', () => {
  // The flaky hole: a report with one expected and one flaky test used to
  // pass the verdict even though a test needed a retry to go green, despite
  // the spec contract Allowed Retries: 0.
  const verdict = verifyPlaywrightJsonReport(reportFixture(['expected', 'flaky']), TARGET);

  assert.equal(verdict.passed, false);
  assert.equal(verdict.counts.flaky, 1);
  assert.match(
    verdict.issues.join('\n'),
    /target test passed only after retry \(flaky\) — generated tests must pass deterministically \(spec Allowed Retries: 0\)/
  );
  assert.doesNotMatch(verdict.issues.join('\n'), /no passing test/);
});

test('playwright stage pins the html reporter to never auto-open', () => {
  // --reporter=html,json on the CLI REPLACES the config's
  // ['html', { open: 'never' }] entry; without the env pins the html reporter
  // falls back to open:'on-failure' locally, auto-opens the report on a
  // failing run, and blocks the gate process.
  const stage = buildPlaywrightStage({
    packageManager: 'npm',
    testPath: TARGET,
    project: 'chromium',
    extraEnv: { ENABLE_VISUAL_TESTS: 'true' },
    jsonReportPath: path.join('.ai-runs', 'gate-x', 'playwright-report-chromium.json')
  });

  assert.equal(stage.command, 'npx');
  assert.deepEqual(stage.args, [
    'playwright',
    'test',
    TARGET,
    '--project=chromium',
    '--reporter=html,json',
    '--retries=0',
    '--repeat-each=3',
    '--max-failures=1'
  ]);
  assert.equal(stage.env.PLAYWRIGHT_HTML_OPEN, 'never');
  assert.equal(stage.env.PW_TEST_HTML_REPORT_OPEN, 'never');
  // Caller-provided stage env must survive the merge, and the JSON report
  // target must be absolute so the reporter writes into the run dir.
  assert.equal(stage.env.ENABLE_VISUAL_TESTS, 'true');
  assert.equal(path.isAbsolute(stage.env.PLAYWRIGHT_JSON_OUTPUT_NAME), true);
});

test('JSON report verdict walks nested describe suites', () => {
  const report = {
    suites: [
      {
        title: 'example-flow.spec.ts',
        file: 'regression/example-flow.spec.ts',
        suites: [
          {
            title: 'generated flow',
            specs: [{ title: 'nested spec', tests: [{ status: 'expected' }] }]
          }
        ]
      }
    ]
  };

  const verdict = verifyPlaywrightJsonReport(report, TARGET);

  assert.equal(verdict.passed, true, verdict.issues.join('\n'));
  assert.equal(verdict.counts.expected, 1);
});

test('JSON report verdict tolerates an empty or malformed report object', () => {
  assert.equal(verifyPlaywrightJsonReport({}, TARGET).passed, false);
  assert.equal(verifyPlaywrightJsonReport(undefined, TARGET).passed, false);
});

test('copyEvidence does not create an evidence dir when no artifacts exist', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-gate-'));
  const runDir = path.join(workspace, '.ai-runs', 'gate-test');

  const evidenceDir = copyEvidence(runDir, workspace);

  assert.equal(evidenceDir, undefined);
  // Neither the run dir nor an empty evidence/ dir may be left behind:
  // empty leftovers fail ai:clean:check.
  assert.equal(fs.existsSync(runDir), false);
});

test('copyEvidence copies artifacts when at least one source exists', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-gate-'));
  const runDir = path.join(workspace, '.ai-runs', 'gate-test');
  fs.mkdirSync(path.join(workspace, 'playwright-report'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'playwright-report', 'index.html'), '<html></html>');

  const evidenceDir = copyEvidence(runDir, workspace);

  assert.equal(evidenceDir, path.join(runDir, 'evidence'));
  assert.equal(fs.existsSync(path.join(evidenceDir, 'playwright-report', 'index.html')), true);
  assert.equal(fs.existsSync(path.join(evidenceDir, 'test-results')), false);
});
