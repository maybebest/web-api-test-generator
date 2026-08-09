import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import { PLAYWRIGHT_GENERATION_POLICY } from '../lib/generation-policy.mjs';

// -----------------------------------------------------------------------------
// PERMANENT contract-parity gate (campaign lesson: two live iterations were
// spent on blocking reviewer rules the provider prompt never stated).
//
// This test mechanically enumerates every BLOCKING rule source:
//   1. review-generated-test.mjs: every top-level function that pushes to the
//      blocking `issues` array (warnings-only checks are excluded).
//   2. lib/generated-capability-policy.mjs: every distinct report(...) key.
// and enforces that each enumerated rule has a maintained coverage entry whose
// substrings still appear verbatim in PLAYWRIGHT_GENERATION_POLICY — the exact
// text the provider receives as its system prompt (the rendered IR restates
// the salient-token list per spec; the policy line is asserted here).
//
// Failure modes this makes RED forever:
//   - a new issue-producing check function lands without a coverage entry;
//   - a new report(...) key lands without a coverage entry;
//   - a mapped policy sentence is edited or deleted so a substring vanishes;
//   - a stale mapping entry survives after its rule is removed.
// -----------------------------------------------------------------------------

const REVIEWER_PATH = fileURLToPath(new URL('../review-generated-test.mjs', import.meta.url));
const CAPABILITY_PATH = fileURLToPath(new URL('../lib/generated-capability-policy.mjs', import.meta.url));

function parseSourceFile(filePath) {
  return ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
}

// Top-level function declarations that push onto the blocking `issues` array.
// Pushes onto `warnings` do not count: warnings never block promotion, so the
// prompt is not required to state them (they surface through telemetry).
export function collectBlockingReviewRuleIds(sourceFile) {
  const ruleIds = new Set();
  const containsIssuesPush = (node) => {
    let found = false;
    const scan = (child) => {
      if (found) return;
      if (
        ts.isCallExpression(child)
        && ts.isPropertyAccessExpression(child.expression)
        && child.expression.name.text === 'push'
        && ts.isIdentifier(child.expression.expression)
        && child.expression.expression.text === 'issues'
      ) {
        found = true;
        return;
      }
      ts.forEachChild(child, scan);
    };
    ts.forEachChild(node, scan);
    return found;
  };

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && containsIssuesPush(statement)) {
      ruleIds.add(statement.name.text);
    }
  }
  return ruleIds;
}

// Every distinct report(<key>, ...) key in the capability policy. Dynamic keys
// (template literals such as `env:${name}`) collapse to their static prefix
// with any trailing ':' stripped, so `page-capability:${member}` and the
// static 'page-capability:request' stay distinguishable rule identities.
export function collectCapabilityRuleIds(sourceFile) {
  const ruleIds = new Set();
  const visit = (node) => {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'report'
      && node.arguments.length > 0
    ) {
      const key = node.arguments[0];
      if (ts.isStringLiteralLike(key)) {
        ruleIds.add(key.text);
      } else if (ts.isTemplateExpression(key)) {
        ruleIds.add(key.head.text.replace(/:$/, ''));
      } else {
        ruleIds.add('[unresolvable-report-key]');
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return ruleIds;
}

// -----------------------------------------------------------------------------
// The maintained matrix: blocking-rule identifier -> substrings that must all
// appear verbatim in PLAYWRIGHT_GENERATION_POLICY. Adding a blocking rule to
// the reviewer or capability policy REQUIRES adding both the policy line and
// the entry here; deleting a rule requires deleting its entry.
// -----------------------------------------------------------------------------

const REVIEW_RULE_COVERAGE = {
  checkHeader: ['Copy IR exactHeader and tags exactly'],
  checkFixtureImport: ['Import test and expect from shared fixtures/test'],
  checkPerAcceptanceCriteria: [
    'only focused tests needed for all AC IDs',
    'Each final assertion names exactly one AC-### or NEG-###'
  ],
  checkPerNegativeCase: ['NEG tests put NEG-### in the test and every step title and end with Assert NEG-###'],
  checkGenerationModeShape: ['single mode: exactly one primary test plus at most one per Negative Case'],
  checkSingleModeNegativeTest: ['end with Assert NEG-###'],
  checkPrimaryAcCoverage: [
    "test.info().annotations.push({ type: 'covered-ac-ids', description: 'AC-001 AC-002 ...' })",
    'primary step-title AC-### union must equal it'
  ],
  checkSpecTagDeclarations: ['{ tag: [...] } option'],
  collectPlaywrightTagDeclarations: ['static string literals'],
  checkDataCaseCoverage: ['Loop multiple Data Cases so every caseId creates a test'],
  checkDataCaseAssertionStrength: ['assert salient expected values and visible outcomes'],
  checkSingleResponsibilityAssertions: ['one meaningful user-visible final assertion step per test'],
  checkExpectCalls: [
    'expect receivers are validated by that suffix',
    'tautological or constant-only assertions',
    'Date.now() inside expect'
  ],
  checkExpectPollCall: ['tautological or constant-only assertions'],
  checkWeakMatcher: ['weakened assertions'],
  checkForbiddenRuntimePatterns: [
    'page.waitForTimeout',
    'networkidle',
    'test.only/describe.only/it.only',
    'skips',
    'storage state',
    'setTimeout',
    'Promise.race',
    '"as any" casts',
    'zero-argument test() calls'
  ],
  checkUnimplementedTestDataHelpers: ['setChannelMaxHeroSkus'],
  checkForbiddenAgentBrowserRefs: ['agent-browser @e refs'],
  checkPomLocatorOwnership: ['Locators belong only in Page Objects/Component Objects'],
  checkBrowserWaitForFunction: ['use waitForFunction only behind // locator-policy:exception'],
  checkStringSelectorActionApis: ['String-selector page APIs are forbidden'],
  checkLocatorSelectors: ['raw CSS only after // locator-policy:exception', 'XPath'],
  checkPositionalLocatorPick: ['nth/first/last'],
  checkSemanticLocatorPresence: ['Priority: getByTestId'],
  checkLocatorHints: ['Locator Hints are binding'],
  checkMockContract: ['Implement declared mock URLs/methods/requests/responses'],
  checkExpectedTokens: ['appear verbatim in an assertion, a step/test title, or an iterated data row'],
  checkSecretAndUrlLiterals: ['production credentials', 'hardcoded production URLs'],
  checkStabilityAndVariantsAlignment: [
    'Parallel Safe = no requires test.describe.serial',
    'Enumerate multiple Variants rows'
  ]
};

const CAPABILITY_RULE_COVERAGE = {
  'import-equals': ['Runtime imports only from reviewed modules'],
  module: ['Runtime imports only from reviewed modules'],
  'unapproved-module': ['Runtime imports only from reviewed modules', 'the playwright package is forbidden'],
  // Partial by design: the per-export nectar-api allowlist itself lives in the
  // capability policy; the prompt states the enclosing rule (reviewed modules
  // + reuse of supplied fixtures) and the context pack lists the fixtures.
  'sensitive-fixture': ['Runtime imports only from reviewed modules', 'Reuse supplied fixtures'],
  'page-capability': ['page.evaluate'],
  'page-capability:request': ['page.request'],
  'page-capability:context': ['page.context()'],
  'page-capability:rest': ['destructuring or spreading the page object'],
  'direct-navigation': ['static relative path'],
  env: ['E2E_* configuration fields'],
  'env:bulk': ['E2E_* configuration fields'],
  'process-root': ['process or process.env access'],
  'prototype-escape': ['constructor/prototype access'],
  'prototype-reflection': ['Reflect'],
  reflection: ['Proxy'],
  'dynamic-import': ['dynamic import()'],
  require: ['require()'],
  fetch: ['fetch'],
  'send-beacon': ['navigator.sendBeacon'],
  'dynamic-code': ['eval, new Function'],
  'browser-evaluate': ['page.evaluate'],
  'browser-context': ['page.context()'],
  'api-request': ['APIRequestContext'],
  'route-network': ['route.continue', 'may only fulfill or abort'],
  'file-upload': ['setInputFiles'],
  constructor: ['WebSocket', 'new Function'],
  global: ['global/globalThis roots']
};

function assertParity(enumerated, coverage, label) {
  const missingEntries = [...enumerated].filter((ruleId) => !(ruleId in coverage)).sort();
  assert.deepEqual(
    missingEntries,
    [],
    `${label}: blocking rule(s) with NO prompt-side coverage entry — add the policy line and map it here: ${missingEntries.join(', ')}`
  );

  const staleEntries = Object.keys(coverage).filter((ruleId) => !enumerated.has(ruleId)).sort();
  assert.deepEqual(
    staleEntries,
    [],
    `${label}: coverage entries no longer matching any blocking rule — delete them: ${staleEntries.join(', ')}`
  );

  for (const [ruleId, substrings] of Object.entries(coverage)) {
    assert.ok(Array.isArray(substrings) && substrings.length > 0, `${label}: ${ruleId} must map to at least one policy substring`);
    for (const substring of substrings) {
      assert.ok(
        PLAYWRIGHT_GENERATION_POLICY.includes(substring),
        `${label}: policy no longer states the line covering blocking rule "${ruleId}": missing substring ${JSON.stringify(substring)}`
      );
    }
  }
}

test('every blocking reviewer rule is stated to the model by the generation policy', () => {
  const enumerated = collectBlockingReviewRuleIds(parseSourceFile(REVIEWER_PATH));
  // Self-check: a broken enumerator must not silently pass with an empty set.
  assert.ok(enumerated.size >= 25, `expected >=25 blocking reviewer rules, found ${enumerated.size}`);
  assert.ok(enumerated.has('checkForbiddenRuntimePatterns'), 'enumerator must find checkForbiddenRuntimePatterns');
  assert.ok(enumerated.has('checkExpectedTokens'), 'enumerator must find checkExpectedTokens');
  assertParity(enumerated, REVIEW_RULE_COVERAGE, 'reviewer');
});

test('every blocking capability-policy rule is stated to the model by the generation policy', () => {
  const enumerated = collectCapabilityRuleIds(parseSourceFile(CAPABILITY_PATH));
  assert.ok(enumerated.size >= 20, `expected >=20 capability rule keys, found ${enumerated.size}`);
  assert.ok(enumerated.has('api-request'), 'enumerator must find api-request');
  assert.ok(enumerated.has('page-capability:rest'), 'enumerator must find page-capability:rest');
  assert.ok(!enumerated.has('[unresolvable-report-key]'), 'every report(...) key must be a static string or template with a static prefix');
  assertParity(enumerated, CAPABILITY_RULE_COVERAGE, 'capability');
});

test('warnings-only reviewer checks stay excluded from the blocking matrix', () => {
  const enumerated = collectBlockingReviewRuleIds(parseSourceFile(REVIEWER_PATH));
  for (const warningOnly of [
    'checkAccessibleNameGrounding',
    'checkNonRetryingAttributeAssertions',
    'checkPageObjectHint',
    'checkReuseGuidance'
  ]) {
    assert.ok(
      !enumerated.has(warningOnly),
      `${warningOnly} is expected to be warnings-only; if it now blocks, add a coverage entry instead of relaxing this test`
    );
  }
});
