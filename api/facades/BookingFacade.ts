import { expect, test } from '@playwright/test';

import type { ApiClient } from '../http/ApiClient';
import { BookingApi } from '../services/BookingApi';
import { PaymentApi } from '../services/PaymentApi';
import { UserApi } from '../services/UserApi';
import type { MonthSlotsDto, OccupiedSlotDto, SessionDiscountDto } from '../dto/booking.dto';
import type { ApiUser } from './UserFacade';

/**
 * The assignment behind the calendar is created asynchronously after the
 * expert is chosen; until then the calendar answers 400/9177.
 */
const ASSIGNMENT_TIMEOUT_MS = 60_000;

/**
 * Booking a session over the API, the way the site does it: choose the
 * expert, wait for the calendar, pay, take a cell.
 *
 * Successful bookings are remembered, and cancelRemainingQuietly (called by
 * the fixture teardown) cancels whatever the test did not cancel itself —
 * otherwise a failed test would leave a paid future slot and its chat on
 * the stage.
 */
export class BookingFacade {
  private readonly bookings: Array<{ user: ApiUser; expertUuid: string }> = [];

  constructor(private readonly client: ApiClient) {}

  private bookingApi(user: Pick<ApiUser, 'accessToken'>): BookingApi {
    return new BookingApi(this.client.withToken(user.accessToken));
  }

  /**
   * Chooses the expert by questionnaire. Which answer is picked does not
   * matter for booking, so the first one is used.
   */
  async chooseExpert(user: ApiUser, expertUuid: string): Promise<void> {
    await test.step('choose the expert by questionnaire', async () => {
      const categories = await new UserApi(this.client.withToken(user.accessToken)).getCategories();
      expect(categories.status, 'questionnaire data should answer 200').toBe(200);
      const answerKey = Object.keys(categories.body?.answers ?? {})[0];
      expect(answerKey, 'the questionnaire must offer at least one answer').toBeTruthy();

      const chosen = await this.bookingApi(user).chooseByQuestionnaire(expertUuid, categories.body!, answerKey);
      expect(chosen.status, 'choosing the expert should answer 200').toBe(200);
    });
  }

  /** Waits until the expert's calendar opens for this user and returns it. */
  async waitForCalendar(user: ApiUser, expertUuid: string): Promise<MonthSlotsDto> {
    return test.step('wait for the booking calendar', async () => {
      const api = this.bookingApi(user);
      // A thrown fetch error would abort the poll instead of retrying, so
      // errors are folded into a "not yet" status value.
      await expect
        .poll(
          async () => {
            try {
              return (await api.monthSlots(expertUuid, true)).status;
            } catch {
              return 0;
            }
          },
          {
            message: 'the calendar must open once the asynchronous assignment is created',
            timeout: ASSIGNMENT_TIMEOUT_MS
          }
        )
        .toBe(200);

      const calendar = await api.monthSlots(expertUuid);
      expect(calendar.status, 'the calendar should answer 200').toBe(200);
      return calendar.body!;
    });
  }

  /**
   * Pays for a session package. A fresh account has a zero balance, so the
   * charge equals the package price from the calendar and the whole sum
   * lands on the balance — both facts are checked, because on this API a
   * 200 alone proves nothing.
   */
  async payForPackage(user: ApiUser, calendar: MonthSlotsDto, lengthInMin = 10): Promise<SessionDiscountDto> {
    return test.step(`pay for a ${lengthInMin}-minute session`, async () => {
      const price = calendar.discounts.find((discount) => discount.lengthInMin === lengthInMin);
      expect(price, `the calendar must offer a ${lengthInMin}-minute package`).toBeTruthy();

      const payment = new PaymentApi(this.client.withToken(user.accessToken));
      const paid = await payment.purchase(user.userUuid, price!.price);
      expect(paid.status, 'the purchase should answer 200').toBe(200);
      expect(paid.body?.status, 'the charge itself must succeed').toBe('succeeded');

      const balance = await payment.getBalance();
      expect(balance.status, 'the balance should answer 200').toBe(200);
      expect(balance.body?.ballance, 'the paid sum must land on the balance').toBe(price!.price);
      return price!;
    });
  }

  /**
   * Books the nearest cell in the future. The answer of this call is the
   * only honest booking oracle — a cell can be taken by someone else
   * between the calendar read and this call.
   */
  async bookNearestTime(
    user: ApiUser,
    expertUuid: string,
    lengthInMin = 10,
    minutesAhead = 20
  ): Promise<string> {
    return test.step('book the nearest time', async () => {
      const at = new Date(Date.now() + minutesAhead * 60_000);
      at.setUTCSeconds(0, 0);
      // The service accepts only times on a 5-minute grid, in UTC.
      at.setUTCMinutes(Math.ceil(at.getUTCMinutes() / 5) * 5);
      const dateTime = at.toISOString().slice(0, 16);

      const booked = await this.bookingApi(user).occupyNow({
        count: lengthInMin / 10,
        dateTime,
        requestorUuid: user.userUuid,
        profileUuid: expertUuid,
        type: 'CUSTOM',
        offerAware: true,
        web: true
      });
      expect(booked.status, `booking ${dateTime} should answer 200`).toBe(200);

      this.bookings.push({ user, expertUuid });
      return dateTime;
    });
  }

  /** The user's bookings with this expert. */
  async bookedSlots(user: ApiUser, expertUuid: string): Promise<OccupiedSlotDto[]> {
    const booked = await this.bookingApi(user).bookedSlots(expertUuid);
    expect(booked.status, 'reading own bookings should answer 200').toBe(200);
    return normalizeBookedSlots(booked.body);
  }

  /** Cancels an own booking (see BookingApi about the ownerUuid twist). */
  async cancelBooking(user: ApiUser, slot: OccupiedSlotDto): Promise<void> {
    await test.step('cancel the booking', async () => {
      const cancelled = await this.bookingApi(user).cancelOccupation(slot);
      expect(cancelled.status, 'cancellation should answer 200').toBe(200);
    });
  }

  /**
   * Teardown sweep: cancels every remembered booking that is still BOOKED.
   * Runs while the test users still exist (the fixture guarantees the
   * order) and never throws. Returns one line per remembered booking.
   */
  async cancelRemainingQuietly(): Promise<string[]> {
    const lines: string[] = [];
    for (const { user, expertUuid } of this.bookings) {
      try {
        const booked = await this.bookingApi(user).bookedSlots(expertUuid);
        const active = normalizeBookedSlots(booked.body).filter((slot) => slot.status === 'BOOKED');
        if (active.length === 0) {
          lines.push(`${expertUuid}: no booking left to cancel`);
          continue;
        }
        for (const slot of active) {
          const cancelled = await this.bookingApi(user).cancelOccupation(slot);
          lines.push(
            cancelled.status === 200
              ? `${expertUuid}: booking ${slot.uuid} cancelled`
              : `${expertUuid}: booking ${slot.uuid} not cancelled (HTTP ${cancelled.status})`
          );
        }
      } catch (error) {
        lines.push(`${expertUuid}: cancel sweep failed (${error instanceof Error ? error.message : String(error)})`);
      }
    }
    this.bookings.length = 0;
    return lines;
  }
}

/** The booked endpoint answers two shapes — see BookingApi.bookedSlots. */
function normalizeBookedSlots(body: OccupiedSlotDto[] | MonthSlotsDto | undefined): OccupiedSlotDto[] {
  if (!body) {
    return [];
  }
  return Array.isArray(body) ? body : (body.occupiedSlots ?? []);
}
