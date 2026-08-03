import crypto from 'node:crypto';

export const TEST_HEAL_TRIAGE_SCHEMA = 'test-heal-triage/v1';

const PRODUCT_PATTERNS = [
  /expected(?: string| pattern| value)?\s*:/i,
  /received(?: string| value)?\s*:/i,
  /status(?: code)?\s*(?:was|=|:)/i,
  /response body/i
];
const DATA_PATTERNS = [/fixture.*missing/i, /test data/i, /no such (?:user|plan|record)/i];
const ENVIRONMENT_PATTERNS = [
  /\b(?:401|403)\b|unauthori[sz]ed|forbidden/i,
  /ECONN(?:RESET|REFUSED)|ENOTFOUND|network.*failed/i,
  /browser.*(?:missing|closed)|configuration error/i
];
const LOCATOR_RULES = [
  ['LOCATOR_STRICT_MODE_VIOLATION', /strict mode violation/i],
  ['LOCATOR_NOT_FOUND', /(?:locator|(?:getByRole|getByTestId|getByLabel|getByText)\().*(?:resolved to 0 elements|not found)/i],
  ['LOCATOR_DETACHED', /element (?:is not attached|was detached)/i]
];
const SYNC_RULES = [
  ['ACTIONABILITY_TIMEOUT', /(?:locator\.)?(?:click|fill|check|uncheck|hover|press):.*timeout/i],
  ['ACTIONABILITY_WAIT', /waiting for .* to be (?:visible|enabled|editable|stable)/i]
];

export function triageRuntimeFailure({ evidence = [], stage } = {}) {
  const normalized = evidence.map((item) => String(item ?? '').trim()).filter(Boolean);
  const joined = normalized.join('\n');
  const evidenceFingerprint = crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  if (stage === 'runtime-environment') {
    return verdict('environment', false, ['GATE_ENVIRONMENT_FAILURE'], evidenceFingerprint);
  }
  if (PRODUCT_PATTERNS.some((pattern) => pattern.test(joined))) {
    return verdict('product-or-contract', false, ['ASSERTION_OR_RESPONSE_MISMATCH'], evidenceFingerprint);
  }
  if (ENVIRONMENT_PATTERNS.some((pattern) => pattern.test(joined))) {
    return verdict('environment', false, ['AUTH_NETWORK_OR_BROWSER_FAILURE'], evidenceFingerprint);
  }
  if (DATA_PATTERNS.some((pattern) => pattern.test(joined))) {
    return verdict('data', false, ['TEST_DATA_FAILURE'], evidenceFingerprint);
  }
  for (const [reason, pattern] of LOCATOR_RULES) {
    if (pattern.test(joined)) return verdict('locator-drift', true, [reason], evidenceFingerprint);
  }
  for (const [reason, pattern] of SYNC_RULES) {
    if (pattern.test(joined)) return verdict('synchronization', true, [reason], evidenceFingerprint);
  }
  return verdict('unclassified', false, ['UNCLASSIFIED_RUNTIME_FAILURE'], evidenceFingerprint);
}

function verdict(classification, repairable, reasonCodes, evidenceFingerprint) {
  return Object.freeze({
    schema: TEST_HEAL_TRIAGE_SCHEMA,
    classification,
    repairable,
    reasonCodes: Object.freeze([...reasonCodes]),
    evidenceFingerprint
  });
}
