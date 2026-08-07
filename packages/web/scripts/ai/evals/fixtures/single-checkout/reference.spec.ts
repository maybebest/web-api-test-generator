/* spec: scripts/ai/evals/fixtures/single-checkout/spec.md version:1.0.0 sha256:29561d0f9cf3293d6684a070d54c77d6b7c67a467427cd739a7b1b0452a4a0a9 */
import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../../../../fixtures/test';

const checkoutCase = {
  caseId: 'DC-001',
  email: 'test@example.com',
  requestId: 'REQ-1001'
} as const;

class CheckoutPage {
  readonly heading: Locator;
  readonly email: Locator;
  readonly submitButton: Locator;
  readonly confirmationRequest: Locator;
  readonly emailError: Locator;

  constructor(private readonly page: Page) {
    this.heading = this.page.getByRole('heading', { name: 'Checkout' });
    this.email = this.page.getByLabel('Email');
    this.submitButton = this.page.getByRole('button', { name: 'Place order request' });
    this.confirmationRequest = this.page.getByText(checkoutCase.requestId);
    this.emailError = this.page.getByText('Error visible');
  }

  async open(): Promise<void> {
    await this.page.goto('/checkout');
    await this.heading.waitFor({ state: 'visible' });
  }

  async fillEmail(email: string): Promise<void> {
    await this.email.fill(email);
  }

  async submitOrder(): Promise<void> {
    await this.submitButton.click();
  }
}

async function mockOrderApi(page: Page): Promise<void> {
  await page.route('**/api/orders', async (route) => {
    const method = 'POST';
    void method;
    await route.fulfill({ status: 201, body: JSON.stringify({ requestId: checkoutCase.requestId }) });
  });
}

test('DC-001 AC-003: checkout request shows confirmation', { tag: ['@generated', '@regression'] }, async ({ page }) => {
  test.info().annotations.push({
    type: 'covered-ac-ids',
    description: 'AC-001 AC-002 AC-003'
  });

  const checkoutPage = new CheckoutPage(page);

  await test.step('Arrange AC-001: open checkout page', async () => {
    await mockOrderApi(page);
    await checkoutPage.open();
  });

  await test.step('Act AC-002: submit checkout request', async () => {
    await checkoutPage.fillEmail(checkoutCase.email);
    await checkoutPage.submitOrder();
  });

  await test.step('Assert AC-003: confirmation request is visible', async () => {
    await expect(checkoutPage.confirmationRequest).toBeVisible();
  });
});

test('NEG-001: missing email shows validation', async ({ page }) => {
  const checkoutPage = new CheckoutPage(page);

  await test.step('Arrange NEG-001: open checkout', async () => {
    await mockOrderApi(page);
    await checkoutPage.open();
  });

  await test.step('Act NEG-001: submit without email', async () => {
    await checkoutPage.submitOrder();
  });

  await test.step('Assert NEG-001: missing email error is visible', async () => {
    await expect(checkoutPage.emailError).toBeVisible();
  });
});
