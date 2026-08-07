import type { Locator, Page } from '@playwright/test';

// Authenticated staging landing page (/psychics): a "Psychics" heading plus
// a breadcrumb Home link.
export class PsychicsPage {
  readonly heading: Locator;

  private readonly homeLink: Locator;

  constructor(private readonly page: Page) {
    this.heading = this.page.getByRole('heading', { name: 'Psychics' });
    this.homeLink = this.page.getByRole('link', { name: 'Home' });
  }

  // Readiness wait, not an assertion: the heading is the user-visible signal
  // that authentication landed on the psychics experience.
  async waitForLoaded(): Promise<void> {
    await this.heading.waitFor({ state: 'visible' });
  }

  // The real environment serves the authenticated home variant — the one that
  // owns the find-your-match widget — only on a full document load: after an
  // in-session login, client-side navigation keeps the unauthenticated home
  // shell with no match widget (verified by discovery probes, including a
  // reload A/B). Reloading once after the Home click deterministically lands
  // the browser on the authenticated home document.
  async goHome(): Promise<void> {
    await this.homeLink.click();
    // Wait for the exact home path before reloading. A "/$"-style regex would
    // also match the current "/psychics/" URL and resolve before the SPA
    // navigates, making the subsequent reload race onto the wrong page.
    await this.page.waitForURL((url) => new URL(url).pathname === '/');
    await this.page.reload();
  }
}
