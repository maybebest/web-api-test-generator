import type { Locator, Page } from '@playwright/test';

import { CookieConsent } from '../components/CookieConsent';
import { Header } from '../components/Header';
import { BasePage } from './BasePage';

export class HomePage extends BasePage {
  readonly header: Header;
  readonly cookieConsent: CookieConsent;
  readonly primaryHeading: Locator;
  readonly mainContent: Locator;
  readonly matchQuestionInput: Locator;

  private readonly getTheAnswerButton: Locator;

  constructor(page: Page) {
    super(page);
    this.header = new Header(page);
    this.cookieConsent = new CookieConsent(page);
    // locator-policy:exception the home page has several headings with copy-driven names and no stable test id; the primary heading is by definition the first heading in document order
    this.primaryHeading = page.getByRole('heading').first();
    this.mainContent = page.getByRole('main');
    // Role locator on purpose: a hidden chat-composer input shares the same
    // placeholder text on the real environment, so getByPlaceholder is
    // ambiguous; only the visible match widget exposes this accessible name.
    this.matchQuestionInput = page.getByRole('textbox', { name: 'Type your question here…' });
    this.getTheAnswerButton = page.getByRole('button', { name: 'Get the answer' });
  }

  override async goto(): Promise<void> {
    await super.goto('/');
  }

  // The real home page lazy-mounts the find-your-match widget on user
  // interaction (scroll). Scroll in bounded steps until the widget mounts;
  // every iteration waits on the
  // user-visible signal itself, so there are no unconditional sleeps.
  async revealMatchWidget(): Promise<void> {
    const maxScrollSteps = 15;
    for (let step = 0; step < maxScrollSteps; step += 1) {
      const visible = await this.matchQuestionInput
        .waitFor({ state: 'visible', timeout: 700 })
        .then(() => true, () => false);
      if (visible) {
        break;
      }
      await this.page.mouse.wheel(0, 700);
    }
    await this.matchQuestionInput.waitFor({ state: 'visible' });
    await this.matchQuestionInput.scrollIntoViewIfNeeded();
  }

  async typeMatchQuestion(question: string): Promise<void> {
    await this.revealMatchWidget();
    await this.matchQuestionInput.fill(question);
  }

  // The Get the answer button stays disabled until a question is typed; the
  // click auto-waits for the enabled state. The consent banner (real
  // environment only) is dismissed first so it cannot intercept this
  // bottom-of-page click.
  async submitMatchQuestion(): Promise<void> {
    await this.cookieConsent.dismissIfVisible();
    await this.getTheAnswerButton.click();
  }
}
