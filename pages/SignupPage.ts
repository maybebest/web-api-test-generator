import type { Locator, Page } from '@playwright/test';

import { CookieConsent } from '../components/CookieConsent';

// Page Object for the psychicbook signup/login journey as the staging
// environment exposes it: no data-testid attributes exist there (verified by
// the DOM discovery evidence behind docs/ai-testing/psychicbook-find-your-match-flow.md),
// so locators are role- and placeholder-based.
export class SignupPage {
  readonly cookieConsent: CookieConsent;
  readonly getStartedLink: Locator;
  readonly emailInput: Locator;
  readonly firstCodeDigitInput: Locator;
  readonly phoneHeading: Locator;

  private readonly continueButton: Locator;
  private readonly haveVerificationCodeButton: Locator;
  private readonly codeDigitInputs: Locator;
  private readonly phoneProviderButton: Locator;
  private readonly countryCodeButton: Locator;
  private readonly countrySearchInput: Locator;
  private readonly phoneNumberInput: Locator;

  constructor(private readonly page: Page) {
    this.cookieConsent = new CookieConsent(page);
    this.getStartedLink = this.page.getByRole('link', { name: /get started/i });
    this.emailInput = this.page.getByRole('textbox', { name: /email/i });
    this.continueButton = this.page.getByRole('button', { name: 'Continue' });
    this.haveVerificationCodeButton = this.page.getByRole('button', {
      name: /have a verification code/i
    });
    // locator-policy:exception the four verification-code inputs expose no data-testid, accessible name, label, or placeholder on the staging environment (DOM discovery evidence); inputmode="numeric" is the only stable shared hook
    this.codeDigitInputs = this.page.locator('input[inputmode="numeric"]');
    // locator-policy:exception OTP digit boxes are positional by design — the first box is where code entry visibly starts; exposed as the code-entry readiness/outcome signal
    this.firstCodeDigitInput = this.codeDigitInputs.first();

    // "or continue via" providers on the Join Now or Log In screen.
    this.phoneProviderButton = this.page.getByRole('button', { name: 'Phone', exact: true });
    this.phoneHeading = this.page.getByRole('heading', { name: 'Continue with phone number' });
    // The dial-code trigger shows the currently selected code (e.g. "+48"),
    // so it is matched by shape, not by a fixed name.
    this.countryCodeButton = this.page.getByRole('button', { name: /^\+\d+$/ });
    // While the country list is open the phone screen shows a single search
    // textbox; the number field itself is a spinbutton.
    this.countrySearchInput = this.page.getByRole('textbox');
    this.phoneNumberInput = this.page.getByRole('spinbutton');
  }

  async open(path = '/'): Promise<void> {
    await this.page.goto(path);
    await this.getStartedLink.waitFor({ state: 'visible' });
    await this.cookieConsent.dismissIfVisible();
  }

  async startSignup(): Promise<void> {
    await this.getStartedLink.click();
    await this.emailInput.waitFor({ state: 'visible' });
  }

  async submitEmail(email: string): Promise<void> {
    await this.emailInput.fill(email);
    await this.continueButton.click();
    await this.haveVerificationCodeButton.waitFor({ state: 'visible' });
  }

  async openVerificationCodeEntry(): Promise<void> {
    await this.haveVerificationCodeButton.click();
    await this.firstCodeDigitInput.waitFor({ state: 'visible' });
  }

  // The staging environment submits automatically when the 4th digit is typed
  // (no Continue button exists on its Verify your Email screen).
  async enterVerificationCode(verificationCode: string): Promise<void> {
    const digits = [...verificationCode];
    for (let index = 0; index < digits.length; index += 1) {
      // locator-policy:exception OTP digit boxes are positional by design — digit order is element identity for split single-character code inputs
      await this.codeDigitInputs.nth(index).fill(digits[index]);
    }
  }

  // After a phone number is submitted the code screen may either land on the
  // OTP inputs directly or (like the email journey) behind a "have a
  // verification code" toggle — accept both.
  async openVerificationCodeEntryIfOffered(): Promise<void> {
    // One wait for either shape, not two racing ones: the loser of a race
    // keeps waiting until its timeout and is reported as a failed step
    // inside a test that passed.
    await this.haveVerificationCodeButton
      .or(this.firstCodeDigitInput)
      .first()
      .waitFor({ state: 'visible', timeout: 15_000 });

    if (!(await this.firstCodeDigitInput.isVisible())) {
      await this.haveVerificationCodeButton.click();
    }
    await this.firstCodeDigitInput.waitFor({ state: 'visible' });
  }

  // --- phone login ("or continue via" → Phone) ---

  async startPhoneLogin(): Promise<void> {
    await this.phoneProviderButton.click();
    await this.phoneHeading.waitFor({ state: 'visible' });
  }

  // The picker defaults to a geo-derived country; selecting by country name +
  // dial code keeps the flow deterministic. The two live in separate child
  // nodes (their textContent concatenates without a space), so the entry is
  // matched by an exact-name child plus the dial-code text, not by one string.
  async selectPhoneCountry(countryName: string, dialCode: string): Promise<void> {
    await this.countryCodeButton.click();
    await this.countrySearchInput.waitFor({ state: 'visible' });
    await this.countrySearchInput.fill(countryName);
    await this.page
      .getByRole('listitem')
      .filter({ has: this.page.getByText(countryName, { exact: true }) })
      .filter({ hasText: dialCode })
      .first()
      .click();
    await this.phoneNumberInput.waitFor({ state: 'visible' });
  }

  async submitPhoneNumber(nationalNumber: string): Promise<void> {
    await this.phoneNumberInput.fill(nationalNumber);
    await this.continueButton.click();
  }
}
