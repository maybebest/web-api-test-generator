import { expect, uiTest as test } from '../../../fixtures/ui-test';

/**
 * "My Sessions" shows the sessions of the day, and every "Go To Chat" opens
 * the chat of exactly that card.
 *
 * The user books three sessions with three different experts: two for today
 * at different times and one for another day. Only the two today sessions
 * belong to the "Today" group.
 *
 * The three bookings are at different times, so one online agent can serve
 * them all. Taking the whole pool here would block the other tests.
 */
test('my sessions page lists today bookings and opens the right chat @ui @sessions', async ({
  signedInUser,
  pages,
  expertBooking
}) => {

  const first = await expertBooking.bookWithNewExpert({ date: 'today', minStartOffsetMin: 45 });
  const second = await expertBooking.bookWithNewExpert({
    date: 'today',
    minStartOffsetMin: 45,
    excludeTimes: [first.slotTime]
  });
  const another = await expertBooking.bookWithNewExpert({ date: 'future', minStartOffsetMin: 0 });

  await test.step('the Today group holds exactly the two sessions booked for today', async () => {
    await pages.header.mySessionsLink.click();
    await pages.sessions.waitForSessions([first.chatUuid, second.chatUuid, another.chatUuid]);

    const cards = await pages.sessions.cards();
    await test.info().attach('sessions page', {
      body: JSON.stringify(cards, null, 2),
      contentType: 'application/json'
    });

    const today = cards.filter((card) => card.group === 'Today');
    expect(today.map((card) => card.expertName).sort(), 'both today experts should be there').toEqual(
      [first.expertName, second.expertName].sort()
    );

    for (const booked of [first, second]) {
      const card = today.find((candidate) => candidate.expertName === booked.expertName)!;
      expect(card.sessionTime, 'the card should show the booked time').toContain(booked.slotTime);
      expect(card.chatUuid, 'the card should link to the chat of this booking').toBe(booked.chatUuid);
    }

    const otherDay = cards.find((card) => card.chatUuid === another.chatUuid);
    expect(otherDay?.group ?? 'not shown', 'the session of another day is not in Today').not.toBe('Today');
  });

  for (const booked of [first, second]) {
    await test.step(`"Go To Chat" of ${booked.expertName} opens their chat`, async () => {
      await pages.sessions.open();
      await pages.sessions.goToChatLink(booked.chatUuid).click();
      await pages.chat.waitForOpen();

      expect(pages.chat.chatUuid(), 'this should be the chat of this booking').toBe(booked.chatUuid);
      await expect(pages.chat.expertNameOnPage(booked.expertName)).toBeVisible();
      await pages.chat.waitForIncoming(booked.bookingMessage);
    });
  }
});
