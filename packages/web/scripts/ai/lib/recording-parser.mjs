import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { isStableTestId } from './selector-policy.mjs';

export const DEFAULT_RECORDINGS_DIR = 'recordings';
export const DEFAULT_RECORDED_TEST_DIR = 'tests/recorded';

const SUPPORTED_STEP_TYPES = new Set([
  'navigate',
  'click',
  'doubleClick',
  'change',
  'hover',
  'keyDown',
  'keyUp',
  'waitForElement'
]);

const IGNORED_STEP_TYPES = new Map([
  ['setViewport', 'Viewport metadata is not user behavior. Configure projects/devices in Playwright instead.'],
  ['scroll', 'Scroll is treated as replay metadata. Playwright actions auto-scroll target elements into view.']
]);

const ACTION_STEP_TYPES_REQUIRING_SELECTOR = new Set(['click', 'doubleClick', 'change', 'hover', 'waitForElement']);
const SECRET_CONTEXT_PATTERN = /\b(password|passcode|token|secret|bearer|session|cookie|otp|mfa|2fa|verification\s*code)\b/i;
const SECRET_VALUE_PATTERNS = [
  /\bbearer\s+[a-z0-9._-]{10,}/i,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
  /AKIA[0-9A-Z]{16}/,
  /^[0-9]{6}$/,
  /^[A-Za-z0-9+/=_-]{24,}$/
];
// Query/hash parameter names that carry credentials or session artifacts.
// Screened the same way change-step context is screened: a match is a hard
// error regardless of the parameter value.
const SUSPICIOUS_URL_PARAM_NAME_PATTERN =
  /^(?:token|access[_-]?token|refresh[_-]?token|id[_-]?token|sid|session|session[_-]?id|sessionid|code|auth[_-]?code|otp|key|api[_-]?key|apikey|auth|authorization|bearer|jwt|password|passwd|pwd|secret|client[_-]?secret)$/i;
// Targeted secret shapes (no anchored base64 catch-all) for path/URL-valued
// parameters and bare fragments, where deep routes would otherwise
// false-positive against /^[A-Za-z0-9+/=_-]{24,}$/.
const TARGETED_URL_SECRET_PATTERNS = [
  /\bbearer\s+[a-z0-9._-]{10,}/i,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
  /AKIA[0-9A-Z]{16}/
];
// Chrome DevTools Recorder waitForElement supports exactly these operators.
const WAIT_FOR_ELEMENT_OPERATORS = new Set(['>=', '==', '<=']);

export function listRecordingFiles(recordingsDir = DEFAULT_RECORDINGS_DIR) {
  if (!fs.existsSync(recordingsDir)) {
    return [];
  }

  return fs
    .readdirSync(path.resolve(recordingsDir), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json') && !entry.name.startsWith('_'))
    .map((entry) => path.join(recordingsDir, entry.name).split(path.sep).join('/'))
    .sort();
}

export function readRecordingFile(recordingPath) {
  return fs.readFileSync(path.resolve(recordingPath), 'utf8');
}

export function parseRecordingJson(recordingPath) {
  const content = readRecordingFile(recordingPath);
  return JSON.parse(content);
}

export function validateRecordingFile(recordingPath, options = {}) {
  const issues = [];
  const warnings = [];
  const absolutePath = path.resolve(recordingPath);

  if (!fs.existsSync(absolutePath)) {
    return {
      valid: false,
      issues: [`Recording file does not exist: ${recordingPath}`],
      warnings,
      normalized: undefined
    };
  }

  let recording;
  try {
    recording = parseRecordingJson(recordingPath);
  } catch (error) {
    return {
      valid: false,
      issues: [`Recording JSON is not valid: ${error.message}`],
      warnings,
      normalized: undefined
    };
  }

  const normalized = normalizeRecording(recording, recordingPath, { ...options, issues, warnings });
  return {
    valid: issues.length === 0,
    issues,
    warnings,
    normalized
  };
}

export function normalizeRecordingFile(recordingPath, options = {}) {
  const validation = validateRecordingFile(recordingPath, options);
  if (!validation.valid) {
    throw new Error(
      [`Recording validation failed: ${recordingPath}`, ...validation.issues.map((issue) => `- ${issue}`)].join('\n')
    );
  }

  return validation.normalized;
}

export function normalizeRecording(recording, recordingPath, options = {}) {
  const issues = options.issues ?? [];
  const warnings = options.warnings ?? [];
  const normalizedPath = normalizePath(recordingPath);
  const title = normalizeText(recording?.title ?? recording?.name ?? path.basename(recordingPath, '.json'));
  const steps = [];
  const ignoredSteps = [];
  const ignoredEvents = [];
  const assertions = [];

  if (!recording || typeof recording !== 'object' || Array.isArray(recording)) {
    issues.push('Recording root must be a JSON object exported from Chrome DevTools Recorder.');
    return buildNormalizedRecording({ recordingPath: normalizedPath, title, steps, ignoredSteps, ignoredEvents, assertions });
  }

  if (!title) {
    issues.push('Recording must contain a non-empty title or name.');
  }

  if (!Array.isArray(recording.steps) || recording.steps.length === 0) {
    issues.push('Recording must contain a non-empty steps array.');
    return buildNormalizedRecording({ recordingPath: normalizedPath, title, steps, ignoredSteps, ignoredEvents, assertions });
  }

  let behaviorIndex = 0;
  let assertionIndex = 0;
  for (let sourceIndex = 0; sourceIndex < recording.steps.length; sourceIndex += 1) {
    const rawStep = recording.steps[sourceIndex];
    const stepType = normalizeText(rawStep?.type);

    if (!rawStep || typeof rawStep !== 'object' || Array.isArray(rawStep)) {
      issues.push(`Step ${sourceIndex + 1} must be a JSON object.`);
      continue;
    }

    if (!stepType) {
      issues.push(`Step ${sourceIndex + 1} is missing required field "type".`);
      continue;
    }

    if (IGNORED_STEP_TYPES.has(stepType)) {
      ignoredSteps.push({
        sourceIndex: sourceIndex + 1,
        type: stepType,
        reason: IGNORED_STEP_TYPES.get(stepType)
      });
      continue;
    }

    if (!SUPPORTED_STEP_TYPES.has(stepType)) {
      issues.push(
        `Unsupported recording step type at step ${sourceIndex + 1}: ${stepType}. Add explicit normalization support before generating a test.`
      );
      continue;
    }

    behaviorIndex += 1;
    const id = formatId('RSTEP', behaviorIndex);
    const selectorReview = reviewSelectors(rawStep);
    const normalizedStep = {
      id,
      sourceIndex: sourceIndex + 1,
      type: stepType,
      action: actionForStep(rawStep),
      required: true
    };

    if (ACTION_STEP_TYPES_REQUIRING_SELECTOR.has(stepType)) {
      if (selectorReview.rawSelectors.length === 0) {
        issues.push(`${id} ${stepType} must include at least one selector.`);
      } else if (selectorReview.usableCandidates.length === 0) {
        issues.push(`${id} ${stepType} has no usable selector. ${selectorReview.issueSummary}`);
      }

      normalizedStep.selectors = selectorReview.rawSelectors;
      normalizedStep.selectorCandidates = selectorReview.usableCandidates;
      normalizedStep.bestLocator = selectorReview.usableCandidates[0]?.locator;
    }

    if (selectorReview.warnings.length > 0) {
      warnings.push(...selectorReview.warnings.map((warning) => `${id}: ${warning}`));
    }

    if (stepType === 'navigate') {
      const url = normalizeText(rawStep.url);
      if (!url) {
        issues.push(`${id} navigate step must include a URL.`);
      } else {
        const urlReview = reviewUrl(url);
        if (!urlReview.allowed) {
          issues.push(`${id} navigate URL is not allowed: ${urlReview.reason}`);
        }
        for (const finding of navigateUrlSecretFindings(url)) {
          issues.push(`${id} navigate URL appears to contain a secret, credential, OTP, token, or session value: ${finding}.`);
        }
        normalizedStep.url = url;
        normalizedStep.urlForTest = urlReview.urlForTest;
      }
    }

    if (stepType === 'change') {
      const value = rawStep.value === undefined || rawStep.value === null ? '' : String(rawStep.value);
      normalizedStep.value = value;
      const context = `${selectorReview.rawSelectors.join(' ')} ${rawStep.target ?? ''}`;
      if (containsUnsafeInput(value, context)) {
        issues.push(`${id} change step appears to contain a secret, credential, OTP, token, or session value.`);
      }
    }

    if (stepType === 'keyDown' || stepType === 'keyUp') {
      const key = normalizeText(rawStep.key);
      if (!key) {
        issues.push(`${id} ${stepType} step must include key.`);
      }
      normalizedStep.key = key;
    }

    if (stepType === 'waitForElement') {
      assertionIndex += 1;
      const assertionId = formatId('ASSERT', assertionIndex);
      normalizedStep.assertionId = assertionId;
      const operator = normalizeText(rawStep.operator) ?? '>=';
      if (!WAIT_FOR_ELEMENT_OPERATORS.has(operator)) {
        issues.push(`${id} waitForElement operator must be one of >=, ==, <= (got "${operator}").`);
      }
      normalizedStep.operator = operator;
      const countProvided = rawStep.count !== undefined;
      const count = countProvided ? Number(rawStep.count) : 1;
      if (countProvided && (!Number.isInteger(count) || count < 0)) {
        issues.push(`${id} waitForElement count must be a non-negative integer (got ${JSON.stringify(rawStep.count)}).`);
      }
      normalizedStep.count = count;
      assertions.push({
        id: assertionId,
        stepId: id,
        sourceIndex: sourceIndex + 1,
        expected: expectedForWaitForElement(normalizedStep),
        bestLocator: normalizedStep.bestLocator
      });
    }

    collectIgnoredAssertedEvents(rawStep, id, sourceIndex + 1, ignoredEvents);
    steps.push(normalizedStep);
  }

  if (steps.length === 0) {
    issues.push('Recording contains no supported user-behavior steps after normalization.');
  }

  if (assertions.length === 0) {
    issues.push(
      'Recording must contain at least one assertion-worthy waitForElement step. Edit or re-record the flow with observable outcomes.'
    );
  }

  return buildNormalizedRecording({ recordingPath: normalizedPath, title, steps, ignoredSteps, ignoredEvents, assertions });
}

export function recordingSha256(recordingPathOrNormalized) {
  const normalized =
    typeof recordingPathOrNormalized === 'string'
      ? normalizeRecordingFile(recordingPathOrNormalized)
      : recordingPathOrNormalized;

  return crypto.createHash('sha256').update(recordingBehaviorContent(normalized)).digest('hex');
}

export function recordingBehaviorContent(normalized) {
  const behavior = {
    title: normalized.title,
    steps: normalized.steps.map((step) => ({
      id: step.id,
      type: step.type,
      action: step.action,
      urlForTest: step.urlForTest,
      value: step.value,
      key: step.key,
      bestLocator: step.bestLocator,
      // Include every usable candidate locator, not just the chosen one, so a
      // change to the recorder's selector set (e.g. an extra unstable fallback)
      // is detected as drift even when the top candidate is unchanged.
      candidateLocators: (step.selectorCandidates ?? []).map((candidate) => candidate.locator),
      assertionId: step.assertionId,
      operator: step.operator,
      count: step.count
    })),
    assertions: normalized.assertions
  };

  return `${JSON.stringify(sortKeysDeep(behavior), null, 2)}\n`;
}

export function defaultRecordedTestPath(recordingPath) {
  const basename = path.basename(recordingPath, '.json');
  return path.join(DEFAULT_RECORDED_TEST_DIR, `${slugify(basename)}.spec.ts`).split(path.sep).join('/');
}

export function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'recording';
}

export function normalizePath(value) {
  return path.normalize(value).split(path.sep).join('/');
}

function buildNormalizedRecording({ recordingPath, title, steps, ignoredSteps, ignoredEvents = [], assertions }) {
  const normalized = {
    recordingPath,
    title,
    targetTestFile: defaultRecordedTestPath(recordingPath),
    steps,
    ignoredSteps,
    // Surfaced for transparency only. ignoredSteps and ignoredEvents are
    // intentionally excluded from recordingBehaviorContent, so they never
    // affect the behavior hash.
    ignoredEvents,
    assertions
  };
  normalized.sha256 = crypto.createHash('sha256').update(recordingBehaviorContent(normalized)).digest('hex');
  return normalized;
}

// Chrome Recorder attaches assertedEvents (e.g. navigation URL/title) to
// steps. They are replay metadata, not user behavior, so they are dropped
// from the contract — but never silently: each one is reported here with a
// reason so a reviewer can see what was discarded.
function collectIgnoredAssertedEvents(rawStep, stepId, sourceIndex, ignoredEvents) {
  if (!Array.isArray(rawStep.assertedEvents)) {
    return;
  }

  for (const event of rawStep.assertedEvents) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      continue;
    }

    ignoredEvents.push({
      stepId,
      sourceIndex,
      type: normalizeText(event.type) ?? 'unknown',
      url: normalizeText(event.url),
      title: normalizeText(event.title),
      reason:
        'Recorder assertedEvents are replay metadata and are intentionally excluded from the behavior contract and hash. Express required outcomes as waitForElement assertions instead.'
    });
  }
}

function actionForStep(step) {
  const type = normalizeText(step.type);
  if (type === 'navigate') {
    return `Navigate to ${step.url ?? '(missing URL)'}`;
  }

  if (type === 'change') {
    return `Fill ${firstUsableSelectorText(step) ?? 'target'}`;
  }

  if (type === 'waitForElement') {
    return `Assert ${firstUsableSelectorText(step) ?? 'target'} is present`;
  }

  if (type === 'keyDown' || type === 'keyUp') {
    return `${type} ${step.key ?? '(missing key)'}`;
  }

  return `${type} ${firstUsableSelectorText(step) ?? 'target'}`;
}

function expectedForWaitForElement(step) {
  const count = step.count ?? 1;
  const operator = step.operator ?? '>=';
  return `${step.bestLocator ?? 'target'} count ${operator} ${count}`;
}

function firstUsableSelectorText(step) {
  return reviewSelectors(step).usableCandidates[0]?.label;
}

function reviewSelectors(step) {
  const rawSelectors = flattenSelectors(step.selectors);
  const candidates = rawSelectors.map((selector) => classifyRecorderSelector(selector));
  const usableCandidates = candidates
    .filter((candidate) => candidate.usable)
    .sort((left, right) => right.score - left.score);
  const rejected = candidates.filter((candidate) => !candidate.usable);
  const warnings = [];

  if (usableCandidates.length > 0 && usableCandidates[0].requiresLocatorPolicyException) {
    warnings.push('Best selector is a raw CSS fallback. Generated tests must include a locator-policy exception.');
  }

  return {
    rawSelectors,
    usableCandidates,
    rejected,
    warnings,
    issueSummary:
      rejected.length > 0
        ? rejected.map((candidate) => `${candidate.source}: ${candidate.reason}`).join('; ')
        : 'No selectors were provided.'
  };
}

function flattenSelectors(selectors) {
  if (!Array.isArray(selectors)) {
    return [];
  }

  return selectors
    .flatMap((group) => (Array.isArray(group) ? group : [group]))
    .filter((selector) => typeof selector === 'string')
    .map((selector) => selector.trim())
    .filter(Boolean);
}

export function classifyRecorderSelector(selector) {
  const source = String(selector ?? '').trim();
  const stripped = stripSelectorProtocol(source);

  if (!source) {
    return rejectedSelector(source, 'empty-selector');
  }

  if (isForbiddenSelector(source) || isForbiddenSelector(stripped)) {
    return rejectedSelector(source, 'XPath and nth-child selector chains are forbidden.');
  }

  const testId = extractTestId(stripped);
  if (testId) {
    if (isStableTestId(testId)) {
      return usableSelector(source, {
        type: 'testId',
        label: testId,
        locator: `page.getByTestId(${JSON.stringify(testId)})`,
        score: 100,
        reason: 'Stable meaningful test id can be translated into Playwright getByTestId and is preferred.'
      });
    }
    return rejectedSelector(source, 'Test id selector is not meaningful or stable enough.');
  }

  if (source.startsWith('aria/')) {
    const aria = parseAriaSelector(source.slice('aria/'.length));
    if (aria.role && aria.name) {
      return usableSelector(source, {
        type: 'role',
        label: `${aria.role} ${aria.name}`,
        locator: `page.getByRole(${JSON.stringify(aria.role)}, { name: ${JSON.stringify(aria.name)} })`,
        score: 95,
        reason: 'Recorder ARIA selector includes role and accessible name.'
      });
    }

    if (aria.role) {
      return usableSelector(source, {
        type: 'role',
        label: aria.role,
        locator: `page.getByRole(${JSON.stringify(aria.role)})`,
        score: 88,
        reason: 'Recorder ARIA selector includes a role.'
      });
    }

    if (aria.name) {
      return usableSelector(source, {
        type: 'text',
        label: aria.name,
        locator: `page.getByText(${JSON.stringify(aria.name)})`,
        score: 70,
        reason: 'Recorder ARIA selector can be translated to visible text fallback.'
      });
    }
  }

  if (source.startsWith('text/')) {
    const text = unquoteSelectorValue(source.slice('text/'.length));
    if (isStableVisibleText(text)) {
      return usableSelector(source, {
        type: 'text',
        label: text,
        locator: `page.getByText(${JSON.stringify(text)})`,
        score: 70,
        reason: 'Recorder text selector contains stable visible text.'
      });
    }
    return rejectedSelector(source, 'Text selector is empty, too long, dynamic, or unstable.');
  }

  if (isSimpleStableCss(stripped)) {
    return usableSelector(source, {
      type: 'css',
      label: stripped,
      locator: `page.locator(${JSON.stringify(stripped)})`,
      score: 35,
      reason: 'Raw CSS fallback is only acceptable with a locator-policy exception.',
      requiresLocatorPolicyException: true
    });
  }

  return rejectedSelector(source, 'Only unstable raw CSS remained after selector classification.');
}

function stripSelectorProtocol(selector) {
  return selector.replace(/^(pierce|css)\//, '').trim();
}

function isForbiddenSelector(selector) {
  const normalized = selector.trim();
  return (
    normalized.startsWith('xpath=') ||
    normalized.startsWith('//') ||
    normalized.startsWith('./') ||
    normalized.startsWith('../') ||
    /:nth-(?:child|of-type|last-child)\s*\(/i.test(normalized)
  );
}

function extractTestId(selector) {
  // Only a standalone test-id attribute selector (optionally tag-qualified)
  // maps cleanly to getByTestId. A compound/descendant selector such as
  // `.wrapper [data-testid="x"]` or `div[data-testid="x"].active` targets a
  // scoped or further-qualified element, so collapsing it to a bare
  // getByTestId would point at the wrong node — reject it and let it fall
  // through to the CSS-with-exception path.
  const match = selector.match(
    /^(?:[a-z][a-z0-9]*)?\[(data-testid|data-test-id|data-test)=["']?([^"'\]]+)["']?\]$/i
  );
  return match?.[2]?.trim();
}

function parseAriaSelector(payload) {
  const role = payload.match(/\[role=["']?([^"'\]]+)["']?\]/i)?.[1]?.trim();
  let name = payload.match(/\[name=["']?([^"'\]]+)["']?\]/i)?.[1];

  // Recorder ARIA selectors can carry the accessible name as free text before
  // the attribute brackets (e.g. `Submit recording[role="button"]`). Without
  // this, a [role=...] match would drop the name and yield an over-broad
  // getByRole that matches every element of that role.
  if (name === undefined) {
    const leading = payload.split('[')[0];
    if (leading && leading.trim()) {
      name = leading.trim();
    }
  }

  if (role || name) {
    return { role, name: unquoteSelectorValue(name) };
  }

  const plainName = unquoteSelectorValue(payload);
  return { role: undefined, name: plainName || undefined };
}

function unquoteSelectorValue(value) {
  return normalizeText(String(value ?? '').replace(/^["']|["']$/g, ''));
}

function isStableVisibleText(text) {
  const normalized = normalizeText(text);
  if (!normalized || normalized.length > 100) {
    return false;
  }

  if (/^[0-9]+$/.test(normalized) || /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/.test(normalized)) {
    return false;
  }

  return !/[A-F0-9]{8,}/.test(normalized);
}

function isSimpleStableCss(selector) {
  if (!selector || isForbiddenSelector(selector)) {
    return false;
  }

  if (/^\[[a-z0-9_-]+=["'][^"']+["']\]$/i.test(selector)) {
    return true;
  }

  if (/^#[A-Za-z][\w-]*$/.test(selector)) {
    return true;
  }

  if (/^[a-z][a-z0-9-]*$/i.test(selector)) {
    return true;
  }

  return false;
}

function usableSelector(source, details) {
  return {
    source,
    usable: true,
    requiresLocatorPolicyException: false,
    ...details
  };
}

function rejectedSelector(source, reason) {
  return {
    source,
    usable: false,
    reason
  };
}

function reviewUrl(value) {
  // Protocol-relative URLs (//host/path) also start with "/" but point at an
  // arbitrary host, so they must not be treated as safe root-relative paths.
  if (value.startsWith('//')) {
    return {
      allowed: false,
      reason: `Protocol-relative URL is not allowed (it targets an external host): ${value}`,
      urlForTest: value
    };
  }

  if (value.startsWith('/')) {
    return { allowed: true, urlForTest: value };
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    return { allowed: false, reason: `URL is not absolute or root-relative: ${value}`, urlForTest: value };
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    return { allowed: false, reason: `Unsupported URL protocol: ${url.protocol}`, urlForTest: value };
  }

  const allowedHosts = loadAllowedHosts();
  if (!hostAllowed(url.hostname, allowedHosts)) {
    return {
      allowed: false,
      reason: `Host ${url.hostname} is outside approved local/non-production hosts.`,
      urlForTest: value
    };
  }

  return {
    allowed: true,
    urlForTest: `${url.pathname}${url.search}${url.hash}` || '/'
  };
}

// Screens every query/hash parameter of a navigate URL with the same secret
// heuristics used for change-step values, plus a suspicious-name screen
// (token, sid, session, code, otp, key, auth, bearer, ...). Recordings
// captured mid-session must not leak session artifacts into the contract.
function navigateUrlSecretFindings(value) {
  const findings = [];
  let url;
  try {
    url = new URL(value, 'http://localhost');
  } catch {
    return findings;
  }

  const parameters = [...url.searchParams.entries()];
  const fragment = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
  // SPA hash routes embed their own query string (#/login?token=...). Split at
  // the first '?' so the post-'?' substring is screened as parameters and the
  // route path as a path: URLSearchParams over the whole fragment would yield
  // the bogus key "/login?token" and let the token value escape screening.
  const fragmentQueryIndex = fragment.indexOf('?');
  const fragmentPath = fragmentQueryIndex === -1 ? fragment : fragment.slice(0, fragmentQueryIndex);
  const fragmentQuery = fragmentQueryIndex === -1 ? undefined : fragment.slice(fragmentQueryIndex + 1);

  if (fragmentQuery !== undefined) {
    parameters.push(...new URLSearchParams(fragmentQuery).entries());
  }

  if (fragmentQuery === undefined && fragmentPath.includes('=')) {
    // OAuth-style implicit-grant fragments (#access_token=...) are parameter
    // lists without a '?'.
    parameters.push(...new URLSearchParams(fragmentPath).entries());
  } else if (
    fragmentPath &&
    (TARGETED_URL_SECRET_PATTERNS.some((pattern) => pattern.test(fragmentPath)) || isHighEntropySecretLike(fragmentPath))
  ) {
    findings.push('URL fragment looks like a credential or token');
  }

  for (const [name, parameterValue] of parameters) {
    if (SUSPICIOUS_URL_PARAM_NAME_PATTERN.test(name.trim())) {
      findings.push(`parameter name "${name}" indicates a credential, token, OTP, or session artifact`);
      continue;
    }

    if (isSecretLikeUrlParameterValue(parameterValue)) {
      findings.push(`parameter "${name}" value looks like a secret, token, OTP, or session identifier`);
    }
  }

  return findings;
}

function isSecretLikeUrlParameterValue(value) {
  const text = String(value ?? '');
  if (!text) {
    return false;
  }

  // Route- and URL-valued parameters (e.g. ?redirect=/account/settings) are
  // legitimate; screen them with the targeted patterns only so deep paths do
  // not false-positive against the anchored base64 catch-all.
  const patterns = text.startsWith('/') || /^https?:\/\//i.test(text) ? TARGETED_URL_SECRET_PATTERNS : SECRET_VALUE_PATTERNS;

  return patterns.some((pattern) => pattern.test(text)) || isHighEntropySecretLike(text);
}

function loadAllowedHosts() {
  const hosts = new Set(['localhost', '127.0.0.1', '0.0.0.0']);

  try {
    const baseUrl = new URL(process.env.PLAYWRIGHT_TEST_BASE_URL ?? 'http://localhost:3000');
    hosts.add(baseUrl.hostname);
  } catch {
    // Ignore invalid environment values here; Playwright config owns that failure.
  }

  if (fs.existsSync('agent-browser.json')) {
    try {
      const parsed = JSON.parse(fs.readFileSync('agent-browser.json', 'utf8'));
      for (const host of parsed.allowedDomains ?? []) {
        hosts.add(String(host));
      }
    } catch {
      // Ignore malformed agent-browser config in recording validation.
    }
  }

  return [...hosts];
}

function hostAllowed(host, allowedHosts) {
  return allowedHosts.some((allowed) => {
    if (allowed.startsWith('*.')) {
      const suffix = allowed.slice(1);
      return host.endsWith(suffix);
    }

    return host === allowed;
  });
}

function containsUnsafeInput(value, context) {
  const text = String(value ?? '');
  if (!text) {
    return false;
  }

  if (SECRET_CONTEXT_PATTERN.test(context)) {
    return true;
  }

  if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }

  return isHighEntropySecretLike(text);
}

function isHighEntropySecretLike(value) {
  if (value.length < 20 || /\s/.test(value) || !/[A-Z]/.test(value) || !/[a-z]/.test(value) || !/\d/.test(value)) {
    return false;
  }

  const counts = new Map();
  for (const character of value) {
    counts.set(character, (counts.get(character) ?? 0) + 1);
  }

  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }

  return entropy >= 4;
}

function formatId(prefix, index) {
  return `${prefix}-${String(index).padStart(3, '0')}`;
}

function normalizeText(value) {
  if (value === undefined || value === null) {
    return undefined;
  }

  const text = String(value).replace(/\s+/g, ' ').trim();
  return text || undefined;
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sortKeysDeep(entry));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeysDeep(value[key])])
  );
}
