import { expect, uiTest as test } from '../../../fixtures/ui-test';

import { rnd } from '../../../api/support/crypto';

/**
 * Registration by e-mail and registration by phone are two different flows
 * in the API. Each test creates the account through the API only, and then
 * uses the browser to prove that the same account can log in on the site.
 *
 * The profile is filled through the API before the login. Without it the
 * site sends the user to the "create profile" screen instead of the experts
 * page, and the landing would not be the same every run.
 */

test('user can register by email and log in on the site @api @registration', async ({
  page,
  pages,
  login,
  users,
  userFacade
}) => {
  const nickname = `AQA Reg ${rnd()}`;

  const user = await test.step('create a new user by email', async () => {
    const created = await users.createByEmail('reg');
    await userFacade.completeProfile(created, nickname);
    return created;
  });

  await test.step('log in on the site with the same email', async () => {
    await login.byEmail(user.email!);
    await page.waitForURL((url) => url.pathname.startsWith('/psychics'));
    await pages.catalog.waitForLoaded();
  });

  await test.step('the session is real, not only the url', async () => {
    await expect(pages.header.mySessionsLink).toBeVisible();
    await expect(pages.header.nicknameLabel(nickname)).toBeVisible();
    await expect(pages.header.getStartedCta).toBeHidden();
  });
});

test('user can register by phone and log in on the site @api @registration', async ({
  page,
  pages,
  login,
  users,
  userFacade
}) => {
  const nickname = `AQA Reg ${rnd()}`;

  const user = await test.step('create a new user by phone', async () => {
    const created = await users.createByPhone();
    await userFacade.completeProfile(created, nickname);
    return created;
  });

  await test.step('log in on the site with the same phone number', async () => {
    await login.byPhone(user.nationalPhone!);
    await page.waitForURL((url) => url.pathname.startsWith('/psychics'));
    await pages.catalog.waitForLoaded();
  });

  await test.step('the session is real, not only the url', async () => {
    await expect(pages.header.mySessionsLink).toBeVisible();
    await expect(pages.header.nicknameLabel(nickname)).toBeVisible();
    await expect(pages.header.getStartedCta).toBeHidden();
  });
});
