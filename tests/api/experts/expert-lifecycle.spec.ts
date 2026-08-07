import { expect, apiTest as test } from '../../../fixtures/api-test';
import { EXPERT_NAME_PREFIX } from '../../../api/facades/ExpertFacade';
import { GENERATED_STATE_READY_TO_PUBLISH, TherapistStatus } from '../../../api/dto/expert.dto';

test('admin generates an expert, edits the essentials and deletes it @api @experts', async ({
  expertFacade,
  experts
}) => {
  // Generating one expert takes about a minute, publishing is a background
  // job of its own, and a parallel expert test may hold the shared
  // generation service first — so the story needs far more than the
  // 2-minute budget of the api project.
  test.setTimeout(600_000);

  const draft = await test.step('generate one expert', async () => {
    const generated = await experts.generateDraft();

    expect(generated.state, 'the draft is fully generated, avatar included').toBe(GENERATED_STATE_READY_TO_PUBLISH);
    expect(generated.first_name, 'the draft carries the searchable test prefix').toContain(EXPERT_NAME_PREFIX);
    expect(generated.description, 'the generated card has a description').toBeTruthy();
    expect(generated.greeting_message, 'the generated card has a greeting').toBeTruthy();
    expect(generated.avatar, 'the generated card has an avatar').toBeTruthy();
    expect(generated.price_per_minute, 'the generated card has a price').toBeGreaterThan(0);
    return generated;
  });

  const expert = await test.step('publish the expert', async () => {
    const published = await experts.publish(draft);

    expect(published.profile.status, 'the published expert is live').toBe(TherapistStatus.ACTIVE);
    expect(published.profile.nickname, 'publishing assigns a nickname').toBeTruthy();
    expect(published.profile.pricePerMin, 'the price survives publishing').toBe(draft.price_per_minute);
    return published;
  });

  await test.step('the admin search finds exactly this expert', async () => {
    // The search matches substrings, so rows are pinned by the exact name.
    const rows = await expertFacade.findPublished(draft.first_name);
    const exact = rows.filter((row) => row.firstName === draft.first_name);

    expect(exact, 'the unique name matches one expert').toHaveLength(1);
    expect(exact[0].uuid, 'search returns the published profile').toBe(expert.uuid);
  });

  await test.step('users see the expert in the public catalog', async () => {
    await expertFacade.waitUntilPubliclyListed(expert.uuid);
  });

  await test.step('edit the name and the price', async () => {
    const newFirstName = `${expert.profile.firstName} Edited`;
    const newPrice = Number((draft.price_per_minute + 0.5).toFixed(2));

    const updated = await expertFacade.updatePublished(expert.uuid, {
      firstName: newFirstName,
      pricePerMin: newPrice
    });

    expect(updated.firstName, 'the new name is saved').toBe(newFirstName);
    expect(updated.pricePerMin, 'the new price is saved').toBe(newPrice);
    // Neighbour fields must survive the edit untouched.
    expect(updated.lastName, 'the last name is untouched').toBe(expert.profile.lastName);
    expect(updated.nickname, 'the nickname is untouched').toBe(expert.profile.nickname);
    expect(updated.email, 'the e-mail is untouched').toBe(expert.profile.email);
    expect(updated.status, 'editing does not change the status').toBe(TherapistStatus.ACTIVE);
  });

  await test.step('delete the expert', async () => {
    await expertFacade.deletePublished(expert.uuid);

    const after = await expertFacade.getPublished(expert.uuid);
    expect(after.status, 'the profile status proves the deletion').toBe(TherapistStatus.DELETED);
  });

  await test.step('users must stop seeing the deleted expert', async () => {
    // This step fails today and is meant to: the failure message names
    // the product bug (the catalog cache survives the deletion).
    await expertFacade.waitUntilPubliclyDropped(expert.uuid);
  });
});
