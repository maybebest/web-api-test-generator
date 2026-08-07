import { expect, apiTest as test } from '../../../fixtures/api-test';

test('user books a session with a freshly generated expert @api @experts @booking', async ({
  experts,
  users,
  keepAgentsOnline,
  bookingFacade
}) => {
  // Generating and publishing the expert alone takes minutes, and a
  // parallel expert test may hold the shared generation service first —
  // the default 2-minute budget of the api project is not enough.
  test.setTimeout(600_000);

  const expert = await test.step('create a live expert', async () => {
    return experts.createPublished();
  });

  const user = await test.step('prepare a user ready to book', async () => {
    return users.createReadyToBook('AqaExpertBooker');
  });

  // The site itself picks the agent who serves a booking, and an offline
  // agent gets the booking cancelled — so the whole pool goes online right
  // before booking (the generation above took minutes, and the server logs
  // idle agents out on its own).
  await keepAgentsOnline();

  await bookingFacade.chooseExpert(user, expert.uuid);

  const calendar = await test.step('the calendar of the new expert opens with free time', async () => {
    const slots = await bookingFacade.waitForCalendar(user, expert.uuid);

    expect(slots.singleSlots.length, 'a fresh expert gets a schedule out of the box').toBeGreaterThan(0);
    expect(slots.firstBook, 'the first-booking discount applies to a fresh user').toBe(true);
    expect(
      slots.fullPricePerMin,
      'the calendar shows the price the expert was published with'
    ).toBe(expert.profile.pricePerMin);
    return slots;
  });

  await bookingFacade.payForPackage(user, calendar, 10);
  await bookingFacade.bookNearestTime(user, expert.uuid, 10);

  const booking = await test.step('the booking exists and points at this expert', async () => {
    const booked = await bookingFacade.bookedSlots(user, expert.uuid);

    expect(booked.length, 'exactly one booking belongs to this user').toBe(1);
    expect(booked[0].status, 'the cell is booked, not cancelled').toBe('BOOKED');
    expect(booked[0].occupierNickname, 'the booking belongs to our user').toBe('AqaExpertBooker');
    expect(booked[0].ownerFirstname, 'the booking points at the generated expert').toBe(expert.profile.firstName);
    expect(booked[0].chatUuid, 'a paid booking opens a chat').toBeTruthy();
    return booked[0];
  });

  await test.step('cancelling frees the cell again', async () => {
    await bookingFacade.cancelBooking(user, booking);

    const after = await bookingFacade.bookedSlots(user, expert.uuid);
    expect(after.length, 'no bookings are left after the cancellation').toBe(0);
  });
});
