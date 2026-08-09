/* spec: specs/complex-wizard-personal-plan.md version:1.0.0 sha256:69484fc38ccb401cbbbee6e562681a8a1dbd66974546ad757bf46e75f885ee40 */
import { test, expect } from '../../fixtures/test';
import type { Locator, Page } from '@playwright/test';

class AccountSetupWizardPage {
  private readonly heading: Locator;
  private readonly progress: Locator;
  private readonly nameInput: Locator;
  private readonly emailInput: Locator;
  private readonly passwordInput: Locator;
  private readonly planSelect: Locator;
  private readonly referralSelect: Locator;
  private readonly startDateInput: Locator;
  private readonly nextButton: Locator;
  private readonly reviewSummary: Locator;
  private readonly consentCheckbox: Locator;
  private readonly submitButton: Locator;
  private readonly successPanel: Locator;
  readonly confirmationCode: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Account setup wizard' });
    this.progress = page.getByTestId('wizard-progress');
    this.nameInput = page.getByTestId('wizard-name');
    this.emailInput = page.getByTestId('wizard-email');
    this.passwordInput = page.getByTestId('wizard-password');
    this.planSelect = page.getByTestId('wizard-plan');
    this.referralSelect = page.getByLabel('How did you hear about us?');
    this.startDateInput = page.getByLabel('Start date');
    this.nextButton = page.getByRole('button', { name: 'Next' });
    this.reviewSummary = page.getByTestId('review-summary');
    this.consentCheckbox = page.getByRole('checkbox', {
      name: 'I confirm the details above are correct',
    });
    this.submitButton = page.getByTestId('wizard-submit');
    this.successPanel = page.getByTestId('wizard-success');
    this.confirmationCode = this.successPanel.getByTestId('confirmation-code');
  }

  async open(): Promise<void> {
    await this.page.goto('/complex/wizard');
    await this.heading.waitFor({ state: 'visible' });
    await this.progress.filter({ hasText: 'Step 1 of 3' }).waitFor({ state: 'visible' });
  }

  async completeStepOne(fullName: string, email: string, password: string): Promise<void> {
    await this.nameInput.fill(fullName);
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
  }

  async advanceToStepTwoAndChoosePlan(plan: string): Promise<void> {
    await this.nextButton.click();
    await this.progress.filter({ hasText: 'Step 2 of 3' }).waitFor({ state: 'visible' });
    await this.planSelect.selectOption(plan);
    await this.referralSelect.waitFor({ state: 'visible' });
  }

  async completeStepTwo(referralOptionLabel: string, startDate: string): Promise<void> {
    await this.referralSelect.selectOption({ label: referralOptionLabel });
    await this.startDateInput.fill(startDate);
  }

  async advanceToReview(referralSummary: string, companySummary: string): Promise<void> {
    await this.nextButton.click();
    await this.progress.filter({ hasText: 'Step 3 of 3' }).waitFor({ state: 'visible' });
    await this.reviewSummary
      .filter({ hasText: referralSummary })
      .filter({ hasText: companySummary })
      .waitFor({ state: 'visible' });
  }

  async consentAndSubmit(): Promise<void> {
    await this.consentCheckbox.check();
    await this.submitButton.click();
    await this.successPanel.waitFor({ state: 'visible' });
  }
}

const dataCases = [
  {
    caseId: 'DC-001',
    inputs: {
      fullName: 'Personal Tester',
      email: 'personal.tester@example.com',
      password: 'fixture-pass-2',
      plan: 'personal',
      referralOptionLabel: 'Podcast',
      startDate: '2026-10-01',
    },
    expected: {
      referralSummary: 'podcast',
      companySummary: 'n/a',
      confirmationCode: 'CFX-02231',
    },
  },
] as const;

const variants = [{ Locale: 'en-US', Plan: 'standard', Role: 'guest' }] as const;

for (const dataCase of dataCases) {
  for (const variant of variants) {
    test(
      `Complex wizard personal-plan branch with referral source and deterministic confirmation [${dataCase.caseId}, ${variant.Locale}, ${variant.Plan}, ${variant.Role}]`,
      { tag: ['@generated', '@smoke', '@local-fixture', '@complex-wizard'] },
      async ({ page }) => {
        test.info().annotations.push({
          type: 'covered-ac-ids',
          description: 'AC-001 AC-002 AC-003 AC-004 AC-005 AC-006',
        });

        const accountSetupWizardPage = new AccountSetupWizardPage(page);

        await test.step('Arrange AC-001: open Account setup wizard at Step 1 of 3', async () => {
          await accountSetupWizardPage.open();
        });

        await test.step('Action AC-002: enter valid step-1 account values', async () => {
          await accountSetupWizardPage.completeStepOne(
            dataCase.inputs.fullName,
            dataCase.inputs.email,
            dataCase.inputs.password,
          );
        });

        await test.step('Action AC-003: advance to Step 2 of 3 and choose the personal plan', async () => {
          await accountSetupWizardPage.advanceToStepTwoAndChoosePlan(dataCase.inputs.plan);
        });

        await test.step('Action AC-004: select Podcast and provide the start date', async () => {
          await accountSetupWizardPage.completeStepTwo(
            dataCase.inputs.referralOptionLabel,
            dataCase.inputs.startDate,
          );
        });

        await test.step('Action AC-005: review referral podcast and company n/a', async () => {
          await accountSetupWizardPage.advanceToReview(
            dataCase.expected.referralSummary,
            dataCase.expected.companySummary,
          );
        });

        await test.step('Action AC-006: provide consent, submit, and pass the spinner phase', async () => {
          await accountSetupWizardPage.consentAndSubmit();
        });

        await test.step('Assert AC-006: confirmation code is CFX-02231', async () => {
          await expect(accountSetupWizardPage.confirmationCode).toHaveText(
            dataCase.expected.confirmationCode,
          );
        });
      },
    );
  }
}
