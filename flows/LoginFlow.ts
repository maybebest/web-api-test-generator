import type { Page } from '@playwright/test';

import { SignupPage } from '../pages/SignupPage';
import { environment } from '../config/environments';

/**
 * Logs a user in through the site.
 *
 * The flow only clicks and types. What the login proved (landing page,
 * header with the nickname) is checked in the test.
 */
export class LoginFlow {
  private readonly signup: SignupPage;

  constructor(page: Page) {
    this.signup = new SignupPage(page);
  }

  async byEmail(email: string, code = environment.emailCode): Promise<void> {
    await this.signup.open('/');
    await this.signup.startSignup();
    await this.signup.submitEmail(email);
    await this.signup.openVerificationCodeEntry();
    await this.signup.enterVerificationCode(code);
  }

  async byPhone(nationalNumber: string, code = environment.smsCode): Promise<void> {
    await this.signup.open('/');
    await this.signup.startSignup();
    await this.signup.startPhoneLogin();
    await this.signup.selectPhoneCountry('United States', '+1');
    await this.signup.submitPhoneNumber(nationalNumber);
    await this.signup.openVerificationCodeEntryIfOffered();
    await this.signup.enterVerificationCode(code);
  }
}
