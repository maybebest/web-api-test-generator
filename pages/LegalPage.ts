import type { Locator, Page } from '@playwright/test';

// Page Object for the PsychicBook legal/content sections reached from the
// profile menu: Terms And Conditions (`/profile/terms-and-conditions/`) and
// Privacy Policy (`/profile/privacy-policy/`). Both render inside the profile
// shell as long content sections with section headings and body copy;
// assertions target a heading plus distinctive body text.
export class LegalPage {
  readonly main: Locator;

  constructor(private readonly page: Page) {
    this.main = page.getByRole('main');
  }

  async waitForLoaded(): Promise<void> {
    await this.main.waitFor({ state: 'visible' });
  }

  heading(name: string | RegExp): Locator {
    // locator-policy:exception the page title text can also appear as a breadcrumb link, so first() selects the heading element in document order
    return this.page.getByRole('heading', { name }).first();
  }

  copyContaining(text: string): Locator {
    // locator-policy:exception body copy is matched by its distinctive content; first() guards against the phrase recurring deeper in the document
    return this.main.getByText(text, { exact: false }).first();
  }
}
