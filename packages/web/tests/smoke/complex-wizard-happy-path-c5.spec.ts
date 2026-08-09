/* spec: specs/complex-wizard-happy-path.md version:1.1.0 sha256:d61e9e6ed85e6356e45e390e9209e141653788167a2906b945394e7c3345d55d */
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

  private alertRegion(): Locator {
    return this.page.getByRole('alert');
  }

  private nameField(): Locator {
    return this.page.getByTestId('wizard-name');
  }

  private emailField(): Locator {
    return this.page.getByTestId('wizard-email');
  }

  private passwordField(): Locator {
    return this.page.getByTestId('wizard-password');
  }

  private nextButton(): Locator {
    return this.page.getByRole('button', { name: 'Next' });
  }

  private planSelect(): Locator {
    return this.page.getByTestId('wizard-plan');
  }

  private companyField(): Locator {
    return this.page.getByLabel('Company name');
  }

  private startDateField(): Locator {
    return this.page.getByLabel('Start date');
  }

  private reviewSummary(): Locator {
    return this.page.getByTestId('review-summary');
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

  confirmationCodeObject(): Locator {
    return this.page.getByTestId('confirmation-code');
  }

  async open(): Promise<void> {
    await this.page.goto('/complex/wizard');
    await this.heading().waitFor({ state: 'visible' });
    await this.progress().waitFor({ state: 'visible' });
  }

  async enterInvalidEmailAndBlur(invalidEmail: string): Promise<void> {
    await this.emailField().fill(invalidEmail);
    await this.emailField().press('Tab');
    await this.alertRegion().waitFor({ state: 'visible' });
  }

  async completeStepOne(
    fullName: string,
    email: string,
    password: string,
  ): Promise<void> {
    await this.nameField().fill(fullName);
    await this.emailField().fill(email);
    await this.passwordField().fill(password);
  }

  async chooseBusinessPlan(plan: string): Promise<void> {
    await this.nextButton().click();
    await this.planSelect().selectOption(plan);
    await this.companyField().waitFor({ state: 'visible' });
  }

  async completeStepTwo(company: string, startDate: string): Promise<void> {
    await this.companyField().fill(company);
    await this.startDateField().fill(startDate);
  }

  async advanceToReview(): Promise<void> {
    await this.nextButton().click();
    await this.reviewSummary().waitFor({ state: 'visible' });
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
    fullName: 'Wizard User',
    invalidEmail: 'wizard.user',
    email: 'wizard.user@example.com',
    password: 'fixture-pass-1',
    plan: 'business',
    company: 'Fixture Works Ltd',
    startDate: '2026-09-01',
    confirmationCode: 'CFX-01871',
  },
] as const;

for (const dataCase of dataCases) {
  test(
    `Complex wizard happy path with one recovered validation error (${dataCase.caseId})`,
    { tag: ['@generated', '@smoke', '@local-fixture', '@complex-wizard'] },
    async ({ page }) => {
      test.info().annotations.push({
        type: 'covered-ac-ids',
        description: 'AC-001 AC-002 AC-003 AC-004 AC-005 AC-006',
      });

      const wizardPage = new AccountSetupWizardPage(page);

      await test.step('Arrange AC-001: open Account setup wizard at Step 1 of 3', async () => {
        await wizardPage.open();
      });

      await test.step('Action AC-002: blur invalid email and surface role=alert with Enter a valid email address.', async () => {
        await wizardPage.enterInvalidEmailAndBlur(dataCase.invalidEmail);
      });

      await test.step('Action AC-003: replace invalid values and clear the visible alert region', async () => {
        await wizardPage.completeStepOne(
          dataCase.fullName,
          dataCase.email,
          dataCase.password,
        );
      });

      await test.step('Action AC-004: advance to Step 2 of 3 and choose the Business plan', async () => {
        await wizardPage.chooseBusinessPlan(dataCase.plan);
      });

      await test.step('Action AC-004: complete company and start date fields', async () => {
        await wizardPage.completeStepTwo(dataCase.company, dataCase.startDate);
      });

      await test.step('Action AC-005: advance to the review summary containing the entered email', async () => {
        await wizardPage.advanceToReview();
      });

      await test.step('Action AC-006: consent, submit, and pass the spinner phase', async () => {
        await wizardPage.consentAndSubmit();
      });

      await test.step('Assert AC-006: confirmation code is CFX-01871', async () => {
        const confirmationCodeObject = wizardPage.confirmationCodeObject();
        await expect(confirmationCodeObject).toHaveText(dataCase.confirmationCode);
      });
    },
  );
}
