import assert from 'node:assert/strict';
import test from 'node:test';

import ts from 'typescript';

import { checkGeneratedRuntimeCapabilities } from '../lib/generated-capability-policy.mjs';

function capabilityIssues(source) {
  const sourceFile = ts.createSourceFile('candidate.spec.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const issues = [];
  checkGeneratedRuntimeCapabilities(sourceFile, issues);
  return issues.join('\n');
}

test('capability policy rejects destructured Page escapes and dynamic-code aliases', () => {
  const issues = capabilityIssues(`
    const { evaluate: browserEval } = page;
    const { context: browserContext } = page;
    const { goto: navigate } = page;
    const e = eval;
    const F = Function;
    const C = (() => {}).constructor;
    void browserEval; void browserContext; void navigate; void e; void F; void C;
  `);

  assert.match(issues, /Browser evaluation is forbidden/);
  assert.match(issues, /Browser context access is forbidden/);
  assert.match(issues, /Direct page navigation must use a static relative path/);
  assert.match(issues, /Dynamic code execution is forbidden/);
  assert.match(issues, /constructor.*escape|prototype.*escape/i);
});

test('capability policy rejects renamed destructured request access and constructor spellings', () => {
  const issues = capabilityIssues(`
    const { request: api } = page;
    const ctor = (() => {})['constructor'];
    const proto = Object.getPrototypeOf(() => {});
    void api; void ctor; void proto;
  `);

  assert.match(issues, /Playwright API request capability is forbidden/);
  assert.match(issues, /constructor.*escape|prototype.*escape/i);
});
