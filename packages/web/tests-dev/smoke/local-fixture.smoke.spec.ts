import { test, expect } from '../../fixtures/test';
import { LocalFixturePage } from '../../pages/LocalFixturePage';

test('local fixture smoke route is ready and navigable', async ({ page }) => {
  const fixture = new LocalFixturePage(page);
  await fixture.gotoHome();

  await expect(fixture.heading('Deterministic local fixture')).toBeVisible();
  await expect(fixture.readyStatus()).toHaveText('Fixture ready');
  await fixture.checkoutLink().click();
  await expect(fixture.heading('Checkout')).toBeVisible();
});
