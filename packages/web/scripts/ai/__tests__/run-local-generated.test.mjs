import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectLocalGeneratedPlan,
  runLocalGeneratedGate
} from '../run-local-generated.mjs';

function validation(metadata) {
  return {
    valid: true,
    issues: [],
    content: '# fixture',
    metadata: {
      'Test Type': 'smoke',
      'Generation Status': 'generated',
      Auth: 'none',
      ...metadata
    }
  };
}

function directoryFixture() {
  return {
    valid: true,
    issues: [],
    results: [
      {
        specPath: 'specs/local.md',
        result: validation({ 'Target Test File': 'tests/smoke/local.spec.ts' })
      },
      {
        specPath: 'specs/pending.md',
        result: validation({
          'Generation Status': 'pending-generation',
          'Target Test File': 'tests/smoke/pending.spec.ts'
        })
      },
      {
        specPath: 'specs/auth.md',
        result: validation({
          Auth: 'required',
          'Target Test File': 'tests/regression/auth.authenticated.spec.ts'
        })
      },
      {
        specPath: 'specs/external.md',
        result: validation({
          'Test Type': 'regression',
          'Target Test File': 'tests/regression/external.spec.ts'
        })
      }
    ]
  };
}

test('local generated lane selects only delivered unauthenticated local-fixture pairs', () => {
  const plan = collectLocalGeneratedPlan({
    directoryResult: directoryFixture(),
    fileExists: () => true
  });

  assert.deepEqual(
    plan.selected.map(({ specPath, testPath, projects }) => ({ specPath, testPath, projects })),
    [{
      specPath: 'specs/local.md',
      testPath: 'tests/smoke/local.spec.ts',
      projects: ['local-chromium']
    }]
  );
  assert.deepEqual(
    plan.excluded.map(({ specPath, reason }) => ({ specPath, reason })),
    [
      { specPath: 'specs/pending.md', reason: 'pending-generation' },
      { specPath: 'specs/auth.md', reason: 'auth-required' },
      { specPath: 'specs/external.md', reason: 'external-or-unsupported' }
    ]
  );
  assert.deepEqual(plan.issues, []);
});

test('local generated lane rejects target paths that escape a local suite through traversal', () => {
  const directoryResult = {
    valid: true,
    issues: [],
    results: [{
      specPath: 'specs/traversal.md',
      result: validation({
        'Target Test File': 'tests/smoke/../regression/external.spec.ts'
      })
    }]
  };
  let fileChecks = 0;

  const plan = collectLocalGeneratedPlan({
    directoryResult,
    fileExists() {
      fileChecks += 1;
      return true;
    }
  });

  assert.deepEqual(plan.selected, []);
  assert.deepEqual(plan.excluded, [{
    specPath: 'specs/traversal.md',
    testPath: 'tests/smoke/../regression/external.spec.ts',
    reason: 'external-or-unsupported'
  }]);
  assert.equal(fileChecks, 0, 'unsafe targets must be rejected before filesystem lookup');
});

test('zero selected pairs succeeds without executing and makes no runtime claim', () => {
  let batchCalls = 0;
  const result = runLocalGeneratedGate({
    plan: {
      selected: [],
      excluded: [
        { specPath: 'specs/auth.md', testPath: 'tests/regression/auth.authenticated.spec.ts', reason: 'auth-required' }
      ],
      issues: [],
      directoryResult: directoryFixture()
    },
    runBatch() {
      batchCalls += 1;
      return [];
    }
  });

  assert.equal(result.passed, true);
  assert.equal(result.selected, 0);
  assert.equal(result.executed, 0);
  assert.equal(result.runtimeClaim, false);
  assert.equal(batchCalls, 0);
});

test('runtime claim requires every selected local pair to execute successfully', () => {
  const plan = collectLocalGeneratedPlan({
    directoryResult: directoryFixture(),
    fileExists: () => true
  });
  const result = runLocalGeneratedGate({
    plan,
    runBatch(pairs) {
      return pairs.map((pair) => ({
        passed: true,
        pair,
        execution: { attempted: true, passed: true, issues: [] }
      }));
    }
  });

  assert.equal(result.passed, true);
  assert.equal(result.selected, 1);
  assert.equal(result.executed, 1);
  assert.equal(result.runtimeClaim, true);
});

test('local generated lane rejects a static-red target before global listing can import it', () => {
  const plan = {
    specDir: 'specs',
    directoryResult: directoryFixture(),
    selected: [{
      specPath: 'specs/local.md',
      testPath: 'tests/smoke/local.spec.ts',
      validation: directoryFixture().results[0].result,
      projects: ['local-chromium']
    }],
    excluded: [],
    issues: []
  };
  let globalCalls = 0;

  const result = runLocalGeneratedGate({
    plan,
    reviewer: () => ({ passed: false, issues: ['malicious sentinel'], warnings: [] }),
    runGlobalChecks: () => {
      globalCalls += 1;
      throw new Error('global listing must not run');
    }
  });

  assert.equal(result.passed, false);
  assert.equal(globalCalls, 0);
  assert.match(result.issues.join('\n'), /malicious sentinel/);
});
