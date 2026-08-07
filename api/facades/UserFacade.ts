import { expect, test } from '@playwright/test';

import type { ApiClient } from '../http/ApiClient';
import { PaymentApi } from '../services/PaymentApi';
import { UserApi } from '../services/UserApi';
import { UserAuthApi } from '../services/UserAuthApi';
import { DomainCode, domainCode } from '../dto/error.dto';
import { rnd, uuid } from '../support/crypto';
import { REQUEST_SALT, signAuthRequest } from '../support/signing';
import { credentials } from '../../config/credentials';
import { environment } from '../../config/environments';

export type ApiUser = {
  channel: 'email' | 'phone';
  /** Login identifier of the email channel. */
  email?: string;
  /** National number as dialled (555XXXXXXX) — the phone channel login id. */
  nationalPhone?: string;
  /** Server-normalized phone (+1555XXXXXXX) — assert against this one. */
  registeredPhone?: string;
  userUuid: string;
  accessToken: string;
};

export type CleanupOutcome = 'deleted' | 'already gone' | `failed(${string})`;

/** Profile data every generated user gets. */
export const PROFILE_BIRTHDAY = '1990-05-20';
export const PROFILE_ZODIAC_ID = 2; // Taurus for 1990-05-20
export const PROFILE_ZODIAC_NAME = 'Taurus';

/**
 * Creates and prepares test users: sign up by e-mail or phone, fill the
 * profile, attach a card, delete the account.
 *
 * Checks that prove the operation itself (a new account, a real token) live
 * here. Checks that belong to a scenario stay in the test.
 */
export class UserFacade {
  private readonly auth: UserAuthApi;

  constructor(private readonly client: ApiClient) {
    this.auth = new UserAuthApi(client);
  }

  /** Token-bound profile service for the given user. */
  userApi(user: Pick<ApiUser, 'accessToken'>): UserApi {
    return new UserApi(this.client.withToken(user.accessToken));
  }

  /** Token-bound payment service for the given user. */
  paymentApi(user: Pick<ApiUser, 'accessToken'>): PaymentApi {
    return new PaymentApi(this.client.withToken(user.accessToken));
  }

  /**
   * Attaches the 4242 test card (Stripe's own `pm_card_visa`) as the default
   * payment method. Used as a booking precondition: the in-dialog Stripe
   * form renders unreliably on stage, and a pre-attached card makes the UI
   * booking journey deterministic — slot, then pay.
   */
  async attachTestCard(user: Pick<ApiUser, 'accessToken'>): Promise<void> {
    await test.step('attach the 4242 test card via API', async () => {
      const attached = await this.paymentApi(user).attachCard(credentials.testCard.paymentMethodId);
      expect(attached.status, 'card attach should answer 200').toBe(200);

      const cards = await this.paymentApi(user).listCards();
      expect(cards.status, 'card list should answer 200').toBe(200);
      expect(JSON.stringify(cards.body ?? ''), 'the attached card must be listed').toContain(
        credentials.testCard.number.slice(-4)
      );
    });
  }

  /** New unique e-mail, e.g. qa+book1a2b3c@example.com. */
  newEmail(prefix: string): string {
    const { local, domain } = credentials.userEmail;
    return `${local}+${prefix}${rnd(6)}@${domain}`;
  }

  /** Fresh 555-prefixed US national number. */
  newNationalPhone(): string {
    return `555${rnd(7).replace(/[a-f]/g, (c) => String(c.charCodeAt(0) % 10))}`;
  }

  async createUserByEmail(prefix: string): Promise<ApiUser> {
    return test.step(`createUserByEmail "${prefix}"`, async () => {
      const email = this.newEmail(prefix);
      const deviceId = uuid();

      const init = await this.auth.registerInit(email, deviceId);
      expect(init.status, 'registration init should answer 200').toBe(200);
      expect(init.body?.exist, `${email} must be brand new (exist=false)`).toBe(false);

      const hash = await this.auth.registerHash(email, deviceId);
      expect(hash.status, 'registration hash should answer 200').toBe(200);
      expect(hash.body?.exist, 'hash step of a fresh signup reports exist=false').toBe(false);
      expect(hash.body?.token?.accessToken, 'signup must issue an access token').toBeTruthy();
      expect(hash.body?.userUuid, 'signup must issue a userUuid').toBeTruthy();

      return {
        channel: 'email' as const,
        email,
        userUuid: hash.body!.userUuid,
        accessToken: hash.body!.token.accessToken
      };
    });
  }

  /** Re-login into an existing email account (init reports exist=true). */
  async loginByEmailApi(email: string): Promise<ApiUser> {
    return test.step(`API re-login ${email}`, async () => {
      const deviceId = uuid();
      const hash = await this.auth.registerHash(email, deviceId);
      expect(hash.status, 're-login hash should answer 200').toBe(200);
      expect(hash.body?.token?.accessToken, 're-login must issue an access token').toBeTruthy();

      return {
        channel: 'email' as const,
        email,
        userUuid: hash.body!.userUuid,
        accessToken: hash.body!.token.accessToken
      };
    });
  }

  async createUserByPhone(): Promise<ApiUser> {
    return test.step('createUserByPhone', async () => {
      const nationalPhone = this.newNationalPhone();
      const deviceId = uuid();

      const registration = await this.auth.registerPhone(nationalPhone, deviceId);
      expect(registration.status, 'phone registration should answer 200').toBe(200);
      expect(registration.body?.exist, `+1${nationalPhone} must be brand new (exist=false)`).toBe(false);
      expect(registration.body?.registeredPhone, 'server reports the normalized phone').toBe(`+1${nationalPhone}`);
      const userUuid = registration.body!.userUuid;

      const channel = await this.auth.authChannel(userUuid);
      expect(channel.status, 'auth channel should answer 200').toBe(200);
      expect(channel.body?.channel?.id, 'auth channel must return id/in/out').toBeTruthy();

      const request = await this.auth.authRequest(
        userUuid,
        signAuthRequest(channel.body!.channel, REQUEST_SALT, userUuid)
      );
      expect(request.status, 'auth request (SMS send) should answer 200').toBe(200);

      const confirm = await this.auth.authConfirm(
        userUuid,
        signAuthRequest(channel.body!.channel, environment.smsCode, userUuid)
      );
      expect(confirm.status, 'auth confirm should answer 200').toBe(200);
      // The trap this flow is famous for: a wrong signature also gets a 200,
      // just without a token — the token itself is the only success oracle.
      expect(confirm.body?.token?.accessToken, 'auth confirm must issue an access token').toBeTruthy();

      return {
        channel: 'phone' as const,
        nationalPhone,
        registeredPhone: registration.body!.registeredPhone,
        userUuid,
        accessToken: confirm.body!.token!.accessToken
      };
    });
  }

  /**
   * Fills the profile: nickname, birthday and zodiac, then the horoscope
   * onboarding data. Without this the site sends the user to the
   * "create profile" screen after login instead of the experts page.
   */
  async completeProfile(user: ApiUser, nickname: string): Promise<void> {
    await test.step(`completeProfile "${nickname}"`, async () => {
      const api = this.userApi(user);

      const updated = await api.updateProfile({
        nickname,
        birthday: `${PROFILE_BIRTHDAY}T00:00:00.000`,
        emailOptIn: true,
        zodiacId: PROFILE_ZODIAC_ID
      });
      expect(updated.status, 'profile update should answer 200').toBe(200);
      expect(updated.body?.nickname, 'update echo carries the new nickname').toBe(nickname);
      expect(updated.body?.zodiac?.name, 'zodiac follows the explicit zodiacId').toBe(PROFILE_ZODIAC_NAME);
      expect(updated.body?.status, 'first update moves the profile out of EMPTY').toBe('BOT_NEW');

      const horoscope = await api.submitHoroscopeData({
        birthday: PROFILE_BIRTHDAY,
        nickname,
        location: 'New York, USA',
        latitude: '40.7128',
        longitude: '-74.0060',
        timeOfBirth: '13:45:00'
      });
      expect(horoscope.status, 'horoscope onboarding data should be accepted (201)').toBe(201);
    });
  }

  /**
   * Deletes the account during clean-up. Never throws: a test that already
   * passed must not turn red because of clean-up. "Account is not
   * registered" means the account is gone already, which is fine.
   */
  async deleteUserQuietly(user: Pick<ApiUser, 'accessToken'>): Promise<CleanupOutcome> {
    try {
      const api = this.userApi(user);
      const deletion = await api.deleteAccount();
      if (deletion.status === 200) {
        return 'deleted';
      }
      if (domainCode(deletion.body) === DomainCode.ACCOUNT_NOT_REGISTERED) {
        return 'already gone';
      }
      return `failed(HTTP ${deletion.status})`;
    } catch (error) {
      return `failed(${error instanceof Error ? error.message : String(error)})`;
    }
  }
}
