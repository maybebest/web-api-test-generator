import { expect, apiTest as test } from '../../../fixtures/api-test';

import { DomainCode, domainCode } from '../../../api/dto/error.dto';
import {
  PROFILE_BIRTHDAY,
  PROFILE_ZODIAC_ID,
  PROFILE_ZODIAC_NAME
} from '../../../api/facades/UserFacade';
import { rnd } from '../../../api/support/crypto';

/**
 * The whole life of an account through the API: create, read, update,
 * delete. One test per registration flow, because e-mail and phone accounts
 * are created in different ways and carry different login data.
 *
 * The update is checked twice: in the answer of the request and by reading
 * the profile again. The deletion is checked by reading the profile after
 * it, which must answer with the domain code 3060.
 */

test('email user can be created, read, updated and deleted @api @lifecycle', async ({
  users,
  userFacade
}) => {
  const user = await test.step('create a new user by email', async () => {
    return users.createByEmail('life');
  });
  const api = userFacade.userApi(user);

  await test.step('a new profile is empty and carries the email', async () => {
    const profile = await api.getProfile();
    expect(profile.status).toBe(200);
    expect(profile.body?.email).toBe(user.email);
    expect(profile.body?.phoneNumber, 'an email account has no phone').toBeNull();
    expect(profile.body?.status).toBe('EMPTY');
    expect(profile.body?.nickname).toBeNull();
  });

  const nickname = `AQA Life ${rnd()}`;
  await test.step('send the profile data and check the answer', async () => {
    const updated = await api.updateProfile({
      nickname,
      birthday: `${PROFILE_BIRTHDAY}T00:00:00.000`,
      emailOptIn: true,
      zodiacId: PROFILE_ZODIAC_ID
    });
    expect(updated.status).toBe(200);
    expect(updated.body?.nickname).toBe(nickname);
    expect(updated.body?.zodiac?.name).toBe(PROFILE_ZODIAC_NAME);
    expect(updated.body?.status, 'the first update moves EMPTY to BOT_NEW').toBe('BOT_NEW');
  });

  await test.step('read the profile again: the data is saved and the email is intact', async () => {
    const profile = await api.getProfile();
    expect(profile.status).toBe(200);
    expect(profile.body?.nickname).toBe(nickname);
    expect(profile.body?.email, 'the update must not damage the login email').toBe(user.email);
    expect(profile.body?.birthday).toContain(PROFILE_BIRTHDAY);
  });

  await test.step('delete the account and read it again', async () => {
    const deletion = await api.deleteAccount();
    expect(deletion.status).toBe(200);

    const gone = await api.getProfile();
    expect(gone.status).toBe(400);
    expect(domainCode(gone.body), 'the answer must carry 3060 Account is not registered').toBe(
      DomainCode.ACCOUNT_NOT_REGISTERED
    );
  });
});

test('phone user can be created, read, updated and deleted @api @lifecycle', async ({
  users,
  userFacade
}) => {
  const user = await test.step('create a new user by phone', async () => {
    return users.createByPhone();
  });
  const api = userFacade.userApi(user);

  await test.step('a new profile is empty and carries the phone number', async () => {
    const profile = await api.getProfile();
    expect(profile.status).toBe(200);
    expect(profile.body?.phoneNumber).toBe(user.registeredPhone);
    expect(profile.body?.email, 'a phone account has no email').toBeNull();
    expect(profile.body?.status).toBe('EMPTY');
  });

  await test.step('an update without a nickname is refused with the code 3109', async () => {
    const rejected = await api.updateProfile({ emailOptIn: true } as never);
    expect(rejected.status).toBe(400);
    expect(domainCode(rejected.body)).toBe(DomainCode.USER_DATA_NOT_VALID);
  });

  const nickname = `AQA Life ${rnd()}`;
  await test.step('send the profile data and check the answer', async () => {
    const updated = await api.updateProfile({
      nickname,
      birthday: `${PROFILE_BIRTHDAY}T00:00:00.000`,
      emailOptIn: true,
      zodiacId: PROFILE_ZODIAC_ID
    });
    expect(updated.status).toBe(200);
    expect(updated.body?.nickname).toBe(nickname);
    expect(updated.body?.zodiac?.name).toBe(PROFILE_ZODIAC_NAME);
    expect(updated.body?.status, 'the first update moves EMPTY to BOT_NEW').toBe('BOT_NEW');
  });

  await test.step('read the profile again: the data is saved and the phone is intact', async () => {
    const profile = await api.getProfile();
    expect(profile.status).toBe(200);
    expect(profile.body?.nickname).toBe(nickname);
    expect(profile.body?.phoneNumber, 'the update must not damage the login phone').toBe(
      user.registeredPhone
    );
  });

  await test.step('delete the account and read it again', async () => {
    const deletion = await api.deleteAccount();
    expect(deletion.status).toBe(200);

    const gone = await api.getProfile();
    expect(gone.status).toBe(400);
    expect(domainCode(gone.body), 'the answer must carry 3060 Account is not registered').toBe(
      DomainCode.ACCOUNT_NOT_REGISTERED
    );
  });
});
