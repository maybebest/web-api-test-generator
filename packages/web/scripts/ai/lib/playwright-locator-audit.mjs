import fs from 'node:fs';
import path from 'node:path';

import { chromium } from '@playwright/test';

const DEFAULT_AUDIT_TIMEOUT_MS = 45_000;
const MAX_AUDIT_TIMEOUT_MS = 120_000;
const MAX_AUDITED_CANDIDATES = 500;

export function locatorAuditTimeoutMs(explicitTimeout, env = process.env) {
  const candidate = explicitTimeout ?? env?.LOCATOR_AUDIT_TIMEOUT_MS;
  const parsed = Number(candidate);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_AUDIT_TIMEOUT_MS;
  }
  return Math.min(parsed, MAX_AUDIT_TIMEOUT_MS);
}

/**
 * Opens the discovered URL in a separate headless Playwright context and records the real
 * Locator.count() result for every framework candidate. Candidate strings are never evaluated;
 * locators are rebuilt from the typed element evidence below.
 */
export async function auditLocatorCandidates({
  url,
  elements,
  storageStatePath,
  timeoutMs,
  chromiumImpl = chromium
}) {
  const effectiveTimeoutMs = locatorAuditTimeoutMs(timeoutMs);
  const deadline = Date.now() + effectiveTimeoutMs;
  const resolvedStorageState = resolveStorageState(storageStatePath);
  let browser;

  try {
    browser = await chromiumImpl.launch({ headless: true, timeout: remaining(deadline) });
    const context = await browser.newContext(resolvedStorageState ? { storageState: resolvedStorageState } : {});
    const page = await context.newPage();
    page.setDefaultTimeout(Math.min(10_000, remaining(deadline)));
    const response = await page.goto(url, { waitUntil: 'load', timeout: remaining(deadline) });
    const status = response?.status();
    if (status === 401 || status === 403) {
      const error = new Error(`Playwright locator audit navigation returned HTTP ${status}.`);
      error.code = `HTTP_${status}`;
      throw error;
    }
    await waitForAnyPreferredCandidate(page, elements, Math.min(5_000, remaining(deadline)));
    return await withTimeout(
      auditLocatorCandidatesOnPage(page, elements),
      remaining(deadline),
      'Playwright locator uniqueness audit timed out.'
    );
  } finally {
    if (browser) {
      await withTimeout(browser.close(), 5_000, 'Playwright locator audit browser close timed out.').catch(() => undefined);
    }
  }
}

async function waitForAnyPreferredCandidate(page, elements, timeoutMs) {
  const preferredLocators = elements
    .map((element) => {
      const preferred = element.candidateLocators?.[0];
      return preferred ? locatorForCandidate(page, element, preferred) : undefined;
    })
    .filter(Boolean);
  if (preferredLocators.length === 0) {
    return;
  }
  await Promise.any(
    preferredLocators.map((locator) => locator.first().waitFor({ state: 'attached', timeout: timeoutMs }))
  ).catch(() => undefined);
}

export async function auditLocatorCandidatesOnPage(page, elements) {
  const candidates = elements.flatMap((element, elementIndex) =>
    (element.candidateLocators ?? []).map((candidate, candidateIndex) => ({
      element,
      elementIndex,
      candidate,
      candidateIndex
    }))
  );
  if (candidates.length > MAX_AUDITED_CANDIDATES) {
    throw new Error(
      `Playwright locator audit refused ${candidates.length} candidates; maximum is ${MAX_AUDITED_CANDIDATES}. Scope discovery to a smaller page or container.`
    );
  }

  const counts = await Promise.all(
    candidates.map(async ({ element, candidate }) => locatorForCandidate(page, element, candidate).count())
  );
  const countByPosition = new Map(
    candidates.map(({ elementIndex, candidateIndex }, index) => [`${elementIndex}:${candidateIndex}`, counts[index]])
  );

  return elements.map((element, elementIndex) => ({
    ...element,
    candidateLocators: (element.candidateLocators ?? []).map((candidate, candidateIndex) => {
      const matchCount = countByPosition.get(`${elementIndex}:${candidateIndex}`) ?? 0;
      return {
        ...candidate,
        snapshotMatchCount: candidate.matchCount,
        snapshotUnique: candidate.unique,
        matchCount,
        unique: matchCount === 1,
        matchEvidence: 'playwright-live'
      };
    })
  }));
}

export function locatorForCandidate(page, element, candidate) {
  switch (candidate.type) {
    case 'testId':
      return page.getByTestId(requiredCandidateValue(element.testId, candidate.type));
    case 'role':
      return page.getByRole(requiredCandidateValue(element.role, candidate.type), {
        name: requiredCandidateValue(element.accessibleName, candidate.type)
      });
    case 'label':
      return page.getByLabel(requiredCandidateValue(element.label, candidate.type));
    case 'placeholder':
      return page.getByPlaceholder(requiredCandidateValue(element.placeholder, candidate.type));
    case 'text':
      return page.getByText(requiredCandidateValue(element.text, candidate.type));
    default:
      throw new Error(`Unsupported locator candidate type in live uniqueness audit: ${candidate.type ?? '(missing)'}`);
  }
}

function resolveStorageState(storageStatePath) {
  if (!storageStatePath) {
    return undefined;
  }
  const resolved = path.resolve(storageStatePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`E2E_AUTH_STATE_PATH does not exist for locator audit: ${resolved}`);
  }
  return resolved;
}

function requiredCandidateValue(value, type) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Locator candidate ${type} is missing the typed value required for live audit.`);
  }
  return value;
}

function remaining(deadline) {
  const value = deadline - Date.now();
  if (value <= 0) {
    throw new Error('Playwright locator uniqueness audit timed out.');
  }
  return value;
}

function withTimeout(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      timer.unref?.();
    })
  ]).finally(() => clearTimeout(timer));
}
