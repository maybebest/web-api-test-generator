import crypto from 'node:crypto';

const TEST_ID_CANDIDATE_SCORE = 100;
const ROLE_CANDIDATE_SCORE = 90;
const LABEL_CANDIDATE_SCORE = 80;
const PLACEHOLDER_CANDIDATE_SCORE = 70;
const TEXT_CANDIDATE_SCORE = 60;

const LOCATOR_SAFE_ROLES = new Set([
  'alert',
  'button',
  'checkbox',
  'combobox',
  'dialog',
  'heading',
  'link',
  'listbox',
  'menuitem',
  'option',
  'radio',
  'searchbox',
  'status',
  'switch',
  'tab',
  'textbox'
]);

export function buildSelectorCandidates(element, options = {}) {
  const testIdAttribute = options.testIdAttribute ?? 'data-testid';
  const candidates = [];
  const role = normalizeValue(element.role);
  const accessibleName = normalizeValue(element.accessibleName ?? element.name);
  const label = normalizeValue(element.label);
  const placeholder = normalizeValue(element.placeholder);
  const testId = normalizeValue(element.testId ?? element.attributes?.[testIdAttribute]);
  const text = normalizeValue(element.text);

  if (isStableTestId(testId)) {
    candidates.push({
      type: 'testId',
      locator: `page.getByTestId(${quote(testId)})`,
      score: TEST_ID_CANDIDATE_SCORE,
      reason: `Stable meaningful ${testIdAttribute} is available; prefer it before user-facing locator fallbacks.`
    });
  }

  if (role && accessibleName && LOCATOR_SAFE_ROLES.has(role)) {
    candidates.push({
      type: 'role',
      locator: `page.getByRole(${quote(role)}, { name: ${quote(accessibleName)} })`,
      score: ROLE_CANDIDATE_SCORE,
      reason: 'Role plus accessible name is preferred when no stable test id exists.'
    });
  }

  if (label) {
    candidates.push({
      type: 'label',
      locator: `page.getByLabel(${quote(label)})`,
      score: LABEL_CANDIDATE_SCORE,
      reason: 'Form control has a label visible to users.'
    });
  }

  if (placeholder) {
    candidates.push({
      type: 'placeholder',
      locator: `page.getByPlaceholder(${quote(placeholder)})`,
      score: PLACEHOLDER_CANDIDATE_SCORE,
      reason: 'Placeholder is available when no stronger label is captured.'
    });
  }

  if (isStableText(text) && text !== accessibleName && text !== label && text !== placeholder) {
    candidates.push({
      type: 'text',
      locator: `page.getByText(${quote(text)})`,
      score: TEXT_CANDIDATE_SCORE,
      reason: 'Visible text looks stable enough to use as a fallback.'
    });
  }

  return uniqueLocators(candidates).sort((left, right) => right.score - left.score);
}

export function createDiscoveryElement(rawElement, index, options = {}) {
  const attributes = sanitizeAttributes(rawElement.attributes ?? {});
  const element = {
    elementId: stableElementId(rawElement, index),
    role: normalizeValue(rawElement.role),
    accessibleName: normalizeValue(rawElement.accessibleName ?? rawElement.name),
    label: normalizeValue(rawElement.label ?? attributes['aria-label']),
    placeholder: normalizeValue(rawElement.placeholder ?? attributes.placeholder),
    text: normalizeValue(rawElement.text),
    href: normalizeValue(rawElement.href ?? attributes.href),
    testId: normalizeValue(rawElement.testId ?? attributes['data-testid'] ?? attributes['data-test-id']),
    attributes
  };

  element.candidateLocators = buildSelectorCandidates(element, options);
  return element;
}

/**
 * Records how many captured accessibility elements resolve to each framework candidate.
 * This is deterministic snapshot evidence, not an agent-browser @e ref and not a claim that
 * an arbitrary CSS selector is safe. The artifact reviewer accepts only a preferred candidate
 * whose matchCount is exactly one.
 */
export function annotateSnapshotCandidateMatchCounts(elements) {
  const counts = new Map();
  for (const element of elements) {
    for (const candidate of element.candidateLocators ?? []) {
      counts.set(candidate.locator, (counts.get(candidate.locator) ?? 0) + 1);
    }
  }

  return elements.map((element) => ({
    ...element,
    candidateLocators: (element.candidateLocators ?? []).map((candidate, index) => {
      const matchCount = counts.get(candidate.locator) ?? 0;
      return {
        ...candidate,
        preferred: index === 0,
        matchCount,
        unique: matchCount === 1,
        matchEvidence: 'accessibility-snapshot'
      };
    })
  }));
}

export function selectBestLocator(element, options = {}) {
  return buildSelectorCandidates(element, options)[0];
}

export function hasForbiddenAgentRef(value) {
  return /@e\d+\b/.test(String(value ?? ''));
}

export function hasForbiddenLocatorPattern(value) {
  const text = String(value ?? '');
  return /xpath=|(^|[\s'"])\/\/|:nth-child\s*\(|:nth-of-type\s*\(|page\.locator\s*\(/i.test(text);
}

export function isStableTestId(value) {
  const text = normalizeValue(value);
  if (!text) {
    return false;
  }

  if (text.length > 80 || /\s/.test(text)) {
    return false;
  }

  if (!/[a-z]/i.test(text) || /^[0-9_-]+$/.test(text)) {
    return false;
  }

  if (/^[a-f0-9]{8,}$/i.test(text) || /\b\d{10,}\b/.test(text)) {
    return false;
  }

  return !/[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}/i.test(text);
}

export function isLocatorSafeRole(value) {
  return LOCATOR_SAFE_ROLES.has(normalizeValue(value));
}

function normalizeValue(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).replace(/\s+/g, ' ').trim();
  return text.length > 0 ? text : null;
}

function quote(value) {
  return JSON.stringify(value);
}

function uniqueLocators(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.locator)) {
      return false;
    }
    seen.add(candidate.locator);
    return true;
  });
}

function isStableText(value) {
  const text = normalizeValue(value);
  if (!text) {
    return false;
  }

  if (text.length > 80) {
    return false;
  }

  if (/^\d+$/.test(text) || /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/.test(text)) {
    return false;
  }

  if (/[A-F0-9]{8,}/.test(text)) {
    return false;
  }

  return true;
}

function sanitizeAttributes(attributes) {
  return Object.fromEntries(
    Object.entries(attributes)
      .filter(([key, value]) => value !== undefined && value !== null && !/^ref$/i.test(key))
      .map(([key, value]) => [key, String(value)])
  );
}

function stableElementId(element, index) {
  const identity = [
    index,
    element.role,
    element.accessibleName ?? element.name,
    element.label,
    element.placeholder,
    element.text,
    element.href,
    element.testId
  ]
    .filter((value) => value !== undefined && value !== null)
    .join('|');

  return `el-${crypto.createHash('sha1').update(identity).digest('hex').slice(0, 10)}`;
}
