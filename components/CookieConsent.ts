import type { Locator, Page } from '@playwright/test';

// The real psychicbook environment shows a fixed-position cookie-consent
// banner on first visit. Dismissing it when present keeps the banner from
// intercepting clicks near the bottom of the viewport later in a flow.
export class CookieConsent {
  readonly acceptButton: Locator;

  constructor(page: Page) {
    this.acceptButton = page.getByRole('button', { name: 'Accept' });
  }

  // Conditional by design: the banner exists only on the real environment.
  // Callers wait for page readiness first, so the isVisible() probe does not
  // race the initial render; a second dismissal chance exists right before
  // the bottom-of-page click it protects.
  async dismissIfVisible(): Promise<void> {
    if (await this.acceptButton.isVisible()) {
      await this.acceptButton.click();
      await this.acceptButton.waitFor({ state: 'hidden' });
    }
  }
}
