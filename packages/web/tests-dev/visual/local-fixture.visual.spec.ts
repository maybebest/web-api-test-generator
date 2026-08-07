import { test, expect } from '../../fixtures/test';
import { LocalFixturePage } from '../../pages/LocalFixturePage';

test('local fixture keeps its desktop visual layout contract', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const fixture = new LocalFixturePage(page);
  await fixture.gotoHome();

  const card = fixture.fixtureCard();
  await expect(card).toBeVisible();
  await expect(card).toHaveCSS('border-radius', '16px');
  await expect(fixture.navigation()).toBeVisible();

  const bounds = await card.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds?.width).toBeGreaterThan(500);
  expect(bounds?.width).toBeLessThan(800);
  await testInfo.attach('local-fixture-visual-contract', {
    body: await page.screenshot({ animations: 'disabled' }),
    contentType: 'image/png'
  });
});
