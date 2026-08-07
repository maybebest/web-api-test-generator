import type { Locator, Page } from '@playwright/test';

export const HOROSCOPE_LEVELS = ['Luck Factor', 'Love Potential', 'Career Drive', 'Intuition Level'] as const;

// The daily horoscope page (/daily-horoscope/): zodiac circle, the
// Today/Tomorrow/Weekly/Monthly tabs, the "Today's levels" scales, the
// "General" prediction and the "Expert insight" block with a Start Chat CTA.
export class DailyHoroscopePage {
  readonly levelsHeading: Locator;
  readonly generalHeading: Locator;
  /** Forecast text right under the "General" heading. */
  readonly generalText: Locator;
  readonly expertInsightHeading: Locator;
  readonly startChatButton: Locator;

  constructor(private readonly page: Page) {
    this.levelsHeading = page.getByRole('heading', { name: "Today's levels" });
    this.generalHeading = page.getByRole('heading', { name: 'General' });
    this.generalText = this.generalHeading.locator('xpath=following::p[1]');
    this.expertInsightHeading = page.getByRole('heading', { name: 'Expert insight' });
    this.startChatButton = page.getByRole('button', { name: 'Start Chat' });
  }

  async open(): Promise<void> {
    await this.page.goto('/daily-horoscope/', { waitUntil: 'domcontentloaded' });
    await this.waitForLoaded();
  }

  /** Opens the booking dialog of the astrologer shown on this page. */
  async startChatWithAstrologer(): Promise<void> {
    if (!this.page.url().includes('daily-horoscope')) {
      await this.open();
    }
    await this.waitForLoaded();
    await this.startChatButton.click();
  }

  /** Name of the astrologer in the "Expert insight" block. */
  async astrologerName(): Promise<string> {
    return (await this.expertNameHeading().textContent())!.replace(/\s+/g, ' ').trim();
  }

  /**
   * The page renders as a skeleton first; the Start Chat CTA is the signal
   * that the Expert-insight block (and with it the real content) is there.
   */
  async waitForLoaded(): Promise<void> {
    await this.startChatButton.waitFor({ state: 'visible', timeout: 30_000 });
  }

  /** "Daily <Sign> Horoscope" — the sign-under-test oracle. */
  signHeading(sign: string): Locator {
    return this.page.getByRole('heading', { level: 1, name: `Daily ${sign} Horoscope` });
  }

  anySignHeading(): Locator {
    return this.page.getByRole('heading', { level: 1, name: /^Daily .+ Horoscope$/ });
  }

  tabLabel(name: 'Today' | 'Tomorrow' | 'Weekly' | 'Monthly'): Locator {
    return this.page.getByText(name, { exact: true }).first();
  }

  /**
   * The Today's levels block. Label and percentage live in separate nodes,
   * so the block is matched as the innermost container holding the first and
   * last scale, and the values are parsed from its text.
   */
  levelsBlock(): Locator {
    // locator-policy:exception the block exposes no landmark and its scales are label/value node pairs; the innermost container holding both edge scales is the only stable anchor
    return this.page
      .locator('div')
      .filter({ hasText: HOROSCOPE_LEVELS[0] })
      .filter({ hasText: HOROSCOPE_LEVELS[HOROSCOPE_LEVELS.length - 1] })
      .last();
  }

  /** Scale label → percentage, as rendered. */
  async levelValues(): Promise<Record<string, string>> {
    const text = (await this.levelsBlock().innerText()).replace(/\s+/g, ' ');
    const values: Record<string, string> = {};
    for (const match of text.matchAll(/(Luck Factor|Love Potential|Career Drive|Intuition Level)\s*(\d+)%/g)) {
      values[match[1]] = `${match[2]}%`;
    }
    return values;
  }

  /** The expert's name inside the Expert insight block (its own h4). */
  expertNameHeading(): Locator {
    // locator-policy:exception the block has no landmark; the expert name is the only other level-4 heading between "Expert insight" and the CTA
    return this.page
      .getByRole('heading', { level: 4 })
      .filter({ hasText: /^(?!Expert insight|General|Today's levels).+/ })
      .first();
  }
}
