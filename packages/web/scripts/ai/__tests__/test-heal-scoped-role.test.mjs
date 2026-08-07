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

for (const { label, healedSource } of [
  {
    label: 'a dynamic target role',
    healedSource: `const role = 'button'; const control = page.getByRole('banner').getByRole(role);`
  },
  {
    label: 'a dynamic target name',
    healedSource: `const name = 'Account'; const control = page.getByRole('banner').getByRole('button', { name });`
  },
  {
    label: 'extra target options',
    healedSource: `const control = page.getByRole('banner').getByRole('button', { name: 'Account', exact: true });`
  },
  {
    label: 'a three-level role chain with a role-only target',
    healedSource: `const control = page.getByRole('main').getByRole('banner').getByRole('button');`
  },
  {
    label: 'an unaudited parenthesized scope',
    healedSource: `const control = (page.getByRole('navigation')).getByRole('button');`
  },
  {
    label: 'an unaudited asserted scope',
    healedSource: `const control = (page.getByRole('navigation') as Locator).getByRole('button');`
  },
  {
    label: 'an unaudited non-null scope',
    healedSource: `const control = page.getByRole('navigation')!.getByRole('button');`
  },
  {
    label: 'computed getByRole access',
    healedSource: `const control = page.getByRole('navigation')['getByRole']('button');`
  }
]) {
  test(`new scoped locator rejects ${label}`, () => {
    assert.deepEqual(
      verifyScopedRoleEvidence({ previousSource: baseline, healedSource, repositoryContext: context }),
      { passed: false, reasonCodes: ['UNVERIFIED_SCOPED_ROLE_LOCATOR'], warningCodes: [] }
    );
  });
}
