const FAILURE_KINDS = {
  'input-validation': { reasonCode: 'INPUT_VALIDATION_FAILED', repairable: false },
  'global-static': { reasonCode: 'GLOBAL_STATIC_CHECK_FAILED', repairable: false },
  'static-review': { reasonCode: 'STATIC_REVIEW_FAILED', repairable: true },
  'runtime-test': { reasonCode: 'RUNTIME_TEST_FAILED', repairable: false },
  'runtime-environment': { reasonCode: 'RUNTIME_ENVIRONMENT_FAILED', repairable: false }
};
const MAX_DIAGNOSTICS = 8;
const MAX_DIAGNOSTIC_LENGTH = 500;

export function classifyGeneratedGateFailure({ stage, issues = [] }) {
  const kind = FAILURE_KINDS[stage] ?? FAILURE_KINDS['runtime-environment'];
  return {
    schema: 'generated-gate-verdict/v1',
    passed: false,
    stage: FAILURE_KINDS[stage] ? stage : 'runtime-environment',
    reasonCode: kind.reasonCode,
    diagnostics: issues.slice(0, MAX_DIAGNOSTICS).map(sanitizeDiagnostic),
    repairable: kind.repairable
  };
}

export function acceptedGeneratedGateVerdict({ staticReviewWarningCount = null } = {}) {
  const verdict = {
    schema: 'generated-gate-verdict/v1',
    passed: true,
    stage: 'accepted',
    reasonCode: 'PASSED',
    diagnostics: [],
    repairable: false
  };
  // Non-blocking reviewer warnings ride on the accepted verdict so the caller
  // can persist an accepted-clean vs accepted-with-warning split. Invalid
  // counts are dropped: absence means "unknown", never zero.
  if (Number.isSafeInteger(staticReviewWarningCount) && staticReviewWarningCount >= 0) {
    verdict.staticReviewWarningCount = staticReviewWarningCount;
  }
  return verdict;
}

function sanitizeDiagnostic(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0020\u007f-\u009f\u2028\u2029]+/g, ' ')
    .replace(/\b(authorization|cookie|set-cookie)\s*:\s*.*$/gi, '$1: <redacted>')
    .replace(/\bbearer\s+[A-Za-z0-9._~+\/-]{8,}/gi, 'Bearer <redacted>')
    .replace(/\b(api[_-]?key|token|password|secret)\s*[:=]\s*[^ ]+/gi, '$1=<redacted>')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '<redacted-token>')
    .slice(0, MAX_DIAGNOSTIC_LENGTH);
}
