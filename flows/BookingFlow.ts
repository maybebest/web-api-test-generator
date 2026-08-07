import { expect, test } from '@playwright/test';
import type { Page, Response } from '@playwright/test';

import { BookingDialog, NOW_SLOT, type DialogPrices } from '../components/BookingDialog';
import { ChatPage } from '../pages/ChatPage';
import { SessionsPage } from '../pages/SessionsPage';
import { credentials } from '../config/credentials';

export type BookingOptions = {
  /** Makes sure an agent is online. Runs before every dialog opening. */
  ensureOnline: () => Promise<void>;
  /** Clicks the button that opens the booking dialog ("Book Session", "Start Chat"). */
  openDialog: () => Promise<void>;
  /**
   * Which day to book:
   *  'any'    - today if it has a good slot, otherwise the nearest next day (default);
   *  'today'  - today only;
   *  'future' - the nearest day after today.
   */
  date?: 'today' | 'future' | 'any';
  /** Slot must start at least this many minutes from now (today only). */
  minStartOffsetMin?: number;
  /** Slot must start no later than this many minutes from now (today only). */
  maxStartOffsetMin?: number;
  /** Times to skip, e.g. a time already booked with another expert. */
  excludeSlotTimes?: string[];
  /** Expert name, used to find the booking again if the chat did not open. */
  expectedExpertName?: string;
  /** If no slot fits the window, take the latest slot of today (at least 15 min ahead). */
  latestSlotFallback?: boolean;
  /** Minutes package to select, e.g. 10. */
  packageMinutes?: number;
  /** How many times to reopen the dialog while looking for a slot. */
  openAttempts?: number;
  /**
   * Take the first free cell of the day instead of a random suitable time.
   * Use it when the test needs a session that starts as early as possible.
   */
  firstAvailableSlot?: boolean;
  /**
   * Book the "NOW" cell only. A session starts at once from that cell, while
   * a booking made for a time starts when that time comes.
   */
  nowSlotOnly?: boolean;
};

export type BookingResult = {
  /** Label of the booked cell: a time like "10:15" or "NOW". */
  slotTime: string;
  slotDate: Date;
  /** When the session of this booking starts. */
  sessionStartsAt: Date;
  /** Prices shown for this booking, read right before paying. */
  prices: DialogPrices;
  chatUuid: string;
  bookingMessage: string;
};

const REOPEN_ATTEMPTS = 3;

/** The site asks for the free time of an expert with this request. */
const FREE_TIME_REQUEST = '/calendar/time-slot/month/for-user';
/** And books a session with this one. */
const BOOKING_REQUEST = '/calendar/time-slot/occupation/now';
/**
 * The dialog prepares the calendar with this request first, and asks for the
 * free time only when it succeeds. When it fails, the dialog shows no times
 * at all — which is worth naming in the report.
 */
const CALENDAR_PREPARE_REQUEST = '/calendar/time-zone';

/**
 * Books a session through the UI, from opening the booking dialog to the
 * chat that appears after payment.
 *
 * Two rules the site forces on us:
 *  - an agent must be online, otherwise the expert shows no free time. The
 *    test passes `ensureOnline`, and it runs before every dialog opening;
 *  - a card must exist before paying. Tests attach it over the API, so the
 *    dialog only has to pick a slot and pay. Filling the card form inside
 *    the dialog still works as a fallback.
 */
export class BookingFlow {
  private readonly dialog: BookingDialog;

  constructor(private readonly page: Page) {
    this.dialog = new BookingDialog(page);
  }

  /**
   * Opens the booking dialog for a read-only price check. The payment panel
   * (packages, balance, the price-carrying pay button) renders unreliably on
   * stage, so the dialog is reopened until it is there.
   */
  async openPriceDialog(options: Pick<BookingOptions, 'ensureOnline' | 'openDialog'>): Promise<BookingDialog> {
    return test.step('open the booking dialog for a price read', async () => {
      for (let attempt = 1; attempt <= REOPEN_ATTEMPTS; attempt += 1) {
        await options.ensureOnline();
        await this.openDialogAndLoadSlots(options);

        const ready = await this.dialog.payButton
          .waitFor({ state: 'visible', timeout: 15_000 })
          .then(() => true, () => false);
        if (ready) {
          return this.dialog;
        }
        await this.dialog.close();
      }
      throw new Error(`The booking dialog never rendered its payment panel in ${REOPEN_ATTEMPTS} openings`);
    });
  }

  async bookSession(options: BookingOptions): Promise<BookingResult> {
    return test.step('book a session through the site', async () => {
      const minOffset = options.minStartOffsetMin ?? 15;
      const attempts = options.openAttempts ?? REOPEN_ATTEMPTS;

      // Times that turned out to be taken while we were paying. Another test
      // can book the same time first, and the site answers "there is no
      // time" — then we simply try a different one.
      const takenTimes = [...(options.excludeSlotTimes ?? [])];
      let lastProblem = 'the dialog never showed free time';

      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        await options.ensureOnline();

        const opened = await this.openDialogAndLoadSlots(options);
        if (!opened.loaded) {
          lastProblem = opened.problem!;
          // A fresh page, not just a fresh dialog: the failed opening leaves
          // the site with a half-prepared calendar, and reopening the dialog
          // on the same page runs into the same problem again.
          await this.page.reload();
          continue;
        }

        // The payment panel arrives after the calendar and redraws it, which
        // drops the chosen time (it has booked "now" instead of the picked
        // hour). So the panel is awaited before anything is chosen.
        await this.dialog.payButton.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => undefined);

        const picked = await this.pickSlot({ ...options, excludeSlotTimes: takenTimes }, minOffset);
        if (!picked) {
          lastProblem = `the dialog offered: ${await this.dialog.offeredSlotsSummary()}`;
          await this.dialog.close();
          continue;
        }

        if (options.packageMinutes) {
          await this.dialog.packageCard(options.packageMinutes).click();
        }

        const chat = new ChatPage(this.page);
        // A chat of an earlier booking may still be open, so the new chat
        // has to be a different one.
        const chatBeforePayment = chat.openedChatUuid();

        const paid = await this.payForSlot(options, picked);
        if (!paid.booked) {
          lastProblem = paid.problem;
          takenTimes.push(picked.slotTime);
          await this.dialog.close();
          continue;
        }

        const bookingMessage = await this.openChatOfBooking(chat, chatBeforePayment, options.expectedExpertName);
        return {
          slotTime: picked.slotTime,
          slotDate: picked.slotDate,
          sessionStartsAt: BookingDialog.slotStartsAt(picked.slotDate, picked.slotTime),
          prices: paid.prices!,
          chatUuid: chat.chatUuid(),
          bookingMessage
        };
      }

      throw new Error(
        `Could not book a session in ${attempts} tries ` +
          `(day: ${options.date ?? 'any'}, slot at least ${minOffset} min from now` +
          `${options.maxStartOffsetMin === undefined ? '' : ` and at most ${options.maxStartOffsetMin} min`}). ` +
          `Last problem: ${lastProblem}`
      );
    });
  }

  /**
   * Opens the booking dialog and waits until the site has answered with the
   * free time of the expert.
   *
   * The wait is on the answer, not on the picture: until the times arrive
   * the dialog says "No available time", which looks exactly like an expert
   * without free time.
   */
  private async openDialogAndLoadSlots(options: BookingOptions): Promise<{ loaded: boolean; problem?: string }> {
    const siteProblems: string[] = [];
    const watchPreparation = (response: Response): void => {
      if (response.url().includes(CALENDAR_PREPARE_REQUEST) && response.status() >= 400) {
        siteProblems.push(`${CALENDAR_PREPARE_REQUEST} answered ${response.status()}`);
      }
    };
    this.page.on('response', watchPreparation);

    try {
      const freeTimeAnswer = this.page
        .waitForResponse(
          (response) => response.url().includes(FREE_TIME_REQUEST) && response.request().method() === 'GET',
          { timeout: 30_000 }
        )
        .catch(() => null);

      await options.openDialog();
      await this.dialog.root.waitFor({ state: 'visible', timeout: 20_000 });

      const answer = await freeTimeAnswer;
      if (!answer) {
        return {
          loaded: false,
          problem:
            siteProblems[0] ??
            'the site never asked for the free time of this expert, so the dialog stayed empty'
        };
      }
      // A failed answer draws the same empty dialog as an expert without free
      // time, so it is named rather than read as "no time".
      if (!answer.ok()) {
        return { loaded: false, problem: `the free time request answered ${answer.status()}` };
      }
      return { loaded: await this.dialog.waitForCalendar(), problem: 'the calendar did not finish drawing' };
    } finally {
      this.page.off('response', watchPreparation);
    }
  }

  /**
   * Pays for the chosen slot and reports whether the booking was accepted.
   *
   * The answer of the booking request is the only honest signal: the dialog
   * simply stays open when the time has just been taken by somebody else.
   */
  private async payForSlot(
    options: BookingOptions,
    picked: { slotTime: string; slotDate: Date }
  ): Promise<{ booked: boolean; problem: string; prices?: DialogPrices }> {
    await this.preparePaymentMethod(options, picked);

    // The dialog marks a cell of its own as soon as the calendar is drawn,
    // and the payment panel redraws the calendar — the choice can be back on
    // that default by the time we pay. So the chosen time is read back, and
    // only a wrong one is clicked again: clicking the right one would turn
    // the choice off. ("NOW" is not readable this way, and its mismatch is
    // caught after paying.)
    if (picked.slotTime !== NOW_SLOT) {
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const chosen = await this.dialog.selectedSlotLabel(picked.slotDate);
        if (chosen === picked.slotTime) {
          break;
        }
        const again = await this.dialog.selectSlot(picked.slotDate, {
          minOffsetMin: 0,
          onlyTimes: [picked.slotTime]
        });
        if (!again) {
          return { booked: false, problem: `the dialog would not keep ${picked.slotTime} selected` };
        }
      }
      if ((await this.dialog.selectedSlotLabel(picked.slotDate)) !== picked.slotTime) {
        return {
          booked: false,
          problem: `the dialog kept another time selected instead of ${picked.slotTime}`
        };
      }
      if (options.packageMinutes) {
        await this.dialog.packageCard(options.packageMinutes).click();
      }
    }

    // Read the prices from the same dialog we are about to pay in: they
    // belong to this expert and this booking.
    const prices = await this.dialog.prices();

    const bookingAnswer = this.page
      .waitForResponse(
        (response) => response.url().includes(BOOKING_REQUEST) && response.request().method() === 'POST',
        { timeout: 60_000 }
      )
      .catch(() => null);

    await expect(this.dialog.payButton, 'the pay button should be active').toBeEnabled({ timeout: 15_000 });
    await this.dialog.payButton.click();

    const answer = await bookingAnswer;
    if (!answer) {
      return { booked: false, problem: 'the site never sent the booking request' };
    }
    if (answer.ok()) {
      // What the site booked, not what we believe we picked: the dialog has
      // been seen paying for a different cell than the selected one, and a
      // test that trusts its own choice then checks the wrong session.
      const sent = answer.request().postDataJSON() as { dateTime?: string | null } | null;
      const bookedTime = this.bookedSlotLabel(sent?.dateTime, picked.slotDate);
      if (bookedTime && bookedTime !== picked.slotTime) {
        throw new Error(
          `The site booked ${bookedTime} while the dialog had ${picked.slotTime} selected ` +
            `(booking request asked for ${sent?.dateTime ?? 'no time at all'})`
        );
      }
      return { booked: true, problem: '', prices };
    }

    const body = await answer.text().catch(() => '');
    return { booked: false, problem: `the booking request answered ${answer.status()}: ${body.slice(0, 200)}` };
  }

  /**
   * Turns the time the booking request carries into a cell label, so it can
   * be compared with the chosen one. The request sends UTC ("2026-08-03T10:15")
   * while the cells show local time; a booking that starts within the next
   * minute is the "NOW" cell.
   */
  private bookedSlotLabel(dateTime: string | null | undefined, slotDate: Date): string | null {
    // No time in the request means "start now" — that is how the dialog books
    // the "NOW" cell, and also what it sends when no cell is chosen at all.
    if (dateTime === null) {
      return NOW_SLOT;
    }
    if (!dateTime) {
      return null;
    }
    const bookedAt = new Date(`${dateTime}${dateTime.endsWith('Z') ? '' : 'Z'}`);
    if (Number.isNaN(bookedAt.getTime())) {
      return null;
    }
    if (Math.abs(bookedAt.getTime() - Date.now()) < 60_000) {
      return NOW_SLOT;
    }
    if (bookedAt.toDateString() !== slotDate.toDateString()) {
      return bookedAt.toLocaleString();
    }
    return `${String(bookedAt.getHours()).padStart(2, '0')}:${String(bookedAt.getMinutes()).padStart(2, '0')}`;
  }

  /** Opens the chat the booking created and returns its booking message. */
  private async openChatOfBooking(
    chat: ChatPage,
    chatBeforePayment: string | null,
    expertName?: string
  ): Promise<string> {
    const opened = await chat.waitForOpen(chatBeforePayment).then(() => true, () => false);
    if (!opened) {
      // The booking is paid, so it must not be made again: the chat is
      // reached through the Sessions page instead.
      await this.openBookedChat(expertName);
    }

    let shown = await chat.bookingMessage
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => true, () => false);
    if (!shown) {
      await this.page.reload();
      shown = await chat.bookingMessage
        .waitFor({ state: 'visible', timeout: 30_000 })
        .then(() => true, () => false);
    }
    if (!shown) {
      throw new Error(`The booking was paid, but the chat never showed the booking message (${this.page.url()})`);
    }
    return (await chat.bookingMessage.textContent())!.trim();
  }

  /**
   * Opens the chat of the session just paid for, using the Sessions page as
   * the source of truth. Throws when no such session exists — then the
   * payment really did not go through.
   */
  private async openBookedChat(expertName?: string): Promise<void> {
    const sessions = new SessionsPage(this.page);
    await sessions.open();
    // A page we failed to read must not be reported as "the payment produced
    // no session" — that is a statement about the product.
    const cards = await sessions.cards().catch((error) => {
      throw new Error(`The booking was paid, but the Sessions page could not be read: ${error}`);
    });
    const card = expertName
      ? cards.find((candidate) => candidate.expertName.replace(/\s+/g, ' ') === expertName)
      : cards.at(-1);

    if (!card) {
      throw new Error(
        `The payment did not produce a session${expertName ? ` with ${expertName}` : ''}; ` +
          `Sessions page holds: ${cards.map((candidate) => candidate.expertName).join(', ') || '(nothing)'}`
      );
    }
    await sessions.goToChatLink(card.chatUuid).click();
    await new ChatPage(this.page).waitForOpen();
  }

  private async pickSlot(
    options: BookingOptions,
    minOffset: number
  ): Promise<{ slotTime: string; slotDate: Date } | null> {
    const mode = options.date ?? 'any';

    if (mode !== 'future') {
      const today = new Date();
      // The booking follows the day selected in the date strip. When today
      // is not selectable there, its times still render — and choosing one
      // pays for the day the strip is on instead. So today is only used
      // when the strip really moved to it.
      const todayIsOpen = await this.dialog.showDate(today);
      const query = {
        minOffsetMin: minOffset,
        maxOffsetMin: options.maxStartOffsetMin,
        excludeTimes: options.excludeSlotTimes,
        firstAvailable: options.firstAvailableSlot,
        onlyNow: options.nowSlotOnly
      };
      let slotTime = todayIsOpen ? await this.dialog.selectSlot(today, query) : null;
      if (!slotTime && todayIsOpen && options.latestSlotFallback) {
        slotTime = await this.dialog.selectSlot(today, {
          minOffsetMin: 15,
          excludeTimes: options.excludeSlotTimes,
          preferLatest: true
        });
      }
      if (slotTime) {
        return { slotTime, slotDate: today };
      }
      if (mode === 'today' || options.nowSlotOnly) {
        return null;
      }
      // 'any': today had nothing suitable — fall through to later dates.
    }

    // The first of the next 7 days that offers any slot. Later dates are not
    // on screen until their strip cell is picked.
    for (let ahead = 1; ahead <= 7; ahead += 1) {
      const candidate = new Date();
      candidate.setDate(candidate.getDate() + ahead);
      if (!(await this.dialog.showDate(candidate))) {
        continue;
      }
      const slotTime = await this.dialog.selectSlot(candidate, {
        minOffsetMin: 0,
        excludeTimes: options.excludeSlotTimes
      });
      if (slotTime) {
        return { slotTime, slotDate: candidate };
      }
    }
    return null;
  }

  /**
   * Pays for the selected slot. A payment method must exist BEFORE the pay
   * click: with no saved card the button still enables once a slot is
   * picked, but the click silently does nothing. Adding a card re-renders
   * the dialog, so the slot (and package) are re-selected afterwards.
   */
  private async preparePaymentMethod(
    options: BookingOptions,
    picked: { slotTime: string; slotDate: Date }
  ): Promise<void> {
    // The payment panel can lag behind the calendar by a lot — wait for it
    // here rather than gating the slot pick on it.
    await this.dialog.payButton.waitFor({ state: 'visible', timeout: 30_000 });

    const hasSavedCard = await this.dialog.savedCardRow
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true, () => false);

    if (!hasSavedCard) {
      await this.dialog.fillCard(credentials.testCard);

      // The re-render can drop the slot selection or even the slot list (the
      // agent may have gone offline meanwhile) — recover before paying.
      if (await this.dialog.noAvailableTime.isVisible().catch(() => false)) {
        await options.ensureOnline();
        await this.dialog.close();
        await options.openDialog();
        await this.dialog.root.waitFor({ state: 'visible', timeout: 20_000 });
      }
      // Adding a card redraws the dialog and drops the chosen time, so the
      // very same time is chosen again. A different one would make the test
      // report a booking it did not make.
      const sameSlot = await this.dialog.selectSlot(picked.slotDate, {
        minOffsetMin: 0,
        onlyTimes: [picked.slotTime]
      });
      if (!sameSlot) {
        throw new Error(`The slot ${picked.slotTime} disappeared while the card was being added`);
      }
      if (options.packageMinutes) {
        await this.dialog.packageCard(options.packageMinutes).click();
      }
    }

  }
}
