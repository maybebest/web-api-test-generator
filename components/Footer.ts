import type { Locator, Page } from '@playwright/test';

// The single global site footer (<footer> => role=contentinfo). It carries the
// "status page" marketing/legal links. Every one of those link names also
// appears in the header dropdowns and/or page body, so footer navigation must
// be scoped to this region; within it each link name is unique (DOM-discovery
// evidence: docs/ai-testing/psychicbook-navigation-flow.md).
export class Footer {
  readonly root: Locator;

  constructor(page: Page) {
    this.root = page.getByRole('contentinfo');
  }

  link(name: string): Locator {
    return this.root.getByRole('link', { name, exact: true });
  }

  async scrollIntoView(): Promise<void> {
    await this.root.scrollIntoViewIfNeeded();
  }
}
