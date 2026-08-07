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
