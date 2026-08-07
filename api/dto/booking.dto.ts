/** GET /profile/user/categories — everything the questionnaire answer needs. */
export type UserCategoriesDto = {
  questionnaireUuid: string;
  questionBlockUuid: string;
  questionUuid: string;
  /** answerKey -> display name ("Psychic readings", "Love & relationships", ...). */
  answers: Record<string, string>;
};

/** One purchasable session package of the month-slots answer. */
export type SessionDiscountDto = {
  lengthInMin: number;
  fullPrice: number;
  price: number;
  bonus: number;
};

/** A bookable cell. Times are in the expert's schedule zone (UTC on stage). */
export type TimeSlotDto = {
  uuid: string;
  startTime: string;
  startDay: string;
  endTime: string;
  endDay: string;
};

/** A taken cell as the user sees it. */
export type OccupiedSlotDto = {
  uuid: string;
  chatUuid?: string;
  occupierUuid?: string;
  occupierNickname?: string;
  /**
   * Owner of the schedule the slot belongs to. NOT the expert uuid — and the
   * cancellation endpoint wants exactly this value (see BookingApi).
   */
  ownerUuid: string;
  ownerFirstname?: string;
  ownerLastname?: string;
  timeSlotUuid?: string;
  status: string;
  type?: string;
  startDateTime?: string;
  endDateTime?: string;
};

/** GET /calendar/time-slot/month/for-user — the booking calendar. */
export type MonthSlotsDto = {
  singleSlots: TimeSlotDto[];
  doubleSlots: TimeSlotDto[];
  occupiedSlots: OccupiedSlotDto[];
  discounts: SessionDiscountDto[];
  /** True until the account books for the first time. */
  firstBook: boolean;
  discountPercentage?: number;
  pricePerMin?: number;
  fullPricePerMin?: number;
  currency?: string;
  therapistTimeZone?: string;
  timeZone?: string;
};

/** POST /calendar/time-slot/occupation/now. */
export type OccupyNowRequestDto = {
  /** Session length in 10-minute units: 1 for 10 min, 3 for 30 min. */
  count: number;
  /** UTC, minutes divisible by 5, format yyyy-MM-dd'T'HH:mm. */
  dateTime: string;
  requestorUuid: string;
  /** The expert to book with. */
  profileUuid: string;
  type: 'CUSTOM';
  offerAware: boolean;
  web: boolean;
};
