import { expect, uiTest as test } from '../../../fixtures/ui-test';

const PACKAGE_MINUTES = 10;
const COUPON_DISCOUNT = 25;

/** Messages the two sides exchange while the session is running. */
const AGENT_MESSAGES = ['agent message 1', 'agent message 2', 'agent message 3'];
const USER_MESSAGES = ['user message 1', 'user message 2'];

/** Extra time on top of the session length, for the site to catch up. */
const EXTRA_WAIT_MS = 5 * 60_000;

/**
 * The site discounts the per-minute price and rounds it to cents, so the
 * price of a package can differ from the exact share by up to a cent per
 * minute: 1.99/min with 25% off shows as 1.49/min, that is 14.9 for ten
 * minutes and not 14.925.
 */
const ROUNDING_TOLERANCE = PACKAGE_MINUTES * 0.01;

/**
 * How discounts behave around one session:
 *  1. a new user pays the welcome price, half of the full one;
 *  2. the agent sends a 25% coupon while that session is running;
 *  3. once the session is over, booking another session with the same
 *     expert costs the coupon price.
 *
 * There is no price check during the session on purpose: while a session
 * runs the site offers only "+10 MIN", and any way into the booking dialog
 * leads back to the chat of that session. That is how the product works.
 *
 * Prices are compared as ratios to the full price captured at the start, so
 * the test does not depend on the price list of a particular expert. Only
 * one payment happens here; the other steps just read prices.
 *
 * This test is long on purpose. A session ends when the paid minutes are
 * over and an agent cannot close it earlier. To keep the waiting short, the
 * test books with an expert who can start right away, and the user and the
 * agent talk while it runs.
 */
test('welcome discount, coupon during a session and coupon price after it @ui @coupons', async ({
  signedInUser,
  pages,
  page,
  booking,
  expertBooking,
  agentFacade,
  keepAgentsOnline,
  onlineAgents,
  conversation
}) => {
  // The test waits through a real session: up to a few minutes until it
  // starts, then the paid minutes themselves.
  test.setTimeout(45 * 60_000);

  const ensureOnline = keepAgentsOnline;

  const booked = await test.step('book a session that starts within a few minutes', async () => {
    return expertBooking.bookSessionStartingSoon({ packageMinutes: PACKAGE_MINUTES });
  });
  const fullPrice = booked.prices.full;

  await test.step('a new user pays the welcome price, half of the full one', async () => {
    await test.info().attach('price with welcome discount', {
      body: JSON.stringify({ expert: booked.expertName, slot: booked.slotTime, ...booked.prices }),
      contentType: 'application/json'
    });
    expect(
      Math.abs(booked.prices.actual - fullPrice * 0.5),
      `the first booking costs half of the full price: ${booked.prices.actual} against ${(fullPrice * 0.5).toFixed(3)}`
    ).toBeLessThanOrEqual(ROUNDING_TOLERANCE);
  });

  const chat = await test.step('agent takes the chat', async () => {
    return conversation.takeChatOf(signedInUser.nickname, booked.chatUuid);
  });

  await test.step(`agent sends a ${COUPON_DISCOUNT}% coupon`, async () => {
    const speaker = conversation.speaker;
    const coupons = await speaker.api.listExpertCoupons(
      chat.expertProfile!.profileUuid,
      chat.userProfile!.profileUuid
    );
    expect(coupons.status, 'the coupon list should answer 200').toBe(200);

    const coupon = (coupons.body ?? []).find((candidate) => candidate.discount === COUPON_DISCOUNT);
    const offered = (coupons.body ?? []).map((candidate) => candidate.discount);
    expect(coupon, `the expert should offer a ${COUPON_DISCOUNT}% coupon, offers: ${offered.join(', ')}`).toBeTruthy();

    const sent = await speaker.api.sendCouponToChat(chat.uuid, coupon!.uuid);
    expect(sent.status, 'sending the coupon should answer 200').toBe(200);

    const messages = await agentFacade.readMessages(speaker, chat.uuid);
    expect(messages.some((message) => message.type === 'COUPON'), 'the coupon should be in the chat').toBe(true);
  });

  await test.step(`wait for the session booked for ${booked.slotTime}`, async () => {
    // "NOW" is already running; a booked time starts when it comes.
    const untilStart = booked.sessionStartsAt.getTime() - Date.now();
    await agentFacade.waitForSessionStart(conversation.speaker, chat.uuid, Math.max(untilStart, 0) + EXTRA_WAIT_MS, {
      slotName: booked.slotTime,
      refreshUserPage: () => page.reload().then(() => undefined),
      // The site serves a booking with an agent of its own choosing, and it
      // cancels a booking whose agent is offline. So all of them stay online.
      keepOnline: onlineAgents
    });
  });

  await test.step('user and agent talk while the session is running', async () => {
    await conversation.agentSends(chat, AGENT_MESSAGES);
    await conversation.userSees(AGENT_MESSAGES);

    await conversation.userSends(USER_MESSAGES);
    await conversation.agentSeesUserMessages(chat, USER_MESSAGES);
  });

  await test.step(`wait for the session to end (${PACKAGE_MINUTES} paid minutes)`, async () => {
    await agentFacade.waitForSessionEnd(conversation.speaker, chat.uuid, PACKAGE_MINUTES * 60_000 + EXTRA_WAIT_MS, {
      keepOnline: onlineAgents
    });
  });

  await test.step('agent sends a booking button into the chat', async () => {
    const action = await conversation.speaker.api.sendActionMessage(chat.uuid, 'BOOK_SESSION', 'Book a session with me');
    expect(action.status, 'sending the booking button should answer 200').toBe(200);

    const messages = await agentFacade.readMessages(conversation.speaker, chat.uuid);
    expect(messages.at(-1)?.action?.title, 'the last message should carry the button').toBe('Book Now');
  });

  await test.step(`booking from the chat button uses the ${COUPON_DISCOUNT}% coupon`, async () => {
    await page.reload();
    await expect(pages.chat.bookNowButton, 'the button should be in the chat').toBeVisible({ timeout: 60_000 });

    await booking.openPriceDialog({
      ensureOnline,
      openDialog: () => pages.chat.bookNowButton.click()
    });

    const prices = await pages.bookingDialog.prices();
    await test.info().attach('price with the coupon', {
      body: JSON.stringify(prices),
      contentType: 'application/json'
    });

    const withCoupon = fullPrice * (1 - COUPON_DISCOUNT / 100);
    expect(prices.full, 'the price list should still be the same').toBeCloseTo(fullPrice, 2);
    expect(
      Math.abs(prices.actual - withCoupon),
      `the coupon should be applied now: ${prices.actual} against ${withCoupon.toFixed(3)} for ${COUPON_DISCOUNT}% off`
    ).toBeLessThanOrEqual(ROUNDING_TOLERANCE);
    await expect(pages.bookingDialog.couponAppliedNote).toBeVisible();
  });
});
