import { expect, uiTest as test } from '../../../fixtures/ui-test';

/**
 * The sections of "My Profile": what every menu entry opens and what it
 * shows. All checks only read the page, so a new user is enough — a new user
 * has no money, no coupons and no payments yet.
 */

// This entry is closed when the FAQ page opens, so it can prove that a click
// really opens the answer.
const FAQ_QUESTION = 'How do I schedule a session?';

// The address bar is not used as a check here: for some sections the site
// keeps /profile/ in the address and only changes the content.
test.describe('profile sections', () => {
  test('about me section shows a zero balance @ui @profile', async ({ signedInEmailUser, pages }) => {
    await test.step('open About Me from the profile menu', async () => {
      await pages.profile.openAboutMe();
    });

    await test.step('the balance is $0', async () => {
      await expect(pages.profile.balanceLabel).toBeVisible();
      await expect(pages.profile.balanceAmount).toBeVisible();
      await expect(pages.profile.balanceAmount).toHaveText('$0');
    });
  });

  test('terms and conditions section shows the terms text @ui @profile', async ({ signedInEmailUser, pages }) => {
    await test.step('open Terms And Conditions from the profile menu', async () => {
      await pages.profile.openTermsAndConditions();
      await pages.legal.waitForLoaded();
    });

    await test.step('the headings and the terms text are shown', async () => {
      await expect(pages.legal.heading('Disclaimer and Terms')).toBeVisible();
      await expect(pages.legal.heading('Terms & Conditions')).toBeVisible();
      await expect(pages.legal.copyContaining('Our service and website is for entertainment only')).toBeVisible();
      await expect(pages.legal.copyContaining('PsychicBook will not knowingly disclose the content')).toBeVisible();
    });
  });

  test('privacy policy section shows the policy text @ui @profile', async ({ signedInEmailUser, pages }) => {
    await test.step('open Privacy Policy from the profile menu', async () => {
      await pages.profile.openPrivacyPolicy();
      await pages.legal.waitForLoaded();
    });

    await test.step('the heading and the policy text are shown', async () => {
      await expect(pages.legal.heading(/privacy policy/i)).toBeVisible();
      await expect(pages.legal.copyContaining('This Online Privacy Policy & Legal Statement')).toBeVisible();
      await expect(pages.legal.copyContaining('How we protect your privacy')).toBeVisible();
    });
  });

  test('customer support section loads the support chat @ui @profile', async ({ signedInEmailUser, pages }) => {
    await test.step('open Customer Support from the profile menu', async () => {
      await pages.profile.openCustomerSupport();
    });

    await test.step('the support chat window is loaded', async () => {
      await expect(pages.profile.supportChatFrame).toBeVisible();
      await expect(pages.profile.supportChatFrame).toHaveAttribute('src', /support-chat/);
    });
  });

  test('coupons and promo codes section is empty for a new user @ui @profile', async ({
    signedInEmailUser,
    pages,
    page
  }) => {
    await test.step('open Coupons & Promo Codes from the profile menu', async () => {
      await pages.profile.openCoupons();
    });

    await test.step('the page says there are no coupons', async () => {
      await expect(pages.profile.couponsEmptyState).toBeVisible();
    });
  });

  test('payments section shows an empty payment and balance history @ui @profile', async ({
    signedInEmailUser,
    pages,
    page
  }) => {
    await test.step('open Payments from the profile menu', async () => {
      await pages.profile.openPayments();
    });

    await test.step('payment history is there and balance history is empty', async () => {
      await expect(pages.profile.paymentHistoryHeading).toBeVisible();
      await expect(pages.profile.balanceHistoryEmptyState).toBeVisible();
    });
  });

  test('faq entry opens and closes on click @ui @profile', async ({ signedInEmailUser, pages }) => {
    await test.step('open the FAQ section from the profile menu', async () => {
      await pages.profile.openFaq();
    });

    await test.step('the answer is hidden, opens on the first click and hides on the second', async () => {
      const answer = pages.profile.faqAnswerRegion(FAQ_QUESTION);

      // A closed answer is cut to zero height; an open one has a real
      // height. The block opens with an animation, so the checks wait.
      const opening = { timeout: 15_000 };
      await expect(answer).toHaveCSS('max-height', '0px', opening);

      await pages.profile.toggleFaqQuestion(FAQ_QUESTION);
      await expect(answer).not.toHaveCSS('max-height', '0px', opening);

      await pages.profile.toggleFaqQuestion(FAQ_QUESTION);
      await expect(answer).toHaveCSS('max-height', '0px', opening);
    });
  });
});
