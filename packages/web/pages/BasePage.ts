import type { Locator, Page } from '@playwright/test';

export class BasePage {
  protected readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto(path = '/'): Promise<void> {
    await this.page.goto(path);
    await this.waitForLoaded();
  }

  // Readiness is a wait, not an assertion. Page Objects must not hide test
  // assertions (those belong in the test's final assertion step); using
  // waitFor keeps oracle logic in the tests where the reviewer can see it.
  async waitForLoaded(): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded');
    await this.visiblePageRoot().waitFor({ state: 'visible' });
  }

  protected visiblePageRoot(): Locator {
    return this.page.getByRole('main');
  }
}
