import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyScopedRoleEvidence } from '../healer/test-heal-scoped-role.mjs';

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

test('a direct page role-only locator does not require scoped evidence', () => {
  const direct = `const control = page.getByRole('button');`;
  assert.deepEqual(
    verifyScopedRoleEvidence({ previousSource: baseline, healedSource: direct }),
    { passed: true, reasonCodes: [], warningCodes: [] }
  );
});

for (const { label, healedSource } of [
  {
    label: 'a parenthesized property callee',
    healedSource: `const control = (frame.getByRole)('button');`
  },
  {
    label: 'an as-asserted property callee',
    healedSource: `const control = (frame.getByRole as typeof frame.getByRole)('button');`
  },
  {
    label: 'a type-asserted property callee',
    healedSource: `const control = (<typeof frame.getByRole>frame.getByRole)('button');`
  },
  {
    label: 'a non-null property callee',
    healedSource: `const control = (frame.getByRole!)('button');`
  },
  {
    label: 'a satisfies-wrapped property callee',
    healedSource: `const control = (frame.getByRole satisfies typeof frame.getByRole)('button');`
  },
  {
    label: 'a wrapped exact-page property callee',
    healedSource: `const control = (page.getByRole)('button');`
  },
  {
    label: 'a wrapped literal computed getByRole callee',
    healedSource: `const control = (roleLocator['getByRole'])('link');`
  },
  {
    label: 'a wrapped dynamic computed callee',
    healedSource: `const control = (roleLocator[key])('link');`
  }
]) {
  test(`new scoped locator rejects ${label}`, () => {
    assert.deepEqual(
      verifyScopedRoleEvidence({ previousSource: baseline, healedSource }),
      { passed: false, reasonCodes: ['UNVERIFIED_SCOPED_ROLE_LOCATOR'], warningCodes: [] }
    );
  });
}

for (const { label, healedSource } of [
  {
    label: 'a frame root',
    healedSource: `const control = frame.getByRole('banner').getByRole('button');`
  },
  {
    label: 'a locator root',
    healedSource: `const control = locator.getByRole('banner').getByRole('button');`
  },
  {
    label: 'a this.page root',
    healedSource: `const control = this.page.getByRole('banner').getByRole('button');`
  }
]) {
  test(`matching page evidence does not authorize ${label}`, () => {
    assert.deepEqual(
      verifyScopedRoleEvidence({ previousSource: baseline, healedSource, repositoryContext: context }),
      { passed: false, reasonCodes: ['UNVERIFIED_SCOPED_ROLE_LOCATOR'], warningCodes: [] }
    );
  });
}

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
    healedSource: `const control = page.getByRole('banner')['getByRole']('button');`
  },
  {
    label: 'dynamic computed getByRole access',
    healedSource: `const method = 'getByRole'; const control = page.getByRole('banner')[method]('button');`
  },
  {
    label: 'a direct local const scope alias',
    healedSource: `const scope = page.getByRole('banner'); const control = scope.getByRole('button');`
  },
  {
    label: 'optional getByRole chaining',
    healedSource: `const control = page?.getByRole('banner')?.getByRole('button');`
  },
  {
    label: 'an optional direct const scope alias',
    healedSource: `const scope = page?.getByRole('banner'); const control = scope.getByRole('button');`
  },
  {
    label: 'a dynamic direct const scope alias',
    healedSource: `const role = 'banner'; const scope = page.getByRole(role); const control = scope.getByRole('button');`
  },
  {
    label: 'a nested direct const scope alias',
    healedSource: `const scope = page.getByRole('banner').getByRole('button'); const control = scope.getByRole('button');`
  },
  {
    label: 'a let scope alias',
    healedSource: `let scope = page.getByRole('banner'); const control = scope.getByRole('button');`
  },
  {
    label: 'an outer-block const scope alias',
    healedSource: `const scope = page.getByRole('banner'); { const control = scope.getByRole('button'); }`
  },
  {
    label: 'an awaited scope alias',
    healedSource: `const scope = await page.getByRole('banner'); const control = scope.getByRole('button');`
  },
  {
    label: 'a class-property scope alias',
    healedSource: `class View { scope = page.getByRole('banner'); control = this.scope.getByRole('button'); }`
  },
  {
    label: 'a direct this.page role-only receiver',
    healedSource: `const control = this.page.getByRole('button');`
  }
]) {
  test(`new scoped locator rejects ${label}`, () => {
    assert.deepEqual(
      verifyScopedRoleEvidence({ previousSource: baseline, healedSource, repositoryContext: context }),
      { passed: false, reasonCodes: ['UNVERIFIED_SCOPED_ROLE_LOCATOR'], warningCodes: [] }
    );
  });
}

// Iteration-3 false rejection: the repo's canonical getByRole option shape is
// { name, exact: true } (see tests/smoke/complex-feed-lazyload-comments-c1.spec.ts),
// but the gate parsed any two-property options object as an invalid scoped-role
// form and hard-rejected role-name drift heals with UNVERIFIED_SCOPED_ROLE_LOCATOR
// (3 valid repair attempts / 56,178 tokens exhausted in heal run
// 1786270762736-50937-6b6974a7-5e97-4370-a5bc-b67746e0ce8e).
const feedOriginal = `class ComplexFeedPage {
  private story(storyId: string) {
    return this.page.getByTestId('feed-item-' + storyId);
  }
  async expandDetails(storyNumber: string): Promise<void> {
    await this.story(storyNumber).getByRole('button', { name: 'Story details', exact: true }).click();
  }
}`;
const feedHealed = feedOriginal.replace("name: 'Story details'", "name: 'Details'");
const feedDomEvidence = {
  source: 'playwright-baseline-failure-artifacts',
  pageSnapshot: [
    '- article:',
    '- button "Details"',
    '- button "Comments"'
  ],
  testIdCandidates: ['data-testid "feed-item-1" on <article>']
};

test('a canonical { name, exact: true } drift heal grounded in DOM evidence is accepted', () => {
  assert.deepEqual(
    verifyScopedRoleEvidence({
      previousSource: feedOriginal,
      healedSource: feedHealed,
      repositoryContext: {},
      domEvidence: feedDomEvidence
    }),
    { passed: true, reasonCodes: [], warningCodes: [] }
  );
});

test('a canonical { name } drift heal grounded in DOM evidence is accepted', () => {
  const previousSource = `const control = container.getByRole('button', { name: 'Story details' });`;
  const healedSource = `const control = container.getByRole('button', { name: 'Details' });`;
  assert.deepEqual(
    verifyScopedRoleEvidence({ previousSource, healedSource, domEvidence: feedDomEvidence }),
    { passed: true, reasonCodes: [], warningCodes: [] }
  );
});

test('a hallucinated accessible name still rejects against DOM evidence', () => {
  const hallucinated = feedOriginal.replace("name: 'Story details'", "name: 'Imaginary control'");
  assert.deepEqual(
    verifyScopedRoleEvidence({
      previousSource: feedOriginal,
      healedSource: hallucinated,
      repositoryContext: {},
      domEvidence: feedDomEvidence
    }),
    { passed: false, reasonCodes: ['UNVERIFIED_SCOPED_ROLE_LOCATOR'], warningCodes: [] }
  );
});

test('a role mismatch on an evidence-listed name still rejects', () => {
  const wrongRole = feedOriginal.replace(
    "getByRole('button', { name: 'Story details', exact: true })",
    "getByRole('link', { name: 'Details', exact: true })"
  );
  assert.deepEqual(
    verifyScopedRoleEvidence({
      previousSource: feedOriginal,
      healedSource: wrongRole,
      repositoryContext: {},
      domEvidence: feedDomEvidence
    }),
    { passed: false, reasonCodes: ['UNVERIFIED_SCOPED_ROLE_LOCATOR'], warningCodes: [] }
  );
});

test('dom-discovery snapshot elements also ground an introduced role and name', () => {
  const discoveryContext = {
    domSnapshot: {
      path: '.ai-runs/dom-discovery/run/selector-candidates.json',
      sha256: 'b'.repeat(64),
      content: JSON.stringify({
        elements: [{
          elementId: 'el-details', role: 'button', accessibleName: 'Details', label: null,
          placeholder: null, candidateLocators: []
        }]
      })
    }
  };
  assert.deepEqual(
    verifyScopedRoleEvidence({
      previousSource: feedOriginal,
      healedSource: feedHealed,
      repositoryContext: discoveryContext
    }),
    { passed: true, reasonCodes: [], warningCodes: [] }
  );
  const hallucinated = feedOriginal.replace("name: 'Story details'", "name: 'Imaginary control'");
  assert.deepEqual(
    verifyScopedRoleEvidence({
      previousSource: feedOriginal,
      healedSource: hallucinated,
      repositoryContext: discoveryContext
    }),
    { passed: false, reasonCodes: ['UNVERIFIED_SCOPED_ROLE_LOCATOR'], warningCodes: [] }
  );
});

test('a dynamic exact option keeps the canonical-shape rejection', () => {
  const healedSource = `const exact = true; const control = container.getByRole('button', { name: 'Details', exact });`;
  assert.deepEqual(
    verifyScopedRoleEvidence({ previousSource: baseline, healedSource, domEvidence: feedDomEvidence }),
    { passed: false, reasonCodes: ['UNVERIFIED_SCOPED_ROLE_LOCATOR'], warningCodes: [] }
  );
});

test('an unchanged canonical named chain does not require evidence', () => {
  assert.deepEqual(
    verifyScopedRoleEvidence({ previousSource: feedOriginal, healedSource: `${feedOriginal}\nconst unrelated = true;` }),
    { passed: true, reasonCodes: [], warningCodes: [] }
  );
});

test('a static computed non-getByRole method is not a scoped-role call', () => {
  const healedSource = `const roleLocator = page.getByRole('button'); await roleLocator['click']();`;
  assert.deepEqual(
    verifyScopedRoleEvidence({ previousSource: baseline, healedSource }),
    { passed: true, reasonCodes: [], warningCodes: [] }
  );
});

test('a wrapped static computed non-getByRole method is not a scoped-role call', () => {
  const healedSource = `const roleLocator = page.getByRole('button'); await (roleLocator['click'])();`;
  assert.deepEqual(
    verifyScopedRoleEvidence({ previousSource: baseline, healedSource }),
    { passed: true, reasonCodes: [], warningCodes: [] }
  );
});

test('an unchanged legacy wrapped callee does not block an unrelated heal', () => {
  const source = `const control = (frame.getByRole as typeof frame.getByRole)('button');`;
  assert.deepEqual(
    verifyScopedRoleEvidence({ previousSource: source, healedSource: `${source}\nconst unrelated = true;` }),
    { passed: true, reasonCodes: [], warningCodes: [] }
  );
  assert.deepEqual(
    verifyScopedRoleEvidence({ previousSource: source, healedSource: `const control = (frame.getByRole)('button');` }),
    { passed: false, reasonCodes: ['UNVERIFIED_SCOPED_ROLE_LOCATOR'], warningCodes: [] }
  );
});

test('unchanged legacy invalid scoped-role forms do not block an unrelated heal', () => {
  for (const source of [
    `const role = 'button'; const control = page.getByRole('banner').getByRole(role);`,
    `const control = page.getByRole('banner').getByRole('button', { name: 'Account', exact: true });`,
    `const control = page.getByRole('main').getByRole('banner').getByRole('button');`,
    `const method = 'getByRole'; const control = page.getByRole('banner')[method]('button');`,
    `const scope = page.getByRole('banner'); const control = scope.getByRole('button');`,
    `const control = page?.getByRole('banner')?.getByRole('button');`,
    `let scope = page.getByRole('banner'); const control = scope.getByRole('button');`,
    `const scope = page.getByRole('banner'); { const control = scope.getByRole('button'); }`,
    `const scope = await page.getByRole('banner'); const control = scope.getByRole('button');`,
    `class View { scope = page.getByRole('banner'); control = this.scope.getByRole('button'); }`,
    `const control = this.page.getByRole('button');`
  ]) {
    assert.deepEqual(
      verifyScopedRoleEvidence({ previousSource: source, healedSource: `${source}\nconst unrelated = true;` }),
      { passed: true, reasonCodes: [], warningCodes: [] }
    );
  }
});

test('a replaced invalid scoped-role form remains hard-rejected', () => {
  const previousSource = `const role = 'button'; const control = page.getByRole('banner').getByRole(role);`;
  const healedSource = `const nextRole = 'button'; const control = page.getByRole('banner').getByRole(nextRole);`;
  assert.deepEqual(
    verifyScopedRoleEvidence({ previousSource, healedSource }),
    { passed: false, reasonCodes: ['UNVERIFIED_SCOPED_ROLE_LOCATOR'], warningCodes: [] }
  );
});
