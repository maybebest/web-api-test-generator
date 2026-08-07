import { test } from '@playwright/test';

import type { BookingFlow, BookingResult } from './BookingFlow';
import type { ExpertsCatalogPage } from '../pages/ExpertsCatalogPage';

export type Booking = BookingResult & {
  expertName: string;
  /** Address of that expert's own page, for tests that come back to them. */
  expertPath: string;
};

/**
 * How soon a session has to start when a test is going to wait for it.
 *
 * Example: it is 09:04. "NOW" and 09:15 are fine, 09:30 is not — such an
 * expert is skipped and the next one is tried.
 */
export const SESSION_STARTS_WITHIN_MIN = 17;

/** How many experts are asked for a "NOW" cell before a time is accepted. */
const NOW_CANDIDATES = 3;

export type BookWithNewExpertOptions = {
  /** Which day to book, see BookingFlow. */
  date: 'today' | 'future' | 'any';
  /** Slot must start at least this many minutes from now. */
  minStartOffsetMin: number;
  /**
   * Slot must start no later than this many minutes from now.
   *
   * With it the flow skips an expert whose next free time is too far away:
   * if it is 09:04 and the expert only has 09:30, the next expert is tried.
   * A "NOW" cell always fits.
   */
  maxStartOffsetMin?: number;
  /** Go through the times in the order shown instead of picking a random one. */
  firstAvailableSlot?: boolean;
  /** Minutes package to select, e.g. 10. */
  packageMinutes?: number;
  /** Times already used by other bookings of this test. */
  excludeTimes?: string[];
  /** Book the "NOW" cell only, skipping experts that do not offer it. */
  nowSlotOnly?: boolean;
  /** How many experts to try. Default: the whole candidate list. */
  candidates?: number;
};

export type SoonBookingOptions = {
  /** Minutes package to select, e.g. 10. */
  packageMinutes?: number;
  /** How soon the session has to start, default SESSION_STARTS_WITHIN_MIN. */
  startsWithinMin?: number;
};

/**
 * Books sessions with several different experts, one after another.
 *
 * Not every expert has free time when the test needs it, so the flow walks
 * the catalog until a booking succeeds. Experts already used in this test
 * are skipped, and the reason why a candidate did not work is kept for the
 * error message.
 */
export class MultiBookingFlow {
  readonly bookings: Booking[] = [];

  constructor(
    private readonly catalog: ExpertsCatalogPage,
    private readonly booking: BookingFlow,
    private readonly ensureOnline: () => Promise<void>,
    private readonly maxCandidates = 6
  ) {}

  /**
   * Books a session that starts right away, or as soon as possible.
   *
   * For tests that wait for the session itself. The "NOW" cell is what makes
   * a session start at once, so a few experts are asked for it first; if
   * none of them offers it, the nearest free time is taken, and it must
   * start within `SESSION_STARTS_WITHIN_MIN` so the wait stays short.
   */
  async bookSessionStartingSoon(options: SoonBookingOptions = {}): Promise<Booking> {
    const startsWithin = options.startsWithinMin ?? SESSION_STARTS_WITHIN_MIN;

    try {
      return await this.bookWithNewExpert({
        date: 'today',
        minStartOffsetMin: 0,
        nowSlotOnly: true,
        candidates: NOW_CANDIDATES,
        packageMinutes: options.packageMinutes
      });
    } catch {
      // None of those experts can start right away — take the nearest time.
      return this.bookWithNewExpert({
        date: 'today',
        minStartOffsetMin: 0,
        maxStartOffsetMin: startsWithin,
        firstAvailableSlot: true,
        packageMinutes: options.packageMinutes
      });
    }
  }

  async bookWithNewExpert(options: BookWithNewExpertOptions): Promise<Booking> {
    const what = options.nowSlotOnly ? 'starting now' : options.date;
    return test.step(`book a session (${what})`, async () => {
      await this.catalog.open();
      const skipped: string[] = [];
      const candidates = Math.min(await this.catalog.cardCount(), options.candidates ?? this.maxCandidates);

      for (let index = 0; index < candidates; index += 1) {
        const expertName = await this.catalog.card(index).name();
        if (this.bookings.some((booked) => booked.expertName === expertName)) {
          continue;
        }
        const expertPath = await this.catalog.card(index).profilePath();

        try {
          const result = await this.booking.bookSession({
            ensureOnline: this.ensureOnline,
            openDialog: () => this.catalog.openBookingOf(expertName),
            date: options.date,
            minStartOffsetMin: options.minStartOffsetMin,
            maxStartOffsetMin: options.maxStartOffsetMin,
            firstAvailableSlot: options.firstAvailableSlot,
            nowSlotOnly: options.nowSlotOnly,
            packageMinutes: options.packageMinutes,
            excludeSlotTimes: options.excludeTimes,
            expectedExpertName: expertName,
            // Looking for a session that must start soon is a search across
            // experts, so one look into the dialog of each is enough.
            openAttempts: options.maxStartOffsetMin === undefined && !options.nowSlotOnly ? undefined : 1,
            latestSlotFallback:
              options.date === 'today' && options.maxStartOffsetMin === undefined && !options.nowSlotOnly
          });

          const booking = { ...result, expertName, expertPath };
          this.bookings.push(booking);
          return booking;
        } catch (error) {
          skipped.push(`${expertName}: ${error instanceof Error ? error.message : String(error)}`);
          await this.catalog.open();
        }
      }

      throw new Error(
        `No expert offered a ${options.nowSlotOnly ? '"NOW"' : `free ${options.date}`} slot ` +
          `in ${candidates} tried. Tried:\n${skipped.join('\n')}`
      );
    });
  }
}
