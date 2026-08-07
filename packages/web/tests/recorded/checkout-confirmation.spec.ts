/* recording: recordings/checkout-confirmation.json title:Recorded checkout confirmation sha256:1d7fe4718c61f31c4a12592ed27c23c2b473b81ecfda3ca2694a721591d34d67 */
import { test, expect } from '../../fixtures/test';

test('Recorded checkout confirmation', async ({ page }) => {
  await test.step('RSTEP-001: navigate to the local checkout fixture', async () => {
    await page.goto('/recorded-example/checkout');
  });

  await test.step('RSTEP-002 ASSERT-001: Checkout heading is visible', async () => {
    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
  });

  await test.step('RSTEP-003: enter the recorded email', async () => {
    await page.getByRole('textbox', { name: 'Email' }).fill('recording@example.com');
  });

  await test.step('RSTEP-004: enter the recorded full name', async () => {
    await page.getByRole('textbox', { name: 'Full name' }).fill('Recording Customer');
  });

  await test.step('RSTEP-005: submit the recording', async () => {
    await page.getByRole('button', { name: 'Submit recording' }).click();
  });

  await test.step('RSTEP-006 ASSERT-002: confirmation heading is visible', async () => {
    await expect(page.getByRole('heading', { name: 'Recording submitted' })).toBeVisible();
  });
});
