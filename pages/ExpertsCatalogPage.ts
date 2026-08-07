import type { Locator, Page } from '@playwright/test';

// The authenticated /psychics catalog: category chips on top, expert cards
// below. Each card carries the expert's profile link, an Online badge,
// prices and its own "Book Session" button.
export class ExpertsCatalogPage {
  readonly cards: Locator;

  constructor(private readonly page: Page) {
    // locator-policy:exception the cards expose no landmark/role; the rounded shadow container that holds both the expert profile link and a Book Session button is the only stable card hook (DOM discovery 31.07.2026)
    this.cards = page
      .locator('div[class*="shadow-3xl"]')
      .filter({ has: page.getByRole('button', { name: 'Book Session' }) })
      .filter({ has: page.locator('a[href^="/psychics/"]') });
  }

  // The SPA occasionally answers an in-session navigation with the home
  // page, which carries its own (shorter) expert list — so landing is
  // verified by URL, not just by cards being present.
  async open(): Promise<void> {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await this.page.goto('/psychics/', { waitUntil: 'domcontentloaded' });
      if (this.page.url().includes('/psychics')) {
        await this.waitForLoaded();
        return;
      }
    }
    throw new Error(`Catalog navigation landed on ${this.page.url()} instead of /psychics/`);
  }

  async waitForLoaded(): Promise<void> {
    await this.cards.first().waitFor({ state: 'visible', timeout: 30_000 });
  }

  card(index: number): ExpertCard {
    return new ExpertCard(this.cards.nth(index));
  }

  /**
   * Card of a named expert. The catalog reshuffles on every load, so any
   * flow that reopens the page must address the card by name, not by index.
   */
  cardByName(name: string): ExpertCard {
    const loose = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new ExpertCard(this.cards.filter({ hasText: new RegExp(loose) }).first());
  }

  async cardCount(): Promise<number> {
    return this.cards.count();
  }

  /** Opens the booking dialog of a named expert (the list order changes). */
  async openBookingOf(expertName: string): Promise<void> {
    if (!this.page.url().includes('/psychics')) {
      await this.open();
    }
    await this.waitForLoaded();
    await this.cardByName(expertName).bookSessionButton.click();
  }

  /** Names of the currently rendered cards, in layout order. */
  async cardNames(): Promise<string[]> {
    await this.waitForLoaded();
    const names: string[] = [];
    for (let index = 0; index < (await this.cardCount()); index += 1) {
      names.push(await this.card(index).name());
    }
    return names;
  }
}

export class ExpertCard {
  readonly bookSessionButton: Locator;
  readonly profileLink: Locator;
  readonly onlineBadge: Locator;

  constructor(readonly root: Locator) {
    this.bookSessionButton = root.getByRole('button', { name: 'Book Session' });
    this.profileLink = root.locator('a[href^="/psychics/"]').first();
    this.onlineBadge = root.getByText('Online', { exact: true });
  }

  /** Whitespace-normalized: the stage renders some names with double spaces. */
  async name(): Promise<string> {
    return (await this.profileLink.textContent())!.replace(/\s+/g, ' ').trim();
  }

  /** Address of the expert's own page, e.g. "/psychics/mary-rose-1234/". */
  async profilePath(): Promise<string> {
    return (await this.profileLink.getAttribute('href'))!;
  }
}
