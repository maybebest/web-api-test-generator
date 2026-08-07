/* spec: specs/psychicbook-account-menu.md version:1.0.0 sha256:659b74e381da4f08e9e9ce4bf30a06d45bf910c2bdec17ead2096c1b15a16606 */
import { test, expect } from '../../fixtures/test';
import { requireStandardUserEmail } from '../../data/users';
import type { Locator, Page } from '@playwright/test';

class PsychicBookLoginPage {
  private readonly getStartedLink: Locator;
  private readonly emailField: Locator;
  private readonly continueButton: Locator;
  private readonly verificationCodeAlternativeButton: Locator;
  private readonly verificationCodeInputs: Locator;
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
    this.accountSettingsButton = page.getByRole("banner").getByRole("button");
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
    return this.accountSettingsButton;
  }
}

const dataCases = [
  {
    caseId: 'DC-001',
    verificationCode: '1234',
  },
] as const;

test.describe.serial('PsychicBook account menu after email verification', () => {
  for (const dataCase of dataCases) {
    test(
      `PsychicBook account menu after email verification (${dataCase.caseId})`,
      { tag: ['@generated', '@regression', '@psychicbook'] },
      async ({ page }) => {
        test.info().annotations.push({ type: 'covered-ac-ids', description: 'AC-001 AC-002 AC-003 AC-004' });
        const psychicBookPage = new PsychicBookLoginPage(page);
        const email = requireStandardUserEmail();

        await test.step('Arrange AC-001: open the PsychicBook landing page', async () => {
          await psychicBookPage.gotoLanding();
        });

        await test.step('Action AC-002, AC-003: authenticate with email and verification code', async () => {
          await psychicBookPage.start();
          await psychicBookPage.submitEmail(email);
          await psychicBookPage.chooseVerificationCode();
          await psychicBookPage.submitVerificationCode(dataCase.verificationCode);
        });

        await test.step('Assert AC-004: account-settings control is visible', async () => {
          await expect(psychicBookPage.accountSettingsControl()).toBeVisible();
        });
      },
    );
  }
});
