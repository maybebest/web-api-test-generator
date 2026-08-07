import type { ApiClient, ApiResult } from '../http/ApiClient';
import type {
  AuthChannelResponseDto,
  AuthConfirmResponseDto,
  PhoneRegistrationResponseDto,
  RegisterHashResponseDto,
  RegisterInitResponseDto
} from '../dto/auth.dto';
import { base64 } from '../support/crypto';
import { environment } from '../../config/environments';

const BRAND = 'PB';

/** Every request of the v2 phone flow must carry this header. */
const MOBILE_HEADERS = { version: '2.2' };

/**
 * Registration/authorization endpoints for both user channels: the web email
 * flow (init + hash) and the v2 mobile phone flow (registration + signed
 * channel/request/confirm triad). No Authorization header on any of these.
 */
export class UserAuthApi {
  constructor(private readonly client: ApiClient) {}

  // --- email (web) flow ---

  registerInit(email: string, deviceId: string): Promise<ApiResult<RegisterInitResponseDto>> {
    return this.client.post('/profile/user/web/registration/init', {
      data: {
        brand: BRAND,
        email,
        device: 'PC',
        deviceId,
        deviceType: 'PC',
        os: 'MacOS'
      }
    });
  }

  /**
   * Create + auto-login in one call. The hash is
   * base64("<email>;<verification code>;<brand>") — the verification code is
   * environment-specific (1234 on stage).
   */
  registerHash(email: string, deviceId: string): Promise<ApiResult<RegisterHashResponseDto>> {
    return this.client.post('/profile/user/web/registration/hash', {
      data: {
        appVersion: '5.0-dev',
        brand: BRAND,
        device: 'PC',
        deviceId,
        deviceModel: 'Chrome - 150',
        deviceType: 'PC',
        hash: base64(`${email};${environment.emailCode};${BRAND}`),
        locale: 'en',
        os: 'MacOS'
      }
    });
  }

  // --- phone (v2 mobile) flow ---

  registerPhone(phoneNumber: string, deviceId: string): Promise<ApiResult<PhoneRegistrationResponseDto>> {
    return this.client.post('/profile/v2/user/registration', {
      headers: MOBILE_HEADERS,
      params: { locale: 'en' },
      data: {
        appVersion: '1.0.0',
        appsFlyerId: '',
        device: 'iPhone',
        deviceId,
        deviceModel: 'iPhone',
        deviceType: 'IPHONE',
        isoCodeThree: 'USA',
        os: '17.5',
        phoneCode: '1',
        phoneNumber
      }
    });
  }

  authChannel(userUuid: string): Promise<ApiResult<AuthChannelResponseDto>> {
    return this.client.post('/profile/v2/auth/channel', {
      headers: MOBILE_HEADERS,
      data: { uuid: userUuid }
    });
  }

  authRequest(userUuid: string, requestId: string): Promise<ApiResult<void>> {
    return this.client.post('/profile/v2/auth/request', {
      headers: MOBILE_HEADERS,
      data: { uuid: userUuid, requestId, web: false }
    });
  }

  /** NB: the trailing slash is part of the path — do not normalize it away. */
  authConfirm(userUuid: string, requestId: string): Promise<ApiResult<AuthConfirmResponseDto>> {
    return this.client.post('/profile/v2/auth/', {
      headers: MOBILE_HEADERS,
      data: { uuid: userUuid, requestId, web: false }
    });
  }
}
