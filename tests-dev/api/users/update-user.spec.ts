import { expect, uiTest as test } from '../../../fixtures/ui-test';

import { PROFILE_BIRTHDAY, PROFILE_ZODIAC_ID } from '../../../api/facades/UserFacade';
import { rnd } from '../../../api/support/crypto';

/**
 * Changing the nickname must really change it, everywhere.
 *
 * The user starts with a filled profile, so there is a known value before
 * the change. The new value is then checked three times: in the answer of
 * the request, in a fresh read of the profile, and in the browser after a
 * login on the site.
 */
test('user profile update changes the nickname on the site @api @profile', async ({
  page,
  pages,
  login,
  users,
  userFacade
}) => {
  const nicknameBefore = `Upd User BEFORE ${rnd()}`;
  const nicknameAfter = `Upd User AFTER ${rnd()}`;

  const user = await test.step('create a user with a filled profile', async () => {
    const created = await users.createByEmail('upd');
    await userFacade.completeProfile(created, nicknameBefore);
    return created;
  });
  const api = userFacade.userApi(user);

  await test.step('read the profile before the change', async () => {
    const profile = await api.getProfile();
    expect(profile.status).toBe(200);
    expect(profile.body?.nickname).toBe(nicknameBefore);
    expect(profile.body?.email).toBe(user.email);
    expect(profile.body?.birthday).toContain(PROFILE_BIRTHDAY);
  });

  await test.step('send the new nickname and check the answer', async () => {
    const updated = await api.updateProfile({
      nickname: nicknameAfter,
      birthday: `${PROFILE_BIRTHDAY}T00:00:00.000`,
      emailOptIn: true,
      zodiacId: PROFILE_ZODIAC_ID
    });
    expect(updated.status).toBe(200);
    expect(updated.body?.nickname).toBe(nicknameAfter);
  });

  await test.step('read the profile again: new nickname, old one gone, email intact', async () => {
    const profile = await api.getProfile();
    expect(profile.status).toBe(200);
    expect(profile.body?.nickname).toBe(nicknameAfter);
    expect(profile.body?.nickname).not.toBe(nicknameBefore);
    expect(profile.body?.email, 'the update must not damage the login email').toBe(user.email);
  });

  await test.step('log in on the site and see the new nickname in the header', async () => {
    await login.byEmail(user.email!);
    await page.waitForURL((url) => url.pathname.startsWith('/psychics'));

    await expect(pages.header.mySessionsLink).toBeVisible();
    await expect(pages.header.nicknameLabel(nicknameAfter)).toBeVisible();
    await expect(pages.header.getStartedCta).toBeHidden();
  });

  await test.step('the About Me page shows the new nickname and not the old one', async () => {
    await pages.profile.openAboutMe();

    await expect(pages.profile.nicknameText(nicknameAfter).first()).toBeVisible();
    await expect(pages.profile.nicknameText(nicknameBefore)).toBeHidden();
  });
});
