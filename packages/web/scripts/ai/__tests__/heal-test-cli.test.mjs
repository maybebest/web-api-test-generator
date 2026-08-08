import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { helpText, isSuccessfulHealStatus, renderHealResults } from '../heal-test.mjs';

test('legacy healer entry point re-exports the implementation API', async () => {
  const legacy = await import('../heal-test.mjs');
  const implementation = await import('../healer/heal-test.mjs');

  assert.deepEqual(Object.keys(legacy).sort(), Object.keys(implementation).sort());
  for (const exportName of Object.keys(implementation)) {
    assert.equal(legacy[exportName], implementation[exportName]);
  }
});

test('healer implementation remains directly executable', () => {
  const webRoot = path.resolve(import.meta.dirname, '..', '..', '..');
  const scriptPath = path.resolve(import.meta.dirname, '..', 'healer', 'heal-test.mjs');
  const result = spawnSync(process.execPath, [scriptPath, '--help'], {
    cwd: webRoot,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage:/);
  assert.equal(result.stderr, '');
});

test('policy warnings remain metadata on accepted lifecycle statuses', () => {
  const warningProposal = {
    status: 'proposal-ready',
    target: 'tests/warning-proposal.spec.ts',
    attemptsUsed: 1,
    diffPath: '.ai-runs/heal/proposal/candidate.diff',
    archiveDir: '.ai-runs/heal/proposal',
    policyIssueCodes: ['ASSERTION_COUNT_REDUCED']
  };
  const warningApply = {
    status: 'healed',
    target: 'tests/warning-apply.spec.ts',
    attemptsUsed: 1,
    backupPath: '.ai-runs/heal/apply/original.ts',
    policyIssueCodes: ['SCOPED_ROLE_TARGET_UNNAMED']
  };

  const proposal = renderHealResults([warningProposal]);
  const applied = renderHealResults([warningApply]);

  assert.equal(proposal.exitCode, 0);
  assert.deepEqual(proposal.events.map((event) => event.line), [
    'PROPOSAL READY WITH POLICY WARNINGS tests/warning-proposal.spec.ts after 1 attempt(s) (target unchanged). Diff: .ai-runs/heal/proposal/candidate.diff. Archive: .ai-runs/heal/proposal',
    '- Policy warnings: ASSERTION_COUNT_REDUCED'
  ]);
  assert.equal(applied.exitCode, 1);
  assert.match(applied.events.map((event) => event.line).join('\n'), /SCOPED_ROLE_TARGET_UNNAMED/);
  assert.deepEqual(applied.events.map((event) => event.line), [
    'HEALED WITH POLICY WARNINGS tests/warning-apply.spec.ts after 1 attempt(s). Backup: .ai-runs/heal/apply/original.ts',
    '- Policy warnings: SCOPED_ROLE_TARGET_UNNAMED'
  ]);
});

test('rejected-attempt warnings stay out of final CLI diagnostics', () => {
  const result = renderHealResults([{
    status: 'healed',
    target: 'tests/clean-final.spec.ts',
    attemptsUsed: 2,
    backupPath: '.ai-runs/heal/clean/original.ts',
    attemptTrail: [{
      attempt: 1,
      outcome: 'still-failing',
      policyIssueCodes: ['ASSERTION_COUNT_REDUCED']
    }, {
      attempt: 2,
      outcome: 'healed'
    }]
  }]);

  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.events.map((event) => event.line), [
    'HEALED tests/clean-final.spec.ts after 2 attempt(s). Backup: .ai-runs/heal/clean/original.ts'
  ]);
});

test('accepted statuses and help do not encode warning variants', () => {
  assert.equal(isSuccessfulHealStatus('proposal-ready'), true);
  assert.equal(isSuccessfulHealStatus('healed'), true);
  assert.equal(isSuccessfulHealStatus('proposal-ready-with-policy-warnings'), false);
  assert.equal(isSuccessfulHealStatus('healed-with-policy-warnings'), false);

  const help = helpText();
  assert.doesNotMatch(help, /proposal-ready-with-policy-warnings|healed-with-policy-warnings/);
  assert.match(help, /Policy warnings are reported separately from the accepted proposal or applied status\./i);
  assert.match(help, /An applied result with policy warnings exits non-zero\./i);
});
