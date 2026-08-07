export type TokenDto = {
  tokenType: string;
  accessToken: string;
  refreshToken: string;
  expiration: string;
  expiresIn: number;
};

/** POST /profile/user/web/registration/init */
export type RegisterInitResponseDto = {
  exist: boolean;
};

/** POST /profile/user/web/registration/hash */
export type RegisterHashResponseDto = {
  userUuid: string;
  exist: boolean;
  token: TokenDto;
};

/** POST /profile/v2/user/registration */
export type PhoneRegistrationResponseDto = {
  userUuid: string;
  registeredPhone: string;
  profileType: string;
  freshChatID: string | null;
  exist: boolean;
};

/** POST /profile/v2/auth/channel */
export type AuthChannelResponseDto = {
  channel: {
    id: string;
    in: number;
    out: number;
  };
};

/**
 * POST /profile/v2/auth/ — NB: a wrong signature also returns 200, just
 * without `token`; the only success oracle is a non-empty accessToken.
 */
export type AuthConfirmResponseDto = {
  userUuid: string;
  profileType: string;
  registeredPhone: string;
  freshChatID: string | null;
  token?: TokenDto;
};
