/* spec: scripts/ai/evals/fixtures/suite-checkout/spec.md version:1.0.0 sha256:2d384f2d3a902d57f71e3d21ea4be4c5509e1066383774eb2771e5eee1657445 */
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

test('AC-001: checkout entry page is visible', { tag: ['@generated', '@regression'] }, async ({ page }) => {
  const checkoutPage = new CheckoutPage(page);

  await test.step('Arrange: mock checkout API', async () => {
    await mockOrderApi(page);
  });
  await test.step('Act: open checkout', async () => {
    await checkoutPage.open();
  });
  await test.step('Assert AC-001: checkout entry page is visible', async () => {
    await expect(checkoutPage.heading).toBeVisible();
  });
});

test('AC-002: user can fill contact fields', { tag: ['@generated', '@regression'] }, async ({ page }) => {
  const checkoutPage = new CheckoutPage(page);

  await test.step('Arrange: open checkout', async () => {
    await mockOrderApi(page);
    await checkoutPage.open();
  });
  await test.step('Act: fill contact email', async () => {
    await checkoutPage.fillEmail(checkoutCase.email);
  });
  await test.step('Assert AC-002: email field contains submitted value', async () => {
    await expect(checkoutPage.email).toHaveValue(checkoutCase.email);
  });
});

test('AC-003: user can submit order request', { tag: ['@generated', '@regression'] }, async ({ page }) => {
  const checkoutPage = new CheckoutPage(page);

  await test.step('Arrange: completed checkout form', async () => {
    await mockOrderApi(page);
    await checkoutPage.open();
    await checkoutPage.fillEmail(checkoutCase.email);
  });
  await test.step('Act: submit order request', async () => {
    await checkoutPage.submitOrder();
  });
  await test.step('Assert AC-003: confirmation request is visible', async () => {
    await expect(checkoutPage.confirmationRequest).toBeVisible();
  });
});

test('NEG-001: missing email shows validation', { tag: ['@generated', '@regression'] }, async ({ page }) => {
  const checkoutPage = new CheckoutPage(page);

  await test.step('Arrange: open checkout', async () => {
    await mockOrderApi(page);
    await checkoutPage.open();
  });
  await test.step('Act: submit without email', async () => {
    await checkoutPage.submitOrder();
  });
  await test.step('Assert NEG-001: missing email error is visible', async () => {
    await expect(checkoutPage.emailError).toBeVisible();
  });
});
