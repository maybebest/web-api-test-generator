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

// Iteration-4 vocabulary fixes. The audit ledger overturned every
// synchronization label whose actionability/wait evidence carried a
// locator-shaped subject (c2 waitFor-on-missing-testid, c3 role-name drift +
// container-scope drift, c4a role-name drift, c4b renamed testid): the true
// class is locator-drift manifesting as a timeout. Both classes are
// repairable, so only the label moves — never the routing.

test('waitFor timeout on a missing testid classifies as locator-drift, not synchronization', () => {
  // Shape from audited heal run 1786268365120 (c2 seeded testid rename):
  // the missing testid surfaced via waitFor state:visible, not element(s) not found.
  const verdict = triageRuntimeFailure({
    stage: 'runtime-test',
    evidence: [
      `feed shows unread badge: locator.waitFor: Timeout 5000ms exceeded.
Call log:
  - waiting for getByTestId('feed-item-1').getByTestId('unread-badge') to be visible`
    ]
  });
  assert.equal(verdict.classification, 'locator-drift');
  assert.equal(verdict.repairable, true);
  assert.deepEqual(verdict.reasonCodes, ['LOCATOR_ACTIONABILITY_DRIFT', 'ACTIONABILITY_WAIT']);
});

test('click timeout on a drifted role name classifies as locator-drift, not synchronization', () => {
  // Shape from audited heal run 1786274147829 (c4a: Details -> Story details):
  // the wrong accessible name manifests as a click actionability timeout.
  const verdict = triageRuntimeFailure({
    stage: 'runtime-test',
    evidence: [
      `AC-004 opens story details: locator.click: Timeout 15000ms exceeded.
Call log:
  - waiting for getByTestId('feed-item-1').getByRole('button', { name: 'Details', exact: true })`
    ]
  });
  assert.equal(verdict.classification, 'locator-drift');
  assert.equal(verdict.repairable, true);
  assert.deepEqual(verdict.reasonCodes, ['LOCATOR_ACTIONABILITY_DRIFT', 'ACTIONABILITY_TIMEOUT']);
});

test('reclassified locator-subject shapes keep repairable parity with plain synchronization', () => {
  // Routing must not move: the ledger shapes that flip to locator-drift and a
  // locator-free actionability timeout must agree on repairable=true.
  const plainSync = triageRuntimeFailure({
    stage: 'runtime-test',
    evidence: ['locator.click: Timeout 30000ms exceeded.']
  });
  assert.equal(plainSync.classification, 'synchronization');
  assert.equal(plainSync.repairable, true);
  for (const evidence of [
    ["waiting for getByTestId('feed-load-more') to be visible after locator.click: Timeout 15000ms exceeded"],
    [`DC-001 loads more stories: locator.click: Timeout 15000ms exceeded.
Call log:
  - waiting for getByTestId('feed-load-more')`]
  ]) {
    const reclassified = triageRuntimeFailure({ stage: 'runtime-test', evidence });
    assert.equal(reclassified.classification, 'locator-drift');
    assert.equal(reclassified.repairable, plainSync.repairable);
  }
});

test('the locator subject must ride in the same evidence item as the actionability signal', () => {
  const verdict = triageRuntimeFailure({
    stage: 'runtime-test',
    evidence: [
      'locator.click: Timeout 30000ms exceeded.',
      "an unrelated step mentioned getByRole('button', { name: 'Save' }) earlier"
    ]
  });
  assert.equal(verdict.classification, 'synchronization');
  assert.equal(verdict.repairable, true);
  assert.deepEqual(verdict.reasonCodes, ['ACTIONABILITY_TIMEOUT']);
});

test('test-file compile breakage gets its own non-repairable class distinct from environment', () => {
  // Shape from audited heal run 1786274346166 (c4c seeded broken import): the
  // baseline aborts as runtime-environment, but the test file itself cannot
  // compile — nothing environmental is broken.
  const verdict = triageRuntimeFailure({
    stage: 'runtime-environment',
    evidence: [
      "top-level report error: Error: Cannot find module '../../fixtures/nonexistent-test' imported from tests/smoke/complex-feed-lazyload-comments.spec.ts"
    ]
  });
  assert.equal(verdict.classification, 'compile-breakage');
  assert.equal(verdict.repairable, false);
  assert.deepEqual(verdict.reasonCodes, ['COMPILE_FAILURE']);
});

test('a transform SyntaxError in the test file classifies as compile-breakage', () => {
  const verdict = triageRuntimeFailure({
    stage: 'runtime-environment',
    evidence: [
      'top-level report error: SyntaxError: tests/smoke/complex-feed-lazyload-comments.spec.ts: Unexpected token (12:5)'
    ]
  });
  assert.equal(verdict.classification, 'compile-breakage');
  assert.equal(verdict.repairable, false);
  assert.deepEqual(verdict.reasonCodes, ['COMPILE_FAILURE']);
});

test('TypeScript diagnostics against the test file classify as compile-breakage', () => {
  const verdict = triageRuntimeFailure({
    stage: 'runtime-test',
    evidence: ["tests/smoke/complex-wizard-happy-path.spec.ts(3,1): error TS2307: Cannot find module '../../fixtures/test'."]
  });
  assert.equal(verdict.classification, 'compile-breakage');
  assert.equal(verdict.repairable, false);
  assert.deepEqual(verdict.reasonCodes, ['COMPILE_FAILURE']);
});

test('compile-breakage survives the heal evidence sanitizer redacting file paths', () => {
  // heal-test.mjs sanitizedDiagnosticText replaces 20+ character path runs
  // with <redacted>, so the archived c4c evidence names no file at all. The
  // marker alone must stay decisive at the runtime-environment stage.
  const verdict = triageRuntimeFailure({
    stage: 'runtime-environment',
    evidence: ["top-level report error: Error: Cannot find module '<redacted>' imported from <redacted>"]
  });
  assert.equal(verdict.classification, 'compile-breakage');
  assert.equal(verdict.repairable, false);
  assert.deepEqual(verdict.reasonCodes, ['COMPILE_FAILURE']);
});

test('a bare SyntaxError in ordinary runtime evidence does not classify as compile-breakage', () => {
  const verdict = triageRuntimeFailure({
    stage: 'runtime-test',
    evidence: ['response parse step: SyntaxError: Unexpected token < in JSON at position 0']
  });
  assert.equal(verdict.classification, 'unclassified');
  assert.equal(verdict.repairable, false);
});

test('a webServer module-resolution failure stays environment, never compile-breakage', () => {
  // Shape from audited heal run 1786271113005 (c3 corrupted fixture
  // dependency), whose environment label the audit CONFIRMED: the webServer
  // process cannot start; the test file compiles fine.
  const verdict = triageRuntimeFailure({
    stage: 'runtime-environment',
    evidence: [
      `top-level report error: Error: Process from config.webServer was not able to start. Exit code: 1
[WebServer] Error [ERR_MODULE_NOT_FOUND]: Cannot find module './fixture-data/feed-seed.mjs' imported from local-fixture/server.mjs`
    ]
  });
  assert.equal(verdict.classification, 'environment');
  assert.equal(verdict.repairable, false);
  assert.deepEqual(verdict.reasonCodes, ['GATE_ENVIRONMENT_FAILURE']);
});

test('an environment abort with no compile evidence keeps the environment gate label', () => {
  const verdict = triageRuntimeFailure({
    stage: 'runtime-environment',
    evidence: ['Playwright did not produce a readable JSON report.']
  });
  assert.equal(verdict.classification, 'environment');
  assert.equal(verdict.repairable, false);
  assert.deepEqual(verdict.reasonCodes, ['GATE_ENVIRONMENT_FAILURE']);
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
