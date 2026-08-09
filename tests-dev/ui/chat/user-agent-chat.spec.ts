import { expect, uiTest as test } from '../../../fixtures/ui-test';

const AGENT_MESSAGES = ['agent message 1', 'agent message 2'];
const USER_MESSAGES = ['user message 1', 'user message 2'];

/**
 * A user and an agent talk to each other in the chat that a paid booking
 * creates. The user works in the browser, the agent works over the API.
 *
 * Messages are written in latin letters on purpose: the message field does
 * not accept cyrillic and keeps the send button disabled.
 */
test('user and agent exchange messages in a booked chat @ui @chat', async ({
  signedInUser,
  pages,
  expertBooking,
  conversation
}) => {
  const booked = await test.step('book a session, which creates the chat', async () => {
    // Any expert with free time will do, so the search moves on when this
    // one has none.
    return expertBooking.bookWithNewExpert({ date: 'any', minStartOffsetMin: 15 });
  });

  const chat = await test.step('agent takes this chat', async () => {
    return conversation.takeChatOf(signedInUser.nickname, booked.chatUuid);
  });

  await test.step('agent writes, user sees it in the browser', async () => {
    await conversation.agentSends(chat, AGENT_MESSAGES);
    await conversation.userSees(AGENT_MESSAGES);
  });

  await test.step('user answers, agent sees both messages in order', async () => {
    await conversation.userSends(USER_MESSAGES);
    await conversation.agentSeesUserMessages(chat, USER_MESSAGES);
  });

  await test.step('agent messages are shown as messages of the expert', async () => {
    await conversation.agentMessagesComeFromExpert(chat, AGENT_MESSAGES);
    await expect(pages.chat.message(AGENT_MESSAGES[0])).toBeVisible();
  });
});
