/* spec: specs/psychicbook-healing-experiment.md version:1.0.0 sha256:23e012214461a1475c9fc8ef54fb1ceee84924d1f35778afba3a816d32b59911 */
import type { Locator, Page } from '@playwright/test';
import { requirePsychicBookEmail } from '../../data/psychicbook';
import { expect, test } from '../../fixtures/test';

class PsychicBookHealingExperimentPage {
  readonly getStartedLink: Locator;
  readonly emailTextbox: Locator;
  readonly continueButton: Locator;
  readonly verificationCodeButton: Locator;
  readonly verificationDigitInputs: Locator;
  readonly accountSettingsButton: Locator;

  constructor(private readonly page: Page) {
    this.getStartedLink = page.getByRole('link', { name: 'Get Started' });
    this.emailTextbox = page.getByRole('textbox', { name: /email/i });
    this.continueButton = page.getByRole('button', { name: 'Continue' });
    this.verificationCodeButton = page.getByRole('button', {
      name: /have a verification code/i,
    });
    // locator-policy:exception the reviewed verification fields are anonymous numeric inputs without semantic names
    this.verificationDigitInputs = page.locator('input[inputmode="numeric"][maxlength="1"]');
    this.accountSettingsButton = page
      .getByRole('banner')
      .getByRole('button', { name: 'T', exact: true });
  }

  async gotoLanding(): Promise<void> {
    await this.page.goto('/');
  }

  async start(): Promise<void> {
    await this.getStartedLink.click();
  }

  async submitEmail(email: string): Promise<void> {
    await this.emailTextbox.fill(email);
    await this.continueButton.click();
  }

  async chooseVerificationCode(): Promise<void> {
    await this.verificationCodeButton.click();
  }

  async submitVerificationCode(code: string): Promise<void> {
    if (!/^[0-9]{4}$/.test(code)) {
      throw new Error('Verification code must contain exactly four ASCII digits.');
    }

    for (let index = 0; index < code.length; index += 1) {
      await this.verificationDigitInputs.nth(index).fill(code[index]);
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

test.describe.serial('PsychicBook generated-test healing experiment', () => {
  for (const dataCase of dataCases) {
    test(
      `returning user signs in and sees account settings (${dataCase.caseId})`,
      { tag: ['@generated', '@regression', '@psychicbook', '@healing-experiment'] },
      async ({ page }) => {
        test.info().annotations.push({ type: 'covered-ac-ids', description: 'AC-001 AC-002 AC-003 AC-004' });
        const psychicBookPage = new PsychicBookHealingExperimentPage(page);
        const email = requirePsychicBookEmail();

        await test.step('Arrange AC-001: open the configured landing page', async () => {
          await psychicBookPage.gotoLanding();
        });

        await test.step('Action AC-002 AC-003: authenticate with email and verification code', async () => {
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
