import { expect, uiTest as test } from '../../../fixtures/ui-test';

import { HOROSCOPE_LEVELS } from '../../../pages/DailyHoroscopePage';
import { PROFILE_ZODIAC_NAME } from '../../../api/facades/UserFacade';

const AGENT_MESSAGES = ['agent message 1', 'agent message 2'];
const USER_MESSAGES = ['user message 1', 'user message 2'];

/**
 * The daily horoscope page: the sign is taken from the birthday of the user,
 * the personal block shows four levels, and "Start Chat" books a session
 * with the astrologer of the day and opens a chat with them.
 *
 * The user was born on 1990-05-20, so the sign must be Taurus (Gemini only
 * starts on 21 May).
 */
test('daily horoscope shows the personal forecast and starts a chat with the astrologer @ui @horoscope', async ({
  signedInUser,
  pages,
  booking,
  keepAgentsOnline,
  conversation
}) => {
  await test.step('open Horoscope - Daily from the header', async () => {
    await pages.header.openHoroscopeMenu();
    await pages.header.clickMenuItem('Daily');
    await pages.horoscope.waitForLoaded();
    await expect(pages.horoscope.tabLabel('Today')).toBeVisible();
  });

  await test.step(`the sign matches the birthday of the user (${PROFILE_ZODIAC_NAME})`, async () => {
    await expect(pages.horoscope.signHeading(PROFILE_ZODIAC_NAME)).toBeVisible();
  });

  await test.step('the personal block shows all four levels and a forecast text', async () => {
    const levels = await pages.horoscope.levelValues();
    expect(Object.keys(levels), 'every level should be shown with a value').toEqual([...HOROSCOPE_LEVELS]);

    await expect(pages.horoscope.generalHeading).toBeVisible();
    await expect(pages.horoscope.generalText).not.toBeEmpty();
  });

  const astrologer = await test.step('an astrologer is offered on the page', async () => {
    await expect(pages.horoscope.expertInsightHeading).toBeVisible();
    await expect(pages.horoscope.startChatButton).toBeEnabled();
    return pages.horoscope.astrologerName();
  });

  const booked = await test.step('"Start Chat" books a session with that astrologer', async () => {
    const result = await booking.bookSession({
      ensureOnline: keepAgentsOnline,
      openDialog: () => pages.horoscope.startChatWithAstrologer()
    });

    await expect(pages.chat.bookingMessage, 'the chat shows when the session is booked').toBeVisible();
    return result;
  });

  const chat = await test.step('agent takes this chat', async () => {
    return conversation.takeChatOf(signedInUser.nickname, booked.chatUuid);
  });

  await test.step('user and astrologer exchange messages', async () => {
    await conversation.agentSends(chat, AGENT_MESSAGES);
    await conversation.userSees(AGENT_MESSAGES);

    await conversation.userSends(USER_MESSAGES);
    await conversation.agentSeesUserMessages(chat, USER_MESSAGES);
  });
});
