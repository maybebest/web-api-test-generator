import type { Locator, Page } from '@playwright/test';

// Generic destination/content page reached by following a menu or footer link.
// Used to assert that a navigation landed on a real, rendered page (a level-1
// heading) rather than a 404/error, without coupling to any one page's markup.
export class ContentPage {
  constructor(private readonly page: Page) {}

  // The page's primary heading, optionally matched by name. Pinned to level 1
  // because several pages expose the same accessible name on more than one
  // heading element (DOM-discovery evidence).
  heading(name: string | RegExp): Locator {
    return this.page.getByRole('heading', { level: 1, name });
  }

  get topHeading(): Locator {
    // locator-policy:exception destination article titles are dynamic, so the test cannot match by name; the page exposes a single level-1 heading and first() guards against incidental duplicates
    return this.page.getByRole('heading', { level: 1 }).first();
  }

  // A body paragraph inside the main landmark. Real articles have many; a
  // category/listing page has none, so this distinguishes "a real article
  // opened" from landing on a category page.
  get articleBody(): Locator {
    // locator-policy:exception article bodies expose no role/landmark beyond paragraphs in main; first() takes any rendered body paragraph as the content signal
    return this.page.getByRole('main').locator('p').first();
  }
}
