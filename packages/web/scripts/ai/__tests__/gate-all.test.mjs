import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  classifyGeneratedGateFailure,
  computeGlobalChecksFingerprint,
  executeGeneratedPair,
  runGeneratedPairChecks,
  runGeneratedPairsSequentially,
  runGlobalGeneratedChecks
} from '../lib/generated-gate-runner.mjs';
import * as generatedGateRunner from '../lib/generated-gate-runner.mjs';
import { verifyGlobalChecksReceipt } from '../lib/generated-gate-fingerprint.mjs';
import { FULL_GATE_REPEAT_EACH } from '../lib/generated-gate-policy.mjs';
import { reviewGeneratedTest } from '../review-generated-test.mjs';
import { runGateAll } from '../gate-all.mjs';

function directoryFixture() {
  return {
    valid: true,
    issues: [],
    results: [
      {
        specPath: 'specs/one.md',
        result: {
          valid: true,
          issues: [],
          content: '# one',
          metadata: {
            'Flow ID': 'FLOW-ONE',
            'Target Test File': 'tests/smoke/one.spec.ts',
            'Test Type': 'smoke',
            Auth: 'none'
          }
        }
      },
      {
        specPath: 'specs/two.md',
        result: {
          valid: true,
          issues: [],
          content: '# two',
          metadata: {
            'Flow ID': 'FLOW-TWO',
            'Target Test File': 'tests/smoke/two.spec.ts',
            'Test Type': 'smoke',
            Auth: 'none'
          }
        }
      }
    ]
  };
}

function completePlaywrightReport(stage, report) {
  const repeatEach = Number(
    stage.args.find((arg) => arg.startsWith('--repeat-each='))?.slice('--repeat-each='.length)
  );
  const projectId = stage.project;
  let logicalSpecOrdinal = 0;
  const enrichSuite = (suite) => ({
    ...suite,
    specs: (suite.specs ?? []).map((spec) => ({
      ...spec,
      id: spec.id ?? `logical-spec-${logicalSpecOrdinal += 1}`,
      tests: (spec.tests ?? []).flatMap((entry) => Array.from({ length: repeatEach }, () => ({
        ...entry,
        expectedStatus: entry.expectedStatus ?? 'passed',
        projectName: stage.project,
        projectId,
        results: entry.results ?? [{
          status: entry.status === 'expected'
            ? 'passed'
            : entry.status === 'skipped'
              ? 'skipped'
              : 'failed',
          retry: 0
        }]
      })))
    })),
    ...(suite.suites ? { suites: suite.suites.map(enrichSuite) } : {})
  });
  const suites = (report.suites ?? []).map(enrichSuite);
  const stats = { expected: 0, unexpected: 0, flaky: 0, skipped: 0 };
  const countSuite = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const entry of spec.tests ?? []) stats[entry.status] += 1;
    }
    for (const child of suite.suites ?? []) countSuite(child);
  };
  for (const suite of suites) countSuite(suite);
  return {
    ...report,
    config: report.config ?? {
      projects: [
        { name: stage.project, id: projectId, repeatEach, retries: 0 },
        { name: 'unselected-project', id: 'unselected-project', repeatEach: 1, retries: 0 }
      ]
    },
    suites,
    errors: report.errors ?? [],
    stats: report.stats ?? stats
  };
}

test('generated promotion compatibility script requests two repeats without changing the recording lane', () => {
  const scripts = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')).scripts;

  assert.equal(scripts['ai:test:gate:fast'], 'node scripts/ai/generated-test-gate.mjs --repeat-each 2');
  assert.equal(scripts['ai:recording:gate:fast'], 'node scripts/ai/recording-test-gate.mjs --repeat-each 1');
});

test('batch gate statically rejects every candidate before any global command can import it', () => {
  let globalCalls = 0;
  let pairCalls = 0;
  const result = runGateAll({
    specDir: 'virtual-specs',
    reviewOnly: false,
    validateDirectory: () => directoryFixture(),
    reviewer({ specPath }) {
      return specPath.endsWith('one.md')
        ? { passed: false, issues: ['capability boundary failed'], warnings: [] }
        : { passed: true, issues: [], warnings: [] };
    },
    runGlobalChecks() {
      globalCalls += 1;
      throw new Error('global commands must not run');
    },
    runPairChecks() {
      pairCalls += 1;
      throw new Error('pair execution must not run');
    }
  });

  assert.equal(result.passed, false);
  assert.equal(result.reviewed, 2);
  assert.equal(globalCalls, 0);
  assert.equal(pairCalls, 0);
  assert.match(result.issues.join('\n'), /capability boundary failed/);
});

test('green review-only validates once and reviews every pair without global or runtime work', () => {
  let validations = 0;
  let reviews = 0;
  let globalCalls = 0;
  let batchCalls = 0;
  const result = runGateAll({
    specDir: 'virtual-specs',
    reviewOnly: true,
    validateDirectory() {
      validations += 1;
      return directoryFixture();
    },
    reviewer() {
      reviews += 1;
      return { passed: true, issues: [], warnings: [] };
    },
    runGlobalChecks() {
      globalCalls += 1;
      throw new Error('review-only must not run global commands');
    },
    runPairBatch() {
      batchCalls += 1;
      throw new Error('review-only must not run browser commands');
    }
  });

  assert.equal(result.passed, true, result.issues.join('\n'));
  assert.equal(validations, 1);
  assert.equal(reviews, 2);
  assert.equal(globalCalls, 0);
  assert.equal(batchCalls, 0);
  assert.equal(result.reviewed, 2);
  assert.equal(result.executed, 0);
});

test('review-only pair checks do not require a global-check receipt', () => {
  const pair = {
    specPath: 'specs/one.md',
    testPath: 'tests/smoke/one.spec.ts',
    validation: directoryFixture().results[0].result
  };
  const result = runGeneratedPairChecks(pair, {
    reviewOnly: true,
    reviewer: () => ({ passed: true, issues: [], warnings: [] }),
    executor: () => {
      throw new Error('review-only must not execute');
    }
  });

  assert.equal(result.passed, true);
  assert.equal(result.execution.attempted, false);
});

test('full batch calls global checks once and grouped execution once', () => {
  assert.equal(FULL_GATE_REPEAT_EACH, 3, 'full generated-test acceptance remains exactly three repeats');
  let globalCalls = 0;
  let batchCalls = 0;
  const directoryResult = directoryFixture();
  const result = runGateAll({
    specDir: 'virtual-specs',
    env: { E2E_AUTH_ENABLED: 'false' },
    validateDirectory: () => directoryResult,
    reviewer: () => ({ passed: true, issues: [], warnings: [] }),
    runGlobalChecks(options) {
      globalCalls += 1;
      assert.deepEqual(options.testPaths, ['tests/smoke/one.spec.ts', 'tests/smoke/two.spec.ts']);
      assert.equal(options.env.E2E_AUTH_ENABLED, 'false');
      return {
        passed: true,
        issues: [],
        directoryResult,
        fingerprint: 'a'.repeat(64),
        expectedFingerprint: 'a'.repeat(64)
      };
    },
    runPairBatch(pairs, options) {
      batchCalls += 1;
      assert.equal(pairs.length, 2);
      assert.equal(options.repeatEach, 3);
      assert.equal(options.env.E2E_AUTH_ENABLED, 'false');
      return pairs.map((pair) => ({
        passed: true,
        pair,
        review: pair.precomputedReview,
        execution: { passed: true, attempted: true, issues: [], projects: [] },
        verdict: { diagnostics: [] }
      }));
    }
  });

  assert.equal(result.passed, true, result.issues.join('\n'));
  assert.equal(globalCalls, 1);
  assert.equal(batchCalls, 1);
  assert.equal(result.executed, 2);
});

test('outer pair gate rejects forged stats, omitted logical tests, and duplicate logical ids', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'generated-gate-forged-stats-'));
  const pair = {
    specPath: 'specs/one.md',
    testPath: 'tests/smoke/one.spec.ts',
    validation: directoryFixture().results[0].result
  };
  const cases = [
    ['forged-stats', (report) => { report.stats.unexpected = 2; }],
    ['omitted-logical-spec', (report) => { report.suites[0].specs.pop(); }],
    ['duplicate-logical-id', (report) => {
      report.suites[0].specs[1].id = report.suites[0].specs[0].id;
    }]
  ];

  try {
    for (const [name, mutate] of cases) {
      const result = executeGeneratedPair(pair, {
        runRoot: path.join(workspace, name, '.ai-runs'),
        packageManager: 'npm',
        projectPlanner: () => [{ project: 'local-chromium', env: {} }],
        commandRunner(stage) {
          const report = completePlaywrightReport(stage, {
            suites: [{
              file: stage.testPath,
              specs: [
                { file: stage.testPath, tests: [{ status: 'expected' }] },
                { file: stage.testPath, tests: [{ status: 'expected' }] }
              ]
            }]
          });
          mutate(report);
          fs.writeFileSync(stage.env.PLAYWRIGHT_JSON_OUTPUT_NAME, JSON.stringify(report));
          return 0;
        }
      });

      assert.equal(result.passed, false, name);
      assert.equal(result.stage, 'runtime-environment', name);
      assert.match(result.issues.join('\n'), /stats|execution contract|reconcile|duplicate/i, name);
    }
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('batch gate never lists an expected-red malicious sentinel or an unmapped test', () => {
  const fixture = directoryFixture();
  fixture.results[0].specPath = 'virtual-specs/malicious-sentinel.md';
  fixture.results[0].result.metadata['Target Test File'] = 'tests/smoke/malicious-sentinel.spec.ts';
  let listedPaths;

  const result = runGateAll({
    specDir: 'virtual-specs',
    reviewOnly: false,
    expectedRed: new Set(['virtual-specs/malicious-sentinel.md']),
    validateDirectory: () => fixture,
    reviewer({ specPath }) {
      return specPath.includes('malicious-sentinel')
        ? { passed: false, issues: ['sentinel must remain static-red'], warnings: [] }
        : { passed: true, issues: [], warnings: [] };
    },
    runGlobalChecks(options) {
      listedPaths = options.testPaths;
      return {
        passed: true,
        issues: [],
        directoryResult: fixture,
        fingerprint: 'a'.repeat(64),
        expectedFingerprint: 'a'.repeat(64)
      };
    },
    runPairBatch(pairs) {
      return pairs.map((pair) => ({
        passed: true,
        execution: { attempted: true },
        verdict: { diagnostics: [] },
        pair
      }));
    }
  });

  assert.equal(result.passed, true, result.issues.join('\n'));
  assert.deepEqual(listedPaths, ['tests/smoke/two.spec.ts']);
  assert.doesNotMatch(listedPaths.join('\n'), /malicious-sentinel|unmapped/);
});

test('global checks typecheck dot-prefixed staged candidates through a temp gate tsconfig project', () => {
  const directoryResult = directoryFixture();
  const stagedCandidate = 'tests/smoke/.two.run-1.candidate.spec.ts';
  let typecheckStage;
  let configDuringRun;

  const globalChecks = runGlobalGeneratedChecks({
    specDir: 'specs',
    testPaths: [stagedCandidate],
    validateDirectory: () => directoryResult,
    commandRunner(stage) {
      if (stage.kind === 'typescript') {
        typecheckStage = stage;
        const projectFlag = stage.args[stage.args.indexOf('-p') + 1];
        configDuringRun = JSON.parse(fs.readFileSync(projectFlag, 'utf8'));
      }
      return 0;
    }
  });

  assert.equal(globalChecks.passed, true, globalChecks.issues.join('\n'));
  assert.notEqual(typecheckStage, undefined);
  const projectFlag = typecheckStage.args[typecheckStage.args.indexOf('-p') + 1];
  assert.match(projectFlag, /^tsconfig\.gate-.+\.json$/);
  assert.equal(fs.existsSync(projectFlag), false, 'temp gate tsconfig must be cleaned up');
  assert.equal(configDuringRun.extends, './tsconfig.json');
  assert.ok(configDuringRun.include.includes('tests/**/*.ts'), configDuringRun.include.join(','));
  assert.ok(configDuringRun.include.includes(stagedCandidate), configDuringRun.include.join(','));
});

test('batch gate validates the directory, lists Playwright tests, and typechecks once for multiple pairs', () => {
  const calls = [];
  const directoryResult = directoryFixture();
  const globalChecks = runGlobalGeneratedChecks({
    specDir: 'specs',
    testPaths: directoryResult.results.map(({ result }) => result.metadata['Target Test File']),
    validateDirectory(specDir) {
      calls.push(`validate:${specDir}`);
      return directoryResult;
    },
    commandRunner(stage) {
      calls.push(stage.kind);
      assert.equal(stage.env.AI_GATE_SANITIZED_ENV, 'true');
      assert.equal(stage.env.OPENAI_API_KEY, '');
      assert.equal(stage.env.E2E_USER_PASSWORD, '');
      return 0;
    }
  });

  assert.equal(globalChecks.passed, true, globalChecks.issues.join('\n'));

  const reviewed = [];
  const executed = [];
  const pairOptions = {
    globalChecks,
    reviewer({ specPath, validation }) {
      reviewed.push(`${specPath}:${validation.metadata['Flow ID']}`);
      return { passed: true, issues: [], warnings: [] };
    },
    executor(pair) {
      executed.push(pair.specPath);
      return { passed: true, attempted: true, issues: [] };
    }
  };

  const results = runGeneratedPairsSequentially(
    directoryResult.results.map(({ specPath, result }) => ({
      specPath,
      testPath: result.metadata['Target Test File'],
      validation: result
    })),
    pairOptions
  );

  assert.deepEqual(calls, ['validate:specs', 'playwright-list', 'typescript']);
  assert.deepEqual(reviewed, ['specs/one.md:FLOW-ONE', 'specs/two.md:FLOW-TWO']);
  assert.deepEqual(executed, ['specs/one.md', 'specs/two.md']);
  assert.equal(results.every((result) => result.passed), true);
});

test('pair checks fail closed when the global-check fingerprint is missing or mismatched', () => {
  const pair = {
    specPath: 'specs/one.md',
    testPath: 'tests/smoke/one.spec.ts',
    validation: directoryFixture().results[0].result
  };

  assert.throws(
    () => runGeneratedPairChecks(pair, { globalChecks: undefined }),
    /completed global generated-test checks/
  );
  assert.throws(
    () => runGeneratedPairChecks(pair, {
      globalChecks: {
        passed: true,
        fingerprint: '0'.repeat(64),
        expectedFingerprint: '1'.repeat(64)
      }
    }),
    /fingerprint does not match/
  );
});

test('pair batch never overlaps browser executions', () => {
  const order = [];
  const globalChecks = {
    passed: true,
    fingerprint: 'a'.repeat(64),
    expectedFingerprint: 'a'.repeat(64)
  };
  const pairs = directoryFixture().results.map(({ specPath, result }) => ({
    specPath,
    testPath: result.metadata['Target Test File'],
    validation: result
  }));

  const results = runGeneratedPairsSequentially(pairs, {
    globalChecks,
    reviewer: () => ({ passed: true, issues: [], warnings: [] }),
    executor(pair) {
      order.push(`start:${pair.specPath}`);
      order.push(`end:${pair.specPath}`);
      return { passed: true, attempted: true, issues: [] };
    }
  });

  assert.equal(results.length, 2);
  assert.deepEqual(order, [
    'start:specs/one.md',
    'end:specs/one.md',
    'start:specs/two.md',
    'end:specs/two.md'
  ]);
});

test('reviewer consumes the directory validation result instead of validating the same spec again', () => {
  const result = reviewGeneratedTest({
    specPath: 'specs/already-validated.md',
    testPath: 'tests/smoke/already-validated.spec.ts',
    validation: {
      valid: false,
      issues: ['prevalidated sentinel issue'],
      metadata: {},
      content: ''
    }
  });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /prevalidated sentinel issue/);
});

test('machine verdict marks static review failures as repairable and redacts bounded diagnostics', () => {
  const verdict = classifyGeneratedGateFailure({
    stage: 'static-review',
    issues: [
      'Missing final assertion step.\u0000\tAuthorization: Bearer top-secret-token-1234567890',
      'x'.repeat(2_000)
    ]
  });

  assert.deepEqual(
    {
      schema: verdict.schema,
      passed: verdict.passed,
      stage: verdict.stage,
      reasonCode: verdict.reasonCode,
      repairable: verdict.repairable
    },
    {
      schema: 'generated-gate-verdict/v1',
      passed: false,
      stage: 'static-review',
      reasonCode: 'STATIC_REVIEW_FAILED',
      repairable: true
    }
  );
  assert.equal(verdict.diagnostics.length, 2);
  assert.equal(verdict.diagnostics.every((diagnostic) => diagnostic.length <= 500), true);
  assert.doesNotMatch(verdict.diagnostics.join(''), /[\u0000-\u001f\u007f-\u009f]/);
  assert.doesNotMatch(JSON.stringify(verdict), /top-secret-token/);
});

test('machine verdict does not offer source repair for environment failures', () => {
  const verdict = classifyGeneratedGateFailure({
    stage: 'runtime-environment',
    issues: ['Browser process could not start.']
  });

  assert.equal(verdict.reasonCode, 'RUNTIME_ENVIRONMENT_FAILED');
  assert.equal(verdict.repairable, false);
});

test('pair executor gives every pair isolated report and test-result paths', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'generated-gate-runner-'));
  const artifactPaths = [];
  const commandRunner = (stage) => {
    artifactPaths.push({
      json: stage.env.PLAYWRIGHT_JSON_OUTPUT_NAME,
      html: stage.env.PLAYWRIGHT_HTML_OUTPUT_DIR,
      output: stage.args.find((arg) => arg.startsWith('--output='))?.slice('--output='.length)
    });
    fs.mkdirSync(path.dirname(stage.env.PLAYWRIGHT_JSON_OUTPUT_NAME), { recursive: true });
    fs.writeFileSync(
      stage.env.PLAYWRIGHT_JSON_OUTPUT_NAME,
      JSON.stringify(completePlaywrightReport(stage, {
        suites: [{
          file: stage.testPath,
          specs: [{ file: stage.testPath, tests: [{ status: 'expected' }] }]
        }]
      }))
    );
    return 0;
  };
  const options = {
    runRoot: path.join(workspace, '.ai-runs'),
    packageManager: 'npm',
    projectPlanner: () => [{ project: 'local-chromium', env: {} }],
    commandRunner
  };
  const pairOne = {
    specPath: 'specs/one.md',
    testPath: 'tests/smoke/one.spec.ts',
    validation: directoryFixture().results[0].result
  };
  const pairTwo = {
    specPath: 'specs/two.md',
    testPath: 'tests/smoke/two.spec.ts',
    validation: directoryFixture().results[1].result
  };

  try {
    assert.equal(executeGeneratedPair(pairOne, options).passed, true);
    assert.equal(executeGeneratedPair(pairTwo, options).passed, true);

    assert.equal(artifactPaths.length, 2);
    assert.notEqual(path.dirname(artifactPaths[0].json), path.dirname(artifactPaths[1].json));
    assert.notEqual(artifactPaths[0].html, artifactPaths[1].html);
    assert.notEqual(artifactPaths[0].output, artifactPaths[1].output);
    assert.equal(fs.existsSync(options.runRoot), false, 'green execution must not leave an empty run root');
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('sequential pair planning receives only the explicit environment and fails closed on planning errors', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'generated-gate-sequential-env-'));
  const explicitEnvironment = {
    E2E_AUTH_ENABLED: 'true',
    PLAYWRIGHT_TEST_BASE_URL: 'https://qa.example.test',
    EXPLICIT_ENV_CANARY: 'explicit-only-value'
  };
  const [{ specPath, result: validation }] = directoryFixture().results;
  const pair = {
    specPath,
    testPath: validation.metadata['Target Test File'],
    validation
  };
  let commands = 0;

  try {
    const accepted = executeGeneratedPair(pair, {
      env: explicitEnvironment,
      runRoot: path.join(workspace, '.ai-runs'),
      packageManager: 'npm',
      projectPlanner(_metadata, options) {
        assert.strictEqual(options.env, explicitEnvironment);
        return [{ project: 'local-chromium', env: {} }];
      },
      commandRunner(stage) {
        commands += 1;
        fs.writeFileSync(stage.env.PLAYWRIGHT_JSON_OUTPUT_NAME, JSON.stringify(completePlaywrightReport(stage, {
          suites: [{
            file: stage.testPath,
            specs: [{ file: stage.testPath, tests: [{ status: 'expected' }] }]
          }]
        })));
        return 0;
      }
    });
    assert.equal(accepted.passed, true, accepted.issues.join('\n'));
    assert.equal(commands, 1);

    const rejected = executeGeneratedPair(pair, {
      env: explicitEnvironment,
      runRoot: path.join(workspace, '.ai-runs'),
      projectPlanner(_metadata, options) {
        assert.strictEqual(options.env, explicitEnvironment);
        throw new Error('PRIVATE_PLANNING_CANARY');
      },
      commandRunner() {
        throw new Error('planning failure must not execute Playwright');
      }
    });
    assert.equal(rejected.passed, false);
    assert.equal(rejected.stage, 'runtime-environment');
    assert.doesNotMatch(JSON.stringify(rejected), /PRIVATE_PLANNING_CANARY|explicit-only-value/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('compatible pairs share one three-repeat command and receive independent report verdicts', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'generated-gate-grouped-'));
  const pairs = directoryFixture().results.map(({ specPath, result }) => ({
    specPath,
    testPath: result.metadata['Target Test File'],
    validation: result,
    precomputedReview: { passed: true, issues: [], warnings: [] }
  }));
  const commands = [];
  const globalChecks = {
    passed: true,
    fingerprint: 'a'.repeat(64),
    expectedFingerprint: 'a'.repeat(64)
  };

  try {
    const results = generatedGateRunner.executeGeneratedPairsGrouped(pairs, {
      globalChecks,
      env: { E2E_AUTH_ENABLED: 'false' },
      runRoot: path.join(workspace, '.ai-runs'),
      packageManager: 'npm',
      repeatEach: 3,
      commandRunner(stage) {
        commands.push(stage);
        fs.writeFileSync(stage.env.PLAYWRIGHT_JSON_OUTPUT_NAME, JSON.stringify(completePlaywrightReport(stage, {
          suites: [
            { file: 'smoke/one.spec.ts', specs: [{ file: 'smoke/one.spec.ts', tests: [{ status: 'expected' }] }] },
            { file: 'smoke/two.spec.ts', specs: [{ file: 'smoke/two.spec.ts', tests: [{ status: 'unexpected' }] }] }
          ]
        })));
        return 1;
      }
    });

    assert.equal(commands.length, 1);
    assert.equal(commands[0].args.filter((arg) => arg === 'tests/smoke/one.spec.ts').length, 1);
    assert.equal(commands[0].args.filter((arg) => arg === 'tests/smoke/two.spec.ts').length, 1);
    assert.equal(commands[0].args.filter((arg) => arg === '--repeat-each=3').length, 1);
    assert.equal(commands[0].args.includes('--max-failures=1'), false);
    assert.equal(results[0].passed, true, results[0].execution.issues.join('\n'));
    assert.equal(results[1].passed, false);
    assert.deepEqual(results[0].execution.projects[0].reportVerdict.counts, {
      expected: 3, unexpected: 0, flaky: 0, skipped: 0
    });
    assert.deepEqual(results[1].execution.projects[0].reportVerdict.counts, {
      expected: 0, unexpected: 3, flaky: 0, skipped: 0
    });
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('an abnormal grouped Playwright exit cannot be explained by a sibling report failure', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'generated-gate-abnormal-exit-'));
  const pairs = directoryFixture().results.map(({ specPath, result }) => ({
    specPath,
    testPath: result.metadata['Target Test File'],
    validation: result,
    precomputedReview: { passed: true, issues: [], warnings: [] }
  }));

  try {
    const results = generatedGateRunner.executeGeneratedPairsGrouped(pairs, {
      globalChecks: { passed: true, fingerprint: 'f'.repeat(64), expectedFingerprint: 'f'.repeat(64) },
      env: { E2E_AUTH_ENABLED: 'false' },
      runRoot: path.join(workspace, '.ai-runs'),
      packageManager: 'npm',
      repeatEach: 3,
      commandRunner(stage) {
        fs.writeFileSync(stage.env.PLAYWRIGHT_JSON_OUTPUT_NAME, JSON.stringify(completePlaywrightReport(stage, {
          suites: [
            { file: 'smoke/one.spec.ts', specs: [{ file: 'smoke/one.spec.ts', tests: [{ status: 'expected' }] }] },
            { file: 'smoke/two.spec.ts', specs: [{ file: 'smoke/two.spec.ts', tests: [{ status: 'unexpected' }] }] }
          ]
        })));
        return 137;
      }
    });

    assert.equal(results[0].passed, false);
    assert.equal(results[0].execution.stage, 'runtime-environment');
    assert.match(results[0].execution.issues.join('\n'), /exited 137/);
    assert.equal(results[1].passed, false);
    assert.equal(results[1].execution.stage, 'runtime-environment');
    assert.match(results[1].execution.issues.join('\n'), /exited 137/);
    assert.doesNotMatch(results[1].execution.issues.join('\n'), /unexpected \(failed\)/i);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('top-level Playwright errors fail every grouped lane as runtime environment failures', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'generated-gate-top-level-error-'));
  const pairs = directoryFixture().results.map(({ specPath, result }) => ({
    specPath,
    testPath: result.metadata['Target Test File'],
    validation: result,
    precomputedReview: { passed: true, issues: [], warnings: [] }
  }));

  try {
    const results = generatedGateRunner.executeGeneratedPairsGrouped(pairs, {
      globalChecks: { passed: true, fingerprint: 'f'.repeat(64), expectedFingerprint: 'f'.repeat(64) },
      env: { E2E_AUTH_ENABLED: 'false' },
      runRoot: path.join(workspace, '.ai-runs'),
      packageManager: 'npm',
      repeatEach: 3,
      commandRunner(stage) {
        fs.writeFileSync(stage.env.PLAYWRIGHT_JSON_OUTPUT_NAME, JSON.stringify(completePlaywrightReport(stage, {
          errors: [{ message: 'TOP_LEVEL_SETUP_SECRET' }],
          suites: [
            { file: 'smoke/one.spec.ts', specs: [{ file: 'smoke/one.spec.ts', tests: [{ status: 'expected' }] }] },
            { file: 'smoke/two.spec.ts', specs: [{ file: 'smoke/two.spec.ts', tests: [{ status: 'unexpected' }] }] }
          ]
        })));
        return 1;
      }
    });

    for (const result of results) {
      assert.equal(result.passed, false);
      assert.equal(result.execution.stage, 'runtime-environment');
      assert.match(result.execution.issues.join('\n'), /top-level setup, teardown, or configuration error/i);
      assert.doesNotMatch(result.execution.issues.join('\n'), /TOP_LEVEL_SETUP_SECRET/);
    }
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('grouped execution rejects a mismatched report execution contract without leaking metadata', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'generated-gate-report-contract-'));
  const pairs = directoryFixture().results.map(({ specPath, result }) => ({
    specPath,
    testPath: result.metadata['Target Test File'],
    validation: result,
    precomputedReview: { passed: true, issues: [], warnings: [] }
  }));

  try {
    const results = generatedGateRunner.executeGeneratedPairsGrouped(pairs, {
      globalChecks: { passed: true, fingerprint: 'f'.repeat(64), expectedFingerprint: 'f'.repeat(64) },
      env: { E2E_AUTH_ENABLED: 'false' },
      runRoot: path.join(workspace, '.ai-runs'),
      packageManager: 'npm',
      repeatEach: 3,
      commandRunner(stage) {
        const report = completePlaywrightReport(stage, {
          suites: stage.testPaths.map((testPath) => ({
            file: testPath,
            specs: [{ file: testPath, tests: [{ status: 'expected' }] }]
          }))
        });
        report.config.projects[0].repeatEach = 1;
        report.config.projects[0].metadata = { privateCanary: 'PRIVATE_CONFIG_CANARY' };
        fs.writeFileSync(stage.env.PLAYWRIGHT_JSON_OUTPUT_NAME, JSON.stringify(report));
        return 0;
      }
    });

    for (const result of results) {
      assert.equal(result.passed, false);
      assert.equal(result.execution.stage, 'runtime-environment');
      assert.match(result.execution.issues.join('\n'), /execution contract/i);
    }
    assert.doesNotMatch(JSON.stringify(results), /PRIVATE_CONFIG_CANARY/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('group identity separates project and normalized project environment', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'generated-gate-group-identity-'));
  const fixture = directoryFixture();
  fixture.results.push({
    specPath: 'specs/three.md',
    result: {
      ...fixture.results[0].result,
      metadata: {
        ...fixture.results[0].result.metadata,
        'Flow ID': 'FLOW-THREE',
        'Target Test File': 'tests/smoke/three.spec.ts'
      }
    }
  });
  const pairs = fixture.results.map(({ specPath, result }) => ({
    specPath,
    testPath: result.metadata['Target Test File'],
    validation: result,
    precomputedReview: { passed: true, issues: [], warnings: [] }
  }));
  const commands = [];

  try {
    const results = generatedGateRunner.executeGeneratedPairsGrouped(pairs, {
      globalChecks: { passed: true, fingerprint: 'b'.repeat(64), expectedFingerprint: 'b'.repeat(64) },
      env: { E2E_AUTH_ENABLED: 'false' },
      runRoot: path.join(workspace, '.ai-runs'),
      packageManager: 'npm',
      projectPlanner(metadata) {
        if (metadata['Flow ID'] === 'FLOW-ONE') return [{ project: 'chromium', env: { FEATURE_FLAG: 'one' } }];
        if (metadata['Flow ID'] === 'FLOW-TWO') return [{ project: 'chromium', env: { FEATURE_FLAG: 'two' } }];
        return [{ project: 'webkit', env: { FEATURE_FLAG: 'two' } }];
      },
      commandRunner(stage) {
        commands.push(stage);
        const targets = stage.testPaths;
        fs.writeFileSync(stage.env.PLAYWRIGHT_JSON_OUTPUT_NAME, JSON.stringify(completePlaywrightReport(stage, {
          suites: targets.map((testPath) => ({
            file: testPath,
            specs: [{ file: testPath, tests: [{ status: 'expected' }] }]
          }))
        })));
        return 0;
      }
    });

    assert.equal(results.every((result) => result.passed), true);
    assert.equal(commands.length, 3);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('group identity canonicalizes environment key order without returning environment values', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'generated-gate-env-order-'));
  const pairs = directoryFixture().results.map(({ specPath, result }) => ({
    specPath,
    testPath: result.metadata['Target Test File'],
    validation: result,
    precomputedReview: { passed: true, issues: [], warnings: [] }
  }));
  const commands = [];
  const explicitEnvironment = { E2E_AUTH_ENABLED: 'false', EXPLICIT_ENV_CANARY: 'explicit-only-value' };

  try {
    const results = generatedGateRunner.executeGeneratedPairsGrouped(pairs, {
      globalChecks: { passed: true, fingerprint: 'd'.repeat(64), expectedFingerprint: 'd'.repeat(64) },
      env: explicitEnvironment,
      runRoot: path.join(workspace, '.ai-runs'),
      packageManager: 'npm',
      projectPlanner(metadata, options) {
        assert.strictEqual(options.env, explicitEnvironment, 'the explicit environment must reach planning unchanged');
        return metadata['Flow ID'] === 'FLOW-ONE'
          ? [{ project: 'chromium', env: { Z_FLAG: 'private-value-z', A_FLAG: 'private-value-a' } }]
          : [{ project: 'chromium', env: { A_FLAG: 'private-value-a', Z_FLAG: 'private-value-z' } }];
      },
      commandRunner(stage) {
        commands.push(stage);
        fs.writeFileSync(stage.env.PLAYWRIGHT_JSON_OUTPUT_NAME, JSON.stringify(completePlaywrightReport(stage, {
          suites: stage.testPaths.map((testPath) => ({
            file: testPath,
            specs: [{ file: testPath, tests: [{ status: 'expected' }] }]
          }))
        })));
        return 0;
      }
    });

    assert.equal(commands.length, 1, 'environment insertion order must not split a compatible group');
    assert.equal(results.every((result) => result.passed), true);
    assert.doesNotMatch(JSON.stringify(results), /private-value|explicit-only-value/);
    assert.doesNotMatch(results.flatMap((result) => result.execution.issues).join('\n'), /private-value|explicit-only-value/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('later groups still execute after a command throws and only failed group artifacts remain', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'generated-gate-group-continuation-'));
  const fixture = directoryFixture();
  fixture.results.push({
    specPath: 'specs/three.md',
    result: {
      ...fixture.results[0].result,
      metadata: {
        ...fixture.results[0].result.metadata,
        'Flow ID': 'FLOW-THREE',
        'Target Test File': 'tests/smoke/three.spec.ts'
      }
    }
  });
  const pairs = fixture.results.map(({ specPath, result }) => ({
    specPath,
    testPath: result.metadata['Target Test File'],
    validation: result,
    precomputedReview: { passed: true, issues: [], warnings: [] }
  }));
  const commands = [];

  try {
    const results = generatedGateRunner.executeGeneratedPairsGrouped(pairs, {
      globalChecks: { passed: true, fingerprint: 'e'.repeat(64), expectedFingerprint: 'e'.repeat(64) },
      env: { E2E_AUTH_ENABLED: 'false' },
      runRoot: path.join(workspace, '.ai-runs'),
      packageManager: 'npm',
      projectPlanner(metadata) {
        return [{ project: 'chromium', env: { GROUP: metadata['Flow ID'] } }];
      },
      commandRunner(stage) {
        commands.push(stage);
        if (commands.length === 1) {
          fs.writeFileSync(stage.env.PLAYWRIGHT_JSON_OUTPUT_NAME, JSON.stringify(completePlaywrightReport(stage, {
            suites: stage.testPaths.map((testPath) => ({
              file: testPath,
              specs: [{ file: testPath, tests: [{ status: 'unexpected' }] }]
            }))
          })));
          throw new Error('command failed with private-group-value');
        }
        fs.writeFileSync(stage.env.PLAYWRIGHT_JSON_OUTPUT_NAME, JSON.stringify(completePlaywrightReport(stage, {
          suites: stage.testPaths.map((testPath) => ({
            file: testPath,
            specs: [{ file: testPath, tests: [{ status: 'expected' }] }]
          }))
        })));
        return 0;
      }
    });

    assert.equal(commands.length, 3, 'one failing group must not suppress later groups');
    assert.equal(results[0].passed, false);
    assert.equal(results[0].execution.stage, 'runtime-environment');
    assert.equal(results[1].passed, true);
    assert.equal(results[2].passed, true);
    assert.doesNotMatch(JSON.stringify(results), /private-group-value/);
    const remainingGroups = fs.readdirSync(path.join(workspace, '.ai-runs'));
    assert.equal(remainingGroups.length, 1, 'green group artifact directories must be removed');
    assert.equal(fs.existsSync(results[0].execution.runDir), true);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('grouped execution rejects a symlinked run root before invoking a command', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'generated-gate-symlink-root-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const realRoot = path.join(workspace, 'real-root');
  const runRoot = path.join(workspace, 'linked-root');
  fs.mkdirSync(realRoot);
  fs.symlinkSync(realRoot, runRoot, 'dir');
  const [{ specPath, result: validation }] = directoryFixture().results;
  let commands = 0;

  assert.throws(() => generatedGateRunner.executeGeneratedPairsGrouped([{
    specPath,
    testPath: validation.metadata['Target Test File'],
    validation,
    precomputedReview: { passed: true, issues: [], warnings: [] }
  }], {
    globalChecks: { passed: true, fingerprint: 'f'.repeat(64), expectedFingerprint: 'f'.repeat(64) },
    env: { E2E_AUTH_ENABLED: 'false' },
    runRoot,
    packageManager: 'npm',
    commandRunner() {
      commands += 1;
      return 0;
    }
  }), /run root.*symbolic link/i);
  assert.equal(commands, 0);
});

test('grouped execution rejects a symlinked ancestor of a not-yet-created run root', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'generated-gate-symlink-ancestor-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const realAncestor = path.join(workspace, 'real-ancestor');
  const linkedAncestor = path.join(workspace, 'linked-ancestor');
  fs.mkdirSync(realAncestor);
  fs.symlinkSync(realAncestor, linkedAncestor, 'dir');
  const nestedRunRoot = path.join(linkedAncestor, 'missing', 'nested-runs');
  const [{ specPath, result: validation }] = directoryFixture().results;
  let commands = 0;

  assert.throws(() => generatedGateRunner.executeGeneratedPairsGrouped([{
    specPath,
    testPath: validation.metadata['Target Test File'],
    validation,
    precomputedReview: { passed: true, issues: [], warnings: [] }
  }], {
    globalChecks: { passed: true, fingerprint: '2'.repeat(64), expectedFingerprint: '2'.repeat(64) },
    env: { E2E_AUTH_ENABLED: 'false' },
    runRoot: nestedRunRoot,
    packageManager: 'npm',
    commandRunner() {
      commands += 1;
      return 0;
    }
  }), /run root.*symbolic links/i);
  assert.equal(commands, 0);
  assert.equal(fs.existsSync(path.join(realAncestor, 'missing')), false, 'no descendant may be created through the link');
});

test('grouped execution rejects symlinked and oversized JSON reports without blocking later groups', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'generated-gate-report-safety-'));
  const pairs = directoryFixture().results.map(({ specPath, result }) => ({
    specPath,
    testPath: result.metadata['Target Test File'],
    validation: result,
    precomputedReview: { passed: true, issues: [], warnings: [] }
  }));
  const externalReport = path.join(workspace, 'external-report.json');
  fs.writeFileSync(externalReport, JSON.stringify({ suites: [] }));
  let commands = 0;

  try {
    const results = generatedGateRunner.executeGeneratedPairsGrouped(pairs, {
      globalChecks: { passed: true, fingerprint: '1'.repeat(64), expectedFingerprint: '1'.repeat(64) },
      env: { E2E_AUTH_ENABLED: 'false' },
      runRoot: path.join(workspace, '.ai-runs'),
      packageManager: 'npm',
      maxReportBytes: 64,
      projectPlanner(metadata) {
        return [{ project: 'chromium', env: { GROUP: metadata['Flow ID'] } }];
      },
      commandRunner(stage) {
        commands += 1;
        if (commands === 1) {
          fs.symlinkSync(externalReport, stage.env.PLAYWRIGHT_JSON_OUTPUT_NAME);
        } else {
          fs.writeFileSync(stage.env.PLAYWRIGHT_JSON_OUTPUT_NAME, JSON.stringify({ padding: 'x'.repeat(128), suites: [] }));
        }
        return 0;
      }
    });

    assert.equal(commands, 2);
    assert.equal(results.every((result) => result.passed === false), true);
    assert.match(results[0].execution.issues.join('\n'), /readable JSON report/i);
    assert.match(results[1].execution.issues.join('\n'), /readable JSON report/i);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('multi-project pairs require every lane and malformed reports fail only their group', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'generated-gate-multi-project-'));
  const fixture = directoryFixture();
  const pairs = fixture.results.map(({ specPath, result }) => ({
    specPath,
    testPath: result.metadata['Target Test File'],
    validation: result,
    precomputedReview: { passed: true, issues: [], warnings: [] }
  }));

  try {
    const results = generatedGateRunner.executeGeneratedPairsGrouped(pairs, {
      globalChecks: { passed: true, fingerprint: 'c'.repeat(64), expectedFingerprint: 'c'.repeat(64) },
      env: { E2E_AUTH_ENABLED: 'false' },
      runRoot: path.join(workspace, '.ai-runs'),
      packageManager: 'npm',
      projectPlanner(metadata) {
        return metadata['Flow ID'] === 'FLOW-ONE'
          ? [{ project: 'chromium', env: {} }, { project: 'webkit', env: {} }]
          : [{ project: 'firefox', env: {} }];
      },
      commandRunner(stage) {
        if (stage.project === 'firefox') {
          fs.writeFileSync(stage.env.PLAYWRIGHT_JSON_OUTPUT_NAME, '{broken');
          return 0;
        }
        const status = stage.project === 'webkit' ? 'skipped' : 'expected';
        fs.writeFileSync(stage.env.PLAYWRIGHT_JSON_OUTPUT_NAME, JSON.stringify(completePlaywrightReport(stage, {
          suites: stage.testPaths.map((testPath) => ({
            file: testPath,
            specs: [{ file: testPath, tests: [{ status }] }]
          }))
        })));
        return 0;
      }
    });

    assert.equal(results[0].passed, false, 'one rejected project must reject the pair');
    assert.equal(results[0].execution.projects.length, 2);
    assert.equal(results[1].passed, false);
    assert.match(results[1].execution.issues.join('\n'), /readable JSON report/i);
    assert.equal(fs.existsSync(results[1].execution.runDir), true, 'failed group artifacts must be preserved');
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('global-check receipt changes when a TypeScript target changes', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'generated-gate-fingerprint-'));
  const sourceDir = path.join(workspace, 'tests', 'smoke');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(path.join(workspace, 'package.json'), '{"private":true}\n');
  fs.writeFileSync(
    path.join(workspace, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { noEmit: true }, include: ['tests/**/*.ts'] })
  );
  fs.writeFileSync(path.join(workspace, 'playwright.config.ts'), 'export default {};\n');
  const targetPath = path.join(sourceDir, 'generated.spec.ts');
  fs.writeFileSync(targetPath, "export const state = 'before';\n");
  const result = {
    valid: true,
    issues: [],
    results: [{
      specPath: path.join(workspace, 'specs', 'flow.md'),
      result: {
        valid: true,
        content: '# flow',
        metadata: { 'Target Test File': targetPath }
      }
    }]
  };

  try {
    const before = computeGlobalChecksFingerprint(path.join(workspace, 'specs'), result, workspace);
    fs.writeFileSync(targetPath, "export const state = 'after';\n");
    const after = computeGlobalChecksFingerprint(path.join(workspace, 'specs'), result, workspace);

    assert.notEqual(after, before);
    assert.deepEqual(
      verifyGlobalChecksReceipt({
        expectedFingerprint: before,
        specDir: path.join(workspace, 'specs'),
        directoryResult: result,
        rootDir: workspace
      }),
      {
        valid: false,
        currentFingerprint: after,
        issue: 'The supplied global-check fingerprint does not match the current specs/configuration/TypeScript inputs.'
      }
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('pair executor fails closed when no Playwright project is selected', () => {
  const pair = {
    specPath: 'specs/one.md',
    testPath: 'tests/smoke/one.spec.ts',
    validation: directoryFixture().results[0].result
  };
  const result = executeGeneratedPair(pair, { projectPlanner: () => [] });

  assert.equal(result.passed, false);
  assert.equal(result.attempted, false);
  assert.equal(result.stage, 'runtime-environment');
  assert.match(result.issues.join('\n'), /no Playwright project/i);
});
