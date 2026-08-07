import type { Locator, Page } from '@playwright/test';

// The user-side chat at /dashboard/chat/<chatUuid>/: chat list on the left
// (cards link to chat/<uuid>), the opened chat with the expert's name in the
// header, a black "Book Session" button in that header, the booking system
// message and the message composer at the bottom.
export class ChatPage {
  static readonly CHAT_URL = /\/dashboard\/chat\/([0-9a-f-]+)/;

  readonly headerBookSessionButton: Locator;
  readonly bookingMessage: Locator;
  /** "Book Now" button an agent can send into the chat. */
  readonly bookNowButton: Locator;
  /** The message thread itself; the chat-list preview shows the same texts. */
  readonly thread: Locator;
  private readonly composerInput: Locator;

  constructor(private readonly page: Page) {
    this.headerBookSessionButton = page.getByRole('button', { name: 'Book Session', exact: true }).first();
    this.thread = page.locator('#body-chat');
    this.bookingMessage = this.thread.getByText(/Your session is booked for/).first();
    this.bookNowButton = page.getByRole('button', { name: 'Book Now' });
    // locator-policy:exception the composer exposes no accessible name; match by the "Message…" placeholder across the input flavours the SPA uses
    this.composerInput = page
      .locator('input[placeholder^="Message"], textarea[placeholder^="Message"], div[contenteditable="true"]')
      .first();
  }

  /**
   * Waits until a chat page is open.
   *
   * `previousChatUuid` matters when a chat is already open: after the second
   * booking in a row the address still points to the first chat, and without
   * this the test would read the old chat as if it were the new one.
   */
  async waitForOpen(previousChatUuid?: string | null): Promise<void> {
    await this.page.waitForURL(
      (url) => {
        const openedChat = url.pathname.match(ChatPage.CHAT_URL)?.[1];
        return Boolean(openedChat) && openedChat !== previousChatUuid;
      },
      { timeout: 60_000 }
    );
  }

  /** Chat currently open, or null when the page is not a chat page. */
  openedChatUuid(): string | null {
    return this.page.url().match(ChatPage.CHAT_URL)?.[1] ?? null;
  }

  chatUuid(): string {
    const match = this.page.url().match(ChatPage.CHAT_URL);
    if (!match) {
      throw new Error(`Not on a chat page: ${this.page.url()}`);
    }
    return match[1];
  }

  /**
   * The expert's name as rendered on the chat page. Some experts show it as
   * "Name (Gender)" and some as the bare name, so the parenthesis is not
   * required. Spaces match loosely — several names carry double spaces.
   * Chat identity itself is proven by the chat UUID and the booking message;
   * this guards against a blank or mis-rendered header.
   */
  expertNameOnPage(expertName: string): Locator {
    return this.page.getByText(new RegExp(looseSpacing(expertName))).first();
  }

  /** Chat-list card of the given expert (left column). */
  listCard(expertName: string): Locator {
    return this.page.locator('a[href*="chat/"]').filter({ hasText: new RegExp(looseSpacing(expertName)) }).first();
  }

  /**
   * A message inside the thread (scoped: the chat-list preview repeats the
   * same text). Matched case-insensitively: the product's translation layer
   * re-cases incoming text ("agent message 2" renders as "Agent Message 2").
   * The exact wording is asserted on the API side, where `originalData`
   * carries the untouched text.
   */
  message(text: string): Locator {
    return this.thread.getByText(new RegExp(`^\\s*${looseSpacing(text)}\\s*$`, 'i'));
  }

  /**
   * Waits for an incoming message. Delivery is realtime, but the thread
   * sometimes misses an update, so the page is reloaded between checks.
   */
  async waitForIncoming(text: string, timeoutMs = 90_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const seen = await this.message(text)
        .first()
        .waitFor({ state: 'visible', timeout: 20_000 })
        .then(() => true, () => false);
      if (seen) {
        return;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Message "${text}" never arrived in the chat thread within ${timeoutMs}ms`);
      }
      await this.page.reload();
      await this.thread.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
    }
  }

  async sendMessage(text: string): Promise<void> {
    await this.composerInput.waitFor({ state: 'visible' });
    await this.composerInput.fill(text);
    await this.composerInput.press('Enter');
    // The sent message must render in the thread — that wait is the send oracle.
    await this.message(text).first().waitFor({ state: 'visible', timeout: 15_000 });
  }
}

/** Escaped for RegExp, with every run of spaces matching any whitespace. */
function looseSpacing(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
}
