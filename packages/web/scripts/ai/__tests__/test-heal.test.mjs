import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  DEFAULT_AUTOHEAL_MAX_ATTEMPTS,
  DEFAULT_AUTOHEAL_VERIFY_RUNS,
  MAX_HEAL_EVIDENCE_ITEMS,
  analyzeHealSource,
  autoHealEnabled,
  autoHealMaxAttempts,
  autoHealSourceByteLimit,
  autoHealVerifyRuns,
  buildTestHealPrompt,
  extractRuntimeFailureEvidence,
  healTestSource,
  redactKnownSecretValues,
  verifyHealedSourcePolicy
} from '../lib/test-heal.mjs';
import { healCandidatePath, healSingleTest, inferStandaloneProject, parseArgs } from '../heal-test.mjs';

const PASSING_TYPECHECK = () => ({ passed: true, issues: [] });

const CLEAN_SOURCE = `/* spec: specs/flow.md version:1.0.0 sha256:abc123 */
import { test, expect } from '../../fixtures/test';

test('flow works', async ({ page }) => {
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('status')).toHaveText('Saved');
});
`;

function syntheticReport({ message = 'locator timeout', status = 'failed' } = {}) {
  return {
    suites: [
      {
        file: 'tests/regression/flow.spec.ts',
        specs: [
          {
            title: 'flow works',
            file: 'tests/regression/flow.spec.ts',
            tests: [
              {
                projectName: 'chromium',
                status: 'unexpected',
                results: [
                  { status, retry: 0, error: { message } },
                  { status: 'passed', retry: 0 }
                ]
              }
            ]
          }
        ]
      }
    ]
  };
}

test('auto-heal is disabled by default and every knob validates strictly', () => {
  assert.equal(autoHealEnabled({}), false);
  assert.equal(autoHealEnabled({ AI_AUTOHEAL_ENABLED: 'true' }), true);
  assert.throws(() => autoHealEnabled({ AI_AUTOHEAL_ENABLED: 'maybe' }), /true or false/);

  assert.equal(autoHealMaxAttempts({}), DEFAULT_AUTOHEAL_MAX_ATTEMPTS);
  assert.equal(autoHealMaxAttempts({ AI_AUTOHEAL_MAX_ATTEMPTS: '5' }), 5);
  assert.throws(() => autoHealMaxAttempts({ AI_AUTOHEAL_MAX_ATTEMPTS: '0' }), /whole number/);
  assert.throws(() => autoHealMaxAttempts({ AI_AUTOHEAL_MAX_ATTEMPTS: '11' }), /whole number/);
  assert.throws(() => autoHealMaxAttempts({ AI_AUTOHEAL_MAX_ATTEMPTS: 'three' }), /whole number/);

  assert.equal(autoHealVerifyRuns({}), DEFAULT_AUTOHEAL_VERIFY_RUNS);
  assert.equal(autoHealVerifyRuns({ AI_AUTOHEAL_VERIFY_RUNS: '3' }), 3);
  assert.throws(() => autoHealVerifyRuns({ AI_AUTOHEAL_VERIFY_RUNS: '1' }), /whole number/);
  assert.throws(() => autoHealVerifyRuns({ AI_AUTOHEAL_VERIFY_RUNS: '4' }), /whole number/);

  assert.equal(autoHealSourceByteLimit({}), 128 * 1024);
  assert.throws(() => autoHealSourceByteLimit({ AI_AUTOHEAL_MAX_SOURCE_BYTES: '64kb' }), /whole number/);
});

test('evidence extraction keeps failing results only, strips ANSI, redacts secrets, and stays bounded', () => {
  const report = syntheticReport({
    message: '\u001b[31mTimed out\u001b[39m waiting for getByTestId(\'save\') Authorization: Bearer abcdefghijklmnop'
  });
  const evidence = extractRuntimeFailureEvidence(report, 'tests/regression/flow.spec.ts');
  assert.equal(evidence.length, 1);
  assert.match(evidence[0], /flow works: Timed out waiting/);
  assert.doesNotMatch(evidence[0], /\u001b/);
  assert.doesNotMatch(evidence[0], /abcdefghijklmnop/);

  const otherFile = extractRuntimeFailureEvidence(report, 'tests/regression/other.spec.ts');
  assert.equal(otherFile.length, 0);

  const many = {
    suites: Array.from({ length: 20 }, (_, index) => ({
      file: 'tests/regression/flow.spec.ts',
      specs: [{
        title: `case ${index}`,
        file: 'tests/regression/flow.spec.ts',
        tests: [{ results: [{ status: 'failed', error: { message: `boom ${index}` } }] }]
      }]
    }))
  };
  assert.equal(
    extractRuntimeFailureEvidence(many, 'tests/regression/flow.spec.ts').length,
    MAX_HEAL_EVIDENCE_ITEMS
  );
});

test('policy guard accepts a clean locator heal', () => {
  const healed = CLEAN_SOURCE.replace("getByRole('button', { name: 'Save' })", "getByTestId('save-button')");
  const verdict = verifyHealedSourcePolicy({ previousSource: CLEAN_SOURCE, healedSource: healed });
  assert.deepEqual(verdict, { passed: true, issues: [], issueCodes: [] });
});

test('policy guard rejects masked or weakened heals', () => {
  const cases = [
    ['empty output', '', /empty/i],
    ['dropped spec header', CLEAN_SOURCE.replace(/\/\* spec:[\s\S]*?\*\/\n/, ''), /traceability header/],
    ['added test.skip', CLEAN_SOURCE.replace("test('flow works'", "test.skip('flow works'"), /test\.skip/],
    ['added waitForTimeout', CLEAN_SOURCE.replace('.click();', '.click();\n  await page.waitForTimeout(5000);'), /waitForTimeout/],
    ['introduced xpath', CLEAN_SOURCE.replace("page.getByTestId('status')", "page.locator('//div[2]')"), /XPath/],
    ['introduced nth-child', CLEAN_SOURCE.replace("getByTestId('status')", "locator('li:nth-child(3)')"), /nth-child/],
    ['removed assertion', CLEAN_SOURCE.replace(/ {2}await expect\([\s\S]*?\n/, ''), /removes assertions/]
  ];
  for (const [label, healedSource, pattern] of cases) {
    const verdict = verifyHealedSourcePolicy({ previousSource: CLEAN_SOURCE, healedSource });
    assert.equal(verdict.passed, false, label);
    assert.match(verdict.issues.join(' '), pattern, label);
  }
});

test('policy guard requires locator-policy exceptions for new positional picks and blocks secrets', () => {
  const unjustified = CLEAN_SOURCE.replace("getByTestId('status')", "getByRole('listitem').first()");
  assert.equal(verifyHealedSourcePolicy({ previousSource: CLEAN_SOURCE, healedSource: unjustified }).passed, false);

  const justified = CLEAN_SOURCE.replace(
    "await expect(page.getByTestId('status')).toHaveText('Saved');",
    "// locator-policy:exception fixture renders one status item\n  await expect(page.getByRole('listitem').first()).toHaveText('Saved');"
  );
  assert.equal(verifyHealedSourcePolicy({ previousSource: CLEAN_SOURCE, healedSource: justified }).passed, true);

  const secretBearing = CLEAN_SOURCE.replace("'Saved'", "'ghp_abcdefghijklmnopqrstuvwxyz123456'");
  const verdict = verifyHealedSourcePolicy({ previousSource: CLEAN_SOURCE, healedSource: secretBearing });
  assert.equal(verdict.passed, false);
  assert.match(verdict.issues.join(' '), /secret-like/);
});

test('heal prompt is bounded, redacted, and refuses unusable input', () => {
  const prompt = buildTestHealPrompt({
    testPath: 'tests/regression/flow.spec.ts',
    source: CLEAN_SOURCE,
    evidence: ['flow works: locator timeout password=super-secret-value'],
    notes: ['attempt 1 still failed'],
    attempt: 2,
    maxAttempts: 3,
    env: {}
  });
  const parsed = JSON.parse(prompt);
  assert.equal(parsed.schemaVersion, 'playwright-test-heal/v1');
  assert.equal(parsed.currentTypeScriptSource, CLEAN_SOURCE);
  assert.equal(parsed.attempt, 2);
  assert.doesNotMatch(prompt, /super-secret-value/);

  assert.throws(
    () => buildTestHealPrompt({ source: CLEAN_SOURCE, evidence: [], attempt: 1, maxAttempts: 3, env: {} }),
    /failure evidence/
  );
  assert.throws(
    () => buildTestHealPrompt({ source: '', evidence: ['x'], attempt: 1, maxAttempts: 3, env: {} }),
    /non-empty/
  );
  assert.throws(
    () => buildTestHealPrompt({
      source: 'const password = "super secret value";',
      evidence: ['x'],
      attempt: 1,
      maxAttempts: 3,
      env: {}
    }),
    /secret-bearing/
  );
  assert.throws(
    () => buildTestHealPrompt({
      source: `// ${'x'.repeat(200 * 1024)}`,
      evidence: ['x'],
      attempt: 1,
      maxAttempts: 3,
      env: {}
    }),
    /AI_AUTOHEAL_MAX_SOURCE_BYTES/
  );
});

test('healTestSource requires the opt-in flag and routes through the heal stage', async () => {
  await assert.rejects(
    healTestSource({ testPath: 't.spec.ts', source: CLEAN_SOURCE, evidence: ['e'], attempt: 1, maxAttempts: 3, env: {} }),
    /disabled/
  );

  const calls = [];
  const healed = await healTestSource({
    testPath: 'tests/regression/flow.spec.ts',
    source: CLEAN_SOURCE,
    evidence: ['flow works: locator timeout'],
    attempt: 1,
    maxAttempts: 3,
    env: { AI_AUTOHEAL_ENABLED: 'true' },
    runBrainImpl: async (prompt, options) => {
      calls.push({ prompt, options });
      return { text: '```typescript\nconst healed = true;\n```', brain: { kind: 'openai', model: 'heal-model' } };
    }
  });
  assert.equal(healed.code, 'const healed = true;');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.stage, 'heal');
  assert.equal(calls[0].options.outputKind, 'playwright-typescript');
  assert.equal(calls[0].options.env.AI_COMPACT_REST_PROMPT, 'false');
});

test('CLI arg parsing and standalone project inference', () => {
  const args = parseArgs(['--test', 'tests/a.spec.ts', '--test', 'tests/b.spec.ts', '--max-attempts', '4']);
  assert.deepEqual(args.tests, ['tests/a.spec.ts', 'tests/b.spec.ts']);
  assert.equal(args.maxAttempts, '4');
  assert.throws(() => parseArgs(['--spec', 's.md']), /exactly one --test/);
  assert.throws(() => parseArgs(['--bogus']), /Unknown flag/);
  assert.throws(() => parseArgs(['--test']), /requires a value/);

  assert.equal(inferStandaloneProject('tests/smoke/foo.spec.ts'), 'local-chromium');
  assert.equal(inferStandaloneProject('tests/recorded/foo.spec.ts'), 'local-chromium');
  assert.equal(inferStandaloneProject('tests/regression/foo.authenticated.spec.ts'), 'chromium-auth');
  assert.equal(inferStandaloneProject('tests/regression/foo.spec.ts'), 'chromium');

  const candidate = healCandidatePath('/web/tests/regression/foo.spec.ts', 'run-a1');
  assert.equal(candidate, '/web/tests/regression/.foo.heal-run-a1.candidate.spec.ts');
  const authCandidate = healCandidatePath('/web/tests/regression/foo.authenticated.spec.ts', 'run-a1');
  assert.equal(authCandidate, '/web/tests/regression/.foo.heal-run-a1.candidate.authenticated.spec.ts');
});

function makeHealWorkspace() {
  const webRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'heal-test-'));
  const testDir = path.join(webRoot, 'tests', 'regression');
  fs.mkdirSync(testDir, { recursive: true });
  const targetPath = path.join(testDir, 'flow.spec.ts');
  fs.writeFileSync(targetPath, CLEAN_SOURCE, { mode: 0o644 });
  return { webRoot, targetPath, target: 'tests/regression/flow.spec.ts' };
}

function executionSequence(results) {
  const queue = [...results];
  const calls = [];
  const run = (options) => {
    calls.push(options);
    if (queue.length === 0) throw new Error('Unexpected extra verification run.');
    return queue.shift();
  };
  return { run, calls };
}

const PASSED_EXECUTION = { passed: true, attempted: true, stage: 'accepted', issues: [], artifacts: [] };
const FAILED_EXECUTION = {
  passed: false,
  attempted: true,
  stage: 'runtime-test',
  issues: ['Playwright JSON report shows 1 unexpected (failed) test(s).'],
  artifacts: []
};
const ENV_EXECUTION = {
  passed: false,
  attempted: false,
  stage: 'runtime-environment',
  issues: ['Playwright did not produce a readable JSON report.'],
  artifacts: []
};

test('healSingleTest refuses to run without the opt-in flag', async () => {
  const { webRoot, target } = makeHealWorkspace();
  await assert.rejects(
    healSingleTest({ testPath: target, env: {}, webRoot, discoverSpec: () => null }),
    /AI_AUTOHEAL_ENABLED=true/
  );
});

test('healSingleTest reports already-green without invoking the brain', async () => {
  const { webRoot, target, targetPath } = makeHealWorkspace();
  const { run } = executionSequence([PASSED_EXECUTION]);
  let healCalls = 0;
  const result = await healSingleTest({
    testPath: target,
    env: { AI_AUTOHEAL_ENABLED: 'true' },
    webRoot,
    log: () => {},
    discoverSpec: () => null,
    typecheck: PASSING_TYPECHECK,
    executeStandalone: run,
    heal: async () => {
      healCalls += 1;
      return { code: CLEAN_SOURCE };
    }
  });
  assert.equal(result.status, 'already-green');
  assert.equal(result.attemptsUsed, 0);
  assert.equal(healCalls, 0);
  assert.equal(fs.readFileSync(targetPath, 'utf8'), CLEAN_SOURCE);
});

test('healSingleTest aborts on baseline environment failures instead of masking them', async () => {
  const { webRoot, target } = makeHealWorkspace();
  const { run } = executionSequence([ENV_EXECUTION]);
  let healCalls = 0;
  const result = await healSingleTest({
    testPath: target,
    env: { AI_AUTOHEAL_ENABLED: 'true' },
    webRoot,
    log: () => {},
    discoverSpec: () => null,
    typecheck: PASSING_TYPECHECK,
    executeStandalone: run,
    heal: async () => {
      healCalls += 1;
      return { code: CLEAN_SOURCE };
    }
  });
  assert.equal(result.status, 'environment-failure');
  assert.equal(healCalls, 0);
});

test('healSingleTest heals on a later attempt, promotes atomically, and archives evidence', async () => {
  const { webRoot, target, targetPath } = makeHealWorkspace();
  const healedSource = CLEAN_SOURCE.replace("getByRole('button', { name: 'Save' })", "getByTestId('save-button')");
  const secondHealedSource = healedSource.replace("getByTestId('status')", "getByTestId('save-status')");
  // baseline fails, attempt 1 candidate fails, attempt 2 candidate passes twice.
  const { run, calls } = executionSequence([FAILED_EXECUTION, FAILED_EXECUTION, PASSED_EXECUTION]);
  const healInputs = [];
  const result = await healSingleTest({
    testPath: target,
    env: { AI_AUTOHEAL_ENABLED: 'true' },
    webRoot,
    log: () => {},
    discoverSpec: () => null,
    typecheck: PASSING_TYPECHECK,
    executeStandalone: run,
    heal: async (input) => {
      healInputs.push(input);
      return { code: input.attempt === 1 ? healedSource : secondHealedSource };
    }
  });

  assert.equal(result.status, 'healed');
  assert.equal(result.attemptsUsed, 2);
  assert.equal(fs.readFileSync(targetPath, 'utf8'), secondHealedSource);
  assert.equal(fs.readFileSync(result.backupPath, 'utf8'), CLEAN_SOURCE);
  assert.equal((fs.statSync(targetPath).mode & 0o777), 0o644);

  // Attempt 2 healed from attempt 1's source with fresh notes.
  assert.equal(healInputs.length, 2);
  assert.equal(healInputs[0].source, CLEAN_SOURCE);
  assert.equal(healInputs[1].source, healedSource);
  assert.match(healInputs[1].notes.join(' '), /still failed/);

  // Candidate runs used hidden candidate paths; no candidate remains on disk.
  assert.equal(calls.length, 3);
  assert.match(calls[1].testPath, /\.candidate\.spec\.ts$/);
  const leftovers = fs.readdirSync(path.dirname(targetPath)).filter((name) => name.includes('candidate'));
  assert.deepEqual(leftovers, []);

  const summaryPath = path.join(result.archiveDir, 'heal-summary.json');
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  assert.equal(summary.status, 'healed');
  assert.equal(summary.attemptsUsed, 2);
});

test('healSingleTest consumes attempts on policy-rejected candidates and leaves the original untouched', async () => {
  const { webRoot, target, targetPath } = makeHealWorkspace();
  const { run } = executionSequence([FAILED_EXECUTION]);
  const skipSource = CLEAN_SOURCE.replace("test('flow works'", "test.skip('flow works'");
  const notesSeen = [];
  const result = await healSingleTest({
    testPath: target,
    env: { AI_AUTOHEAL_ENABLED: 'true' },
    webRoot,
    maxAttempts: 2,
    log: () => {},
    discoverSpec: () => null,
    typecheck: PASSING_TYPECHECK,
    executeStandalone: run,
    heal: async (input) => {
      notesSeen.push(input.notes);
      return { code: skipSource };
    }
  });
  assert.equal(result.status, 'exhausted');
  assert.equal(result.attemptsUsed, 2);
  assert.equal(fs.readFileSync(targetPath, 'utf8'), CLEAN_SOURCE);
  assert.match(notesSeen[1].join(' '), /test\.skip/);
});

test('healSingleTest preserves a concurrent manual edit instead of overwriting it', async () => {
  const { webRoot, target, targetPath } = makeHealWorkspace();
  const healedSource = CLEAN_SOURCE.replace("getByRole('button', { name: 'Save' })", "getByTestId('save-button')");
  const manualEdit = `${CLEAN_SOURCE}\n// manual concurrent edit\n`;
  const { run } = executionSequence([
    FAILED_EXECUTION,
    { ...PASSED_EXECUTION }
  ]);
  const result = await healSingleTest({
    testPath: target,
    env: { AI_AUTOHEAL_ENABLED: 'true' },
    webRoot,
    log: () => {},
    discoverSpec: () => null,
    typecheck: PASSING_TYPECHECK,
    executeStandalone: (options) => {
      const outcome = run(options);
      if (outcome.passed) fs.writeFileSync(targetPath, manualEdit);
      return outcome;
    },
    heal: async () => ({ code: healedSource })
  });
  assert.equal(result.status, 'aborted-concurrent-edit');
  assert.equal(fs.readFileSync(targetPath, 'utf8'), manualEdit);
});

test('healSingleTest runs spec-bound static review before spending a verification run', async () => {
  const { webRoot, target, targetPath } = makeHealWorkspace();
  const healedSource = CLEAN_SOURCE.replace("getByRole('button', { name: 'Save' })", "getByTestId('save-button')");
  const { run, calls } = executionSequence([FAILED_EXECUTION, PASSED_EXECUTION]);
  const reviews = [];
  const result = await healSingleTest({
    testPath: target,
    env: { AI_AUTOHEAL_ENABLED: 'true' },
    webRoot,
    log: () => {},
    discoverSpec: () => ({ specPath: 'specs/flow.md', validation: { metadata: { 'Target Test File': target } } }),
    typecheck: PASSING_TYPECHECK,
    executePair: (pair, options) => {
      assert.equal(pair.specPath, 'specs/flow.md');
      assert.equal(options.repeatEach, 2);
      return run(pair);
    },
    reviewer: (input) => {
      reviews.push(input);
      return { passed: true, issues: [] };
    },
    heal: async () => ({ code: healedSource })
  });
  assert.equal(result.status, 'healed');
  assert.equal(fs.readFileSync(targetPath, 'utf8'), healedSource);
  assert.equal(reviews.length, 1);
  assert.match(reviews[0].testPath, /\.candidate\.spec\.ts$/);
  assert.equal(calls.length, 2);
});

test('AST guard defeats comment/string smuggling and structural assertion masking', () => {
  // Regex counting would accept a commented-out assertion; the AST does not.
  const commentSmuggled = CLEAN_SOURCE.replace(
    "  await expect(page.getByTestId('status')).toHaveText('Saved');\n",
    "  // await expect(page.getByTestId('status')).toHaveText('Saved');\n"
  );
  const commentVerdict = verifyHealedSourcePolicy({ previousSource: CLEAN_SOURCE, healedSource: commentSmuggled });
  assert.equal(commentVerdict.passed, false);
  assert.match(commentVerdict.issues.join(' '), /removes assertions/);

  const tryWrapped = CLEAN_SOURCE.replace(
    "  await expect(page.getByTestId('status')).toHaveText('Saved');\n",
    "  try {\n    await expect(page.getByTestId('status')).toHaveText('Saved');\n  } catch {}\n"
  );
  const tryVerdict = verifyHealedSourcePolicy({ previousSource: CLEAN_SOURCE, healedSource: tryWrapped });
  assert.equal(tryVerdict.passed, false);
  assert.match(tryVerdict.issues.join(' '), /try\/catch/);

  const conditional = CLEAN_SOURCE.replace(
    "  await expect(page.getByTestId('status')).toHaveText('Saved');\n",
    "  if (await page.getByTestId('status').isVisible()) {\n    await expect(page.getByTestId('status')).toHaveText('Saved');\n  }\n"
  );
  const conditionalVerdict = verifyHealedSourcePolicy({ previousSource: CLEAN_SOURCE, healedSource: conditional });
  assert.equal(conditionalVerdict.passed, false);
  assert.match(conditionalVerdict.issues.join(' '), /behind conditions/);

  const downgraded = CLEAN_SOURCE.replace(".toHaveText('Saved')", '.toBeVisible()');
  const downgradeVerdict = verifyHealedSourcePolicy({ previousSource: CLEAN_SOURCE, healedSource: downgraded });
  assert.equal(downgradeVerdict.passed, false);
  assert.match(downgradeVerdict.issues.join(' '), /downgrades or drops assertion matcher "toHaveText"/);

  const bracketSkip = CLEAN_SOURCE.replace("test('flow works'", "test['skip']('flow works'");
  const bracketVerdict = verifyHealedSourcePolicy({ previousSource: CLEAN_SOURCE, healedSource: bracketSkip });
  assert.equal(bracketVerdict.passed, false);
  assert.match(bracketVerdict.issues.join(' '), /any form/);

  const dynamicSkip = `${CLEAN_SOURCE}\nconst mode = 'sk' + 'ip';\ntest[mode]('later', async () => {});\n`;
  const dynamicVerdict = verifyHealedSourcePolicy({ previousSource: CLEAN_SOURCE, healedSource: dynamicSkip });
  assert.equal(dynamicVerdict.passed, false);
  assert.match(dynamicVerdict.issues.join(' '), /dynamic keys/);

  const unparsable = CLEAN_SOURCE.replace('});', '});)');
  const parseVerdict = verifyHealedSourcePolicy({ previousSource: CLEAN_SOURCE, healedSource: unparsable });
  assert.equal(parseVerdict.passed, false);
  assert.match(parseVerdict.issues.join(' '), /does not parse/);
});

test('analyzeHealSource counts structural facts from the AST, not raw text', () => {
  const analysis = analyzeHealSource(CLEAN_SOURCE);
  assert.equal(analysis.expectCount, 1);
  assert.equal(analysis.matcherCounts.get('toHaveText'), 1);
  assert.equal(analysis.tryStatementCount, 0);
  assert.equal(analysis.skipFamilyCount, 0);

  const commented = '// test.skip and expect(x).toBe(1) inside a comment\nconst a = 1;\n';
  const commentedAnalysis = analyzeHealSource(commented);
  assert.equal(commentedAnalysis.expectCount, 0);
  assert.equal(commentedAnalysis.skipFamilyCount, 0);
});

test('known secret values are removed from evidence by value, not just by shape', () => {
  assert.equal(
    redactKnownSecretValues('login failed for hunter2-pass on submit', ['hunter2-pass']),
    'login failed for <redacted> on submit'
  );
  const report = syntheticReport({ message: 'fill failed with value hunter2-pass' });
  const evidence = extractRuntimeFailureEvidence(report, 'tests/regression/flow.spec.ts', {
    secretValues: ['hunter2-pass']
  });
  assert.match(evidence[0], /<redacted>/);
  assert.doesNotMatch(evidence[0], /hunter2-pass/);
});

test('healSingleTest canonicalizes absolute --test paths to repo-relative targets', async () => {
  const { webRoot, targetPath, target } = makeHealWorkspace();
  const seenTargets = [];
  const result = await healSingleTest({
    testPath: targetPath,
    env: { AI_AUTOHEAL_ENABLED: 'true' },
    webRoot,
    log: () => {},
    discoverSpec: (candidateTarget) => {
      seenTargets.push(candidateTarget);
      return null;
    },
    typecheck: PASSING_TYPECHECK,
    executeStandalone: (options) => {
      seenTargets.push(options.testPath);
      return PASSED_EXECUTION;
    }
  });
  assert.equal(result.status, 'already-green');
  assert.deepEqual(seenTargets, [target, target]);
});

test('healSingleTest rejects --spec bindings whose Target Test File does not match --test', async () => {
  const { webRoot, target } = makeHealWorkspace();
  const validateDirectory = () => ({
    valid: true,
    results: [{
      specPath: 'specs/other.md',
      result: { metadata: { 'Target Test File': 'tests/regression/other.spec.ts' } }
    }]
  });
  await assert.rejects(
    healSingleTest({
      testPath: target,
      specPath: 'specs/other.md',
      env: { AI_AUTOHEAL_ENABLED: 'true' },
      webRoot,
      log: () => {},
      validateDirectory
    }),
    /does not match --test/
  );
});

test('healSingleTest consumes attempts on typecheck-rejected candidates and forwards diagnostics', async () => {
  const { webRoot, target, targetPath } = makeHealWorkspace();
  const healedSource = CLEAN_SOURCE.replace("getByRole('button', { name: 'Save' })", "getByTestId('save-button')");
  const { run } = executionSequence([FAILED_EXECUTION]);
  const notesSeen = [];
  const result = await healSingleTest({
    testPath: target,
    env: { AI_AUTOHEAL_ENABLED: 'true' },
    webRoot,
    maxAttempts: 2,
    log: () => {},
    discoverSpec: () => null,
    typecheck: () => ({ passed: false, issues: ['TS2304 at 5:9: Cannot find name saveButton.'] }),
    executeStandalone: run,
    heal: async (input) => {
      notesSeen.push(input.notes);
      return { code: healedSource };
    }
  });
  assert.equal(result.status, 'exhausted');
  assert.equal(result.attemptsUsed, 2);
  assert.equal(fs.readFileSync(targetPath, 'utf8'), CLEAN_SOURCE);
  assert.match(notesSeen[1].join(' '), /TS2304/);
  const leftovers = fs.readdirSync(path.dirname(targetPath)).filter((name) => name.includes('candidate'));
  assert.deepEqual(leftovers, []);
});

test('healSingleTest ratchets policy against the ORIGINAL source across attempts', async () => {
  const { webRoot, target } = makeHealWorkspace();
  // Attempt 1 justifies a positional pick; attempt 2 keeps the pick but drops
  // the justification. Compared against the original, attempt 2 must fail.
  const justified = CLEAN_SOURCE.replace(
    "await expect(page.getByTestId('status')).toHaveText('Saved');",
    "// locator-policy:exception fixture renders one status item\n  await expect(page.getByRole('listitem').first()).toHaveText('Saved');"
  );
  const unjustified = CLEAN_SOURCE.replace(
    "await expect(page.getByTestId('status')).toHaveText('Saved');",
    "await expect(page.getByRole('listitem').first()).toHaveText('Saved');"
  );
  const { run } = executionSequence([FAILED_EXECUTION, FAILED_EXECUTION]);
  const result = await healSingleTest({
    testPath: target,
    env: { AI_AUTOHEAL_ENABLED: 'true' },
    webRoot,
    maxAttempts: 2,
    log: () => {},
    discoverSpec: () => null,
    typecheck: PASSING_TYPECHECK,
    executeStandalone: run,
    heal: async (input) => ({ code: input.attempt === 1 ? justified : unjustified })
  });
  assert.equal(result.status, 'exhausted');
  assert.deepEqual(
    result.attemptTrail.map((entry) => entry.outcome),
    ['still-failing', 'policy-rejected']
  );
});

test('healSingleTest sweeps stale crash-orphaned candidates before running', async () => {
  const { webRoot, target, targetPath } = makeHealWorkspace();
  const stale = path.join(path.dirname(targetPath), '.flow.heal-stale.candidate.spec.ts');
  fs.writeFileSync(stale, 'stale');
  const { run } = executionSequence([PASSED_EXECUTION]);
  await healSingleTest({
    testPath: target,
    env: { AI_AUTOHEAL_ENABLED: 'true' },
    webRoot,
    log: () => {},
    discoverSpec: () => null,
    typecheck: PASSING_TYPECHECK,
    executeStandalone: run
  });
  assert.equal(fs.existsSync(stale), false);
});
