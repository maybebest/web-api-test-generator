import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';

import {
  HEAL_DOM_EVIDENCE_SOURCE,
  MAX_DOM_EVIDENCE_LINE_CHARS,
  MAX_DOM_EVIDENCE_SNAPSHOT_LINES,
  MAX_DOM_EVIDENCE_TESTID_CANDIDATES,
  buildHealDomEvidence,
  extractPageSnapshotLines,
  extractTestidCandidatesFromTrace,
  normalizeHealDomEvidence,
  readZipTextEntries
} from '../healer/test-heal-dom-evidence.mjs';
import { buildTestHealPrompt } from '../healer/test-heal.mjs';
import { collectBaselineDomEvidence, healSingleTest } from '../heal-test.mjs';

// Mirrors the real Playwright error-context.md captured from the seeded
// wrong-testid feed failure (aria snapshot: roles + accessible names, refs).
const FEED_ERROR_CONTEXT = `# Instructions

- Following Playwright test failed.

# Test info

- Name: smoke/flow.spec.ts >> Complex feed lazy loading [DC-001]
- Location: tests/regression/flow.spec.ts:79:7

# Error details

\`\`\`
Error: locator.waitFor: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByTestId('unread-count-badge').filter({ hasText: /^15$/ }) to be visible
\`\`\`

# Page snapshot

\`\`\`yaml
- generic [active] [ref=e1]:
  - banner [ref=e2]:
    - navigation "Fixture navigation" [ref=e3]:
      - strong [ref=e4]: Web test fixture
      - link "Home" [ref=e5] [cursor=pointer]:
        - /url: /
  - main [ref=e7]:
    - heading "Activity feed" [level=1] [ref=e8]
    - paragraph [ref=e9]: "Unread stories: 15"
    - generic "Stories" [ref=e10]:
      - article [ref=e11]:
        - button "Details" [ref=e22] [cursor=pointer]
        - button "Comments" [ref=e23] [cursor=pointer]
      - article [ref=e24]:
        - button "Details" [ref=e35] [cursor=pointer]
        - button "Comments" [ref=e36] [cursor=pointer]
\`\`\`

# Test source

\`\`\`ts
  13  |     return this.page.getByTestId('unread-count-badge');
\`\`\`
`;

// Mirrors real trace NDJSON: frame-snapshot events carry the live DOM as
// ["TAG", {attrs}, ...children] arrays; back-references are [[n, m]] pairs.
const FEED_TRACE_NDJSON = [
  JSON.stringify({ type: 'context-options', options: {} }),
  'not-json garbage line',
  JSON.stringify({
    type: 'frame-snapshot',
    snapshot: {
      html: ['HTML', {}, ['BODY', {},
        ['P', {}, 'Unread stories: ',
          ['SPAN', { class: 'unread-pill', id: 'unread-badge', 'data-testid': 'unread-badge' }, '0']],
        ['BUTTON', { id: 'load-more', 'data-testid': 'feed-load-more', disabled: '' }, 'Load more stories']]]
    }
  }),
  JSON.stringify({
    type: 'frame-snapshot',
    snapshot: {
      html: ['HTML', {}, ['BODY', {}, [[2, 14]],
        ['P', {}, [[2, 37]],
          ['SPAN', { class: 'unread-pill', id: 'unread-badge', 'data-testid': 'unread-badge' }, '15']],
        ['ARTICLE', { 'data-testid': 'feed-item-1' }, ['H3', {}, 'Nightly pipeline finished']]]]
    }
  }),
  JSON.stringify({ type: 'screencast-frame', sha1: 'abc' })
].join('\n');

test('extractPageSnapshotLines keeps deduplicated locator-candidate lines without refs', () => {
  const lines = extractPageSnapshotLines(FEED_ERROR_CONTEXT);

  assert.ok(lines.includes('- paragraph: "Unread stories: 15"'), JSON.stringify(lines));
  assert.ok(lines.includes('- heading "Activity feed" [level=1]'));
  // Repeated card controls collapse to one candidate line each.
  assert.equal(lines.filter((line) => line === '- button "Details"').length, 1);
  assert.equal(lines.filter((line) => line === '- button "Comments"').length, 1);
  // No [ref=...] / [cursor=...] noise and no non-snapshot sections leak through.
  assert.ok(lines.every((line) => !line.includes('[ref=') && !line.includes('[cursor=')));
  assert.ok(lines.every((line) => !line.includes('unread-count-badge')));
});

test('extractPageSnapshotLines bounds output and redacts secret values', () => {
  const bigSnapshot = [
    '# Page snapshot',
    '',
    '```yaml',
    ...Array.from({ length: 500 }, (_, index) => `- button "Item ${index}" [ref=e${index}]`),
    '- textbox "Password" [ref=e900]: hunter2-secret-value',
    '```'
  ].join('\n');
  const lines = extractPageSnapshotLines(bigSnapshot, { secretValues: ['hunter2-secret-value'] });

  assert.ok(lines.length <= MAX_DOM_EVIDENCE_SNAPSHOT_LINES);
  assert.ok(lines.every((line) => line.length <= MAX_DOM_EVIDENCE_LINE_CHARS));
  assert.ok(lines.every((line) => !line.includes('hunter2-secret-value')));
});

test('extractPageSnapshotLines returns nothing without a page snapshot section', () => {
  assert.deepEqual(extractPageSnapshotLines('# Error details\n\n```\nboom\n```\n'), []);
  assert.deepEqual(extractPageSnapshotLines(''), []);
  assert.deepEqual(extractPageSnapshotLines(undefined), []);
});

test('extractTestidCandidatesFromTrace surfaces live data-testid candidates with the latest text', () => {
  const candidates = extractTestidCandidatesFromTrace(FEED_TRACE_NDJSON);

  const badge = candidates.find((line) => line.includes('unread-badge'));
  assert.ok(badge, JSON.stringify(candidates));
  // The LAST frame snapshot wins: badge text is 15, not the initial 0.
  assert.ok(badge.includes('"15"'), badge);
  assert.ok(badge.toLowerCase().includes('span'), badge);
  assert.ok(candidates.some((line) => line.includes('feed-load-more')));
  assert.ok(candidates.some((line) => line.includes('feed-item-1')));
  assert.ok(candidates.length <= MAX_DOM_EVIDENCE_TESTID_CANDIDATES);
});

test('extractTestidCandidatesFromTrace tolerates garbage and redacts secret values', () => {
  const traceText = [
    '{"type":"frame-snapshot"',
    JSON.stringify({
      type: 'frame-snapshot',
      snapshot: { html: ['DIV', { 'data-testid': 'token-box' }, 'sk-secret-abcdef'] }
    })
  ].join('\n');
  const candidates = extractTestidCandidatesFromTrace(traceText, { secretValues: ['sk-secret-abcdef'] });

  assert.equal(candidates.length, 1);
  assert.ok(candidates[0].includes('token-box'));
  assert.ok(!candidates[0].includes('sk-secret-abcdef'));
  assert.deepEqual(extractTestidCandidatesFromTrace(''), []);
  assert.deepEqual(extractTestidCandidatesFromTrace(undefined), []);
});

function crc32(bytes) {
  return zlib.crc32(bytes);
}

function buildZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const { name, text, method } of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const raw = Buffer.from(text, 'utf8');
    const data = method === 8 ? zlib.deflateRawSync(raw) : raw;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(Buffer.concat([central, nameBytes]));
    localParts.push(local, nameBytes, data);
    offset += local.length + nameBytes.length + data.length;
  }
  const centralBytes = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralBytes, end]);
}

test('readZipTextEntries reads stored and deflated entries that match the filter', () => {
  const zip = buildZip([
    { name: '0-trace.trace', text: FEED_TRACE_NDJSON, method: 8 },
    { name: '0-trace.network', text: '{"cookie":"secret"}', method: 0 },
    { name: 'resources/blob.bin', text: 'binary-ish', method: 0 },
    { name: 'test.trace', text: '{"type":"context-options"}', method: 0 }
  ]);
  const entries = readZipTextEntries(zip, {
    nameFilter: (name) => /(^|\/)[^/]*\.trace$/.test(name)
  });

  assert.deepEqual(entries.map((entry) => entry.name).sort(), ['0-trace.trace', 'test.trace']);
  const traceEntry = entries.find((entry) => entry.name === '0-trace.trace');
  assert.ok(traceEntry.text.includes('unread-badge'));
});

test('readZipTextEntries enforces byte bounds and survives corrupt buffers', () => {
  const zip = buildZip([{ name: '0-trace.trace', text: 'x'.repeat(4096), method: 0 }]);
  assert.deepEqual(readZipTextEntries(zip, { nameFilter: () => true, maxEntryBytes: 128 }), []);
  assert.deepEqual(readZipTextEntries(Buffer.from('not a zip'), { nameFilter: () => true }), []);
  assert.deepEqual(readZipTextEntries(Buffer.alloc(0), { nameFilter: () => true }), []);
});

test('buildHealDomEvidence returns undefined when there is nothing to report', () => {
  assert.equal(buildHealDomEvidence({ pageSnapshotLines: [], testIdCandidates: [] }), undefined);
  const evidence = buildHealDomEvidence({
    pageSnapshotLines: ['- paragraph: "Unread stories: 15"'],
    testIdCandidates: []
  });
  assert.equal(evidence.source, HEAL_DOM_EVIDENCE_SOURCE);
  assert.deepEqual(evidence.pageSnapshot, ['- paragraph: "Unread stories: 15"']);
  assert.deepEqual(evidence.testIdCandidates, []);
});

test('normalizeHealDomEvidence bounds, sanitizes, and drops non-string entries', () => {
  const normalized = normalizeHealDomEvidence({
    source: 'anything-the-caller-claims',
    pageSnapshot: [
      '- textbox "Password": hunter2-secret-value',
      42,
      null,
      `- generic: ${'y'.repeat(2 * MAX_DOM_EVIDENCE_LINE_CHARS)}`,
      ...Array.from({ length: 300 }, (_, index) => `- row ${index}`)
    ],
    testIdCandidates: Array.from({ length: 300 }, (_, index) => `data-testid "cell-${index}"`)
  }, { secretValues: ['hunter2-secret-value'] });

  assert.equal(normalized.source, HEAL_DOM_EVIDENCE_SOURCE);
  assert.ok(normalized.pageSnapshot.length <= MAX_DOM_EVIDENCE_SNAPSHOT_LINES);
  assert.ok(normalized.testIdCandidates.length <= MAX_DOM_EVIDENCE_TESTID_CANDIDATES);
  assert.ok(normalized.pageSnapshot.every((line) => typeof line === 'string'));
  assert.ok(normalized.pageSnapshot.every((line) => line.length <= MAX_DOM_EVIDENCE_LINE_CHARS));
  assert.ok(!JSON.stringify(normalized).includes('hunter2-secret-value'));
  assert.equal(normalizeHealDomEvidence(undefined), undefined);
  assert.equal(normalizeHealDomEvidence(null), undefined);
  assert.equal(normalizeHealDomEvidence({ pageSnapshot: [], testIdCandidates: [] }), undefined);
  assert.equal(normalizeHealDomEvidence('not-an-object'), undefined);
});

function writeBaselineArtifacts(root, { errorContext = FEED_ERROR_CONTEXT, traceNdjson = FEED_TRACE_NDJSON } = {}) {
  const runDir = path.join(root, '.ai-runs', 'heal-verify-1');
  const testResultsDir = path.join(runDir, 'test-results');
  const caseDir = path.join(testResultsDir, 'smoke-flow-case');
  fs.mkdirSync(caseDir, { recursive: true });
  const errorContextPath = path.join(caseDir, 'error-context.md');
  fs.writeFileSync(errorContextPath, errorContext);
  const tracePath = path.join(caseDir, 'trace.zip');
  fs.writeFileSync(tracePath, buildZip([{ name: '0-trace.trace', text: traceNdjson, method: 8 }]));
  const report = {
    suites: [{
      file: 'regression/flow.spec.ts',
      specs: [{
        title: 'Complex feed lazy loading [DC-001]',
        file: 'regression/flow.spec.ts',
        tests: [{
          results: [{
            status: 'timedOut',
            errors: [{ message: "locator.waitFor: Test timeout of 30000ms exceeded. waiting for getByTestId('unread-count-badge')" }],
            attachments: [
              { name: 'screenshot', contentType: 'image/png', path: path.join(caseDir, 'test-failed-1.png') },
              { name: 'error-context', contentType: 'text/markdown', path: errorContextPath },
              { name: 'trace', contentType: 'application/zip', path: tracePath }
            ]
          }]
        }]
      }]
    }]
  };
  const jsonReportPath = path.join(runDir, 'playwright.json');
  fs.writeFileSync(jsonReportPath, JSON.stringify(report));
  return {
    execution: {
      passed: false,
      attempted: true,
      stage: 'runtime-test',
      issues: ['Playwright exited 1 for tests/regression/flow.spec.ts.'],
      artifacts: [{ project: 'local-chromium', jsonReportPath, testResultsDir }],
      runDir
    },
    errorContextPath,
    tracePath,
    caseDir
  };
}

test('collectBaselineDomEvidence assembles bounded DOM evidence from the failed baseline artifacts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'heal-dom-evidence-'));
  const { execution } = writeBaselineArtifacts(root);

  const evidence = collectBaselineDomEvidence(execution, 'tests/regression/flow.spec.ts', { secretValues: [] });

  assert.equal(evidence.source, HEAL_DOM_EVIDENCE_SOURCE);
  assert.ok(evidence.pageSnapshot.some((line) => line.includes('Unread stories: 15')));
  assert.ok(evidence.testIdCandidates.some((line) => line.includes('unread-badge')));
  assert.ok(evidence.testIdCandidates.every((line) => !line.includes('unread-count-badge')));
});

test('collectBaselineDomEvidence ignores other test files and attachments outside the run directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'heal-dom-evidence-'));
  const { execution } = writeBaselineArtifacts(root);

  assert.equal(
    collectBaselineDomEvidence(execution, 'tests/regression/other.spec.ts', { secretValues: [] }),
    undefined
  );

  // An attachment path that escapes the artifact's test-results directory is
  // never read, even when the report claims it is the error context.
  const outside = path.join(root, 'outside.md');
  fs.writeFileSync(outside, '# Page snapshot\n\n```yaml\n- button "Escaped"\n```\n');
  const report = JSON.parse(fs.readFileSync(execution.artifacts[0].jsonReportPath, 'utf8'));
  report.suites[0].specs[0].tests[0].results[0].attachments = [
    { name: 'error-context', contentType: 'text/markdown', path: outside }
  ];
  fs.writeFileSync(execution.artifacts[0].jsonReportPath, JSON.stringify(report));
  assert.equal(
    collectBaselineDomEvidence(execution, 'tests/regression/flow.spec.ts', { secretValues: [] }),
    undefined
  );
});

test('collectBaselineDomEvidence never throws on unreadable or malformed artifacts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'heal-dom-evidence-'));
  const { execution, errorContextPath, tracePath } = writeBaselineArtifacts(root);
  fs.writeFileSync(tracePath, Buffer.from('corrupt zip'));
  fs.rmSync(errorContextPath);

  assert.equal(collectBaselineDomEvidence(execution, 'tests/regression/flow.spec.ts', { secretValues: [] }), undefined);
  assert.equal(collectBaselineDomEvidence({ passed: false, artifacts: [] }, 'tests/regression/flow.spec.ts', { secretValues: [] }), undefined);
  assert.equal(collectBaselineDomEvidence(undefined, 'tests/regression/flow.spec.ts', { secretValues: [] }), undefined);
});

const SEEDED_SOURCE = `import { test, expect } from '../../fixtures/test';

test('feed badge', async ({ page }) => {
  await page.getByTestId('unread-count-badge').waitFor({ state: 'visible' });
  await expect(page.getByTestId('unread-count-badge')).toHaveText('15');
});
`;

test('seeded wrong-testid failure: the assembled heal prompt contains the REAL testid from the DOM snapshot', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'heal-dom-evidence-'));
  const { execution } = writeBaselineArtifacts(root);
  const domEvidence = collectBaselineDomEvidence(execution, 'tests/regression/flow.spec.ts', { secretValues: [] });

  const prompt = buildTestHealPrompt({
    testPath: 'tests/regression/flow.spec.ts',
    source: SEEDED_SOURCE,
    evidence: ["Complex feed lazy loading [DC-001]: locator.waitFor: Test timeout of 30000ms exceeded. waiting for getByTestId('unread-count-badge')"],
    attempt: 1,
    maxAttempts: 3,
    domEvidence,
    env: {}
  });

  const parsed = JSON.parse(prompt);
  assert.equal(parsed.schemaVersion, 'playwright-test-heal/v1');
  assert.ok(parsed.domEvidence, 'assembled prompt must carry the domEvidence section');
  assert.ok(
    parsed.domEvidence.testIdCandidates.some((line) => line.includes('unread-badge')),
    JSON.stringify(parsed.domEvidence)
  );
  assert.ok(parsed.domEvidence.pageSnapshot.some((line) => line.includes('Unread stories: 15')));
  // The wrong seeded testid stays visible in the runtime evidence, so the
  // model can see both the broken locator and the real candidate.
  assert.ok(parsed.runtimeFailureEvidence.some((line) => line.includes('unread-count-badge')));
});

test('buildTestHealPrompt omits domEvidence when none was collected', () => {
  const prompt = buildTestHealPrompt({
    testPath: 'tests/regression/flow.spec.ts',
    source: SEEDED_SOURCE,
    evidence: ['boom'],
    attempt: 1,
    maxAttempts: 3,
    env: {}
  });
  assert.ok(!('domEvidence' in JSON.parse(prompt)));
});

test('healSingleTest forwards baseline DOM evidence into the heal prompt for locator-drift failures', async () => {
  const webRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'heal-dom-wire-'));
  const testDir = path.join(webRoot, 'tests', 'regression');
  fs.mkdirSync(testDir, { recursive: true });
  fs.writeFileSync(path.join(webRoot, 'tests', '.no-header-allowlist'), 'tests/regression/flow.spec.ts\n');
  fs.writeFileSync(path.join(testDir, 'flow.spec.ts'), SEEDED_SOURCE, { mode: 0o644 });
  const { execution } = writeBaselineArtifacts(webRoot);
  execution.issues = ["locator resolved to 0 elements: getByTestId('unread-count-badge')"];
  const healCalls = [];

  const result = await healSingleTest({
    testPath: 'tests/regression/flow.spec.ts',
    env: { AI_AUTOHEAL_ENABLED: 'true' },
    webRoot,
    log: () => {},
    discoverSpec: () => null,
    executeStandalone: () => execution,
    heal: async (options) => {
      healCalls.push(options);
      throw new Error('capture-only stub brain');
    }
  });

  assert.equal(result.status, 'brain-error');
  assert.equal(healCalls.length, 1);
  const domEvidence = healCalls[0].domEvidence;
  assert.ok(domEvidence, 'heal() must receive the baseline DOM evidence');
  assert.ok(domEvidence.testIdCandidates.some((line) => line.includes('unread-badge')));
});
