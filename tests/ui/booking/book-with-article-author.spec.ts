import { expect, uiTest as test } from '../../../fixtures/ui-test';

const AGENT_MESSAGE = 'agent message 1';
const USER_MESSAGE = 'user message 1';

/**
 * A user reads an article, opens the profile of its author and books a
 * session with exactly that expert. One message in each direction proves the
 * chat created by the booking really works.
 *
 * The expert is fixed by the article, so the test never falls back to
 * another expert.
 */
test('user books a session with the author of an article @ui @booking', async ({
  signedInUser,
  pages,
  page,
  booking,
  keepAgentsOnline,
  conversation
}) => {
  const author = await test.step('open an article written by an expert', async () => {
    await pages.header.articlesLink.click();
    await page.waitForURL(/\/articles/);
    await expect(pages.articles.popularHeading).toBeVisible();

    return pages.articles.openArticleWithAuthor();
  });

  const expertName = await test.step('the author link opens their expert profile', async () => {
    await pages.article.topAuthorLink().click();
    await page.waitForURL((url) => url.pathname.startsWith(author.profilePath));

    await expect(pages.expertProfile.nameParagraph(author.name)).toBeVisible();
    await expect(pages.expertProfile.bookSessionButton).toBeVisible();
    return pages.expertProfile.profileName(author.name);
  });

  const booked = await test.step('book a session with this expert', async () => {
    const result = await booking.bookSession({
      ensureOnline: keepAgentsOnline,
      openDialog: () => pages.expertProfile.openBooking(author.profilePath),
      expectedExpertName: expertName
    });

    await expect(pages.chat.bookingMessage).toBeVisible();
    await expect(pages.chat.listCard(expertName)).toContainText('Session booked', { timeout: 30_000 });
    return result;
  });

  const chat = await test.step('agent takes the chat of this booking', async () => {
    const found = await conversation.takeChatOf(signedInUser.nickname, booked.chatUuid);
    expect(found.uuid, 'the agent should see the chat the booking created').toBe(booked.chatUuid);
    return found;
  });

  await test.step('one message in each direction', async () => {
    await conversation.agentSends(chat, [AGENT_MESSAGE]);
    await conversation.userSees([AGENT_MESSAGE]);

    await conversation.userSends([USER_MESSAGE]);
    await conversation.agentSeesUserMessages(chat, [USER_MESSAGE]);
  });
});
