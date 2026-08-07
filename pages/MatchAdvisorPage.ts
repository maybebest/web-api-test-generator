import type { Locator, Page } from '@playwright/test';

// Psychic Match page (/match-advisor) — the new page the find-your-match
// question navigates to on the staging environment.
//
// The page's "Find your match with a Psychic Expert" title is only a transient
// pre-matching heading: on the real environment a "Matching you with your
// advisor…" modal takes over within ~2s (hiding the heading from the
// accessibility tree) and the heading is then replaced by a "Meet Your Psychic
// Match" result view (verified by discovery timeline probes on 2026-06-11). The
// "Psychic Match" breadcrumb, by contrast, is present and visible throughout
// the whole lifecycle (matching modal and result alike) and is exactly one
// element — so it is the stable signal that the new page loaded.
export class MatchAdvisorPage {
  readonly pageBreadcrumb: Locator;

  constructor(page: Page) {
    this.pageBreadcrumb = page.getByText('Psychic Match', { exact: true });
  }

  // Readiness wait, not an assertion: the breadcrumb is the user-visible signal
  // that the Psychic Match page has loaded. Polls up to the navigation budget
  // to absorb the real environment's SPA transition.
  async waitForLoaded(): Promise<void> {
    await this.pageBreadcrumb.waitFor({ state: 'visible', timeout: 30_000 });
  }
}
