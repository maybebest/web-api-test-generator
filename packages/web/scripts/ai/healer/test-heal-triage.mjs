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
// A bare 400 is normally a product-or-contract signal, but an HTTP 400 status
// carrying an authentication context in the SAME evidence item is broken
// credentials or an expired session (environment), not a test defect. The 400
// must look like an HTTP status ("Received: 400", "status 400", "HTTP 400",
// "400 Bad Request") so prices, test ids, and URL segments never match, and
// the auth words are word-anchored so "author"/"authors" never match. Both
// patterns must match one item; matching across the joined evidence would let
// an unrelated "login" line reclassify a genuine contract 400.
const HTTP_400_STATUS_PATTERN = new RegExp(
  [
    '\\breceived\\s*:?\\s*400\\b',
    '\\bstatus(?:\\s+code)?\\s*(?:was|=|:)?\\s*400\\b',
    '\\bhttp\\s*400\\b',
    '\\b400\\s+bad\\s+request\\b'
  ].join('|'),
  'i'
);
const AUTH_CONTEXT_PATTERN = /\bauthoriz\w*|\bauthenticat\w*|\blogin\b|\bsign[ -]?in\b|\bauth\b|\boauth\b/i;
const LOCATOR_RULES = [
  ['LOCATOR_STRICT_MODE_VIOLATION', /strict mode violation/i],
  [
    'LOCATOR_NOT_FOUND',
    /(?:\bLocator:\s*[^\r\n]+[\s\S]{0,1600}?\bError:\s*element\(s\) not found\b|(?:locator|(?:getByRole|getByTestId|getByLabel|getByText)\()[\s\S]{0,1600}?resolved to 0 elements)/i
  ],
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
  if (ENVIRONMENT_PATTERNS.some((pattern) => pattern.test(joined))) {
    return verdict('environment', false, ['AUTH_NETWORK_OR_BROWSER_FAILURE'], evidenceFingerprint);
  }
  if (DATA_PATTERNS.some((pattern) => pattern.test(joined))) {
    return verdict('data', false, ['TEST_DATA_FAILURE'], evidenceFingerprint);
  }
  for (const [reason, pattern] of LOCATOR_RULES) {
    if (pattern.test(joined)) return verdict('locator-drift', true, [reason], evidenceFingerprint);
  }
  // The auth-400 rule runs AFTER the locator and synchronization rules so
  // repairable locator/sync evidence keeps its classification even when it
  // mentions an auth context and a 400, but BEFORE PRODUCT_PATTERNS:
  // "Received: 400" would otherwise classify an auth-context 400 as
  // product-or-contract first.
  const authContext400 = normalized.some(
    (item) => HTTP_400_STATUS_PATTERN.test(item) && AUTH_CONTEXT_PATTERN.test(item)
  );
  if (authContext400) {
    for (const [reason, pattern] of SYNC_RULES) {
      if (pattern.test(joined)) return verdict('synchronization', true, [reason], evidenceFingerprint);
    }
    return verdict('environment', false, ['AUTH_NETWORK_OR_BROWSER_FAILURE'], evidenceFingerprint);
  }
  if (PRODUCT_PATTERNS.some((pattern) => pattern.test(joined))) {
    return verdict('product-or-contract', false, ['ASSERTION_OR_RESPONSE_MISMATCH'], evidenceFingerprint);
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
