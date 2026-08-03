import assert from 'node:assert/strict';
import test from 'node:test';
import { triageRuntimeFailure } from '../lib/test-heal-triage.mjs';

test('triage permits a strict locator failure', () => {
  const verdict = triageRuntimeFailure({
    stage: 'runtime-test',
    evidence: ['save flow: locator.click: strict mode violation: getByRole("button", { name: "Save" }) resolved to 2 elements']
  });
  assert.equal(verdict.classification, 'locator-drift');
  assert.equal(verdict.repairable, true);
  assert.deepEqual(verdict.reasonCodes, ['LOCATOR_STRICT_MODE_VIOLATION']);
  assert.match(verdict.evidenceFingerprint, /^[a-f0-9]{64}$/);
});

test('triage rejects assertion, auth, network, and unknown failures', () => {
  for (const evidence of [
    ['Expected string: "Saved"', 'Received string: "Save failed"'],
    ['401 Unauthorized while loading plan'],
    ['request failed: ECONNRESET'],
    ['something unexplained happened']
  ]) {
    const verdict = triageRuntimeFailure({ stage: 'runtime-test', evidence });
    assert.equal(verdict.repairable, false);
  }
});

test('environment stages fail closed before textual triage', () => {
  const verdict = triageRuntimeFailure({
    stage: 'runtime-environment',
    evidence: ['locator.click timed out']
  });
  assert.equal(verdict.classification, 'environment');
  assert.equal(verdict.repairable, false);
});
