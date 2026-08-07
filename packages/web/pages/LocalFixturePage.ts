import type { Locator, Page } from '@playwright/test';

export class LocalFixturePage {
  constructor(private readonly page: Page) {}

  async gotoHome(): Promise<void> {
    await this.page.goto('/');
  }

  async gotoCheckout(): Promise<void> {
    await this.page.goto('/recorded-example/checkout');
  }

  heading(name: string | RegExp): Locator {
    return this.page.getByRole('heading', { name });
  }

  navigation(): Locator {
    return this.page.getByRole('navigation', { name: 'Fixture navigation' });
  }

  fixtureCard(): Locator {
    return this.page.getByTestId('fixture-card');
  }

  readyStatus(): Locator {
    return this.page.getByRole('status');
  }

  checkoutLink(): Locator {
    return this.page.getByRole('link', { name: 'Open the checkout fixture' });
  }

  emailField(): Locator {
    return this.page.getByRole('textbox', { name: 'Email' });
  }

  fullNameField(): Locator {
    return this.page.getByRole('textbox', { name: 'Full name' });
  }

  submitRecordingButton(): Locator {
    return this.page.getByRole('button', { name: 'Submit recording' });
  }
}
