/** GET /profile/user — the only self-lookup available to the user role. */
export type UserProfileDto = {
  avatarUrl: string | null;
  nickname: string | null;
  email: string | null;
  phoneNumber: string | null;
  /** EMPTY on a fresh account, BOT_NEW after the first profile update. */
  status: string;
  questionnaireStatus?: string;
  birthday: string | null;
  emailOptIn: boolean;
  anonym?: boolean;
  zodiac?: {
    id: number | null;
    name: string | null;
  };
  firstBookSession?: boolean;
  firstSession?: boolean;
};

/**
 * PUT /profile/user. `nickname` is mandatory (omitting it → 400/3109);
 * `birthday` must carry the time part: yyyy-MM-dd'T'HH:mm:ss.SSS.
 * The server does NOT derive zodiacId from birthday — send it explicitly.
 */
export type UpdateUserRequestDto = {
  nickname: string;
  email?: string;
  birthday?: string;
  emailOptIn?: boolean;
  zodiacId?: number;
};

/**
 * POST /profile/horoscope/data/user. Unlike PUT /profile/user, `birthday`
 * here is a bare yyyy-MM-dd date.
 */
export type HoroscopeDataRequestDto = {
  birthday: string;
  nickname: string;
  location: string;
  latitude: string;
  longitude: string;
  timeOfBirth: string;
};
