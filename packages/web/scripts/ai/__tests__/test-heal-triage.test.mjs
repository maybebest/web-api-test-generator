import assert from 'node:assert/strict';
import test from 'node:test';
import { triageRuntimeFailure } from '../healer/test-heal-triage.mjs';

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

test('triage permits a multiline Playwright visibility locator-not-found failure', () => {
  const verdict = triageRuntimeFailure({
    stage: 'runtime-test',
    evidence: [
      `expect(locator).toBeVisible() failed

Locator: getByRole('banner').getByRole('button', { name: 'T', exact: true })
Expected: visible
Error: element(s) not found`
    ]
  });
  assert.equal(verdict.classification, 'locator-drift');
  assert.equal(verdict.repairable, true);
  assert.deepEqual(verdict.reasonCodes, ['LOCATOR_NOT_FOUND']);
});

test('triage classifies an HTTP 400 with auth context in the same evidence item as environment', () => {
  const verdict = triageRuntimeFailure({
    stage: 'runtime-test',
    evidence: ['login request: apiRequestContext.post: Expected: 200 Received: 400 with Authorization header']
  });
  assert.equal(verdict.classification, 'environment');
  assert.equal(verdict.repairable, false);
  assert.deepEqual(verdict.reasonCodes, ['AUTH_NETWORK_OR_BROWSER_FAILURE']);
});

test('triage keeps a non-auth HTTP 400 as product-or-contract', () => {
  const verdict = triageRuntimeFailure({
    stage: 'runtime-test',
    evidence: ['Expected: 200', 'Received: 400']
  });
  assert.equal(verdict.classification, 'product-or-contract');
  assert.equal(verdict.repairable, false);
  assert.deepEqual(verdict.reasonCodes, ['ASSERTION_OR_RESPONSE_MISMATCH']);
});

test('triage requires the auth context and the 400 in the SAME evidence item', () => {
  const verdict = triageRuntimeFailure({
    stage: 'runtime-test',
    evidence: ['navigated to the login page', 'Received: 400']
  });
  assert.equal(verdict.classification, 'product-or-contract');
  assert.equal(verdict.repairable, false);
});

test('triage keeps an HTTP 400 whose only auth-like token is "authors" as product-or-contract', () => {
  const verdict = triageRuntimeFailure({
    stage: 'runtime-test',
    evidence: ['Expected: 200 Received: 400 from GET /api/authors/list']
  });
  assert.equal(verdict.classification, 'product-or-contract');
  assert.equal(verdict.repairable, false);
  assert.deepEqual(verdict.reasonCodes, ['ASSERTION_OR_RESPONSE_MISMATCH']);
});

test('triage keeps a price token like £400 out of the auth-400 environment rule', () => {
  const verdict = triageRuntimeFailure({
    stage: 'runtime-test',
    evidence: ["Locator: getByText('£400/month') on login page\nError: element(s) not found"]
  });
  assert.equal(verdict.classification, 'locator-drift');
  assert.equal(verdict.repairable, true);
  assert.deepEqual(verdict.reasonCodes, ['LOCATOR_NOT_FOUND']);
});

test('triage keeps a test id containing 400 out of the auth-400 environment rule', () => {
  const verdict = triageRuntimeFailure({
    stage: 'runtime-test',
    evidence: ['strict mode violation: getByTestId("login-error-400") resolved to 2 elements']
  });
  assert.equal(verdict.classification, 'locator-drift');
  assert.equal(verdict.repairable, true);
  assert.deepEqual(verdict.reasonCodes, ['LOCATOR_STRICT_MODE_VIOLATION']);
});

test('triage classifies an authorization expectation answered with HTTP 400 as environment', () => {
  const verdict = triageRuntimeFailure({
    stage: 'runtime-test',
    evidence: ['agent authorization should answer 200: Expected: 200 Received: 400']
  });
  assert.equal(verdict.classification, 'environment');
  assert.equal(verdict.repairable, false);
  assert.deepEqual(verdict.reasonCodes, ['AUTH_NETWORK_OR_BROWSER_FAILURE']);
});

test('triage keeps synchronization evidence repairable even when it mentions auth and an HTTP 400', () => {
  const verdict = triageRuntimeFailure({
    stage: 'runtime-test',
    evidence: ['locator.click: Timeout 30000ms exceeded on the login form after HTTP 400']
  });
  assert.equal(verdict.classification, 'synchronization');
  assert.equal(verdict.repairable, true);
  assert.deepEqual(verdict.reasonCodes, ['ACTIONABILITY_TIMEOUT']);
});

test('triage keeps assertion-value mismatches non-repairable', () => {
  const verdict = triageRuntimeFailure({
    stage: 'runtime-test',
    evidence: ['Expected string: "Saved"', 'Received string: "Save failed"']
  });
  assert.equal(verdict.classification, 'product-or-contract');
  assert.equal(verdict.repairable, false);
  assert.deepEqual(verdict.reasonCodes, ['ASSERTION_OR_RESPONSE_MISMATCH']);
});

test('triage keeps locator-shaped assertion values non-repairable', () => {
  const verdict = triageRuntimeFailure({
    stage: 'runtime-test',
    evidence: [
      "Assertion failed for getByText('status')",
      'Expected string: "Saved"',
      'Received string: "Record not found"'
    ]
  });
  assert.equal(verdict.classification, 'product-or-contract');
  assert.equal(verdict.repairable, false);
  assert.deepEqual(verdict.reasonCodes, ['ASSERTION_OR_RESPONSE_MISMATCH']);
});

test('triage keeps locator-shaped response-body messages non-repairable', () => {
  const verdict = triageRuntimeFailure({
    stage: 'runtime-test',
    evidence: [
      "Request triggered by getByRole('button', { name: 'Save' })",
      'Response body: {"message":"not found"}'
    ]
  });
  assert.equal(verdict.classification, 'product-or-contract');
  assert.equal(verdict.repairable, false);
  assert.deepEqual(verdict.reasonCodes, ['ASSERTION_OR_RESPONSE_MISMATCH']);
});
