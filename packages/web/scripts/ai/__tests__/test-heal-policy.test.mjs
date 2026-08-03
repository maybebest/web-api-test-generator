import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyHealedSourcePolicy } from '../lib/test-heal.mjs';

const SOURCE = `/* recording: recordings/save.json title:Save sha256:${'a'.repeat(64)} */
import { test, expect } from '../../fixtures/test';
const payload = { planName: 'Summer' };
test('RSTEP-001 saves', { tag: ['@save'] }, async ({ page }) => {
  await test.step('ASSERT-001 result', async () => {
    await page.getByLabel('Plan name').fill(payload.planName);
    await expect(page.getByTestId('status')).toHaveText('Saved');
  });
});`;

for (const [label, candidate, code] of [
  ['expected value', SOURCE.replace("'Saved'", "'Save failed'"), 'ASSERTION_ARGUMENT_CHANGED'],
  ['test title', SOURCE.replace('RSTEP-001 saves', 'unrelated test'), 'TEST_TITLE_CHANGED'],
  ['recording header', SOURCE.replace(/^\/\* recording:.*\*\/\n/, ''), 'TRACEABILITY_HEADER_CHANGED'],
  ['action payload', SOURCE.replace('fill(payload.planName)', "fill('Other')"), 'ACTION_PAYLOAD_CHANGED'],
  ['tag', SOURCE.replace("'@save'", "'@other'"), 'TEST_OPTIONS_CHANGED']
]) {
  test(`policy rejects changed ${label}`, () => {
    const result = verifyHealedSourcePolicy({ previousSource: SOURCE, healedSource: candidate });
    assert.equal(result.passed, false);
    assert.ok(result.issueCodes.includes(code));
  });
}
