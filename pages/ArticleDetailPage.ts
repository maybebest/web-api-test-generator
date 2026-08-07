import type { Locator, Page } from '@playwright/test';

// An opened article page. The "Written by our advisor" block appears twice
// (under the title and at the end); both link to the same expert profile —
// always work with the FIRST (top) one.
export class ArticleDetailPage {
  readonly writtenByBlocks: Locator;
  /** First text block of the article body — proves the page has content. */
  readonly firstParagraph: Locator;

  constructor(private readonly page: Page) {
    this.writtenByBlocks = page.getByText('Written by our advisor');
    this.firstParagraph = page.getByRole('main').locator('p').first();
  }

  heading(name: string): Locator {
    return this.page.getByRole('heading', { level: 1, name });
  }

  /** The author link of the TOP "Written by our advisor" block. */
  topAuthorLink(): Locator {
    // locator-policy:exception the block exposes no landmark; the author link is the first /psychics/ anchor in main that carries the author's name (its sibling anchor wraps the avatar image only)
    return this.page.getByRole('main').locator('a[href^="/psychics/"]').filter({ hasText: /.+/ }).first();
  }
}
