/* spec: specs/complex-wizard-personal-plan.md version:1.0.0 sha256:69484fc38ccb401cbbbee6e562681a8a1dbd66974546ad757bf46e75f885ee40 */
import { test, expect } from '../../fixtures/test';
import type { Locator, Page } from '@playwright/test';

class AccountSetupWizardPage {
  constructor(private readonly page: Page) {}

  private heading(): Locator {
    return this.page.getByRole('heading', { name: 'Account setup wizard' });
  }

  private progress(): Locator {
    return this.page.getByTestId('wizard-progress');
  }

  private nameInput(): Locator {
    return this.page.getByTestId('wizard-name');
  }

  private emailInput(): Locator {
    return this.page.getByTestId('wizard-email');
  }

  private passwordInput(): Locator {
    return this.page.getByTestId('wizard-password');
  }

  private planSelect(): Locator {
    return this.page.getByTestId('wizard-plan');
  }

  private referralSelect(): Locator {
    return this.page.getByLabel('How did you hear about us?');
  }

  private startDateInput(): Locator {
    return this.page.getByLabel('Start date');
  }

  private nextButton(): Locator {
    return this.page.getByRole('button', { name: 'Next' });
  }

  private reviewSummary(): Locator {
    return this.page.getByTestId('review-summary');
  }

  private referralSummary(): Locator {
    return this.reviewSummary().getByText('podcast', { exact: true });
  }

  private companySummary(): Locator {
    return this.reviewSummary().getByText('n/a', { exact: true });
  }

  private consentCheckbox(): Locator {
    return this.page.getByRole('checkbox', {
      name: 'I confirm the details above are correct',
    });
  }

  private submitButton(): Locator {
    return this.page.getByTestId('wizard-submit');
  }

  private busyStatus(): Locator {
    return this.page.getByRole('status');
  }

  private successPanel(): Locator {
    return this.page.getByTestId('wizard-success');
  }

  confirmationCode(): Locator {
    return this.successPanel().getByTestId('confirmation-code');
  }

  async open(): Promise<void> {
    await this.page.goto('/complex/wizard');
    await this.heading().waitFor({ state: 'visible' });
    await this.progress().getByText('Step 1 of 3', { exact: true }).waitFor({ state: 'visible' });
  }

  async completeStepOne(fullName: string, email: string, password: string): Promise<void> {
    await this.nameInput().fill(fullName);
    await this.emailInput().fill(email);
    await this.passwordInput().fill(password);
    await this.nextButton().click();
  }

  async choosePersonalPlan(plan: string): Promise<void> {
    await this.progress().getByText('Step 2 of 3', { exact: true }).waitFor({ state: 'visible' });
    await this.planSelect().selectOption(plan);
    await this.referralSelect().waitFor({ state: 'visible' });
  }

  async completeStepTwo(referralOptionLabel: string, startDate: string): Promise<void> {
    await this.referralSelect().selectOption({ label: referralOptionLabel });
    await this.startDateInput().fill(startDate);
    await this.nextButton().click();
  }

  async waitForReviewSummary(): Promise<void> {
    await this.progress().getByText('Step 3 of 3', { exact: true }).waitFor({ state: 'visible' });
    await this.reviewSummary().waitFor({ state: 'visible' });
    await this.referralSummary().waitFor({ state: 'visible' });
    await this.companySummary().waitFor({ state: 'visible' });
  }

  async consentAndSubmit(): Promise<void> {
    await this.consentCheckbox().check();
    await this.submitButton().click();
    await this.busyStatus().waitFor({ state: 'visible' });
    await this.successPanel().waitFor({ state: 'visible' });
  }
}

const dataCases = [
  {
    caseId: 'DC-001',
    fullName: 'Personal Tester',
    email: 'personal.tester@example.com',
    password: 'fixture-pass-2',
    plan: 'personal',
    referralOptionLabel: 'Podcast',
    startDate: '2026-10-01',
    referralSummary: 'podcast',
    companySummary: 'n/a',
    confirmationCode: 'CFX-02231',
  },
] as const;

const variants = [
  { Locale: 'en-US', Plan: 'standard', Role: 'guest' },
] as const;

for (const dataCase of dataCases) {
  for (const variant of variants) {
    test(
      `Complex wizard personal-plan branch with referral source and deterministic confirmation [${dataCase.caseId}] [${variant.Locale}/${variant.Plan}/${variant.Role}]`,
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

        await test.step('Action AC-002: enter valid step-1 account details', async () => {
          await accountSetupWizardPage.completeStepOne(
            dataCase.fullName,
            dataCase.email,
            dataCase.password,
          );
        });

        await test.step('Action AC-003: reach Step 2 of 3 and choose the personal plan', async () => {
          await accountSetupWizardPage.choosePersonalPlan(dataCase.plan);
        });

        await test.step('Action AC-004: choose Podcast and the start date', async () => {
          await accountSetupWizardPage.completeStepTwo(
            dataCase.referralOptionLabel,
            dataCase.startDate,
          );
        });

        await test.step(`Action AC-005: review referral ${dataCase.referralSummary} and company ${dataCase.companySummary}`, async () => {
          await accountSetupWizardPage.waitForReviewSummary();
        });

        await test.step('Action AC-006: consent, submit, and pass the spinner phase', async () => {
          await accountSetupWizardPage.consentAndSubmit();
        });

        await test.step('Assert AC-006: confirmation code is CFX-02231', async () => {
          await expect(accountSetupWizardPage.confirmationCode()).toHaveText(dataCase.confirmationCode);
        });
      },
    );
  }
}
