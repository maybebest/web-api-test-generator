import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { collectCleanTreeIssues, hasMeaningfulContent } from '../check-clean-tree.mjs';

function createWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ai-clean-tree-'));
}

test('a stale, recursively empty evidence dir is not flagged as a runtime artifact', () => {
  const workspace = createWorkspace();
  // Live regression: gates pre-created .ai-runs/gate-*/evidence/ and left it empty.
  fs.mkdirSync(path.join(workspace, '.ai-runs', 'gate-1700000000000-example-flow', 'evidence'), { recursive: true });

  assert.deepEqual(collectCleanTreeIssues(workspace), []);
});

test('placeholder files (.gitkeep, .DS_Store) do not make a directory meaningful', () => {
  const workspace = createWorkspace();
  const runsDir = path.join(workspace, '.ai-runs');
  fs.mkdirSync(path.join(runsDir, 'gate-1700000000000-example-flow', 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(runsDir, '.gitkeep'), '');
  fs.writeFileSync(path.join(runsDir, 'gate-1700000000000-example-flow', '.DS_Store'), 'junk');
  fs.writeFileSync(path.join(runsDir, 'gate-1700000000000-example-flow', 'evidence', '.DS_Store'), 'junk');

  assert.equal(hasMeaningfulContent(runsDir), false);
  assert.deepEqual(collectCleanTreeIssues(workspace), []);
});

test('a real file nested under an otherwise empty run dir is still flagged', () => {
  const workspace = createWorkspace();
  const evidenceDir = path.join(workspace, '.ai-runs', 'gate-1700000000000-example-flow', 'evidence');
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, 'stdout.log'), 'gate output');

  const issues = collectCleanTreeIssues(workspace);

  assert.equal(issues.length, 1);
  assert.match(issues[0], /\.ai-runs\/ contains runtime artifacts/);
});

test('a file hidden in a deep sibling of empty dirs is not masked by them', () => {
  const workspace = createWorkspace();
  const reportDir = path.join(workspace, 'playwright-report');
  fs.mkdirSync(path.join(reportDir, 'data', 'empty-a', 'empty-b'), { recursive: true });
  fs.mkdirSync(path.join(reportDir, 'trace'), { recursive: true });
  fs.writeFileSync(path.join(reportDir, 'trace', 'index.html'), '<html></html>');

  const issues = collectCleanTreeIssues(workspace);

  assert.equal(issues.length, 1);
  assert.match(issues[0], /playwright-report\/ contains runtime artifacts/);
});

test('trace/video/HAR artifacts outside forbidden dirs are still reported', () => {
  const workspace = createWorkspace();
  fs.mkdirSync(path.join(workspace, 'recordings'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'recordings', 'session.har'), '{}');
  fs.writeFileSync(path.join(workspace, 'checkout.trace.zip'), 'zip');

  const issues = collectCleanTreeIssues(workspace);

  assert.equal(issues.length, 2);
  assert.match(issues.join('\n'), /session\.har: trace\/video\/HAR artifact present/);
  assert.match(issues.join('\n'), /checkout\.trace\.zip: trace\/video\/HAR artifact present/);
});

test('node_modules and .git are skipped, forbidden dirs are not double-reported', () => {
  const workspace = createWorkspace();
  fs.mkdirSync(path.join(workspace, 'node_modules', 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'node_modules', 'pkg', 'fixture.har'), '{}');
  fs.mkdirSync(path.join(workspace, '.git'), { recursive: true });
  fs.writeFileSync(path.join(workspace, '.git', 'demo.webm'), 'video');
  fs.mkdirSync(path.join(workspace, 'test-results'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'test-results', 'video.webm'), 'video');

  const issues = collectCleanTreeIssues(workspace);

  // Exactly one issue: test-results/ via the forbidden-dir rule. The .webm
  // inside it must not also surface through the file scan, and skip dirs stay dark.
  assert.equal(issues.length, 1);
  assert.match(issues[0], /test-results\/ contains runtime artifacts/);
});
