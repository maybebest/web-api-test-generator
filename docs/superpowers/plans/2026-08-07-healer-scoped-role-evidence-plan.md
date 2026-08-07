# Healer Scoped-Role Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Supply the single-file healer with live-audited one-level role-scoped locator evidence, enforce its provenance, and use it to heal both PsychicBook dev tests without changing canonical tests.

**Architecture:** Add one structured `scopedRole` evidence type with deterministic rendering and typed Playwright reconstruction. Project it through the existing explicit `--dom-snapshot` channel, then add a dedicated AST provenance gate for newly introduced role-only scoped locators; a verified unnamed target is warning-soft, while an unaudited chain is rejected before runtime. An ignored fixed-flow helper captures only the approved authenticated failure state; automatic fixture/reporter capture is out of scope.

**Tech Stack:** Node.js 22, JavaScript ES modules, TypeScript compiler API, Playwright Test 1.59.1, agent-browser 0.27.0, Node test runner.

## Global Constraints

- Keep the change bounded to one semantic container role followed by one descendant control role.
- Scope roles are exactly `banner`, `navigation`, `main`, `complementary`, `region`, and `dialog`; target roles use the existing safe-role allowlist.
- Require snapshot and live `locator.count()` values to equal exactly `1` before scoped evidence reaches the provider.
- Never accept arbitrary locator strings, extra chain levels, dynamic roles/names, CSS, XPath, positional selectors, or executable artifact values.
- Keep normal policy findings warning-soft. The new audited-evidence provenance check is a separate hard gate.
- A verified unnamed target uses `SCOPED_ROLE_TARGET_UNNAMED`; `--apply` may promote after every hard gate and three runtime passes, but CLI/CI exits nonzero.
- Preserve all existing public terminal statuses and the `test-heal-triage/v1` and `playwright-test-heal/v1` schemas.
- Do not add automatic DOM capture to fixtures, reporters, or ordinary healer runs.
- Do not increase three provider attempts, three candidate verification runs, zero retries, or one worker.
- Do not edit canonical `packages/web/tests/**`, `packages/web/pages/PsychicBookLoginPage.ts`, specs, assertions, test data, or flow expectations.
- Only healer `--apply` may modify the two `packages/web/tests-dev/regression/psychicbook-*.spec.ts` targets.
- The ignored live helper reads private values without printing, copying, archiving, or committing them.

---

### Task 1: Add structured scoped-role evidence and live audit

**Files:**
- Create: `packages/web/scripts/ai/lib/scoped-role-locator.mjs`
- Modify: `packages/web/scripts/ai/lib/selector-policy.mjs`
- Modify: `packages/web/scripts/ai/lib/playwright-locator-audit.mjs`
- Modify: `packages/web/scripts/ai/review-dom-discovery.mjs`
- Create: `packages/web/scripts/ai/__tests__/scoped-role-locator.test.mjs`
- Modify: `packages/web/scripts/ai/__tests__/agent-browser-hardening.test.mjs`

**Interfaces:**
- Consumes: existing safe-role policy, discovery candidate records, and `auditLocatorCandidatesOnPage(page, elements)`.
- Produces: `createScopedRoleCandidate(identity)`, `normalizeScopedRoleCandidate(candidate)`, `scopedRoleLocatorForPage(page, candidate)`, and reviewer-accepted `type: 'scopedRole'` records.

- [ ] **Step 1: Write failing structured-candidate tests**

Create `scoped-role-locator.test.mjs` with direct expectations:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createScopedRoleCandidate,
  normalizeScopedRoleCandidate,
  scopedRoleLocatorForPage
} from '../lib/scoped-role-locator.mjs';

const UNNAMED = {
  scopeRole: 'banner',
  scopeAccessibleName: null,
  targetRole: 'button',
  targetAccessibleName: null
};

test('scoped role candidate is deterministic and marks an unnamed target', () => {
  const candidate = createScopedRoleCandidate(UNNAMED);
  assert.equal(candidate.type, 'scopedRole');
  assert.equal(candidate.locator, 'page.getByRole("banner").getByRole("button")');
  assert.deepEqual(candidate.scope, { role: 'banner', accessibleName: null });
  assert.deepEqual(candidate.target, { role: 'button', accessibleName: null });
  assert.deepEqual(candidate.warningCodes, ['SCOPED_ROLE_TARGET_UNNAMED']);
  assert.deepEqual(normalizeScopedRoleCandidate(candidate), candidate);
});

test('scoped role candidate reconstructs the typed Playwright chain', async () => {
  const calls = [];
  const target = { count: async () => 1 };
  const page = {
    getByRole(role, options) {
      calls.push(['scope', role, options]);
      return {
        getByRole(targetRole, targetOptions) {
          calls.push(['target', targetRole, targetOptions]);
          return target;
        }
      };
    }
  };
  assert.equal(scopedRoleLocatorForPage(page, createScopedRoleCandidate(UNNAMED)), target);
  assert.deepEqual(calls, [['scope', 'banner', undefined], ['target', 'button', undefined]]);
});

test('scoped role validation rejects unsupported or non-canonical input', () => {
  const valid = createScopedRoleCandidate(UNNAMED);
  for (const candidate of [
    { ...valid, locator: `${valid.locator}.first()` },
    { ...valid, scope: { role: 'document', accessibleName: null } },
    { ...valid, target: { role: 'banner', accessibleName: null } },
    { ...valid, warningCodes: [] },
    { ...valid, extra: true }
  ]) assert.throws(() => normalizeScopedRoleCandidate(candidate));
});
```

- [ ] **Step 2: Run the new unit file and prove RED**

Run:

```bash
cd packages/web
node --test scripts/ai/__tests__/scoped-role-locator.test.mjs
```

Expected: module-not-found or missing-export failure; no production code exists yet.

- [ ] **Step 3: Implement the small structured-locator module**

In `selector-policy.mjs`, export a read-only predicate without changing existing candidate output:

```js
export function isLocatorSafeRole(value) {
  return LOCATOR_SAFE_ROLES.has(normalizeValue(value));
}
```

Create `scoped-role-locator.mjs` with these exact public constants and signatures:

```js
import { isLocatorSafeRole } from './selector-policy.mjs';

export const SCOPED_ROLE_TARGET_UNNAMED = 'SCOPED_ROLE_TARGET_UNNAMED';
export const SCOPED_ROLE_SCOPE_ROLES = Object.freeze([
  'banner', 'navigation', 'main', 'complementary', 'region', 'dialog'
]);

const SCOPE_SET = new Set(SCOPED_ROLE_SCOPE_ROLES);
const IDENTITY_KEYS = new Set(['type', 'locator', 'scope', 'target', 'warningCodes']);
const OPTIONAL_DISCOVERY_KEYS = new Set(['score', 'reason']);

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a plain object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} must be a plain object.`);
  }
  return value;
}

function exactKeys(value, keys, label) {
  const extras = Object.keys(value).filter((key) => !keys.has(key));
  if (extras.length) throw new Error(`${label} contains unsupported field(s): ${extras.join(', ')}.`);
}

function name(value, label) {
  if (value === null) return null;
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`${label} must be a trimmed static string or null.`);
  }
  return value;
}

function roleOptions(accessibleName) {
  return accessibleName === null ? '' : `, { name: ${JSON.stringify(accessibleName)} }`;
}

export function renderScopedRoleLocator({ scope, target }) {
  return `page.getByRole(${JSON.stringify(scope.role)}${roleOptions(scope.accessibleName)})`
    + `.getByRole(${JSON.stringify(target.role)}${roleOptions(target.accessibleName)})`;
}

export function createScopedRoleCandidate({
  scopeRole,
  scopeAccessibleName = null,
  targetRole,
  targetAccessibleName = null
}) {
  const scopeName = name(scopeAccessibleName, 'Scoped role scope name');
  const targetName = name(targetAccessibleName, 'Scoped role target name');
  if (!SCOPE_SET.has(scopeRole)) throw new Error(`Unsupported scoped role container: ${scopeRole ?? '(missing)'}.`);
  if (!isLocatorSafeRole(targetRole)) throw new Error(`Unsupported scoped role target: ${targetRole ?? '(missing)'}.`);
  const scope = { role: scopeRole, accessibleName: scopeName };
  const target = { role: targetRole, accessibleName: targetName };
  return {
    type: 'scopedRole',
    locator: renderScopedRoleLocator({ scope, target }),
    scope,
    target,
    score: 85,
    reason: 'A semantic container plus descendant role is live-audited when no direct stable identity exists.',
    warningCodes: targetName === null ? [SCOPED_ROLE_TARGET_UNNAMED] : []
  };
}

export function normalizeScopedRoleCandidate(candidateValue) {
  const candidate = plainObject(candidateValue, 'Scoped role candidate');
  const auditKeys = new Set([
    ...IDENTITY_KEYS, ...OPTIONAL_DISCOVERY_KEYS, 'preferred', 'matchCount', 'unique', 'snapshotMatchCount',
    'snapshotUnique', 'matchEvidence'
  ]);
  exactKeys(candidate, auditKeys, 'Scoped role candidate');
  const scope = plainObject(candidate.scope, 'Scoped role scope');
  const target = plainObject(candidate.target, 'Scoped role target');
  exactKeys(scope, new Set(['role', 'accessibleName']), 'Scoped role scope');
  exactKeys(target, new Set(['role', 'accessibleName']), 'Scoped role target');
  const canonical = createScopedRoleCandidate({
    scopeRole: scope.role,
    scopeAccessibleName: scope.accessibleName,
    targetRole: target.role,
    targetAccessibleName: target.accessibleName
  });
  for (const key of IDENTITY_KEYS) {
    if (JSON.stringify(candidate[key]) !== JSON.stringify(canonical[key])) {
      throw new Error(`Scoped role candidate.${key} is not canonical.`);
    }
  }
  const hasScore = candidate.score !== undefined;
  const hasReason = candidate.reason !== undefined;
  if (hasScore !== hasReason) {
    throw new Error('Scoped role candidate score and reason must be supplied together.');
  }
  if (hasScore && (candidate.score !== canonical.score || candidate.reason !== canonical.reason)) {
    throw new Error('Scoped role candidate discovery metadata is not canonical.');
  }
  return {
    ...Object.fromEntries([...IDENTITY_KEYS].map((key) => [key, canonical[key]])),
    ...(hasScore ? { score: canonical.score, reason: canonical.reason } : {}),
    ...Object.fromEntries([...auditKeys]
      .filter((key) => !IDENTITY_KEYS.has(key)
        && !OPTIONAL_DISCOVERY_KEYS.has(key)
        && candidate[key] !== undefined)
      .map((key) => [key, candidate[key]]))
  };
}

export function scopedRoleLocatorForPage(page, candidateValue) {
  const candidate = normalizeScopedRoleCandidate(candidateValue);
  const scope = candidate.scope.accessibleName === null
    ? page.getByRole(candidate.scope.role)
    : page.getByRole(candidate.scope.role, { name: candidate.scope.accessibleName });
  return candidate.target.accessibleName === null
    ? scope.getByRole(candidate.target.role)
    : scope.getByRole(candidate.target.role, { name: candidate.target.accessibleName });
}
```

Keep validation functions local; do not introduce a general locator parser.

- [ ] **Step 4: Add live audit and artifact-review regressions**

In `playwright-locator-audit.mjs`, import `scopedRoleLocatorForPage` and add only this switch branch:

```js
case 'scopedRole':
  return scopedRoleLocatorForPage(page, candidate);
```

In `review-dom-discovery.mjs`, normalize `scopedRole` before the common count checks. Require exact canonical fields, `matchEvidence === 'playwright-live'`, `snapshotMatchCount === 1`, `matchCount === 1`, and matching warning codes. Add tests to `agent-browser-hardening.test.mjs`:

```js
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
});
```

Use a nested fake page whose outer `getByRole()` returns an object with descendant `getByRole().count()`; add reviewer fixtures for live counts `0`, `1`, and `2` and for a mismatched locator string.

- [ ] **Step 5: Run focused GREEN verification**

```bash
cd packages/web
node --test \
  scripts/ai/__tests__/scoped-role-locator.test.mjs \
  scripts/ai/__tests__/selector-policy.test.mjs \
  scripts/ai/__tests__/agent-browser-hardening.test.mjs
```

Expected: all tests pass; existing flat selector policy output is byte-for-byte unchanged.

- [ ] **Step 6: Commit Task 1**

```bash
git add \
  packages/web/scripts/ai/lib/scoped-role-locator.mjs \
  packages/web/scripts/ai/lib/selector-policy.mjs \
  packages/web/scripts/ai/lib/playwright-locator-audit.mjs \
  packages/web/scripts/ai/review-dom-discovery.mjs \
  packages/web/scripts/ai/__tests__/scoped-role-locator.test.mjs \
  packages/web/scripts/ai/__tests__/agent-browser-hardening.test.mjs
git commit -m "feat(web): audit scoped role locator evidence"
```

---

### Task 2: Project scoped-role evidence into the healer prompt

**Files:**
- Modify: `packages/web/scripts/ai/lib/test-heal-context.mjs`
- Modify: `packages/web/scripts/ai/__tests__/test-heal-context.test.mjs`
- Modify: `packages/web/scripts/ai/__tests__/test-heal.test.mjs`

**Interfaces:**
- Consumes: Task 1 `normalizeScopedRoleCandidate(candidate)` and the existing `--dom-snapshot` artifact path.
- Produces: a bounded normalized `repositoryContext.domSnapshot.content` retaining only scoped identity, live count, provenance, and warning codes.

- [ ] **Step 1: Add failing context projection tests**

Extend the test artifact in `test-heal-context.test.mjs` with a second element whose candidate is:

```js
{
  ...createScopedRoleCandidate({ scopeRole: 'banner', targetRole: 'button' }),
  preferred: true,
  matchCount: 1,
  unique: true,
  snapshotMatchCount: 1,
  snapshotUnique: true,
  matchEvidence: 'playwright-live'
}
```

Assert the projected candidate equals:

```js
{
  type: 'scopedRole',
  locator: 'page.getByRole("banner").getByRole("button")',
  scope: { role: 'banner', accessibleName: null },
  target: { role: 'button', accessibleName: null },
  preferred: true,
  matchCount: 1,
  matchEvidence: 'playwright-live',
  warningCodes: ['SCOPED_ROLE_TARGET_UNNAMED']
}
```

Add negative cases for changed locator text, extra scope/target keys, unsupported roles, count `0`, and a missing warning code.

- [ ] **Step 2: Run projection tests and prove RED**

```bash
cd packages/web
node --test \
  scripts/ai/__tests__/test-heal-context.test.mjs \
  scripts/ai/__tests__/test-heal.test.mjs
```

Expected: scoped fields are rejected as unsupported or omitted from the provider context.

- [ ] **Step 3: Implement strict projection in `test-heal-context.mjs`**

Import `normalizeScopedRoleCandidate`. In both raw-artifact and projected-context branches:

- allow `scope`, `target`, and `warningCodes` only as possible candidate keys;
- call `normalizeScopedRoleCandidate()` when `candidate.type === 'scopedRole'`;
- reject those three fields on every flat candidate type;
- preserve only `type`, `locator`, `scope`, `target`, `preferred`, `matchCount: 1`, `matchEvidence: 'playwright-live'`, and `warningCodes` in provider context;
- continue stripping scores, reasons, raw text, attributes, source commands, URL, capture time, and screenshot metadata;
- keep all secret checks and the fixed 64 KiB cap unchanged.

Use a small local projection helper:

```js
function projectedCandidate(candidate, secretValues) {
  if (candidate.type !== 'scopedRole') {
    if (candidate.scope !== undefined || candidate.target !== undefined || candidate.warningCodes !== undefined) {
      throw new Error('Flat heal locator candidates cannot carry scoped-role fields.');
    }
    return {
      type: candidate.type,
      locator: sanitizedContextString(validateLocatorIdentity(candidate, 'Heal locator candidate'), secretValues),
      preferred: candidate.preferred,
      matchCount: 1,
      matchEvidence: 'playwright-live'
    };
  }
  const normalized = normalizeScopedRoleCandidate(candidate);
  const serializedIdentity = JSON.stringify({
    locator: normalized.locator,
    scope: normalized.scope,
    target: normalized.target
  });
  if (sanitizedContextString(serializedIdentity, secretValues) !== serializedIdentity) {
    throw new Error('Scoped role candidate contains secret-like material.');
  }
  return {
    type: normalized.type,
    locator: normalized.locator,
    scope: normalized.scope,
    target: normalized.target,
    preferred: normalized.preferred,
    matchCount: 1,
    matchEvidence: 'playwright-live',
    warningCodes: normalized.warningCodes
  };
}
```

- [ ] **Step 4: Prove prompt preservation and rejection**

In `test-heal.test.mjs`, extend `validRepositoryContext()` with one scoped candidate. Assert `buildTestHealPrompt()` preserves the exact projected object and rejects a locator string with `.first()`, a dynamic-looking name, an unknown warning code, or `matchCount: 2`.

- [ ] **Step 5: Run focused GREEN verification**

```bash
cd packages/web
node --test \
  scripts/ai/__tests__/test-heal-context.test.mjs \
  scripts/ai/__tests__/test-heal-contract.test.mjs \
  scripts/ai/__tests__/test-heal.test.mjs
```

- [ ] **Step 6: Commit Task 2**

```bash
git add \
  packages/web/scripts/ai/lib/test-heal-context.mjs \
  packages/web/scripts/ai/__tests__/test-heal-context.test.mjs \
  packages/web/scripts/ai/__tests__/test-heal.test.mjs
git commit -m "feat(web): pass scoped role evidence to healer"
```

---

### Task 3: Enforce scoped-role provenance and warning-soft apply

**Files:**
- Create: `packages/web/scripts/ai/lib/test-heal-scoped-role.mjs`
- Create: `packages/web/scripts/ai/__tests__/test-heal-scoped-role.test.mjs`
- Modify: `packages/web/scripts/ai/lib/test-heal.mjs`
- Modify: `packages/web/scripts/ai/heal-test.mjs`
- Modify: `packages/web/scripts/ai/__tests__/test-heal.test.mjs`
- Modify: `packages/web/scripts/ai/__tests__/heal-test-cli.test.mjs`
- Modify: `packages/web/AGENTS.md`
- Modify: `packages/web/ai/prompts/04-heal-locator.md`

**Interfaces:**
- Consumes: normalized `repositoryContext.domSnapshot.content` from Task 2.
- Produces: `verifyScopedRoleEvidence({ previousSource, healedSource, repositoryContext }) -> { passed, reasonCodes, warningCodes }`; orchestrator check `locatorEvidence`; policy warning `SCOPED_ROLE_TARGET_UNNAMED`.

- [ ] **Step 1: Add failing AST provenance tests**

Create `test-heal-scoped-role.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyScopedRoleEvidence } from '../lib/test-heal-scoped-role.mjs';

const baseline = `const control = page.getByRole('button', { name: 'Account settings' });`;
const unnamed = `const control = page.getByRole('banner').getByRole('button');`;
const context = {
  importedSources: [],
  manualChangeRequired: false,
  domSnapshot: {
    path: '.ai-runs/dom-discovery/run/selector-candidates.json',
    sha256: 'a'.repeat(64),
    content: JSON.stringify({
      source: 'agent-browser',
      selectorOwnership: 'framework',
      locatorAudit: {
        method: 'playwright-locator-count',
        snapshotDiagnostics: 'accessibility-snapshot-candidate-equivalence',
        requiredMatchCount: 1
      },
      elements: [{
        elementId: 'el-account', role: 'button', accessibleName: null, label: null,
        placeholder: null,
        candidateLocators: [{
          type: 'scopedRole',
          locator: 'page.getByRole("banner").getByRole("button")',
          scope: { role: 'banner', accessibleName: null },
          target: { role: 'button', accessibleName: null },
          preferred: true,
          matchCount: 1,
          matchEvidence: 'playwright-live',
          warningCodes: ['SCOPED_ROLE_TARGET_UNNAMED']
        }]
      }]
    })
  }
};

test('audited unnamed scoped locator is warning-soft', () => {
  assert.deepEqual(
    verifyScopedRoleEvidence({ previousSource: baseline, healedSource: unnamed, repositoryContext: context }),
    { passed: true, reasonCodes: [], warningCodes: ['SCOPED_ROLE_TARGET_UNNAMED'] }
  );
});

test('unaudited role-only scoped locator fails before runtime', () => {
  const invented = `const control = page.getByRole('navigation').getByRole('button');`;
  assert.deepEqual(
    verifyScopedRoleEvidence({ previousSource: baseline, healedSource: invented, repositoryContext: context }),
    { passed: false, reasonCodes: ['UNVERIFIED_SCOPED_ROLE_LOCATOR'], warningCodes: [] }
  );
});

test('unchanged baseline chains and named scoped targets need no unnamed warning', () => {
  assert.equal(verifyScopedRoleEvidence({ previousSource: unnamed, healedSource: unnamed, repositoryContext: {} }).passed, true);
  const named = `const control = page.getByRole('banner').getByRole('button', { name: 'Account' });`;
  assert.deepEqual(
    verifyScopedRoleEvidence({ previousSource: baseline, healedSource: named, repositoryContext: {} }),
    { passed: true, reasonCodes: [], warningCodes: [] }
  );
});
```

Add cases that reject a dynamic target role, a dynamic name, extra options, and a three-level role chain when the newly introduced target is role-only.

- [ ] **Step 2: Run the new unit file and prove RED**

```bash
cd packages/web
node --test scripts/ai/__tests__/test-heal-scoped-role.test.mjs
```

- [ ] **Step 3: Implement the isolated AST evidence gate**

Create `test-heal-scoped-role.mjs` using the TypeScript compiler API. Keep it independent from the general semantic policy:

```js
import ts from 'typescript';

const UNVERIFIED = 'UNVERIFIED_SCOPED_ROLE_LOCATOR';
const UNNAMED = 'SCOPED_ROLE_TARGET_UNNAMED';

function staticString(node) {
  return ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : undefined;
}

function roleCall(node) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)
    || node.expression.name.text !== 'getByRole') return undefined;
  const receiver = node.expression.expression;
  const role = staticString(node.arguments[0]);
  if (!role) return { invalid: true, receiver };
  if (node.arguments.length === 1) return { role, name: null, receiver };
  if (node.arguments.length !== 2 || !ts.isObjectLiteralExpression(node.arguments[1])) {
    return { invalid: true, receiver };
  }
  const properties = node.arguments[1].properties;
  if (properties.length !== 1 || !ts.isPropertyAssignment(properties[0])
    || properties[0].name.getText() !== 'name') return { invalid: true, receiver };
  const name = staticString(properties[0].initializer);
  return name ? { role, name, receiver } : { invalid: true, receiver };
}

function introducedRoleOnlyScopes(source) {
  const file = ts.createSourceFile('heal-scoped-role.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const identities = new Set();
  let invalid = false;
  const visit = (node) => {
    const outer = roleCall(node);
    if (outer) {
      const scope = roleCall(outer.receiver);
      if (scope) {
        const grandScope = roleCall(scope.receiver);
        if (outer.invalid || scope.invalid || grandScope) {
          invalid = true;
        } else if (outer.name === null) {
          identities.add(JSON.stringify({
            scope: { role: scope.role, accessibleName: scope.name },
            target: { role: outer.role, accessibleName: null }
          }));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { identities, invalid };
}

export function verifyScopedRoleEvidence({ previousSource, healedSource, repositoryContext = {} }) {
  const before = introducedRoleOnlyScopes(String(previousSource ?? ''));
  const after = introducedRoleOnlyScopes(String(healedSource ?? ''));
  if (after.invalid) return { passed: false, reasonCodes: [UNVERIFIED], warningCodes: [] };
  const introduced = [...after.identities].filter((identity) => !before.identities.has(identity));
  if (!introduced.length) return { passed: true, reasonCodes: [], warningCodes: [] };
  let projected;
  try { projected = JSON.parse(repositoryContext.domSnapshot?.content ?? '{}'); } catch { projected = {}; }
  const audited = new Set((projected.elements ?? []).flatMap((element) =>
    (element.candidateLocators ?? [])
      .filter((candidate) => candidate.type === 'scopedRole'
        && candidate.matchCount === 1
        && candidate.matchEvidence === 'playwright-live')
      .map((candidate) => JSON.stringify({ scope: candidate.scope, target: candidate.target }))));
  if (introduced.some((identity) => !audited.has(identity))) {
    return { passed: false, reasonCodes: [UNVERIFIED], warningCodes: [] };
  }
  return { passed: true, reasonCodes: [], warningCodes: [UNNAMED] };
}
```

Refine the AST walk only as required by the failing tests; do not add a general TypeScript query framework.

- [ ] **Step 4: Integrate the hard evidence gate before candidate files/runtime**

In `heal-test.mjs`:

1. call `verifyScopedRoleEvidence()` after provider-source safety and before `verifyHealedSourcePolicy()`;
2. set `checks.locatorEvidence` to `passed` or `rejected`;
3. on rejection, archive only `UNVERIFIED_SCOPED_ROLE_LOCATOR`, record outcome `locator-evidence-rejected`, set sanitized notes, and continue without creating/running a candidate;
4. merge returned warning codes with normal policy issue codes using `normalizeHealPolicyIssueCodes()`;
5. keep general policy results warning-soft.

Change the private rejected audit helper to accept bounded reason codes:

```js
function rejectedAttemptAudit(attempt, outcome, reasonCodes = []) {
  return `${JSON.stringify({
    schema: 'test-heal-rejected-attempt/v1',
    attempt,
    outcome,
    ...(reasonCodes.length ? { reasonCodes } : {})
  }, null, 2)}\n`;
}
```

Allow only the literal `UNVERIFIED_SCOPED_ROLE_LOCATOR` in this new field; never archive locator text.

In `test-heal.mjs`, add `SCOPED_ROLE_TARGET_UNNAMED` to `HEAL_POLICY_ISSUE_CODES` and add one system-prompt rule:

```text
- Never introduce a role-only scoped locator unless repositoryContext contains the exact live-audited scopedRole candidate.
```

- [ ] **Step 5: Add healer integration and CLI tests**

In `test-heal.test.mjs`, add two integrations:

- unaudited scoped candidate with `maxAttempts: 1` returns `exhausted`, never calls typecheck/lint/review/runtime for the candidate, records `checks.locatorEvidence: 'rejected'`, and writes only the private reason code;
- audited scoped candidate with `apply: true` passes all hard gates, promotes atomically, returns `status: 'healed'`, and includes `policyIssueCodes: ['SCOPED_ROLE_TARGET_UNNAMED']`.

In `heal-test-cli.test.mjs`, use the new warning code in the existing warning-apply fixture and retain:

```js
assert.equal(applied.exitCode, 1);
assert.match(applied.events.map((event) => event.line).join('\n'), /SCOPED_ROLE_TARGET_UNNAMED/);
```

- [ ] **Step 6: Update only operator-facing contract text**

In `packages/web/AGENTS.md` and `ai/prompts/04-heal-locator.md`, document:

- scoped role-only targets require exact live-audited `--dom-snapshot` evidence;
- an unnamed target is warning-soft;
- an unaudited chain is rejected by a hard evidence gate;
- ordinary policy findings remain warning-soft;
- automatic DOM capture remains out of scope.

- [ ] **Step 7: Run the complete focused healer surface**

```bash
cd packages/web
node --test \
  scripts/ai/__tests__/scoped-role-locator.test.mjs \
  scripts/ai/__tests__/test-heal-scoped-role.test.mjs \
  scripts/ai/__tests__/test-heal-triage.test.mjs \
  scripts/ai/__tests__/test-heal-contract.test.mjs \
  scripts/ai/__tests__/test-heal-policy.test.mjs \
  scripts/ai/__tests__/test-heal-context.test.mjs \
  scripts/ai/__tests__/test-heal.test.mjs \
  scripts/ai/__tests__/heal-test-cli.test.mjs
```

Expected: all tests pass; no warnings from Node; product/auth/network/data/environment triage remains non-repairable.

- [ ] **Step 8: Commit Task 3**

```bash
git add \
  packages/web/scripts/ai/lib/test-heal-scoped-role.mjs \
  packages/web/scripts/ai/__tests__/test-heal-scoped-role.test.mjs \
  packages/web/scripts/ai/lib/test-heal.mjs \
  packages/web/scripts/ai/heal-test.mjs \
  packages/web/scripts/ai/__tests__/test-heal.test.mjs \
  packages/web/scripts/ai/__tests__/heal-test-cli.test.mjs \
  packages/web/AGENTS.md \
  packages/web/ai/prompts/04-heal-locator.md
git commit -m "feat(web): require audited scoped heal locators"
```

---

### Task 4: Capture approved live evidence and heal both dev targets

**Files:**
- Create ignored runtime helper: `packages/web/.ai-runs/heal-experiment/psychicbook-scoped-evidence.cjs`
- Modify ignored runtime helper: `packages/web/.ai-runs/heal-experiment/psychicbook-live-launcher.cjs`
- Modify through healer apply only: `packages/web/tests-dev/regression/psychicbook-account-menu.spec.ts`
- Modify through healer apply only: `packages/web/tests-dev/regression/psychicbook-healing-experiment.spec.ts`

**Interfaces:**
- Consumes: Tasks 1-3 scoped candidate/audit/context/gate APIs, the two existing specs, and private original-checkout env files.
- Produces: two reviewed mode-0600 discovery artifacts, two healer-applied dev specs, sanitized heal summaries with `verifyRuns: 3`, and independent 3/3 passes.

- [ ] **Step 1: Create the fixed ignored evidence helper**

Use `apply_patch` to create a CommonJS helper with these fixed behaviors:

```js
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const dotenv = require('dotenv');
const { chromium } = require('@playwright/test');

const checkoutRoot = '/Users/maybebest/Documents/web-api-test-generator';
const webRoot = path.resolve(__dirname, '../..');
const allowed = new Map([
  ['specs/psychicbook-account-menu.md', '.ai-runs/dom-discovery/psychicbook-account-menu/selector-candidates.json'],
  ['specs/psychicbook-healing-experiment.md', '.ai-runs/dom-discovery/psychicbook-healing-experiment/selector-candidates.json']
]);

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function roleOf(node) {
  const value = node?.role ?? node?.type;
  return typeof value === 'string' ? value.trim().toLowerCase() : undefined;
}

function childrenOf(node) {
  if (!node || typeof node !== 'object') return [];
  return Object.entries(node)
    .filter(([key, value]) => !['parent', 'ownerDocument'].includes(key) && value && typeof value === 'object')
    .flatMap(([, value]) => Array.isArray(value) ? value : [value]);
}

function countScopedPairs(root, scopeRole, targetRole) {
  let count = 0;
  const descendantTargets = (node) => childrenOf(node).reduce(
    (total, child) => total + (roleOf(child) === targetRole ? 1 : 0) + descendantTargets(child),
    0
  );
  const visit = (node) => {
    if (roleOf(node) === scopeRole) count += descendantTargets(node);
    for (const child of childrenOf(node)) visit(child);
  };
  visit(root?.data ?? root);
  return count;
}

(async () => {
  const specPath = option('--spec');
  const relativeOut = allowed.get(specPath);
  if (!relativeOut || process.argv.length !== 4) process.exit(64);
  process.chdir(webRoot);
  const rootValues = dotenv.parse(fs.readFileSync(path.join(checkoutRoot, '.env')));
  const port = await freePort();
  const { runAgentBrowser, parseJsonOutput } = await import(path.join(webRoot, 'scripts/ai/lib/agent-browser-runner.mjs'));
  const { createScopedRoleCandidate } = await import(path.join(webRoot, 'scripts/ai/lib/scoped-role-locator.mjs'));
  const { auditLocatorCandidatesOnPage } = await import(path.join(webRoot, 'scripts/ai/lib/playwright-locator-audit.mjs'));
  const { specSha256 } = await import(path.join(webRoot, 'scripts/ai/lib/spec-parser.mjs'));
  const { reviewDomDiscoveryArtifact } = await import(path.join(webRoot, 'scripts/ai/review-dom-discovery.mjs'));
  const browser = await chromium.launch({
    headless: true,
    args: [`--remote-debugging-port=${port}`, '--remote-allow-origins=*']
  });
  try {
    const context = await browser.newContext({
      httpCredentials: {
        username: rootValues.WEB_BASIC_AUTH_USER,
        password: rootValues.WEB_BASIC_AUTH_PASSWORD
      }
    });
    const page = await context.newPage();
    await page.goto('https://user.dev.psychicbook.net/');
    await page.getByRole('link', { name: 'Get Started' }).click();
    await page.getByRole('textbox', { name: /email/i }).fill(rootValues.ADMIN_EMAIL);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: /have a verification code/i }).click();
    const inputs = page.locator('input[inputmode="numeric"][maxlength="1"]');
    for (const [index, digit] of [...'1234'].entries()) await inputs.nth(index).fill(digit);
    await page.getByRole('banner').waitFor({ state: 'visible' });

    const snapshotResult = runAgentBrowser(
      ['--session', `psychicbook-evidence-${process.pid}`, '--cdp', String(port), 'snapshot', '--json'],
      {
        cwd: webRoot,
        env: { AGENT_BROWSER_ALLOWED_DOMAINS: 'user.dev.psychicbook.net' },
        stdio: 'pipe'
      }
    );
    if (snapshotResult.status !== 0 || snapshotResult.failure) throw new Error('Authenticated agent-browser snapshot failed.');
    const snapshot = parseJsonOutput(snapshotResult.stdout);
    const snapshotCount = countScopedPairs(snapshot, 'banner', 'button');
    if (snapshotCount !== 1) throw new Error(`Expected one banner/button pair, received ${snapshotCount}.`);

    const base = createScopedRoleCandidate({ scopeRole: 'banner', targetRole: 'button' });
    const elements = await auditLocatorCandidatesOnPage(page, [{
      elementId: 'el-authenticated-banner-button',
      role: 'button', accessibleName: null, label: null, placeholder: null,
      text: null, href: null, testId: null, attributes: {}, snapshotOccurrences: 1,
      candidateLocators: [{
        ...base,
        preferred: true,
        matchCount: snapshotCount,
        unique: true,
        matchEvidence: 'accessibility-snapshot'
      }]
    }]);
    if (elements[0].candidateLocators[0].matchCount !== 1) throw new Error('Live scoped locator audit was not unique.');

    const artifact = {
      specPath,
      specSha256: specSha256(specPath),
      flowId: specPath.includes('healing-experiment') ? 'FLOW-PSY-HEAL-001' : 'FLOW-PSY-001',
      specVersion: '1.0.0',
      url: 'https://user.dev.psychicbook.net/',
      capturedAt: new Date().toISOString(),
      source: 'agent-browser',
      sourceCommands: [
        'Playwright fixed non-production login journey',
        'agent-browser CDP accessibility snapshot',
        'framework Playwright locator.count() uniqueness audit'
      ],
      selectorOwnership: 'framework',
      locatorAudit: {
        method: 'playwright-locator-count',
        snapshotDiagnostics: 'accessibility-snapshot-candidate-equivalence',
        requiredMatchCount: 1
      },
      elements
    };
    const output = path.join(webRoot, relativeOut);
    fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
    fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(output, 0o600);
    const review = reviewDomDiscoveryArtifact(output, {
      rootDir: webRoot,
      expectedSpecPath: specPath,
      expectedSpecSha256: specSha256(specPath)
    });
    if (!review.passed) throw new Error(`Scoped evidence review failed: ${review.issues.join(' ')}`);
    process.stdout.write(`${relativeOut}\n`);
    await context.close();
  } finally {
    await browser.close();
  }
})().catch(() => {
  process.stderr.write('Scoped evidence capture failed; diagnostic details were omitted.\n');
  process.exitCode = 1;
});
```

Before use, validate `process.argv` handling with invalid specs and ensure the error path never prints env values. If remote debugging is unavailable, record the live-capture step as `BLOCKED`, begin a root-cause cycle, and do not fabricate or weaken the evidence source.

- [ ] **Step 2: Generate and review both artifacts**

```bash
node packages/web/.ai-runs/heal-experiment/psychicbook-scoped-evidence.cjs \
  --spec specs/psychicbook-account-menu.md
node packages/web/.ai-runs/heal-experiment/psychicbook-scoped-evidence.cjs \
  --spec specs/psychicbook-healing-experiment.md

cd packages/web
npm run ai:dom:discover:review -- \
  --artifact .ai-runs/dom-discovery/psychicbook-account-menu/selector-candidates.json
npm run ai:dom:discover:review -- \
  --artifact .ai-runs/dom-discovery/psychicbook-healing-experiment/selector-candidates.json
```

Expected: both pass; neither file contains email, Basic-auth values, cookies, headers, storage, trace, video, screenshot, or raw page text.

- [ ] **Step 3: Bind the fixed launcher to each artifact**

Extend the ignored launcher with an allowlisted `--dom-snapshot` option. In heal mode require this exact mapping:

```js
const allowedSnapshotByTarget = new Map([
  ['tests-dev/regression/psychicbook-account-menu.spec.ts',
    '.ai-runs/dom-discovery/psychicbook-account-menu/selector-candidates.json'],
  ['tests-dev/regression/psychicbook-healing-experiment.spec.ts',
    '.ai-runs/dom-discovery/psychicbook-healing-experiment/selector-candidates.json']
]);
```

Append `--dom-snapshot`, mappedPath to healer args; reject caller-supplied mismatches with exit `64`. Baseline mode accepts no artifact argument.

- [ ] **Step 4: Run the account-menu healer**

```bash
node packages/web/.ai-runs/heal-experiment/psychicbook-live-launcher.cjs \
  --target tests-dev/regression/psychicbook-account-menu.spec.ts \
  --mode heal \
  --repeat-each 1 \
  --dom-snapshot .ai-runs/dom-discovery/psychicbook-account-menu/selector-candidates.json
```

Accept only `healed` with `verifyRuns: 3`, three runtime passes, and `SCOPED_ROLE_TARGET_UNNAMED`. The expected process exit is nonzero because applied policy warnings are warning failures. Prove the target changed and canonical paths did not.

- [ ] **Step 5: Run the healing-experiment healer**

Use the second exact target/artifact pair. Apply the same decision table. If either run exhausts, fails a hard gate, or lacks the expected evidence warning, keep the remaining target unchanged and start another root-cause/design/TDD cycle before retrying.

- [ ] **Step 6: Inspect only sanitized outcomes**

Print only: `target`, `status`, `attemptsUsed`, `verifyRuns`, `triage.classification`, `triage.reasonCodes`, `attemptTrail[].attempt`, `attemptTrail[].outcome`, `attemptTrail[].checks`, and `attemptTrail[].policyIssueCodes`.

Expected for both accepted files: `status: healed`, `verifyRuns: 3`, final runtime passed, warning code present, and no integrity/concurrency failure.

- [ ] **Step 7: Prove isolation and independent stability**

```bash
git diff --exit-code -- packages/web/tests packages/web/pages/PsychicBookLoginPage.ts

node packages/web/.ai-runs/heal-experiment/psychicbook-live-launcher.cjs \
  --target tests-dev/regression/psychicbook-account-menu.spec.ts \
  --mode baseline --repeat-each 3
node packages/web/.ai-runs/heal-experiment/psychicbook-live-launcher.cjs \
  --target tests-dev/regression/psychicbook-healing-experiment.spec.ts \
  --mode baseline --repeat-each 3
```

Expected: canonical isolation exits zero; each target passes 3/3 with zero retries, skips, or flaky outcomes.

- [ ] **Step 8: Re-run generated reviewers and commit only healer output**

```bash
cd packages/web
PLAYWRIGHT_TEST_SUITE_ROOT=tests-dev node scripts/ai/review-generated-test.mjs \
  --spec specs/psychicbook-account-menu.md \
  --test tests-dev/regression/psychicbook-account-menu.spec.ts
PLAYWRIGHT_TEST_SUITE_ROOT=tests-dev node scripts/ai/review-generated-test.mjs \
  --spec specs/psychicbook-healing-experiment.md \
  --test tests-dev/regression/psychicbook-healing-experiment.spec.ts

git add \
  tests-dev/regression/psychicbook-account-menu.spec.ts \
  tests-dev/regression/psychicbook-healing-experiment.spec.ts
git commit -m "test(web): heal PsychicBook dev account locators"
```

The ignored capture/launcher files and all `.ai-runs`, traces, videos, screenshots, reports, and auth state remain untracked.

---

### Task 5: Run complete regression, security, and branch verification

**Files:**
- Verify all committed files from Tasks 1-4.
- Do not create a commit unless a deterministic correction is required.

**Interfaces:**
- Consumes: scoped evidence framework and two healer-applied dev specs.
- Produces: final green evidence, canonical isolation proof, and a clean reviewable branch.

- [ ] **Step 1: Run static and focused framework checks**

```bash
npm run -w packages/web typecheck
npm run -w packages/web lint
node --test \
  packages/web/scripts/ai/__tests__/scoped-role-locator.test.mjs \
  packages/web/scripts/ai/__tests__/test-heal-scoped-role.test.mjs \
  packages/web/scripts/ai/__tests__/test-suite-root.test.mjs \
  packages/web/scripts/ai/__tests__/test-heal-triage.test.mjs \
  packages/web/scripts/ai/__tests__/test-heal-contract.test.mjs \
  packages/web/scripts/ai/__tests__/test-heal-policy.test.mjs \
  packages/web/scripts/ai/__tests__/test-heal-context.test.mjs \
  packages/web/scripts/ai/__tests__/test-heal.test.mjs \
  packages/web/scripts/ai/__tests__/heal-test-cli.test.mjs
```

- [ ] **Step 2: Run complete web framework checks**

```bash
npm run -w packages/web ai:test:self
npm run -w packages/web ai:spec:validate
npm run -w packages/web ai:spec:drift
npm run -w packages/web ai:eval
npm run -w packages/web test:e2e:local
```

Expected: all self-tests/evaluation pass; default local execution collects canonical tests only and never `tests-dev`.

- [ ] **Step 3: Run repository and security checks**

```bash
npm test
npm run api:secrets
npm audit --audit-level=high
gitleaks detect --source . --config .gitleaks.toml --redact --verbose --exit-code 1
git diff --check
git status --short
```

Expected: zero high vulnerabilities, both secret scans clean, no unintended tracked/runtime files. If `gitleaks` is unavailable, install or invoke the repository-pinned verified binary before claiming completion; do not skip the command.

- [ ] **Step 4: Prove canonical isolation and review branch history**

```bash
git diff --exit-code fed1426 -- packages/web/tests packages/web/pages/PsychicBookLoginPage.ts
git log --oneline --decorate -15
```

Expected: canonical tests and shared Page Object are unchanged since the dev mirror commit; history has separate evidence, context, provenance, and healer-output commits.

- [ ] **Step 5: Run final whole-branch independent review**

Review every commit after `2e9ab1c` against:

- `docs/superpowers/specs/2026-08-07-healer-scoped-role-evidence-design.md`;
- this implementation plan;
- the original two-target live goal;
- the warning-soft apply decision;
- the no-overengineering constraint.

Require explicit verdicts for Spec Compliance, Security/Secret Safety, Framework Complexity, Canonical Isolation, and Test Evidence. Resolve every Important/Critical finding through the original task implementer and rerun its focused checks before another review.

- [ ] **Step 6: Finish the branch**

Invoke `superpowers:verification-before-completion`, then `superpowers:finishing-a-development-branch`. Report the exact branch, commits, live healer outcomes, warning-soft behavior, product accessibility feedback, and any remaining limitation. Do not merge or push without a separately authorized finishing choice.
