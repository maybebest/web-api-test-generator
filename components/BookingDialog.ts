import type { FrameLocator, Locator, Page } from '@playwright/test';

export type CardDetails = {
  number: string;
  expiry: string;
  cvc: string;
};

export type SlotQuery = {
  /** Minimum minutes from now (today only). */
  minOffsetMin: number;
  maxOffsetMin?: number;
  /** HH:mm labels to skip, e.g. a time already booked with another expert. */
  excludeTimes?: string[];
  /** Scan from the end of the day, used when the earliest times are gone. */
  preferLatest?: boolean;
  /** Take only these times, used to pick the same slot again. */
  onlyTimes?: string[];
  /** Take the "NOW" cell and nothing else. */
  onlyNow?: boolean;
  /**
   * Go through the cells in the order they are shown instead of picking a
   * random one. Used when the test wants the earliest possible session.
   */
  firstAvailable?: boolean;
};

/** Label of the cell that books a session starting right away. */
export const NOW_SLOT = 'NOW';
/** How the dialog marks the chosen time. */
const SELECTED_SLOT_MARK = 'bg-teal-600';
/** A slot cell shows either a time or the word "NOW". */
const SLOT_LABEL = /^(NOW|\d{1,2}:\d{2})$/;
/** Choosing a time makes the site check whether it is still free. */
const SLOT_CHECK_REQUEST = '/calendar/time-slot/validation/now';

export type DialogPrices = {
  /** Struck-through full price; equals `actual` when no discount is shown. */
  full: number;
  actual: number;
};

// The booking dialog ("Choose a time to join the session"): date strip on
// top, one scrollable slot section per date, minutes packages, the balance /
// card panel and the pay button that carries the prices in its own label
// ("Book Session • $19.9 $9.95").
export class BookingDialog {
  readonly root: Locator;
  readonly closeButton: Locator;
  readonly noAvailableTime: Locator;
  readonly addCreditCardRow: Locator;
  readonly savedCardRow: Locator;
  readonly addCardButton: Locator;
  readonly payButton: Locator;
  readonly limitedOfferBanner: Locator;
  readonly couponAppliedNote: Locator;
  private readonly stripeFrame: FrameLocator;
  /** Last slot that refused to be selected, for the error message. */
  private lastRejectedSlot = '';

  constructor(private readonly page: Page) {
    // Anchored on its own heading: after a booking the chat page keeps
    // another role=dialog element around, and a bare getByRole('dialog')
    // silently latches onto that one (waits for a panel that never comes,
    // "closes" a dialog that was never open).
    this.root = page
      .getByRole('dialog')
      .filter({ has: page.getByRole('heading', { name: 'Choose a time to join the session' }) });
    this.closeButton = this.root.getByRole('button', { name: 'Close' });
    // "avalable" is the stage's own typo — match loosely so a fix does not break us.
    this.noAvailableTime = this.root.getByText(/No av[ai]+lable time/i);
    // locator-policy:exception the card row is a plain clickable div (invisible to role queries) — the portal cases tripped over this too
    this.addCreditCardRow = this.root.locator('div.cursor-pointer', { hasText: 'Add Credit Card' }).first();
    this.savedCardRow = this.root.getByText(/Credit Card ••••/);
    this.addCardButton = this.root.getByRole('button', { name: 'Add Card' });
    this.payButton = this.root.getByRole('button', { name: /^Book Session •/ });
    this.limitedOfferBanner = this.root.getByText('Limited Offer for new customers');
    this.couponAppliedNote = this.root.getByText(/coupon/i).filter({ hasText: /25\s?%|%/ }).first();
    this.stripeFrame = page.frameLocator('iframe[src*="elements-inner"]');
  }

  /**
   * Date cell of the top strip. A cell shows a weekday and a day number
   * ("Fri 31"); days with no free time are greyed out and not clickable.
   *
   * The two parts run together in the text ("Fri31"), so the whole cell text
   * is matched. Matching the number alone also hit other blocks of the
   * dialog and made the calendar switch to a day that was never opened.
   */
  dateStripCell(date: Date): Locator {
    const day = String(date.getDate()).padStart(2, '0');
    // locator-policy:exception the strip is plain divs; the selectable ones are the rounded cursor-pointer cells that are not marked cursor-not-allowed
    return this.root
      .locator('div[class*="rounded-lg"][class*="cursor-pointer"]:not([class*="cursor-not-allowed"])')
      .filter({ hasText: new RegExp(`^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\\s*${day}$`) })
      .first();
  }

  /**
   * Makes `date` the selected day of the calendar.
   *
   * The dialog renders a section per date, but the booking follows the date
   * PICKED IN THE STRIP: clicking a time under another date's heading books
   * that time on the selected day instead (a slot clicked under "Aug 4" was
   * observed booking today). So the strip cell is always clicked unless it
   * is already active.
   */
  async showDate(date: Date): Promise<boolean> {
    const cell = this.dateStripCell(date);
    if (!(await cell.count())) {
      return false;
    }
    const classes = (await cell.getAttribute('class')) ?? '';
    if (!classes.includes(SELECTED_SLOT_MARK)) {
      await cell.click();
      await this.slotCells(date)
        .first()
        .waitFor({ state: 'visible', timeout: 5_000 })
        .catch(() => {});
    }

    // The day has to be the one the strip is on, not merely a day whose
    // times are drawn: the booking follows the strip, so choosing a time of
    // a day that is not selected pays for the selected day instead.
    const selected = ((await cell.getAttribute('class')) ?? '').includes(SELECTED_SLOT_MARK);
    return selected && (await this.slotCells(date).count()) > 0;
  }

  /** Every clickable cell of the date strip. */
  dateStripCells(): Locator {
    return this.root.locator(
      'div[class*="rounded-lg"][class*="cursor-pointer"]:not([class*="cursor-not-allowed"])'
    );
  }

  /**
   * Waits until the calendar is really drawn.
   *
   * The dialog first shows grey placeholders. Reading it at that moment
   * looks exactly like "this expert has no free time", so the date strip is
   * awaited first, and only then the times of the selected day.
   */
  async waitForCalendar(timeoutMs = 30_000): Promise<boolean> {
    const stripDrawn = await this.dateStripCells()
      .first()
      .waitFor({ state: 'visible', timeout: timeoutMs })
      .then(() => true, () => false);
    if (!stripDrawn) {
      return false;
    }

    // Either the times or the empty state must be there. Waiting for both in
    // one locator keeps the loser from running on to its own timeout, and a
    // calendar that draws neither is reported as "not drawn" instead of
    // passing for an expert without free time.
    return this.anySlotCell()
      .first()
      .or(this.noAvailableTime.first())
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true, () => false);
  }

  /** Any slot cell of any date — the "calendar has loaded" signal. */
  anySlotCell(): Locator {
    // locator-policy:exception slot cells are plain divs carrying a time text; cursor-pointer + the label pattern is the only hook
    return this.root.locator('section[data-day] div[class*="cursor-pointer"]').filter({ hasText: SLOT_LABEL });
  }

  /** Slot section of a calendar date (sections carry data-y/m/d, month 1-based). */
  daySection(date: Date): Locator {
    return this.root.locator(
      `section[data-year="${date.getFullYear()}"][data-month="${date.getMonth() + 1}"][data-day="${date.getDate()}"]`
    );
  }

  /**
   * Clickable slot cells of a day. A cell is a time like "10:15" or the
   * word "NOW", which means the session starts right away.
   */
  slotCells(date: Date): Locator {
    // locator-policy:exception slot cells are plain divs with a label; cursor-pointer + the label pattern is the only hook
    return this.daySection(date).locator('div[class*="cursor-pointer"]', { hasText: SLOT_LABEL });
  }

  /**
   * Picks a slot of `date` matching the query, clicks it and returns its
   * HH:mm label; null when nothing suitable exists. Start-offset limits only
   * apply to today (a future date has no "too soon" slots).
   */
  async selectSlot(date: Date, query: SlotQuery): Promise<string | null> {
    const section = this.daySection(date);
    if (!(await section.count())) {
      return null;
    }
    await section.scrollIntoViewIfNeeded().catch(() => {});

    const labels = (await this.slotCells(date).allTextContents()).map((text) => text.trim());
    const isToday = new Date().toDateString() === date.toDateString();

    const suitable = labels.filter((label) => {
      if (query.onlyNow) {
        return label === NOW_SLOT;
      }
      if (query.onlyTimes && !query.onlyTimes.includes(label)) {
        return false;
      }
      if (query.excludeTimes?.includes(label)) {
        return false;
      }
      // "NOW" starts the session right away, so it only fits a test that
      // accepts a session starting immediately. A test asking for a slot
      // "at least N minutes from now" wants an upcoming session, and a
      // running one is not shown among them.
      if (label === NOW_SLOT) {
        return query.minOffsetMin <= 0;
      }
      return !isToday || this.withinOffset(date, label, query);
    });

    // Tests run side by side and would otherwise all take the earliest free
    // time, and then lose the race to each other. A random suitable time
    // keeps them out of each other's way — unless the test asked for the
    // first cell of the day on purpose.
    const order = query.firstAvailable ? suitable : query.preferLatest ? suitable.reverse() : shuffle(suitable);

    for (const label of order) {
      if (await this.pickSlotCell(date, label)) {
        return label;
      }
    }
    return null;
  }

  /**
   * Clicks a slot and makes sure the site took the choice.
   *
   * Clicking a chosen cell again turns the choice OFF, and the booking then
   * goes to "now" instead of the picked time. So there is exactly one click
   * per attempt, and the answer is awaited rather than guessed: choosing a
   * time makes the site ask whether that time is still free, which is the
   * one signal that works for every cell — the chosen time turns teal, the
   * "NOW" cell is styled differently.
   */
  private async pickSlotCell(date: Date, label: string): Promise<boolean> {
    const cell = this.slotCells(date).filter({ hasText: label }).first();

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const before = (await cell.getAttribute('class')) ?? '';
      if (before.includes(SELECTED_SLOT_MARK)) {
        return true;
      }

      const siteChecked = this.page
        .waitForResponse((response) => this.checksThisSlot(response.url(), date, label), { timeout: 5_000 })
        .then(() => true, () => false);
      await cell.click();
      if (await siteChecked) {
        return true;
      }

      const after = (await cell.getAttribute('class')) ?? '';
      if (after.includes(SELECTED_SLOT_MARK)) {
        return true;
      }
      this.lastRejectedSlot = `${label} (the site never checked this time; look: ${after.replace(/\s+/g, ' ').trim()})`;
    }
    return false;
  }

  /**
   * Label of the time cell the dialog currently shows as chosen, if any.
   *
   * Only time cells can be read this way: the chosen one turns teal, while
   * the "NOW" cell is styled differently and cannot be told apart, so it
   * answers null just like "nothing is chosen".
   */
  async selectedSlotLabel(date: Date): Promise<string | null> {
    const cells = this.slotCells(date);
    const marked = await cells.evaluateAll((nodes, mark) =>
      nodes.filter((node) => node.className.includes(mark)).map((node) => node.textContent?.trim() ?? ''),
    SELECTED_SLOT_MARK);
    return marked[0] ?? null;
  }

  /**
   * Is this the site checking the very time we clicked?
   *
   * The dialog picks a cell of its own as soon as the calendar is drawn and
   * checks that one too, so the time in the request has to match — otherwise
   * another cell's check would pass for ours. The request carries UTC.
   */
  private checksThisSlot(url: string, date: Date, label: string): boolean {
    if (!url.includes(SLOT_CHECK_REQUEST)) {
      return false;
    }
    const asked = new URL(url).searchParams.get('dateTime');
    if (!asked) {
      return false;
    }
    const askedAt = new Date(`${asked.endsWith('Z') ? asked : `${asked}Z`}`);
    if (Number.isNaN(askedAt.getTime())) {
      return false;
    }
    const wanted = label === NOW_SLOT ? new Date() : BookingDialog.slotStartsAt(date, label);
    // "NOW" is checked as "this minute", a time cell to the exact minute.
    const tolerance = label === NOW_SLOT ? 5 * 60_000 : 60_000;
    return Math.abs(askedAt.getTime() - wanted.getTime()) < tolerance;
  }

  /** When the session of this slot starts. "NOW" means right away. */
  static slotStartsAt(date: Date, label: string): Date {
    if (label === NOW_SLOT) {
      return new Date();
    }
    const [hours, minutes] = label.split(':').map(Number);
    const startsAt = new Date(date);
    startsAt.setHours(hours, minutes, 0, 0);
    return startsAt;
  }

  private withinOffset(date: Date, label: string, query: SlotQuery): boolean {
    const [hours, minutes] = label.split(':').map(Number);
    const slotAt = new Date(date);
    slotAt.setHours(hours, minutes, 0, 0);
    const offsetMin = (slotAt.getTime() - Date.now()) / 60_000;
    return offsetMin >= query.minOffsetMin && (query.maxOffsetMin === undefined || offsetMin <= query.maxOffsetMin);
  }

  /**
   * What the dialog is currently offering, for failure messages: the first
   * dates with their slot labels, or the empty-state text.
   */
  async offeredSlotsSummary(): Promise<string> {
    if (this.lastRejectedSlot) {
      return `the slot ${this.lastRejectedSlot} could not be selected`;
    }
    if (await this.noAvailableTime.isVisible().catch(() => false)) {
      return '"No available time"';
    }
    const sections = this.root.locator('section[data-day]');
    const count = Math.min(await sections.count(), 3);
    if (count === 0) {
      return 'no date sections rendered';
    }
    const parts: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const section = sections.nth(index);
      const day = await section.getAttribute('data-day');
      const month = await section.getAttribute('data-month');
      const labels = (await section.locator('div[class*="cursor-pointer"]').allTextContents())
        .map((text) => text.trim())
        .filter(Boolean);
      parts.push(`${month}/${day}: ${labels.slice(0, 12).join(' ') || '(no slots)'}${labels.length > 12 ? ' …' : ''}`);
    }
    return parts.join(' | ');
  }

  /** Minutes-package card, e.g. packageCard(10) → "10 Minutes". */
  packageCard(minutes: number): Locator {
    return this.root.getByText(`${minutes} Minutes`, { exact: true });
  }

  async fillCard(card: CardDetails): Promise<void> {
    await this.addCreditCardRow.click();
    const numberInput = this.stripeFrame.locator('input[name="number"]');
    await numberInput.waitFor({ state: 'visible', timeout: 20_000 });
    await numberInput.fill(card.number);
    await this.stripeFrame.locator('input[name="expiry"]').fill(card.expiry);
    await this.stripeFrame.locator('input[name="cvc"]').fill(card.cvc);
    await this.addCardButton.click();
    await this.savedCardRow.waitFor({ state: 'visible', timeout: 30_000 });
  }

  /** Prices from the pay button label: "Book Session • $19.9 $9.95" (full struck + actual). */
  async prices(): Promise<DialogPrices> {
    const label = (await this.payButton.textContent()) ?? '';
    const amounts = [...label.matchAll(/\$(\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]));
    if (amounts.length === 0) {
      throw new Error(`Pay button label carries no prices: "${label}"`);
    }
    return amounts.length === 1 ? { full: amounts[0], actual: amounts[0] } : { full: amounts[0], actual: amounts[1] };
  }

  /**
   * Closes the dialog: Close button, then Escape, then a reload. A dialog
   * that survives keeps intercepting clicks on the page underneath, so the
   * reload is a real fallback, not politeness — but only when a dialog is
   * actually open. Reloading a page that never opened one throws away the
   * rendered page and leaves the next attempt clicking into a skeleton.
   */
  async close(): Promise<void> {
    if (!(await this.isOpen())) {
      return;
    }
    await this.closeButton.click({ timeout: 5_000 }).catch(() => {});
    if (await this.isOpen()) {
      await this.page.keyboard.press('Escape');
      await this.root.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
    }
    if (await this.isOpen()) {
      await this.page.reload();
      await this.root.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
    }
  }

  async isOpen(): Promise<boolean> {
    return this.root.isVisible().catch(() => false);
  }
}

/** Same items, random order. */
function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapWith = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapWith]] = [copy[swapWith], copy[index]];
  }
  return copy;
}
