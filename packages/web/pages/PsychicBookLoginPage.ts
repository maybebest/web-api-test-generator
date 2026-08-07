import type { Locator, Page } from '@playwright/test';

/**
 * Owns the reviewed PsychicBook email-verification sign-in journey. Assertions
 * remain in the calling test so its final account-settings check is explicit.
 */
export class PsychicBookLoginPage {
  private readonly getStartedLink: Locator;
  private readonly emailField: Locator;
  private readonly continueButton: Locator;
  private readonly verificationCodeAlternativeButton: Locator;
  private readonly verificationCodeInputs: Locator;
  private readonly accountSettingsLink: Locator;
  private readonly accountSettingsButton: Locator;

  constructor(private readonly page: Page) {
    this.getStartedLink = page.getByRole('link', { name: 'Get Started' });
    this.emailField = page.getByRole('textbox', { name: /email/i });
    this.continueButton = page.getByRole('button', { name: 'Continue' });
    this.verificationCodeAlternativeButton = page.getByRole('button', {
      name: /have a verification code/i
    });
    // locator-policy:exception the reviewed verification fields are anonymous numeric inputs without semantic names
    this.verificationCodeInputs = page.locator('input[inputmode="numeric"][maxlength="1"]');
    this.accountSettingsLink = page.getByRole('link', { name: /^account settings$/i });
    this.accountSettingsButton = page.getByRole('button', { name: /^account settings$/i });
  }

  async gotoLanding(): Promise<void> {
    await this.page.goto('/');
  }

  async start(): Promise<void> {
    await this.getStartedLink.click();
  }

  async submitEmail(email: string): Promise<void> {
    await this.emailField.fill(email);
    await this.continueButton.click();
  }

  async chooseVerificationCode(): Promise<void> {
    await this.verificationCodeAlternativeButton.click();
  }

  async submitVerificationCode(code: string): Promise<void> {
    if (!/^[0-9]{4}$/.test(code)) {
      throw new Error('PsychicBookLoginPage: verification code must contain exactly four ASCII digits.');
    }

    for (const [index, digit] of [...code].entries()) {
      // locator-policy:exception the reviewed four anonymous digit inputs must be filled in their rendered order
      await this.verificationCodeInputs.nth(index).fill(digit);
    }
  }

  accountSettingsControl(): Locator {
    return this.accountSettingsLink.or(this.accountSettingsButton);
  }
}
