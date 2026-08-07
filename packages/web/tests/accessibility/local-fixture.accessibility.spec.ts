import AxeBuilder from '@axe-core/playwright';

import { test, expect } from '../../fixtures/test';
import { LocalFixturePage } from '../../pages/LocalFixturePage';

test('checkout fixture has no detectable violations before or after submission', async ({ page }) => {
  const fixture = new LocalFixturePage(page);
  await fixture.gotoCheckout();

  const beforeSubmit = await new AxeBuilder({ page }).analyze();
  expect(beforeSubmit.violations).toEqual([]);

  await fixture.emailField().fill('qa.user@example.test');
  await fixture.fullNameField().fill('QA User');
  await fixture.submitRecordingButton().click();
  await expect(fixture.heading('Recording submitted')).toBeVisible();

  const afterSubmit = await new AxeBuilder({ page }).analyze();
  expect(afterSubmit.violations).toEqual([]);
});
