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
// Iteration-4 vocabulary fix (audit ledger runs 1786268365120, 1786270762736,
// 1786270986047, 1786274147829, 1786274253340): a renamed testid, drifted
// accessible name, or wrong container scope routinely manifests as an
// actionability timeout or waitFor wait, so the synchronization label absorbed
// locator drift five times at 100% audited coverage. When the SAME evidence
// item that carries the actionability signal names a locator-shaped subject
// (getBy* call, .locator(...), or a testid engine reference), the true class
// is locator-drift. Both classes are repairable, so only the label moves —
// heal routing, prompts, and fail-closed behavior are unchanged.
const LOCATOR_SUBJECT_PATTERN =
  /\bgetBy(?:Role|TestId|Label|Placeholder|Text|Title|AltText)\s*\(|\.locator\s*\(|\bdata-testid\b|\binternal:(?:testid|role|label|text)\b/i;
// Iteration-4 vocabulary fix (audit ledger run 1786274346166): a test file
// that cannot compile aborts the baseline as an environment failure, but
// nothing environmental is broken — the label must point at the broken test
// source, not at infrastructure. The marker and a test-file reference must
// source, not at infrastructure. webServer process failures are excluded: a
// fixture server that cannot start (audit run 1786271113005, CONFIRMED) is a
// genuine environment failure even when its own imports are what broke. At the
// runtime-environment stage a bare marker is decisive — no test executed, so
// the broken module is the test file's own load chain (file paths are
// sanitized to <redacted> before triage, so requiring one would blind the
// rule). At every other stage the marker must cite a test source file in the
// SAME evidence item so a page-level SyntaxError inside ordinary runtime
// assertion evidence can never masquerade as compile breakage.
const COMPILE_MARKER_PATTERN = /\bCannot find module\b|\bERR_MODULE_NOT_FOUND\b|\bSyntaxError\b|\berror TS\d{2,5}\b/i;
const TEST_SOURCE_REFERENCE_PATTERN = /\.(?:spec|test)\.[cm]?[tj]sx?\b/i;
const WEB_SERVER_CONTEXT_PATTERN = /\[WebServer\]|\bconfig\.webServer\b|\bweb ?server\b/i;

export function triageRuntimeFailure({ evidence = [], stage } = {}) {
  const normalized = evidence.map((item) => String(item ?? '').trim()).filter(Boolean);
  const joined = normalized.join('\n');
  const evidenceFingerprint = crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  const compileBreakage = normalized.some((item) => (
    COMPILE_MARKER_PATTERN.test(item)
    && (stage === 'runtime-environment' || TEST_SOURCE_REFERENCE_PATTERN.test(item))
    && !WEB_SERVER_CONTEXT_PATTERN.test(item)
  ));
  if (compileBreakage) {
    return verdict('compile-breakage', false, ['COMPILE_FAILURE'], evidenceFingerprint);
  }
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
  // An actionability signal whose own evidence item names a locator-shaped
  // subject is locator drift wearing a synchronization costume; both labels
  // stay repairable=true, so the split changes vocabulary only. The subject
  // must ride in the SAME item as the signal so an unrelated locator mention
  // elsewhere never reclassifies a genuine synchronization failure.
  const actionabilityVerdict = (reason, pattern) => {
    const locatorSubject = normalized.some(
      (item) => pattern.test(item) && LOCATOR_SUBJECT_PATTERN.test(item)
    );
    return locatorSubject
      ? verdict('locator-drift', true, ['LOCATOR_ACTIONABILITY_DRIFT', reason], evidenceFingerprint)
      : verdict('synchronization', true, [reason], evidenceFingerprint);
  };
  if (authContext400) {
    for (const [reason, pattern] of SYNC_RULES) {
      if (pattern.test(joined)) return actionabilityVerdict(reason, pattern);
    }
    return verdict('environment', false, ['AUTH_NETWORK_OR_BROWSER_FAILURE'], evidenceFingerprint);
  }
  if (PRODUCT_PATTERNS.some((pattern) => pattern.test(joined))) {
    return verdict('product-or-contract', false, ['ASSERTION_OR_RESPONSE_MISMATCH'], evidenceFingerprint);
  }
  for (const [reason, pattern] of SYNC_RULES) {
    if (pattern.test(joined)) return actionabilityVerdict(reason, pattern);
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
