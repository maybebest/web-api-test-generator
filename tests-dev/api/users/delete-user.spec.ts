import { expect, uiTest as test } from '../../../fixtures/ui-test';

import { DomainCode, domainCode } from '../../../api/dto/error.dto';
import { rnd } from '../../../api/support/crypto';

/**
 * A deleted account must be gone for the API and for the site.
 *
 * The account is alive first, so the deletion has something to remove. The
 * API check is the domain code 3060 on the next read. The browser then
 * shows what a real user sees: the same e-mail is free again, the login
 * opens an empty profile with no sign of the old data.
 *
 * That new empty account is created by the login itself, so the test hands
 * it to the users fixture as well and it is deleted at the end.
 */
test('deleted user is gone and the email starts an empty profile @api @deletion', async ({
  page,
  login,
  users,
  userFacade
}) => {
  const nickname = `Del User ${rnd()}`;

  const user = await test.step('create a user with a filled profile', async () => {
    const created = await users.createByEmail('del');
    await userFacade.completeProfile(created, nickname);
    return created;
  });
  const api = userFacade.userApi(user);

  await test.step('the account is alive before the deletion', async () => {
    const profile = await api.getProfile();
    expect(profile.status).toBe(200);
    expect(profile.body?.nickname).toBe(nickname);
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

  await test.step('a login with the same email opens an empty profile', async () => {
    await login.byEmail(user.email!);
    await page.waitForURL((url) => url.pathname.startsWith('/create-profile'));

    await expect(page.getByText(/account info/i).first()).toBeVisible();
    await expect(page.getByText(nickname), 'no trace of the deleted profile').toBeHidden();
  });

  await test.step('the account made by that login is deleted at the end too', async () => {
    users.remember(await userFacade.loginByEmailApi(user.email!));
  });
});
