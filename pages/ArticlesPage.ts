import type { Locator, Page } from '@playwright/test';

import { CookieConsent } from '../components/CookieConsent';

// The Articles listing at /articles/ (header "Articles" link destination).
// Article cards live in the single `main` landmark; each card has three
// same-href anchors (image, title, excerpt) and the listing sections expose no
// aria landmarks, so the title anchor is isolated by its Tailwind line-clamp
// class (DOM-discovery evidence: docs/ai-testing/psychicbook-navigation-flow.md).
export class ArticlesPage {
  readonly cookieConsent: CookieConsent;
  readonly pageHeading: Locator;
  readonly popularHeading: Locator;
  readonly firstArticleCardTitle: Locator;
  private readonly articleTitleLinks: Locator;

  constructor(private readonly page: Page) {
    this.cookieConsent = new CookieConsent(page);
    // Pinned to level 1: getByRole('heading', { name: 'Articles' }) matches several elements here.
    this.pageHeading = page.getByRole('heading', { level: 1, name: 'Articles' });
    this.popularHeading = page.getByRole('heading', { name: 'Popular Articles' });
    // locator-policy:exception each card has three anchors sharing one href and the listing has no role/landmark to distinguish the title; the `line-clamp-2` title-anchor class is the only stable hook, and the known test-junk cards (/test2/, /123/) are excluded so first() opens a real content article (DOM discovery evidence)
    this.articleTitleLinks = page.getByRole('main').locator('a.line-clamp-2:not([href="/test2/"]):not([href="/123/"])');
    this.firstArticleCardTitle = this.articleTitleLinks.first();
  }

  async open(): Promise<void> {
    await this.page.goto('/articles/', { waitUntil: 'domcontentloaded' });
    await this.cookieConsent.dismissIfVisible();
    await this.pageHeading.waitFor({ state: 'visible' });
  }

  /** Title link of the nth article card, in the order they are shown. */
  articleTitleLink(index: number): Locator {
    return this.articleTitleLinks.nth(index);
  }

  /**
   * Opens articles one by one and stops on the first one written by an
   * expert. Returns the author name and the link to their profile.
   */
  async openArticleWithAuthor(maxArticles = 3): Promise<{ name: string; profilePath: string }> {
    for (let index = 0; index < maxArticles; index += 1) {
      await this.articleTitleLink(index).click();
      await this.page.waitForURL((url) => !url.pathname.startsWith('/articles'));

      const authorLink = this.page.getByRole('main').locator('a[href^="/psychics/"]').filter({ hasText: /.+/ }).first();
      const hasAuthor = await this.page
        .getByText('Written by our advisor')
        .first()
        .isVisible({ timeout: 5_000 })
        .catch(() => false);

      if (hasAuthor) {
        return {
          name: (await authorLink.textContent())!.replace(/\s+/g, ' ').trim(),
          profilePath: (await authorLink.getAttribute('href'))!
        };
      }
      await this.open();
    }
    throw new Error(`None of the first ${maxArticles} articles is written by an expert`);
  }
}
