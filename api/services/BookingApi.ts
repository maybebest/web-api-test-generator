import type { ApiClient, ApiResult } from '../http/ApiClient';
import type { MonthSlotsDto, OccupiedSlotDto, OccupyNowRequestDto, UserCategoriesDto } from '../dto/booking.dto';

/**
 * Booking a session with an expert, as the user does it. Construct with a
 * client bound to the user token.
 */
export class BookingApi {
  constructor(private readonly client: ApiClient) {}

  /**
   * Chooses the expert by answering the questionnaire. The field name
   * `questionnaireUpdte` is misspelled on the server side — keep it as is.
   */
  chooseByQuestionnaire(
    expertUuid: string,
    categories: UserCategoriesDto,
    answerKey: string
  ): Promise<ApiResult<void>> {
    return this.client.put(`/profile/user/therapist/${expertUuid}/choose-by-questionnaire`, {
      data: {
        questionnaireUpdte: {
          questionnaireUuid: categories.questionnaireUuid,
          questionBlocks: [
            {
              answers: [answerKey],
              questionBlockUuid: categories.questionBlockUuid,
              questionUuid: categories.questionUuid
            }
          ]
        },
        visibleNotes: true,
        offerAware: true,
        web: true
      }
    });
  }

  /**
   * The booking calendar of one expert. Right after the expert is chosen
   * this answers 400 with domain code 9177 ("No assignment") for a short
   * while — the assignment is created asynchronously, so callers poll.
   */
  monthSlots(expertUuid: string, quiet = false): Promise<ApiResult<MonthSlotsDto>> {
    return this.client.get('/calendar/time-slot/month/for-user', {
      params: { therapistUuid: expertUuid, offerAware: true, web: true },
      quiet
    });
  }

  /**
   * The user's own bookings with this expert. The endpoint answers either
   * a bare array or a month-calendar object with `occupiedSlots` inside —
   * callers go through BookingFacade, which normalizes both shapes.
   */
  bookedSlots(expertUuid: string): Promise<ApiResult<OccupiedSlotDto[] | MonthSlotsDto>> {
    return this.client.get('/calendar/time-slot/month/for-user/booked', {
      params: { therapistUuid: expertUuid }
    });
  }

  /** Books a cell. The 200/non-200 of this call is the booking oracle. */
  occupyNow(body: OccupyNowRequestDto): Promise<ApiResult<void>> {
    return this.client.post('/calendar/time-slot/occupation/now', { data: body });
  }

  /**
   * Cancels an own booking. `therapistUuid` here is NOT the expert uuid but
   * the `ownerUuid` of the occupied slot (the schedule owner) — with the
   * expert uuid the service answers 404.
   */
  cancelOccupation(occupiedSlot: OccupiedSlotDto): Promise<ApiResult<MonthSlotsDto>> {
    return this.client.post('/calendar/time-slot/cancellation', {
      data: {
        occupiedTimeSlotUuid: occupiedSlot.uuid,
        therapistUuid: occupiedSlot.ownerUuid
      }
    });
  }
}
