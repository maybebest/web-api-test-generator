import { expect, uiTest as test } from '../../../fixtures/ui-test';

/**
 * "Find your match": a question typed on the home page opens the Psychic
 * Match page. The second test shows the other side of the login: a wrong
 * verification code lets nobody in.
 */

// Any short question works; the page only needs some text to start matching.
const MATCH_QUESTION = 'Birthday';

// The environment accepts one code only, so this one must always fail.
const WRONG_CODE = '9999';

test.describe('find your match', () => {
  test('a question from the home page opens the psychic match page @ui @match', async ({
    signedInUser,
    pages,
    page
  }) => {
    await test.step('go from the psychics page to the home page', async () => {
      await pages.psychics.goHome();
    });

    await test.step('type the question and ask for the answer', async () => {
      await pages.home.typeMatchQuestion(MATCH_QUESTION);
      await pages.home.submitMatchQuestion();
    });

    await test.step('a new page opens: the Psychic Match page', async () => {
      await pages.matchAdvisor.waitForLoaded();
      await expect(page).toHaveURL(/\/match-advisor\/?(?:[?#].*)?$/);
      await expect(pages.matchAdvisor.pageBreadcrumb).toBeVisible();
    });
  });

  test('a wrong verification code keeps the user on the code screen @ui @match', async ({
    users,
    login,
    pages,
    page
  }) => {
    const user = await users.createByEmail('match');

    await test.step('ask for a code for this email and type a wrong one', async () => {
      await login.byEmail(user.email!, WRONG_CODE);
    });

    await test.step('the code screen stays and the user is not logged in', async () => {
      await expect(pages.signup.firstCodeDigitInput).toBeVisible();
      await expect(page).not.toHaveURL(/\/psychics/);
    });
  });
});
