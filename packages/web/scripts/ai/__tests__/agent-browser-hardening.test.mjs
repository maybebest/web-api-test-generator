import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  agentBrowserTimeoutMs,
  classifyAgentBrowserResult,
  formatAgentBrowserFailure,
  runAgentBrowser
} from '../lib/agent-browser-runner.mjs';
import { buildAgentBrowserOpenArgs, resolveDiscoveryAuthStatePath } from '../lib/discovery-auth.mjs';
import {
  auditLocatorCandidatesOnPage,
  locatorAuditTimeoutMs
} from '../lib/playwright-locator-audit.mjs';
import { createScopedRoleCandidate } from '../lib/scoped-role-locator.mjs';
import { annotateSnapshotCandidateMatchCounts, createDiscoveryElement } from '../lib/selector-policy.mjs';
import {
  findLatestDomDiscoveryArtifactForReview,
  reviewDomDiscoveryArtifact,
  reviewDomDiscoveryArtifactObject
} from '../review-dom-discovery.mjs';

test('configured discovery auth state is a regular file and --state precedes the open command', async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'discovery-auth-state-'));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  const statePath = path.join(workspace, 'user.json');
  await fs.writeFile(statePath, '{"cookies":[],"origins":[]}\n');

  const resolved = resolveDiscoveryAuthStatePath({ E2E_AUTH_STATE_PATH: statePath });

  assert.equal(resolved, path.resolve(statePath));
  assert.deepEqual(
    buildAgentBrowserOpenArgs({
      session: 'dom-flow-test',
      url: 'https://www.dev.rtd.js-devops.co.uk/planning',
      authStatePath: resolved
    }),
    [
      '--session',
      'dom-flow-test',
      '--state',
      path.resolve(statePath),
      'open',
      'https://www.dev.rtd.js-devops.co.uk/planning'
    ]
  );
});

test('configured discovery auth state fails fast when the file is missing or not regular', async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'discovery-auth-invalid-'));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));

  assert.throws(
    () => resolveDiscoveryAuthStatePath({ E2E_AUTH_STATE_PATH: path.join(workspace, 'missing.json') }),
    /existing regular file/
  );
  assert.throws(
    () => resolveDiscoveryAuthStatePath({ E2E_AUTH_STATE_PATH: workspace }),
    /existing regular file/
  );
});

test('discovery without configured auth state omits the agent-browser --state option', () => {
  assert.equal(resolveDiscoveryAuthStatePath({}), undefined);
  assert.equal(resolveDiscoveryAuthStatePath({ E2E_AUTH_STATE_PATH: '   ' }), undefined);
  assert.deepEqual(
    buildAgentBrowserOpenArgs({
      session: 'dom-public-flow',
      url: 'http://127.0.0.1:3000/'
    }),
    ['--session', 'dom-public-flow', 'open', 'http://127.0.0.1:3000/']
  );
});

test('agent-browser execution is timeout-bounded and returns a classified fallback', () => {
  const calls = [];
  const timeoutError = Object.assign(new Error('spawnSync agent-browser ETIMEDOUT'), { code: 'ETIMEDOUT' });
  const result = runAgentBrowser(['snapshot', '-i', '--json'], {
    timeoutMs: 1_234,
    resolveBin: () => ({ command: '/test/agent-browser', prefixArgs: [] }),
    spawnSyncImpl: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: null, signal: 'SIGKILL', stdout: '', stderr: '', error: timeoutError };
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.timeout, 1_234);
  assert.equal(calls[0].options.killSignal, 'SIGKILL');
  assert.equal(calls[0].options.shell, false);
  assert.equal(result.failure.kind, 'timeout');
  assert.equal(result.failure.fallback.strategy, 'retry-once-then-playwright-cli');
  assert.match(result.failure.fallback.documentation, /AGENT_BROWSER\.md#classified-failures-and-fallbacks/);
  assert.match(formatAgentBrowserFailure(result.failure), /Fallback:/);
});

test('agent-browser timeout configuration is positive, defaulted, and capped', () => {
  assert.equal(agentBrowserTimeoutMs(undefined, {}), 45_000);
  assert.equal(agentBrowserTimeoutMs(undefined, { AGENT_BROWSER_TIMEOUT_MS: '90000' }), 90_000);
  assert.equal(agentBrowserTimeoutMs(-1, {}), 45_000);
  assert.equal(agentBrowserTimeoutMs(900_000, {}), 300_000);
});

test('agent-browser failures are explicitly classified with deterministic fallbacks', () => {
  const cases = [
    ['http-401', { status: 1, stdout: '', stderr: 'HTTP/1.1 401 Unauthorized' }],
    ['http-403', { status: 1, stdout: '', stderr: 'HTTP status 403 Forbidden' }],
    ['challenge', { status: 0, stdout: 'Checking your browser — cf-challenge', stderr: '' }],
    ['captcha', { status: 0, stdout: '<iframe title="reCAPTCHA">', stderr: '' }],
    ['process-failure', { status: 2, stdout: '', stderr: 'browser process exited' }]
  ];

  for (const [expectedKind, result] of cases) {
    const failure = classifyAgentBrowserResult(result);
    assert.equal(failure.kind, expectedKind);
    assert.ok(failure.fallback.nextStep);
    assert.equal(typeof failure.fallback.retryable, 'boolean');
  }

  const empty = classifyAgentBrowserResult(
    { status: 0, stdout: '{"success":true,"data":[]}', stderr: '' },
    { expectSnapshot: true, snapshotElementCount: 0 }
  );
  assert.equal(empty.kind, 'empty-snapshot');
  assert.equal(empty.fallback.strategy, 'playwright-cli-snapshot');
});

test('snapshot locator audit records match counts and uniqueness for every candidate', () => {
  const audited = annotateSnapshotCandidateMatchCounts([
    createDiscoveryElement({ role: 'button', accessibleName: 'Save' }, 0),
    createDiscoveryElement({ role: 'button', accessibleName: 'Save' }, 1),
    createDiscoveryElement({ role: 'link', accessibleName: 'Help' }, 2)
  ]);

  assert.equal(audited[0].candidateLocators[0].preferred, true);
  assert.equal(audited[0].candidateLocators[0].matchCount, 2);
  assert.equal(audited[0].candidateLocators[0].unique, false);
  assert.equal(audited[0].candidateLocators[0].matchEvidence, 'accessibility-snapshot');
  assert.equal(audited[2].candidateLocators[0].matchCount, 1);
  assert.equal(audited[2].candidateLocators[0].unique, true);
});

test('live Playwright locator audit rebuilds typed candidates and records real count evidence', async () => {
  const snapshotAudited = annotateSnapshotCandidateMatchCounts([
    createDiscoveryElement({ role: 'button', accessibleName: 'Save' }, 0),
    createDiscoveryElement({ role: 'button', accessibleName: 'Save' }, 1),
    createDiscoveryElement({ role: 'link', accessibleName: 'Help' }, 2)
  ]);
  const calls = [];
  const page = fakePage(
    {
      'role:button:Save': 2,
      'role:link:Help': 1
    },
    calls
  );

  const liveAudited = await auditLocatorCandidatesOnPage(page, snapshotAudited);
  assert.deepEqual(calls, ['role:button:Save', 'role:button:Save', 'role:link:Help']);
  assert.equal(liveAudited[0].candidateLocators[0].snapshotMatchCount, 2);
  assert.equal(liveAudited[0].candidateLocators[0].matchCount, 2);
  assert.equal(liveAudited[0].candidateLocators[0].matchEvidence, 'playwright-live');
  assert.equal(liveAudited[2].candidateLocators[0].matchCount, 1);
  assert.equal(liveAudited[2].candidateLocators[0].unique, true);
  assert.equal(locatorAuditTimeoutMs(undefined, {}), 45_000);
  assert.equal(locatorAuditTimeoutMs(500_000, {}), 120_000);
});

test('scoped role live audit and reviewer require one exact match', async () => {
  const base = createScopedRoleCandidate({ scopeRole: 'banner', targetRole: 'button' });
  const snapshot = [{
    elementId: 'el-account', role: 'button', accessibleName: null, label: null,
    placeholder: null, text: null, href: null, testId: null, attributes: {},
    snapshotOccurrences: 1,
    candidateLocators: [{
      ...base, preferred: true, matchCount: 1, unique: true,
      matchEvidence: 'accessibility-snapshot'
    }]
  }];
  const live = await auditLocatorCandidatesOnPage(scopedFakePage(1), snapshot);
  assert.equal(live[0].candidateLocators[0].snapshotMatchCount, 1);
  assert.equal(live[0].candidateLocators[0].matchCount, 1);
  assert.equal(live[0].candidateLocators[0].matchEvidence, 'playwright-live');

  for (const [count, expectedPassed] of [[0, false], [1, true], [2, false]]) {
    const audited = await auditLocatorCandidatesOnPage(scopedFakePage(count), snapshot);
    const reviewed = reviewDomDiscoveryArtifactObject(scopedArtifact(audited));
    assert.equal(reviewed.passed, expectedPassed, reviewed.issues.join('\n'));
  }

  const mismatchedLocator = structuredClone(live);
  mismatchedLocator[0].candidateLocators[0].locator += '.first()';
  const rejected = reviewDomDiscoveryArtifactObject(scopedArtifact(mismatchedLocator));
  assert.equal(rejected.passed, false);
  assert.match(rejected.issues.join('\n'), /not a canonical scoped-role candidate/);
});

test('DOM discovery review fails a live non-unique preferred locator and accepts unique evidence', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dom-discovery-uniqueness-'));
  const artifactPath = path.join(temporaryRoot, 'selector-candidates.json');
  const duplicateCandidates = await auditLocatorCandidatesOnPage(
    fakePage({ 'role:button:Save': 2 }),
    annotateSnapshotCandidateMatchCounts([
      createDiscoveryElement({ role: 'button', accessibleName: 'Save' }, 0),
      createDiscoveryElement({ role: 'button', accessibleName: 'Save' }, 1)
    ])
  );
  const baseArtifact = {
    specPath: 'specs/_template.md',
    source: 'agent-browser',
    selectorOwnership: 'framework',
    locatorAudit: {
      method: 'playwright-locator-count',
      snapshotDiagnostics: 'accessibility-snapshot-candidate-equivalence',
      requiredMatchCount: 1
    }
  };

  try {
    await fs.writeFile(
      artifactPath,
      `${JSON.stringify({ ...baseArtifact, elements: [duplicateCandidates[0]] })}\n`,
      'utf8'
    );
    const rejected = reviewDomDiscoveryArtifact(artifactPath);
    assert.equal(rejected.passed, false);
    assert.match(rejected.issues.join('\n'), /preferred locator is not unique \(matchCount=2\)/);

    const uniqueCandidates = await auditLocatorCandidatesOnPage(
      fakePage({ 'role:button:Save': 1 }),
      annotateSnapshotCandidateMatchCounts([createDiscoveryElement({ role: 'button', accessibleName: 'Save' }, 0)])
    );
    await fs.writeFile(
      artifactPath,
      `${JSON.stringify({ ...baseArtifact, elements: uniqueCandidates })}\n`,
      'utf8'
    );
    const accepted = reviewDomDiscoveryArtifact(artifactPath);
    assert.equal(accepted.passed, true, accepted.issues.join('\n'));

    const snapshotOnly = structuredClone(uniqueCandidates);
    snapshotOnly[0].candidateLocators[0].matchEvidence = 'accessibility-snapshot';
    await fs.writeFile(
      artifactPath,
      `${JSON.stringify({ ...baseArtifact, elements: snapshotOnly })}\n`,
      'utf8'
    );
    const snapshotOnlyResult = reviewDomDiscoveryArtifact(artifactPath);
    assert.equal(snapshotOnlyResult.passed, false);
    assert.match(snapshotOnlyResult.issues.join('\n'), /matchEvidence: "playwright-live"/);
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('review-side automatic DOM discovery fails closed above its bounded entry scan', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dom-discovery-review-limit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const specPath = path.join(root, 'specs/flow.md');
  const discoveryRoot = path.join(root, '.ai-runs/dom-discovery');
  fsSync.mkdirSync(path.dirname(specPath), { recursive: true });
  fsSync.writeFileSync(specPath, '# Flow: Review finder limit\n');
  fsSync.mkdirSync(discoveryRoot, { recursive: true });
  for (let index = 0; index <= 2_048; index += 1) {
    fsSync.writeFileSync(path.join(discoveryRoot, `noise-${String(index).padStart(4, '0')}`), '');
  }
  assert.throws(
    () => findLatestDomDiscoveryArtifactForReview(specPath, root),
    /DOM discovery.*limit.*2048|2048.*entries.*exceeded/i
  );
});

function fakePage(counts, calls = []) {
  const locator = (key) => ({
    count: async () => {
      calls.push(key);
      return counts[key] ?? 0;
    }
  });
  return {
    getByTestId: (value) => locator(`testId:${value}`),
    getByRole: (role, options) => locator(`role:${role}:${options.name}`),
    getByLabel: (value) => locator(`label:${value}`),
    getByPlaceholder: (value) => locator(`placeholder:${value}`),
    getByText: (value) => locator(`text:${value}`)
  };
}

function scopedFakePage(count) {
  return {
    getByRole: () => ({
      getByRole: () => ({ count: async () => count })
    })
  };
}

function scopedArtifact(elements) {
  return {
    specPath: 'specs/_template.md',
    source: 'agent-browser',
    selectorOwnership: 'framework',
    locatorAudit: {
      method: 'playwright-locator-count',
      snapshotDiagnostics: 'accessibility-snapshot-candidate-equivalence',
      requiredMatchCount: 1
    },
    elements
  };
}
