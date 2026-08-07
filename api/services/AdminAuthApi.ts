import type { ApiClient, ApiResult } from '../http/ApiClient';
import { base64 } from '../support/crypto';

/**
 * The public OAuth client of the platform. It is not a secret — every web
 * client ships it — but the token endpoint refuses requests without it.
 */
const OAUTH_BASIC = `Basic ${base64('client:clientsecret')}`;

export type AdminUuidResponseDto = {
  email: string;
  uuid: string;
};

export type OAuthTokenResponseDto = {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  uuid?: string;
};

/**
 * Administrator sign-in. It is a two-step dance: the token endpoint does not
 * accept an e-mail as the username, so the e-mail is first exchanged for the
 * administrator uuid, and the uuid signs in.
 */
export class AdminAuthApi {
  constructor(private readonly client: ApiClient) {}

  /** Resolves the administrator uuid. The endpoint needs no token. */
  uuidByEmail(email: string): Promise<ApiResult<AdminUuidResponseDto>> {
    return this.client.get(`/admin-v3/profile/administrator/${email}/uuid`);
  }

  /**
   * OAuth password grant. This endpoint wants multipart/form-data (not JSON
   * and not urlencoded) and the shared client Basic header.
   */
  token(adminUuid: string, password: string): Promise<ApiResult<OAuthTokenResponseDto>> {
    return this.client.post('/auth/oauth/token', {
      headers: { Authorization: OAUTH_BASIC },
      multipart: {
        grant_type: 'password',
        username: adminUuid,
        password
      }
    });
  }
}
