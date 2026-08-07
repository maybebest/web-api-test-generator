import type { Locator, Page } from '@playwright/test';

// An expert's public profile at /psychics/<slug>/. Two equivalent
// "Book Session" buttons exist (the expert card and the sticky price bar) —
// always use the first (card) one. The profile name is not a heading: it
// lives in a paragraph together with the Online/Offline badge, and the
// avatar image's alt carries the exact profile name.
export class ExpertProfilePage {
  readonly bookSessionButton: Locator;

  constructor(private readonly page: Page) {
    this.bookSessionButton = page.getByRole('button', { name: 'Book Session' }).first();
  }

  /**
   * Opens the booking dialog. The profile shows grey placeholders while it
   * loads, so the button is awaited before the click.
   */
  async openBooking(profilePath: string): Promise<void> {
    if (!this.page.url().includes(profilePath)) {
      await this.page.goto(profilePath);
    }
    await this.bookSessionButton.waitFor({ state: 'visible', timeout: 30_000 });
    await this.bookSessionButton.click();
  }

  /** Paragraph that shows the profile name (plus the presence badge). */
  nameParagraph(nameFragment: string): Locator {
    return this.page.locator('p').filter({ hasText: new RegExp(escapeRegExp(nameFragment), 'i') }).first();
  }

  /** Exact profile name, taken from the avatar image alt (no badge noise). */
  async profileName(nameFragment: string): Promise<string> {
    const avatar = this.page.getByRole('img', { name: new RegExp(escapeRegExp(nameFragment), 'i') }).first();
    if (await avatar.isVisible().catch(() => false)) {
      const alt = await avatar.getAttribute('alt');
      if (alt) {
        return alt.trim();
      }
    }
    const text = (await this.nameParagraph(nameFragment).textContent())!.trim();
    return text.replace(/\s*(Online|Offline)\s*$/i, '');
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
