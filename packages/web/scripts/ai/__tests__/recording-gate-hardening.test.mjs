import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { pinnedAgentBrowserVersion, resolveAgentBrowserBin } from '../lib/agent-browser-runner.mjs';
import {
  cleanupJsonReport,
  copyEvidence,
  playwrightJsonVerdict,
  playwrightStageEnv,
  readPlaywrightReportVerdict
} from '../recording-test-gate.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function createWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'recording-gate-hardening-'));
}

function inDirectory(directory, run) {
  const previous = process.cwd();
  process.chdir(directory);
  try {
    return run();
  } finally {
    process.chdir(previous);
  }
}

test('playwright JSON verdict accepts an honest run with executed expected tests', () => {
  const verdict = playwrightJsonVerdict({ stats: { expected: 2, unexpected: 0, skipped: 0, flaky: 0 } });

  assert.equal(verdict.ok, true, verdict.reason);
});

test('playwright JSON verdict rejects runs with zero expected tests (empty run hides failure)', () => {
  const verdict = playwrightJsonVerdict({ stats: { expected: 0, unexpected: 0, skipped: 0 } });

  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /at least one expected test/);
});

test('playwright JSON verdict rejects unexpected and skipped outcomes and missing stats', () => {
  const unexpected = playwrightJsonVerdict({ stats: { expected: 1, unexpected: 1, skipped: 0 } });
  assert.equal(unexpected.ok, false);
  assert.match(unexpected.reason, /unexpected test outcomes/);

  const skipped = playwrightJsonVerdict({ stats: { expected: 1, unexpected: 0, skipped: 2 } });
  assert.equal(skipped.ok, false);
  assert.match(skipped.reason, /skipped/);

  const missingStats = playwrightJsonVerdict({ suites: [] });
  assert.equal(missingStats.ok, false);
  assert.match(missingStats.reason, /stats/);
});

test('playwright JSON verdict treats flaky outcomes as failure (flaky policy parity)', () => {
  const verdict = playwrightJsonVerdict({ stats: { expected: 1, unexpected: 0, skipped: 0, flaky: 1 } });

  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /target test passed only after retry \(flaky\)/);
  assert.match(verdict.reason, /recorded tests must pass deterministically/);
});

test('playwright JSON verdict fails closed when the flaky count is missing from stats', () => {
  const verdict = playwrightJsonVerdict({ stats: { expected: 1, unexpected: 0, skipped: 0 } });

  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /flaky/);
});

test('playwright stage env disables HTML report auto-open and pins the JSON output path', () => {
  const env = playwrightStageEnv(path.join('.ai-runs', 'recording-gate-last-run.json'));

  assert.equal(env.PLAYWRIGHT_HTML_OPEN, 'never');
  assert.equal(env.PW_TEST_HTML_REPORT_OPEN, 'never');
  assert.equal(env.PLAYWRIGHT_JSON_OUTPUT_NAME, path.join('.ai-runs', 'recording-gate-last-run.json'));
});

test('cleanupJsonReport removes a green-run report and the then-empty .ai-runs directory', () => {
  const workspace = createWorkspace();
  const runDir = path.join(workspace, '.ai-runs');
  const reportPath = path.join(runDir, 'recording-gate-last-run.json');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(reportPath, '{"stats":{"expected":1,"unexpected":0,"skipped":0,"flaky":0}}');

  cleanupJsonReport(reportPath);

  assert.equal(fs.existsSync(reportPath), false);
  assert.equal(fs.existsSync(runDir), false);

  // Missing report paths are tolerated (force remove semantics).
  cleanupJsonReport(reportPath);
});

test('cleanupJsonReport keeps .ai-runs when other artifacts (e.g. failure evidence) remain', () => {
  const workspace = createWorkspace();
  const runDir = path.join(workspace, '.ai-runs');
  const reportPath = path.join(runDir, 'recording-gate-last-run.json');
  const evidencePath = path.join(runDir, 'evidence-keep.txt');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(reportPath, '{}');
  fs.writeFileSync(evidencePath, 'keep');

  cleanupJsonReport(reportPath);

  assert.equal(fs.existsSync(reportPath), false);
  assert.equal(fs.existsSync(runDir), true);
  assert.equal(fs.readFileSync(evidencePath, 'utf8'), 'keep');
});

test('playwright report verdict fails when the JSON report is missing or malformed', () => {
  const workspace = createWorkspace();

  const missing = readPlaywrightReportVerdict(path.join(workspace, 'absent.json'));
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /was not written/);

  const malformedPath = path.join(workspace, 'broken.json');
  fs.writeFileSync(malformedPath, '{not-json');
  const malformed = readPlaywrightReportVerdict(malformedPath);
  assert.equal(malformed.ok, false);
  assert.match(malformed.reason, /not valid JSON/);
});

test('copyEvidence does not create an empty evidence directory when no artifacts exist', () => {
  const workspace = createWorkspace();

  const evidenceDir = inDirectory(workspace, () => copyEvidence('recordings/flow.json', 'a'.repeat(64)));

  assert.equal(evidenceDir, undefined);
  assert.equal(fs.existsSync(path.join(workspace, '.ai-runs')), false);
});

test('copyEvidence copies artifacts when they exist', () => {
  const workspace = createWorkspace();
  fs.mkdirSync(path.join(workspace, 'playwright-report'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'playwright-report', 'index.html'), '<html></html>');

  const evidenceDir = inDirectory(workspace, () => copyEvidence('recordings/flow.json', 'a'.repeat(64)));

  assert.ok(evidenceDir, 'expected an evidence directory');
  assert.equal(fs.existsSync(path.join(workspace, evidenceDir, 'playwright-report', 'index.html')), true);
  assert.equal(fs.existsSync(path.join(workspace, evidenceDir, 'test-results')), false);
});

test('agent-browser binary resolves relative to the repo root regardless of cwd', () => {
  const resolved = inDirectory(os.tmpdir(), () => resolveAgentBrowserBin());

  if (resolved.command === 'npx') {
    // No local install in this checkout: the fallback must be version-pinned.
    assert.match(resolved.prefixArgs[0], /^agent-browser@\d+\.\d+\.\d+$/);
  } else {
    assert.equal(path.isAbsolute(resolved.command), true);
    assert.equal(resolved.command.startsWith(path.join(REPO_ROOT, 'node_modules', '.bin')), true);
    assert.deepEqual(resolved.prefixArgs, []);
  }
});

test('agent-browser npx fallback is pinned to the package.json version, never latest', () => {
  const version = pinnedAgentBrowserVersion();
  assert.match(version, /^\d+\.\d+\.\d+$/);

  const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.equal(version, manifest.devDependencies['agent-browser']);

  const workspaceWithPin = createWorkspace();
  fs.writeFileSync(
    path.join(workspaceWithPin, 'package.json'),
    `${JSON.stringify({ devDependencies: { 'agent-browser': version } })}\n`
  );
  const fallback = resolveAgentBrowserBin(workspaceWithPin);
  assert.equal(fallback.command, 'npx');
  assert.deepEqual(fallback.prefixArgs, [`agent-browser@${version}`]);
});

test('agent-browser resolution fails fast with an npm ci hint when nothing is pinned', () => {
  const emptyWorkspace = createWorkspace();

  assert.throws(() => resolveAgentBrowserBin(emptyWorkspace), /Run "npm ci" first/);

  const rangeWorkspace = createWorkspace();
  fs.writeFileSync(
    path.join(rangeWorkspace, 'package.json'),
    `${JSON.stringify({ devDependencies: { 'agent-browser': '^0.27.0' } })}\n`
  );
  assert.throws(() => resolveAgentBrowserBin(rangeWorkspace), /Run "npm ci" first/);
});

test('MCP workflow config wires the allowed-origins boundary and mirrors agent-browser.json', () => {
  const workflow = fs.readFileSync(path.join(REPO_ROOT, 'ai', 'workflows', 'playwright-mcp-workflow.md'), 'utf8');

  assert.match(workflow, /--allowed-origins/);
  assert.match(workflow, /MUST mirror `agent-browser\.json` `allowedDomains`/);

  const cliConfig = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, '.playwright', 'cli.config.json'), 'utf8'));
  const agentBrowser = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'agent-browser.json'), 'utf8'));
  const allowedDomains = agentBrowser.allowedDomains ?? [];

  assert.ok(Array.isArray(cliConfig.allowedOrigins) && cliConfig.allowedOrigins.length > 0);

  const hostnames = cliConfig.allowedOrigins.map((origin) => new URL(origin).hostname);
  assert.ok(hostnames.includes('localhost'));
  assert.ok(hostnames.includes('127.0.0.1'));

  for (const hostname of hostnames) {
    const allowed = allowedDomains.some((domain) =>
      domain.startsWith('*.') ? hostname.endsWith(domain.slice(1)) : hostname === domain
    );
    assert.ok(allowed, `cli.config.json origin host ${hostname} is not in agent-browser.json allowedDomains`);
  }

  // The workflow doc must carry the same origins as the CLI config sample.
  for (const origin of cliConfig.allowedOrigins) {
    assert.ok(workflow.includes(origin), `workflow doc is missing allowed origin ${origin}`);
  }
});
