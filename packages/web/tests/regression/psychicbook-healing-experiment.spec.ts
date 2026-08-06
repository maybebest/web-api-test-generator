/* spec: specs/psychicbook-healing-experiment.md version:1.0.0 sha256:23e012214461a1475c9fc8ef54fb1ceee84924d1f35778afba3a816d32b59911 */
import type { Locator, Page } from '@playwright/test';

import { requirePsychicBookEmail } from '../../data/psychicbook';
import { test, expect } from '../../fixtures/test';

const dataCase = {
  caseId: 'DC-001',
  inputs: {
    verificationCode: '1234'
  },
  expected: {
    authenticatedTopMenu: true,
    accountSettingsControlVisible: true
  }
} as const;

class PsychicBookHealingExperimentPage {
  readonly getStartedLink: Locator;
  readonly emailTextbox: Locator;
  readonly continueButton: Locator;
  readonly verificationCodeAlternativeButton: Locator;
  readonly verificationDigitInputs: Locator;
  readonly accountSettingsControl: Locator;

  constructor(private readonly page: Page) {
    this.getStartedLink = page.getByRole('link', { name: 'Get Started' });
    this.emailTextbox = page.getByRole('textbox', { name: /email/i });
    this.continueButton = page.getByRole('button', { name: 'Continue', exact: true });
    this.verificationCodeAlternativeButton = page.getByRole('button', {
      name: /have a verification code/i
    });
    // locator-policy:exception the reviewed verification fields are anonymous numeric inputs without semantic names
    this.verificationDigitInputs = page.locator('input[inputmode="numeric"][maxlength="1"]');
    this.accountSettingsControl = page
      .getByRole('banner')
      .getByRole('button', { name: 'T', exact: true });
  }

  async openLandingPage(): Promise<void> {
    await this.page.goto('/');
  }

  async continueWithEmail(email: string): Promise<void> {
    await this.getStartedLink.click();
    await this.emailTextbox.fill(email);
    await this.continueButton.click();
  }

  async submitVerificationCode(verificationCode: string): Promise<void> {
    if (!/^[0-9]{4}$/.test(verificationCode)) {
      throw new Error('Verification code must contain exactly four ASCII digits.');
    }

    await this.verificationCodeAlternativeButton.click();
    const digitInputs = await this.verificationDigitInputs.all();

    if (digitInputs.length !== verificationCode.length) {
      throw new Error(`Expected four verification inputs, but found ${digitInputs.length}.`);
    }

    for (const [index, digitInput] of digitInputs.entries()) {
      await digitInput.fill(verificationCode[index]);
    }
  }
}

test.describe.serial(
  'PsychicBook generated-test healing experiment',
  { tag: ['@generated', '@regression', '@psychicbook', '@healing-experiment'] },
  () => {
    test('DC-001 returning user sees the account-settings control after verification', async ({ page }) => {
      test.info().annotations.push({
        type: 'covered-ac-ids',
        description: 'AC-001 AC-002 AC-003 AC-004'
      });

      const email = requirePsychicBookEmail();
      const psychicBookPage = new PsychicBookHealingExperimentPage(page);

      await test.step('Arrange AC-001: open the external landing page', async () => {
        await psychicBookPage.openLandingPage();
      });

      await test.step('Act AC-002: continue with the returning-user email', async () => {
        await psychicBookPage.continueWithEmail(email);
      });

      await test.step('Act AC-003: submit the deterministic verification code', async () => {
        await psychicBookPage.submitVerificationCode(dataCase.inputs.verificationCode);
      });

      await test.step('Assert AC-004: account-settings control is visible', async () => {
        await expect(psychicBookPage.accountSettingsControl).toBeVisible();
      });
    });
  }
);
