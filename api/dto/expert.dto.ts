/**
 * Expert generation lives on a separate service (see
 * `environment.generationApiUrl`); published experts are managed through the
 * `/admin-v3` part of the main gateway. Both sides accept the same
 * administrator bearer token.
 */

/** One selectable option of the generation form: an id plus a display name. */
export type GeneratedExpertFieldDto = {
  psychicbook_id: string;
  name: string;
};

/**
 * A not-yet-published expert on the generation service.
 *
 * `state` is numeric: 2 — generation finished, the expert can be published;
 * 3 — the avatar is still rendering; 7 — publishing is in progress (the
 * draft briefly leaves the list right after the publish call, then comes
 * BACK with this state until the live profile is fully built). Other
 * values were never observed.
 */
export type GeneratedExpertDto = {
  id: number | string;
  state: number;
  first_name: string;
  last_name: string;
  description: string;
  greeting_message: string;
  avatar: string;
  brand: string;
  price_per_minute: number;
  expected_price_per_minute: number;
  category: GeneratedExpertFieldDto;
  additional_categories: GeneratedExpertFieldDto[];
  topics: GeneratedExpertFieldDto[];
  language: GeneratedExpertFieldDto;
  gender: GeneratedExpertFieldDto;
};

export const GENERATED_STATE_READY_TO_PUBLISH = 2;
export const GENERATED_STATE_PUBLISHING = 7;

/** The list answers with classic Django REST pagination. */
export type GeneratedExpertsPageDto = {
  count: number;
  next?: string | null;
  previous?: string | null;
  results: GeneratedExpertDto[];
};

/**
 * Batch state of the generation service. It is shared, not per-request:
 * `in_process` while a batch is being generated, `completed` while finished
 * experts are still waiting in the list, `ready` when the list is empty.
 */
export type GenerationStateDto = {
  state: 'ready' | 'in_process' | 'completed';
};

/** GET /admin-v3/profile/therapist/data-for-generate — form reference data. */
export type BrandDetailsDto = {
  brand: string;
  firstFreePhoneNumber?: string;
  additionalSpecializations: Record<string, string>;
  genders: Record<string, string>;
  languages: Record<string, string>;
  mainSpecializations: Record<string, string>;
  topics: Record<string, string>;
};

/**
 * POST body of the generation request. Note the shapes: `gender`, `category`,
 * `additional_categories` and `topics` are arrays, `language` is a single
 * object — the service rejects other combinations.
 */
export type GenerateExpertsRequestDto = {
  brand: string;
  number_of_experts: number;
  gender: GeneratedExpertFieldDto[];
  ethnicity: string;
  category: GeneratedExpertFieldDto[];
  additional_categories: GeneratedExpertFieldDto[];
  topics: GeneratedExpertFieldDto[];
  language: GeneratedExpertFieldDto;
  photo_style: string;
};

/**
 * PATCH body of a draft edit. The service expects the full set of seven
 * fields every time, even when only one of them changes. Unlike the
 * generation request, `category` here is a single object — the same shape
 * the draft is read with.
 */
export type GeneratedExpertUpdateDto = {
  first_name: string;
  last_name: string;
  description: string;
  greeting_message: string;
  topics: GeneratedExpertFieldDto[];
  category: GeneratedExpertFieldDto;
  additional_categories: GeneratedExpertFieldDto[];
};

/** Statuses a published expert can carry (admin side). */
export const TherapistStatus = {
  ACTIVE: 'ACTIVE',
  DELETED: 'DELETED'
} as const;

/** One row of GET /admin-v3/profile/therapist/all. */
export type AdminTherapistListItemDto = {
  uuid: string;
  firstName: string;
  lastName: string;
  status: string;
  brand: string;
  assignable?: boolean;
  testUser?: boolean;
  email?: string;
  phoneNumber?: string;
  registrationDate?: string;
  rating?: number;
  reviewCount?: number;
  avatarUrl?: string;
};

/** Spring page envelope of the admin expert list. */
export type AdminTherapistPageDto = {
  content: AdminTherapistListItemDto[];
  totalElements: number;
  totalPages?: number;
  number?: number;
  size?: number;
};

/** GET /admin-v3/profile/therapist/{uuid} — the full profile. */
export type AdminTherapistDetailDto = {
  uuid?: string;
  firstName: string;
  lastName: string;
  status: string;
  brand?: string;
  nickname?: string;
  email?: string;
  phoneNumber?: string;
  about?: string;
  pricePerMin?: number;
  expectedPricePerMin?: number;
  rateBoost?: number;
  individual?: boolean;
  assignable?: boolean;
  testUser?: boolean;
  registrationDate?: string;
};

/**
 * PATCH /admin-v3/profile/therapist/{uuid}. This is where the price of a
 * published expert is edited — a draft on the generation service has no
 * writable price at all.
 */
export type AdminTherapistUpdateDto = {
  about?: string;
  email?: string;
  expectedPricePerMin?: number;
  firstName: string;
  lastName: string;
  phoneNumber?: string;
  pricePerMin?: number;
  rateBoost?: number;
  individual?: boolean;
};

/** Card of the public (user-facing) expert catalog cache. */
export type PublicExpertCardDto = {
  uuid: string;
  firstName?: string;
  lastName?: string;
  nickname?: string;
  imageUrl?: string;
  online?: boolean;
};
