// Bounded, sanitized DOM evidence for heal prompts.
//
// Iteration-1 finding: locator-drift heals exhausted their attempt budget
// because the heal prompt carried ZERO observation of the live page — the
// model could only see the broken locator, so every candidate rewrote waits
// around the same wrong testid. The baseline failure artifacts already
// contain the ground truth: the Playwright error-context attachment carries
// the accessibility snapshot (roles + accessible names), and the trace's
// frame-snapshot events carry the live DOM with real data-testid values.
// This module distills BOTH into a small, redacted candidate list; nothing
// raw (no traces, no screenshots, no HTML bodies) ever reaches the prompt.

import zlib from 'node:zlib';

import { redactSecretMaterial } from '../lib/secret-safety.mjs';

export const HEAL_DOM_EVIDENCE_SOURCE = 'playwright-baseline-failure-artifacts';
export const MAX_DOM_EVIDENCE_SNAPSHOT_LINES = 80;
export const MAX_DOM_EVIDENCE_TESTID_CANDIDATES = 40;
export const MAX_DOM_EVIDENCE_LINE_CHARS = 240;
export const MAX_DOM_EVIDENCE_TOTAL_CHARS = 8000;
// Triage classifications whose heal prompt benefits from page observation.
// Locator drift is the primary target; synchronization repairs reuse the same
// evidence because choosing what to await requires the same page knowledge.
export const HEAL_DOM_EVIDENCE_CLASSIFICATIONS = Object.freeze(
  new Set(['locator-drift', 'synchronization'])
);

const MAX_ZIP_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_ZIP_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_CANDIDATE_TEXT_CHARS = 80;

function redactKnownValues(text, secretValues = []) {
  let result = String(text ?? '');
  const ordered = [...new Set(secretValues.filter((value) => typeof value === 'string' && value.length >= 4))]
    .sort((left, right) => right.length - left.length);
  for (const value of ordered) result = result.split(value).join('<redacted>');
  return result;
}

function sanitizedLine(value, secretValues) {
  return redactSecretMaterial(
    redactKnownValues(String(value ?? ''), secretValues)
      // eslint-disable-next-line no-control-regex -- strips ANSI escape sequences
      .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
      // eslint-disable-next-line no-control-regex -- strips raw control characters
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
  ).trim().slice(0, MAX_DOM_EVIDENCE_LINE_CHARS);
}

function boundedLineList(lines, { maxLines, secretValues, budget }) {
  const result = [];
  const seen = new Set();
  for (const line of lines) {
    if (typeof line !== 'string') continue;
    const sanitized = sanitizedLine(line, secretValues);
    if (!sanitized || seen.has(sanitized)) continue;
    if (result.length >= maxLines) break;
    if (budget.remaining - sanitized.length < 0) break;
    budget.remaining -= sanitized.length;
    seen.add(sanitized);
    result.push(sanitized);
  }
  return result;
}

// Extracts the "# Page snapshot" fenced YAML block from a Playwright
// error-context markdown attachment and returns trimmed, deduplicated,
// ref-stripped locator-candidate lines (roles, accessible names, text).
export function extractPageSnapshotLines(errorContextMarkdown, { secretValues = [] } = {}) {
  const text = String(errorContextMarkdown ?? '');
  const sectionMatch = text.match(/^# Page snapshot\s*$/m);
  if (!sectionMatch) return [];
  const afterSection = text.slice(sectionMatch.index + sectionMatch[0].length);
  const fenceMatch = afterSection.match(/```(?:yaml)?\r?\n([\s\S]*?)\r?\n```/);
  if (!fenceMatch) return [];
  const candidateLines = fenceMatch[1]
    .split(/\r?\n/)
    .map((line) => line
      .replace(/\s*\[(?:ref=[^\]]*|cursor=[^\]]*|active)\]/g, '')
      .trim())
    .filter(Boolean);
  return boundedLineList(candidateLines, {
    maxLines: MAX_DOM_EVIDENCE_SNAPSHOT_LINES,
    secretValues,
    budget: { remaining: MAX_DOM_EVIDENCE_TOTAL_CHARS }
  });
}

function isElementNode(node) {
  return Array.isArray(node) && typeof node[0] === 'string';
}

function collectTestidElements(node, found) {
  if (!isElementNode(node)) return;
  const tag = node[0];
  const hasAttributes = node[1] !== null
    && typeof node[1] === 'object'
    && !Array.isArray(node[1]);
  const attributes = hasAttributes ? node[1] : {};
  const children = node.slice(hasAttributes ? 2 : 1);
  const testId = attributes['data-testid'];
  if (typeof testId === 'string' && testId.trim()) {
    const text = children.find((child) => typeof child === 'string' && child.trim());
    // Later frame snapshots overwrite earlier ones so the candidate reflects
    // the page state closest to the failure.
    found.set(testId.trim(), {
      tag: String(tag).toLowerCase(),
      text: typeof text === 'string' ? text.trim().slice(0, MAX_CANDIDATE_TEXT_CHARS) : ''
    });
  }
  for (const child of children) collectTestidElements(child, found);
}

// Distills data-testid locator candidates from trace NDJSON: frame-snapshot
// events carry the live DOM as ["TAG", {attrs}, ...children] arrays. Only
// the distilled candidate lines survive; raw trace data never leaves here.
export function extractTestidCandidatesFromTrace(traceNdjsonText, { secretValues = [] } = {}) {
  const text = String(traceNdjsonText ?? '');
  if (!text.includes('frame-snapshot')) return [];
  const found = new Map();
  for (const line of text.split('\n')) {
    if (!line.includes('frame-snapshot')) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!event || event.type !== 'frame-snapshot') continue;
    collectTestidElements(event.snapshot?.html, found);
  }
  const lines = [...found.entries()].map(([testId, { tag, text: elementText }]) => (
    `data-testid "${testId}" on <${tag}>${elementText ? ` text "${elementText}"` : ''}`
  ));
  return boundedLineList(lines, {
    maxLines: MAX_DOM_EVIDENCE_TESTID_CANDIDATES,
    secretValues,
    budget: { remaining: MAX_DOM_EVIDENCE_TOTAL_CHARS }
  });
}

// Minimal read-only ZIP text extraction (central directory walk; stored and
// deflate entries only). Structural problems, oversized entries, and unknown
// compression methods are skipped silently: DOM evidence is best-effort and
// must never turn a heal run into a crash.
export function readZipTextEntries(zipBuffer, {
  nameFilter = () => false,
  maxEntryBytes = MAX_ZIP_ENTRY_BYTES,
  maxTotalBytes = MAX_ZIP_TOTAL_BYTES
} = {}) {
  const entries = [];
  try {
    if (!Buffer.isBuffer(zipBuffer) || zipBuffer.length < 22) return [];
    let endOffset = -1;
    const scanFloor = Math.max(0, zipBuffer.length - (64 * 1024 + 22));
    for (let cursor = zipBuffer.length - 22; cursor >= scanFloor; cursor -= 1) {
      if (zipBuffer.readUInt32LE(cursor) === 0x06054b50) {
        endOffset = cursor;
        break;
      }
    }
    if (endOffset < 0) return [];
    const entryCount = zipBuffer.readUInt16LE(endOffset + 10);
    let cursor = zipBuffer.readUInt32LE(endOffset + 16);
    let totalBytes = 0;
    for (let index = 0; index < entryCount; index += 1) {
      if (cursor + 46 > zipBuffer.length || zipBuffer.readUInt32LE(cursor) !== 0x02014b50) break;
      const method = zipBuffer.readUInt16LE(cursor + 10);
      const compressedSize = zipBuffer.readUInt32LE(cursor + 20);
      const uncompressedSize = zipBuffer.readUInt32LE(cursor + 24);
      const nameLength = zipBuffer.readUInt16LE(cursor + 28);
      const extraLength = zipBuffer.readUInt16LE(cursor + 30);
      const commentLength = zipBuffer.readUInt16LE(cursor + 32);
      const localOffset = zipBuffer.readUInt32LE(cursor + 42);
      const name = zipBuffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);
      cursor += 46 + nameLength + extraLength + commentLength;
      if (!nameFilter(name)) continue;
      if (uncompressedSize > maxEntryBytes || compressedSize > maxEntryBytes) continue;
      if (totalBytes + uncompressedSize > maxTotalBytes) break;
      if (localOffset + 30 > zipBuffer.length || zipBuffer.readUInt32LE(localOffset) !== 0x04034b50) continue;
      const localNameLength = zipBuffer.readUInt16LE(localOffset + 26);
      const localExtraLength = zipBuffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      if (dataStart + compressedSize > zipBuffer.length) continue;
      const raw = zipBuffer.subarray(dataStart, dataStart + compressedSize);
      let bytes;
      if (method === 0) {
        bytes = raw;
      } else if (method === 8) {
        try {
          bytes = zlib.inflateRawSync(raw, { maxOutputLength: maxEntryBytes });
        } catch {
          continue;
        }
      } else {
        continue;
      }
      if (bytes.length > maxEntryBytes) continue;
      totalBytes += bytes.length;
      entries.push({ name, text: bytes.toString('utf8') });
    }
  } catch {
    return [];
  }
  return entries;
}

export function buildHealDomEvidence({ pageSnapshotLines = [], testIdCandidates = [] } = {}) {
  return normalizeHealDomEvidence({
    pageSnapshot: pageSnapshotLines,
    testIdCandidates
  });
}

// Defensive prompt-side normalization: whatever the caller hands over, only
// bounded sanitized string lines under the canonical source label reach the
// provider prompt.
export function normalizeHealDomEvidence(value, { secretValues = [] } = {}) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const budget = { remaining: MAX_DOM_EVIDENCE_TOTAL_CHARS };
  const pageSnapshot = boundedLineList(
    Array.isArray(value.pageSnapshot) ? value.pageSnapshot : [],
    { maxLines: MAX_DOM_EVIDENCE_SNAPSHOT_LINES, secretValues, budget }
  );
  const testIdCandidates = boundedLineList(
    Array.isArray(value.testIdCandidates) ? value.testIdCandidates : [],
    { maxLines: MAX_DOM_EVIDENCE_TESTID_CANDIDATES, secretValues, budget }
  );
  if (pageSnapshot.length === 0 && testIdCandidates.length === 0) return undefined;
  return {
    source: HEAL_DOM_EVIDENCE_SOURCE,
    pageSnapshot,
    testIdCandidates
  };
}

function normalizeReportPath(value) {
  return String(value ?? '').trim().replace(/\\/g, '/');
}

function reportFileMatchesTarget(reportFile, target) {
  const normalized = normalizeReportPath(reportFile);
  if (!normalized) return false;
  const normalizedTarget = normalizeReportPath(target);
  return normalized === normalizedTarget
    || normalizedTarget.endsWith(`/${normalized}`)
    || normalized.endsWith(`/${normalizedTarget}`);
}

// Walks a Playwright JSON report and returns the artifact attachments
// ({ name, contentType, path }) of the target file's FAILED results only.
export function collectFailureAttachments(report, targetTestFile) {
  const attachments = [];
  const visitSuite = (suite, inheritedFile) => {
    if (!suite || typeof suite !== 'object') return;
    const suiteFile = suite.file ?? inheritedFile;
    for (const spec of Array.isArray(suite.specs) ? suite.specs : []) {
      if (!spec || typeof spec !== 'object') continue;
      if (!reportFileMatchesTarget(spec.file ?? suiteFile, targetTestFile)) continue;
      for (const testEntry of Array.isArray(spec.tests) ? spec.tests : []) {
        if (!testEntry || typeof testEntry !== 'object') continue;
        for (const result of Array.isArray(testEntry.results) ? testEntry.results : []) {
          if (!result || typeof result !== 'object' || result.status === 'passed') continue;
          for (const attachment of Array.isArray(result.attachments) ? result.attachments : []) {
            if (!attachment || typeof attachment !== 'object') continue;
            if (typeof attachment.name !== 'string' || typeof attachment.path !== 'string') continue;
            attachments.push({
              name: attachment.name,
              contentType: typeof attachment.contentType === 'string' ? attachment.contentType : '',
              path: attachment.path
            });
          }
        }
      }
    }
    for (const child of Array.isArray(suite.suites) ? suite.suites : []) {
      visitSuite(child, suiteFile);
    }
  };
  for (const suite of Array.isArray(report?.suites) ? report.suites : []) {
    visitSuite(suite, undefined);
  }
  return attachments;
}
