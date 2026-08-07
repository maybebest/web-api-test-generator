import type { Locator, Page } from '@playwright/test';

export type SessionCard = {
  /** Group of the card: "Today", "Tomorrow" or a date like "Monday, August 3rd, 2026". */
  group: string;
  expertName: string;
  /** "16:00 - 16:10" as rendered. */
  sessionTime: string;
  /** Target chat of the card's "Go To Chat" link. */
  chatUuid: string;
};

// The "My Sessions" page at /sessions/. Bookings are grouped by date — the
// upcoming ones under "Today", later ones under their own date caption — and
// each card carries the expert name, specialization, a "Session time"
// interval, a remove button and a "Go To Chat" LINK (not a button).
export class SessionsPage {
  readonly heading: Locator;
  readonly goToChatLinks: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { level: 1, name: 'Sessions' });
    this.goToChatLinks = page.getByRole('link', { name: 'Go To Chat' });
  }

  async open(): Promise<void> {
    await this.page.goto('/sessions/', { waitUntil: 'domcontentloaded' });
    await this.heading.waitFor({ state: 'visible' });
  }

  goToChatLink(chatUuid: string): Locator {
    return this.page.locator(`a[href*="${chatUuid}"]`).first();
  }

  /**
   * Waits until the page shows the sessions of the given chats.
   *
   * Waiting for "at least N cards" is not enough: the page draws the cards
   * one by one, so a later card can still be missing while the count is
   * already reached, and the test would read an incomplete page.
   */
  async waitForSessions(chatUuids: string[]): Promise<void> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const missing: string[] = [];
      for (const chatUuid of chatUuids) {
        const shown = await this.goToChatLink(chatUuid)
          .waitFor({ state: 'visible', timeout: 15_000 })
          .then(() => true, () => false);
        if (!shown) {
          missing.push(chatUuid);
        }
      }
      if (missing.length === 0) {
        return;
      }
      await this.open();
    }
    throw new Error(`The Sessions page never showed the sessions of chats: ${chatUuids.join(', ')}`);
  }

  /**
   * Reads the whole page as structured cards: every "Go To Chat" link is
   * walked up to the block that owns the card (the one carrying both the
   * expert heading and the "Session time" line), and matched to the last
   * grouping caption ("Today", "Monday, August 3rd, 2026") that appears
   * before it in document order.
   */
  async cards(): Promise<SessionCard[]> {
    await this.goToChatLinks.first().waitFor({ state: 'visible', timeout: 30_000 });
    return this.page.evaluate(() => {
      const normalize = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim();
      // The page groups sessions under "Today", "Tomorrow" or a full date.
      const isGroupCaption = (text: string): boolean =>
        text === 'Today' ||
        text === 'Tomorrow' ||
        /^[A-Z][a-z]+day, [A-Z][a-z]+ \d+(st|nd|rd|th), \d{4}$/.test(text);

      // Grouping captions in document order, with their position.
      const captions: Array<{ node: Element; text: string }> = [];
      for (const node of document.querySelectorAll('div, p, span, h2, h3')) {
        const own = normalize(
          [...node.childNodes]
            .filter((child) => child.nodeType === Node.TEXT_NODE)
            .map((child) => child.textContent ?? '')
            .join(' ')
        );
        if (isGroupCaption(own)) {
          captions.push({ node, text: own });
        }
      }

      const cards: Array<{ group: string; expertName: string; sessionTime: string; chatUuid: string }> = [];
      for (const link of document.querySelectorAll('a[href*="/dashboard/chat/"]')) {
        if (!link.textContent?.includes('Go To Chat')) {
          continue;
        }

        let block: Element | null = link;
        while (block && !(block.querySelector('h3') && normalize(block.textContent).includes('Session time'))) {
          block = block.parentElement;
        }
        const blockText = normalize(block?.textContent);

        const group =
          [...captions]
            .reverse()
            .find(({ node }) => node.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING)?.text ?? '';

        cards.push({
          group,
          expertName: normalize(block?.querySelector('h3')?.textContent),
          sessionTime: blockText.match(/Session time\s*(\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2})/)?.[1] ?? '',
          chatUuid: link.getAttribute('href')?.match(/chat\/([0-9a-f-]+)/)?.[1] ?? ''
        });
      }
      return cards;
    });
  }
}
