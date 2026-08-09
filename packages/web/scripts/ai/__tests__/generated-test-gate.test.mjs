import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  buildPlaywrightStage,
  captureFullGateTargetSnapshot,
  copyEvidence,
  linkFullGateOutcome,
  parseArgs,
  verifyPlaywrightJsonReport,
  writeGeneratedGateVerdict
} from '../generated-test-gate.mjs';
import * as generatedTestGate from '../generated-test-gate.mjs';
import {
  bindGenerationRunSubject,
  createGenerationRun,
  finalizeGenerationRun
} from '../lib/generation-run.mjs';
import { computeGlobalChecksFingerprint } from '../lib/generated-gate-fingerprint.mjs';
import {
  FULL_GATE_REPEAT_EACH,
  PROMOTION_GATE_POLICY,
  PROMOTION_GATE_REPEAT_EACH
} from '../lib/generated-gate-policy.mjs';
import { acceptedGenerationQualityFingerprint } from '../lib/generation-quality.mjs';
import { specSha256 } from '../lib/spec-parser.mjs';
import { validateSpecDirectory } from '../validate-flow-spec.mjs';

const TARGET = 'tests/regression/example-flow.spec.ts';
const acceptedSourceSha256 = '205e8c43a278ba22c066e3ae822f57cc42659b2a4654cb14279bc3b4c2d13522';
const acceptedQualityFingerprint = acceptedGenerationQualityFingerprint({
  sourceSha256: acceptedSourceSha256,
  repairCount: 0
});

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

function exactExecutionReportFixture() {
  const file = 'regression/example-flow.spec.ts';
  const passedExecution = () => ({
    status: 'expected',
    expectedStatus: 'passed',
    projectName: 'local-chromium',
    projectId: 'local-chromium',
    results: [{ status: 'passed', retry: 0 }]
  });
  return {
    config: {
      projects: [
        { name: 'local-chromium', id: 'local-chromium', repeatEach: 2, retries: 0 }
      ]
    },
    suites: [{
      title: 'example-flow.spec.ts',
      file,
      specs: [
        { id: 'logical-spec-1', title: 'first logical spec', file, tests: [passedExecution(), passedExecution()] },
        { id: 'logical-spec-2', title: 'second logical spec', file, tests: [passedExecution(), passedExecution()] }
      ]
    }],
    errors: [],
    stats: { expected: 4, unexpected: 0, flaky: 0, skipped: 0 }
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

test('JSON report verdict rejects top-level Playwright errors without exposing their text', () => {
  const report = {
    ...reportFixture(['expected']),
    errors: [{ message: 'TOP_LEVEL_SETUP_SECRET' }]
  };

  const verdict = verifyPlaywrightJsonReport(report, TARGET);

  assert.equal(verdict.passed, false);
  assert.equal(verdict.environmentFailure, true);
  assert.match(verdict.issues.join('\n'), /top-level setup, teardown, or configuration error/i);
  assert.doesNotMatch(verdict.issues.join('\n'), /TOP_LEVEL_SETUP_SECRET/);
});

test('max-failures early stop after a proven target failure remains a runtime-test failure', () => {
  const file = 'regression/example-flow.spec.ts';
  const report = {
    config: {
      maxFailures: 1,
      projects: [
        { name: 'local-chromium', id: 'local-chromium', repeatEach: 2, retries: 0 }
      ]
    },
    suites: [{
      title: 'example-flow.spec.ts',
      file,
      specs: [{
        id: 'failed-repeat-1',
        title: 'DC-001: generated result is visible',
        file,
        line: 42,
        column: 7,
        tests: [{
          status: 'unexpected',
          expectedStatus: 'passed',
          projectName: 'local-chromium',
          projectId: 'local-chromium',
          results: [{ status: 'failed', retry: 0 }]
        }]
      }]
    }],
    errors: [{ message: 'Testing stopped early after 1 maximum allowed failures.' }],
    stats: { expected: 0, unexpected: 1, flaky: 0, skipped: 0 }
  };
  const contract = { project: 'local-chromium', repeatEach: 2, retries: 0 };

  const verdict = verifyPlaywrightJsonReport(report, TARGET, contract);

  assert.equal(verdict.passed, false);
  assert.equal(verdict.environmentFailure, false, verdict.issues.join('\n'));
  assert.equal(verdict.counts.unexpected, 1);
  assert.equal(generatedTestGate.playwrightFailureStage(1, { ...verdict, readable: true }), 'runtime-test');
});

test('JSON report execution contract requires exact two-run retry-zero pass evidence', () => {
  const report = reportFixture(['expected']);
  report.errors = [];
  report.config = {
    projects: [
      { name: 'local-chromium', id: 'local-chromium', repeatEach: 2, retries: 0 },
      { name: 'chromium', id: 'chromium', repeatEach: 1, retries: 0 }
    ]
  };
  report.config.projects[0].metadata = { privateCanary: 'PRIVATE_CONFIG_CANARY' };
  report.suites[0].specs[0].id = 'logical-spec-1';
  report.suites[0].specs[0].tests = Array.from({ length: 2 }, () => ({
    status: 'expected',
    expectedStatus: 'passed',
    projectName: 'local-chromium',
    projectId: 'local-chromium',
    results: [{ status: 'passed', retry: 0 }]
  }));
  report.stats = { expected: 2, unexpected: 0, flaky: 0, skipped: 0 };
  const contract = { project: 'local-chromium', repeatEach: 2, retries: 0 };

  const accepted = verifyPlaywrightJsonReport(report, TARGET, contract);
  assert.equal(accepted.passed, true, accepted.issues.join('\n'));

  for (const mutate of [
    (candidate) => { candidate.config.projects[0].repeatEach = 3; },
    (candidate) => { candidate.config.projects[0].retries = 1; },
    (candidate) => { candidate.suites[0].specs[0].tests[0].projectName = 'chromium'; },
    (candidate) => { candidate.suites[0].specs[0].tests[0].projectId = 'chromium'; },
    (candidate) => { candidate.suites[0].specs[0].tests.length = 1; },
    (candidate) => { candidate.suites[0].specs[0].tests.push({ ...candidate.suites[0].specs[0].tests[0] }); },
    (candidate) => {
      candidate.suites[0].specs[0].tests[1].status = 'unexpected';
      candidate.suites[0].specs[0].tests[1].expectedStatus = 'failed';
      candidate.suites[0].specs[0].tests[1].results = [{ status: 'failed', retry: 0 }];
    },
    (candidate) => {
      candidate.suites[0].specs[0].tests[1].status = 'skipped';
      candidate.suites[0].specs[0].tests[1].expectedStatus = 'skipped';
      candidate.suites[0].specs[0].tests[1].results = [{ status: 'skipped', retry: 0 }];
    },
    (candidate) => { candidate.suites[0].specs[0].tests[1].results[0].retry = 1; },
    (candidate) => { delete candidate.suites[0].specs[0].tests[1].results; },
    (candidate) => { delete candidate.errors; },
    (candidate) => { delete candidate.stats; }
  ]) {
    const candidate = JSON.parse(JSON.stringify(report));
    mutate(candidate);
    const verdict = verifyPlaywrightJsonReport(candidate, TARGET, contract);
    assert.equal(verdict.passed, false);
    assert.ok(verdict.issues.length > 0);
    assert.doesNotMatch(verdict.issues.join('\n'), /PRIVATE_CONFIG_CANARY/);
  }
});

test('JSON report execution contract accepts Playwright repeat-each specs split per execution', () => {
  const file = 'regression/example-flow.spec.ts';
  const passedExecution = () => ({
    status: 'expected',
    expectedStatus: 'passed',
    projectName: 'local-chromium',
    projectId: 'local-chromium',
    results: [{ status: 'passed', retry: 0 }]
  });
  const report = {
    config: {
      projects: [
        { name: 'local-chromium', id: 'local-chromium', repeatEach: 2, retries: 0 }
      ]
    },
    suites: [{
      title: 'example-flow.spec.ts',
      file,
      suites: [{
        title: 'generated flow',
        file,
        specs: [
          {
            id: 'logical-prefix-repeat-1',
            title: 'DC-001: generated result is visible',
            file,
            line: 42,
            column: 7,
            tests: [passedExecution()]
          },
          {
            id: 'logical-prefix-repeat-2',
            title: 'DC-001: generated result is visible',
            file,
            line: 42,
            column: 7,
            tests: [passedExecution()]
          }
        ]
      }],
      specs: []
    }],
    errors: [],
    stats: { expected: 2, unexpected: 0, flaky: 0, skipped: 0 }
  };
  const contract = { project: 'local-chromium', repeatEach: 2, retries: 0 };

  const verdict = verifyPlaywrightJsonReport(report, TARGET, contract);

  assert.equal(verdict.passed, true, verdict.issues.join('\n'));
  assert.deepEqual(verdict.counts, { expected: 2, unexpected: 0, flaky: 0, skipped: 0 });
});

test('exact execution evidence reconciles bounded stats, logical spec ids, and every reported test', () => {
  const contract = { project: 'local-chromium', repeatEach: 2, retries: 0 };
  const accepted = exactExecutionReportFixture();
  assert.equal(verifyPlaywrightJsonReport(accepted, TARGET, contract).passed, true);

  const cases = [
    ['nonzero unexpected stats with a clean tree', (report) => { report.stats.unexpected = 2; }],
    ['mismatched expected stats', (report) => { report.stats.expected = 3; }],
    ['negative stats', (report) => { report.stats.expected = -1; }],
    ['fractional stats', (report) => { report.stats.expected = 3.5; }],
    ['unbounded stats', (report) => { report.stats.expected = 1_000_001; }],
    ['non-integer stats', (report) => { report.stats.expected = '4'; }],
    ['an omitted logical target spec', (report) => { report.suites[0].specs.pop(); }],
    ['a duplicate logical spec id', (report) => {
      report.suites[0].specs[1].id = report.suites[0].specs[0].id;
    }],
    ['unaccounted execution evidence', (report) => {
      const extra = structuredClone(report.suites[0].specs[0]);
      extra.id = 'logical-spec-outside-target';
      extra.file = 'regression/not-requested.spec.ts';
      report.suites.push({
        title: 'not-requested.spec.ts',
        file: 'regression/not-requested.spec.ts',
        specs: [extra]
      });
      report.stats.expected = 6;
    }]
  ];

  for (const [name, mutate] of cases) {
    const report = structuredClone(accepted);
    mutate(report);
    const verdict = verifyPlaywrightJsonReport(report, TARGET, contract);
    assert.equal(verdict.passed, false, `${name} must fail closed`);
    assert.equal(verdict.environmentFailure, true, `${name} is a report-contract failure`);
    assert.ok(verdict.issues.length > 0, name);
  }
});

test('report-proven skipped tests remain runtime-test failures when Playwright exits zero', () => {
  const reportVerdict = {
    ...verifyPlaywrightJsonReport(reportFixture(['skipped']), TARGET),
    readable: true
  };

  assert.equal(generatedTestGate.playwrightFailureStage(0, reportVerdict), 'runtime-test');
  assert.equal(generatedTestGate.playwrightFailureStage(1, reportVerdict), 'runtime-test');
  assert.equal(generatedTestGate.playwrightFailureStage(137, reportVerdict), 'runtime-environment');
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

test('playwright stage supports the two-repeat promotion lane and rejects unsupported repeats', () => {
  const stage = buildPlaywrightStage({
    packageManager: 'npm',
    testPath: TARGET,
    project: 'chromium',
    repeatEach: 2,
    jsonReportPath: path.join('.ai-runs', 'gate-fast', 'playwright-report-chromium.json')
  });

  assert.ok(stage.args.includes('--repeat-each=2'));
  assert.ok(stage.args.includes('--retries=0'));
  assert.ok(stage.args.includes('--max-failures=1'));
  assert.throws(
    () => buildPlaywrightStage({
      packageManager: 'npm',
      testPath: TARGET,
      project: 'chromium',
      repeatEach: 1,
      jsonReportPath: path.join('.ai-runs', 'gate-invalid', 'playwright-report-chromium.json')
    }),
    /repeat-each must be 2 \(promotion\) or 3 \(full\)/
  );
  assert.throws(
    () => buildPlaywrightStage({
      packageManager: 'npm',
      testPath: TARGET,
      project: 'chromium',
      repeatEach: 4,
      jsonReportPath: path.join('.ai-runs', 'gate-invalid', 'playwright-report-chromium.json')
    }),
    /repeat-each must be 2 \(promotion\) or 3 \(full\)/
  );
});

test('playwright stage accepts a normalized target list once and does not stop a multi-target group early', () => {
  const secondTarget = 'tests/regression/second-flow.spec.ts';
  const stage = buildPlaywrightStage({
    packageManager: 'npm',
    testPaths: [
      `./tests//regression/./${path.basename(TARGET)}`,
      TARGET.replaceAll('/', '\\'),
      'tests/regression/nested/../second-flow.spec.ts',
      secondTarget
    ],
    project: 'chromium',
    repeatEach: 3,
    jsonReportPath: path.join('.ai-runs', 'gate-group', 'report.json')
  });

  assert.equal(stage.args.filter((arg) => arg === TARGET).length, 1);
  assert.equal(stage.args.filter((arg) => arg === secondTarget).length, 1);
  assert.equal(stage.args.filter((arg) => arg === '--repeat-each=3').length, 1);
  assert.equal(stage.args.includes('--max-failures=1'), false);
  assert.deepEqual(stage.testPaths, [TARGET, secondTarget]);
});

test('shared JSON reports produce an exact independent verdict for every requested target', () => {
  const secondTarget = 'tests/regression/second-flow.spec.ts';
  const verdicts = generatedTestGate.verifyPlaywrightJsonReports({
    suites: [
      {
        file: 'regression/example-flow.spec.ts',
        specs: [{ file: 'regression/example-flow.spec.ts', tests: [{ status: 'expected' }] }]
      },
      {
        file: 'regression/second-flow.spec.ts',
        specs: [{ file: 'regression/second-flow.spec.ts', tests: [{ status: 'skipped' }] }]
      }
    ]
  }, [TARGET, secondTarget]);

  assert.equal(verdicts.get(TARGET).passed, true);
  assert.equal(verdicts.get(secondTarget).passed, false);
  assert.equal(verdicts.get(secondTarget).counts.skipped, 1);
  assert.equal(verifyPlaywrightJsonReport(reportFixture(['expected']), TARGET).passed, true);
});

test('shared report matching fails closed when a shortened basename matches multiple targets', () => {
  const first = 'tests/regression/a/shared-flow.spec.ts';
  const second = 'tests/regression/b/shared-flow.spec.ts';
  const verdicts = generatedTestGate.verifyPlaywrightJsonReports({
    suites: [{
      file: 'shared-flow.spec.ts',
      specs: [{ file: 'shared-flow.spec.ts', tests: [{ status: 'expected' }] }]
    }]
  }, [first, second]);

  for (const target of [first, second]) {
    assert.equal(verdicts.get(target).passed, false);
    assert.match(verdicts.get(target).issues.join('\n'), /ambiguous/i);
  }
});

test('shared report normalization keeps ambiguous and missing verdicts independent', () => {
  const exact = 'tests/regression/exact.spec.ts';
  const ambiguousA = 'tests/regression/a/shared.spec.ts';
  const ambiguousB = 'tests/regression/b/shared.spec.ts';
  const missing = 'tests/regression/missing.spec.ts';
  const verdicts = generatedTestGate.verifyPlaywrightJsonReports({
    suites: [
      {
        file: './tests//regression/./exact.spec.ts',
        specs: [{ file: './tests/regression/nested/../exact.spec.ts', tests: [{ status: 'expected' }] }]
      },
      {
        file: 'shared.spec.ts',
        specs: [{ file: 'shared.spec.ts', tests: [{ status: 'expected' }] }]
      }
    ]
  }, [exact, ambiguousA, ambiguousB, missing, `./${exact}`]);

  assert.equal(verdicts.size, 4, 'duplicate normalized targets must collapse');
  assert.equal(verdicts.get(exact).passed, true);
  assert.match(verdicts.get(ambiguousA).issues.join('\n'), /ambiguous/i);
  assert.match(verdicts.get(ambiguousB).issues.join('\n'), /ambiguous/i);
  assert.doesNotMatch(verdicts.get(missing).issues.join('\n'), /ambiguous/i);
  assert.match(verdicts.get(missing).issues.join('\n'), /no passing test/i);
});

test('playwright stage isolates HTML and test-result artifacts for one generated pair', () => {
  const stage = buildPlaywrightStage({
    packageManager: 'npm',
    testPath: TARGET,
    project: 'local-chromium',
    jsonReportPath: path.join('.ai-runs', 'gate-isolated', 'report.json'),
    htmlReportDir: path.join('.ai-runs', 'gate-isolated', 'html'),
    testResultsDir: path.join('.ai-runs', 'gate-isolated', 'test-results')
  });

  assert.ok(stage.args.includes(`--output=${path.resolve('.ai-runs', 'gate-isolated', 'test-results')}`));
  assert.equal(
    stage.env.PLAYWRIGHT_HTML_OUTPUT_DIR,
    path.resolve('.ai-runs', 'gate-isolated', 'html')
  );
});

test('gate arguments accept only promotion and full repeat counts', () => {
  assert.equal(FULL_GATE_REPEAT_EACH, 3, 'the independent full-gate policy remains exactly three repeats');
  assert.equal(parseArgs(['--spec', 'spec.md', '--test', TARGET]).repeatEach, 3);
  assert.equal(parseArgs(['--spec', 'spec.md', '--test', TARGET, '--repeat-each', '2']).repeatEach, 2);
  assert.equal(parseArgs(['--spec', 'spec.md', '--test', TARGET, '--repeat-each', '3']).repeatEach, 3);
  assert.throws(
    () => parseArgs(['--spec', 'spec.md', '--test', TARGET, '--repeat-each', '1']),
    /--repeat-each must be 2 \(promotion\) or 3 \(full\)/
  );
  assert.throws(
    () => parseArgs(['--spec', 'spec.md', '--test', TARGET, '--repeat-each', '4']),
    /--repeat-each must be 2 \(promotion\) or 3 \(full\)/
  );
});

test('gate arguments accept an internal global-check receipt and private verdict file', () => {
  const parsed = parseArgs([
    '--spec',
    'specs/flow.md',
    '--test',
    TARGET,
    '--global-checks-complete',
    'a'.repeat(64),
    '--verdict-file',
    '/tmp/generated-gate-verdict.json'
  ]);

  assert.equal(parsed.globalChecksComplete, 'a'.repeat(64));
  assert.equal(parsed.verdictFile, '/tmp/generated-gate-verdict.json');
  assert.throws(
    () => parseArgs(['--spec', 'specs/flow.md', '--test', TARGET, '--global-checks-complete', 'bad']),
    /64-character SHA-256 fingerprint/
  );
});

test('gate arguments accept a verified run id only for the three-repeat full lane', () => {
  assert.equal(
    parseArgs(['--spec', 'specs/flow.md', '--test', TARGET, '--run-id', 'verified-run-1']).runId,
    'verified-run-1'
  );
  assert.throws(
    () => parseArgs(['--spec', 'specs/flow.md', '--test', TARGET, '--run-id', '../escape']),
    /run id/i
  );
  assert.throws(
    () => parseArgs([
      '--spec', 'specs/flow.md', '--test', TARGET, '--repeat-each', '2', '--run-id', 'verified-run-1'
    ]),
    /run-id.*full three-repeat gate/i
  );
});

test('full gate outcome links a matching target to its finalized generation run without diagnostics', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'generated-gate-run-link-'));
  const telemetryRoot = path.join(workspace, 'generation');
  const specPath = path.join(workspace, 'specs', 'flow.md');
  const testPath = path.join(workspace, 'tests', 'regression', 'accepted.spec.ts');
  fs.mkdirSync(path.dirname(specPath), { recursive: true });
  fs.mkdirSync(path.dirname(testPath), { recursive: true });
  fs.writeFileSync(
    specPath,
    fs.readFileSync(path.join(process.cwd(), 'specs', 'media-plan-save-via-nectar-ai.md'), 'utf8')
  );
  fs.writeFileSync(testPath, 'const accepted = true;\n');
  const run = createGenerationRun({ telemetryRoot, runId: 'linked-full-gate' });
  bindGenerationRunSubject(run, {
    specSha256: specSha256(specPath),
    targetIdentity: 'tests/regression/accepted.spec.ts'
  });
  finalizeGenerationRun(run, {
    status: 'succeeded',
    quality: {
      reviewPassed: true,
      fastGatePassed: true,
      fullGatePassed: null,
      promotionGatePolicy: PROMOTION_GATE_POLICY,
      promotionGateRepeatEach: PROMOTION_GATE_REPEAT_EACH,
      qualityFingerprint: acceptedQualityFingerprint,
      repairCount: 0
    }
  });

  try {
    const targetSnapshot = captureFullGateTargetSnapshot(testPath);
    const updated = linkFullGateOutcome({
      args: { runId: 'linked-full-gate', repeatEach: 3, spec: specPath, test: testPath },
      verdict: {
        schema: 'generated-gate-verdict/v1',
        passed: false,
        stage: 'runtime-test',
        reasonCode: 'RUNTIME_TEST_FAILED',
        diagnostics: ['PRIVATE browser output'],
        repairable: false
      },
      telemetryRoot,
      webRoot: workspace,
      targetSnapshot
    });
    assert.equal(updated.quality.fullGatePassed, false);
    assert.equal(updated.quality.qualityFingerprint, acceptedQualityFingerprint);
    assert.doesNotMatch(fs.readFileSync(run.manifestPath, 'utf8'), /PRIVATE browser output/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('full gate linkage rejects a target changed after its pre-execution snapshot', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'generated-gate-snapshot-'));
  const telemetryRoot = path.join(workspace, 'generation');
  const specPath = path.join(workspace, 'specs', 'flow.md');
  const testPath = path.join(workspace, 'tests', 'regression', 'accepted.spec.ts');
  fs.mkdirSync(path.dirname(specPath), { recursive: true });
  fs.mkdirSync(path.dirname(testPath), { recursive: true });
  fs.writeFileSync(
    specPath,
    fs.readFileSync(path.join(process.cwd(), 'specs', 'media-plan-save-via-nectar-ai.md'), 'utf8')
  );
  fs.writeFileSync(testPath, 'const accepted = true;\n');
  const run = createGenerationRun({ telemetryRoot, runId: 'snapshot-bound-gate' });
  bindGenerationRunSubject(run, {
    specSha256: specSha256(specPath),
    targetIdentity: 'tests/regression/accepted.spec.ts'
  });
  finalizeGenerationRun(run, {
    status: 'succeeded',
    quality: {
      reviewPassed: true,
      fastGatePassed: true,
      fullGatePassed: null,
      promotionGatePolicy: PROMOTION_GATE_POLICY,
      promotionGateRepeatEach: PROMOTION_GATE_REPEAT_EACH,
      qualityFingerprint: acceptedQualityFingerprint,
      repairCount: 0
    }
  });

  try {
    const targetSnapshot = captureFullGateTargetSnapshot(testPath);
    fs.writeFileSync(testPath, 'const swappedDuringGate = true;\n');
    assert.throws(
      () => linkFullGateOutcome({
        args: {
          runId: 'snapshot-bound-gate', repeatEach: 3, spec: specPath, test: testPath
        },
        verdict: {
          schema: 'generated-gate-verdict/v1', passed: true, stage: 'accepted', reasonCode: 'PASSED',
          diagnostics: [], repairable: false
        },
        telemetryRoot,
        webRoot: workspace,
        targetSnapshot
      }),
      /changed during the full gate/i
    );
    assert.equal(JSON.parse(fs.readFileSync(run.manifestPath, 'utf8')).quality.fullGatePassed, null);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('full gate infrastructure failures remain outside the candidate quality rate', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'generated-gate-infra-'));
  const telemetryRoot = path.join(workspace, 'generation');
  const specPath = path.join(workspace, 'specs', 'flow.md');
  const testPath = path.join(workspace, 'tests', 'regression', 'accepted.spec.ts');
  fs.mkdirSync(path.dirname(specPath), { recursive: true });
  fs.mkdirSync(path.dirname(testPath), { recursive: true });
  fs.writeFileSync(
    specPath,
    fs.readFileSync(path.join(process.cwd(), 'specs', 'media-plan-save-via-nectar-ai.md'), 'utf8')
  );
  fs.writeFileSync(testPath, 'const accepted = true;\n');
  const run = createGenerationRun({ telemetryRoot, runId: 'infra-full-gate' });
  bindGenerationRunSubject(run, {
    specSha256: specSha256(specPath),
    targetIdentity: 'tests/regression/accepted.spec.ts'
  });
  finalizeGenerationRun(run, {
    status: 'succeeded',
    quality: {
      reviewPassed: true,
      fastGatePassed: true,
      fullGatePassed: null,
      promotionGatePolicy: PROMOTION_GATE_POLICY,
      promotionGateRepeatEach: PROMOTION_GATE_REPEAT_EACH,
      qualityFingerprint: acceptedQualityFingerprint,
      repairCount: 0
    }
  });

  try {
    const updated = linkFullGateOutcome({
      args: { runId: 'infra-full-gate', repeatEach: 3, spec: specPath, test: testPath },
      verdict: {
        schema: 'generated-gate-verdict/v1', passed: false, stage: 'runtime-environment',
        reasonCode: 'RUNTIME_ENVIRONMENT_FAILED', diagnostics: ['PRIVATE environment detail'], repairable: false
      },
      telemetryRoot,
      webRoot: workspace,
      targetSnapshot: captureFullGateTargetSnapshot(testPath)
    });
    assert.equal(updated.quality.fullGatePassed, null);
    assert.equal(updated.quality.fullGateOutcomeStage, 'runtime-environment');
    assert.equal(updated.quality.fullGateReasonCode, 'RUNTIME_ENVIRONMENT_FAILED');
    assert.doesNotMatch(fs.readFileSync(run.manifestPath, 'utf8'), /PRIVATE environment detail/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('gate verdict writer creates a private file and refuses an existing target', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'generated-gate-verdict-'));
  const verdictPath = path.join(workspace, 'verdict.json');
  const verdict = {
    schema: 'generated-gate-verdict/v1',
    passed: false,
    stage: 'static-review',
    reasonCode: 'STATIC_REVIEW_FAILED',
    diagnostics: ['Missing final assertion.'],
    repairable: true
  };

  try {
    writeGeneratedGateVerdict(verdictPath, verdict);
    assert.deepEqual(JSON.parse(fs.readFileSync(verdictPath, 'utf8')), verdict);
    assert.equal(fs.statSync(verdictPath).mode & 0o777, 0o600);
    assert.throws(() => writeGeneratedGateVerdict(verdictPath, verdict), /already exists/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('gate verdict writer never follows or replaces a symbolic-link target', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'generated-gate-verdict-link-'));
  const victimPath = path.join(workspace, 'victim.txt');
  const verdictPath = path.join(workspace, 'verdict.json');
  fs.writeFileSync(victimPath, 'preserve me');
  fs.symlinkSync(victimPath, verdictPath);

  try {
    assert.throws(
      () => writeGeneratedGateVerdict(verdictPath, { schema: 'generated-gate-verdict/v1' }),
      /already exists/
    );
    assert.equal(fs.readFileSync(victimPath, 'utf8'), 'preserve me');
    assert.equal(fs.lstatSync(verdictPath).isSymbolicLink(), true);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

// Iteration-3 hole: staged candidates are dot-prefixed
// (tests/smoke/.NAME.<runId>.candidate.spec.ts) and TypeScript wildcard
// matching skips dotfiles, so `tsc -p tsconfig.json` (include tests/**/*.ts)
// never typechecked the candidate — a catalog candidate promoted with a
// TS18047 strict-null fault and broke the project typecheck for every later
// gate. The gate now extends the project config with the explicit staged
// paths (explicit include entries are matched even when dotted).
test('a per-gate tsconfig project makes a dot-prefixed staged candidate visible to tsc', () => {
  const require = createRequire(import.meta.url);
  const tscBin = path.join(path.dirname(require.resolve('typescript/package.json')), 'bin', 'tsc');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-tsconfig-project-'));
  const runTsc = (project) => spawnSync(
    process.execPath,
    [tscBin, '--noEmit', '--pretty', 'false', '-p', project],
    { cwd: workspace, encoding: 'utf8' }
  );
  try {
    fs.mkdirSync(path.join(workspace, 'tests'));
    fs.writeFileSync(
      path.join(workspace, 'tsconfig.json'),
      `${JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [] }, include: ['tests/**/*.ts'] })}\n`
    );
    fs.writeFileSync(path.join(workspace, 'tests', 'visible.spec.ts'), "export const ok: string = 'ok';\n");
    const brokenCandidate = 'tests/.checkout.run-1.candidate.spec.ts';
    fs.writeFileSync(
      path.join(workspace, brokenCandidate),
      'export function broken(value: string | null): number {\n  return value.length;\n}\n'
    );

    // The historical hole itself: the project config typechecks green while
    // the staged candidate carries a strict-null error.
    assert.equal(runTsc('tsconfig.json').status, 0);

    const scoped = generatedTestGate.createGateTypecheckProject({
      rootDir: workspace,
      testPaths: [brokenCandidate]
    });
    try {
      assert.match(scoped.configName, /^tsconfig\.gate-.+\.json$/);
      const config = JSON.parse(fs.readFileSync(scoped.configPath, 'utf8'));
      assert.equal(config.extends, './tsconfig.json');
      assert.deepEqual(config.include, ['tests/**/*.ts', brokenCandidate]);
      const broken = runTsc(scoped.configName);
      assert.notEqual(broken.status, 0);
      assert.match(`${broken.stdout}\n${broken.stderr}`, /TS18047|possibly 'null'/);
    } finally {
      scoped.cleanup();
    }
    assert.equal(fs.existsSync(scoped.configPath), false);

    const cleanCandidate = 'tests/.checkout.run-2.candidate.spec.ts';
    fs.writeFileSync(
      path.join(workspace, cleanCandidate),
      "export const staged: string = 'clean';\n"
    );
    const cleanScoped = generatedTestGate.createGateTypecheckProject({
      rootDir: workspace,
      testPaths: [cleanCandidate]
    });
    try {
      assert.equal(runTsc(cleanScoped.configName).status, 0);
    } finally {
      cleanScoped.cleanup();
    }

    assert.throws(
      () => generatedTestGate.createGateTypecheckProject({
        rootDir: workspace,
        testPaths: ['../outside.spec.ts']
      }),
      /escapes the package root/
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('the single-pair gate rejects a strict-null staged candidate at the typecheck step', () => {
  const id = `tscheck-${process.pid}`;
  const candidatePath = path.join('tests', 'smoke', `.complex-feed-lazyload-comments-c3.${id}.candidate.spec.ts`);
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'generated-gate-typecheck-'));
  const verdictPath = path.join(workspace, 'verdict.json');
  const source = fs.readFileSync(path.join('tests', 'smoke', 'complex-feed-lazyload-comments-c1.spec.ts'), 'utf8')
    .replace(
      "await this.page.goto('/complex/feed');",
      "const staged: string | null = null;\n    void staged.length;\n    await this.page.goto('/complex/feed');"
    );
  assert.match(source, /void staged\.length/);
  fs.writeFileSync(candidatePath, source);
  try {
    const result = spawnSync(
      process.execPath,
      [
        path.join(process.cwd(), 'scripts', 'ai', 'generated-test-gate.mjs'),
        '--spec',
        path.join('specs', 'complex-feed-lazyload-comments.md'),
        '--test',
        candidatePath,
        '--verdict-file',
        verdictPath
      ],
      { cwd: process.cwd(), encoding: 'utf8' }
    );

    assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const verdict = JSON.parse(fs.readFileSync(verdictPath, 'utf8'));
    assert.equal(verdict.stage, 'global-static', JSON.stringify(verdict));
    assert.equal(verdict.reasonCode, 'GLOBAL_STATIC_CHECK_FAILED');
    // The typecheck rejection happens before any Playwright execution.
    assert.doesNotMatch(result.stdout, /--reporter=html,json/);
    // The per-gate temp tsconfig never survives the gate.
    assert.deepEqual(fs.readdirSync('.').filter((entry) => entry.startsWith('tsconfig.gate-')), []);
  } finally {
    fs.rmSync(candidatePath, { force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('single-pair gate writes a machine verdict for an input-validation failure', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'generated-gate-cli-verdict-'));
  const verdictPath = path.join(workspace, 'verdict.json');
  try {
    const result = spawnSync(
      process.execPath,
      [
        path.join(process.cwd(), 'scripts', 'ai', 'generated-test-gate.mjs'),
        '--spec',
        path.join(workspace, 'missing.md'),
        '--test',
        path.join(workspace, 'missing.spec.ts'),
        '--verdict-file',
        verdictPath
      ],
      { cwd: process.cwd(), encoding: 'utf8' }
    );

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    const verdict = JSON.parse(fs.readFileSync(verdictPath, 'utf8'));
    assert.equal(verdict.stage, 'input-validation');
    assert.equal(verdict.reasonCode, 'INPUT_VALIDATION_FAILED');
    assert.equal(verdict.repairable, false);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('single-pair gate writes a repairable static-review verdict without scraping output', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'generated-gate-static-verdict-'));
  const testPath = path.join(workspace, 'invalid.authenticated.spec.ts');
  const verdictPath = path.join(workspace, 'verdict.json');
  const specDir = path.join(workspace, 'specs');
  const specPath = path.join(specDir, 'valid-input.md');
  fs.mkdirSync(specDir);
  fs.copyFileSync('specs/nectar-summary-reflection.md', specPath);
  fs.writeFileSync(testPath, "import { test } from '@playwright/test';\ntest('invalid', async () => {});\n");
  const directoryResult = validateSpecDirectory(specDir);
  const fingerprint = computeGlobalChecksFingerprint(specDir, directoryResult);

  try {
    const result = spawnSync(
      process.execPath,
      [
        path.join(process.cwd(), 'scripts', 'ai', 'generated-test-gate.mjs'),
        '--spec',
        specPath,
        '--test',
        testPath,
        '--global-checks-complete',
        fingerprint,
        '--verdict-file',
        verdictPath
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, E2E_AUTH_ENABLED: 'false' }
      }
    );

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    const verdict = JSON.parse(fs.readFileSync(verdictPath, 'utf8'));
    assert.equal(verdict.stage, 'static-review');
    assert.equal(verdict.reasonCode, 'STATIC_REVIEW_FAILED');
    assert.equal(verdict.repairable, true);
    assert.ok(verdict.diagnostics.length > 0);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('single-pair gate rejects static review before running global list/typecheck work', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'generated-gate-cheap-review-'));
  const testPath = path.join(workspace, 'invalid.authenticated.spec.ts');
  const verdictPath = path.join(workspace, 'verdict.json');
  const specDir = path.join(workspace, 'specs');
  const specPath = path.join(specDir, 'valid-input.md');
  fs.mkdirSync(specDir);
  fs.copyFileSync('specs/nectar-summary-reflection.md', specPath);
  fs.writeFileSync(testPath, "import { test } from '@playwright/test';\ntest('invalid', async () => {});\n");

  try {
    const result = spawnSync(
      process.execPath,
      [
        path.join(process.cwd(), 'scripts', 'ai', 'generated-test-gate.mjs'),
        '--spec',
        specPath,
        '--test',
        testPath,
        '--verdict-file',
        verdictPath
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, E2E_AUTH_ENABLED: 'false' }
      }
    );

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.doesNotMatch(result.stdout, /npm run test:e2e:list|npx tsc/);
    assert.equal(JSON.parse(fs.readFileSync(verdictPath, 'utf8')).stage, 'static-review');
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
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

test('single-pair report reader rejects symbolic links and oversized reports before parsing', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'single-pair-report-safety-'));
  const victimPath = path.join(workspace, 'victim.json');
  const symlinkPath = path.join(workspace, 'playwright-symlink.json');
  const oversizedPath = path.join(workspace, 'playwright-oversized.json');
  fs.writeFileSync(victimPath, JSON.stringify(reportFixture(['expected'])));
  fs.symlinkSync(victimPath, symlinkPath);
  fs.writeFileSync(oversizedPath, '{}');
  fs.truncateSync(oversizedPath, (32 * 1024 * 1024) + 1);

  try {
    const symlinkVerdict = generatedTestGate.readJsonReportVerdict(symlinkPath, TARGET);
    assert.equal(symlinkVerdict.passed, false);
    assert.equal(symlinkVerdict.readable, false);
    assert.match(symlinkVerdict.issues.join('\n'), /non-symlink|symbolic link/i);

    const oversizedVerdict = generatedTestGate.readJsonReportVerdict(oversizedPath, TARGET);
    assert.equal(oversizedVerdict.passed, false);
    assert.equal(oversizedVerdict.readable, false);
    assert.match(oversizedVerdict.issues.join('\n'), /32.*MiB|33554432|size limit/i);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('single-pair gate run setup rejects a symbolic-link .ai-runs root', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'single-pair-run-root-'));
  const victim = path.join(workspace, 'victim');
  const runsRoot = path.join(workspace, '.ai-runs');
  fs.mkdirSync(victim);
  fs.symlinkSync(victim, runsRoot);

  try {
    assert.throws(
      () => generatedTestGate.prepareSinglePairGateRunDirectory({
        specPath: 'specs/nectar-summary-reflection.md',
        aiRunsRoot: runsRoot
      }),
      /symbolic links/i
    );
    assert.deepEqual(fs.readdirSync(victim), []);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
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
