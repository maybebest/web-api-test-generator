// Live Playwright demo of channel CRUD via GraphQL, using the Builder + Factory patterns.
//
// This spec is NOT part of the generated suite and is not run by `npm run test:api:*`. Run it
// explicitly against a real environment:
//   CHANNEL_BEARER_TOKEN=<azure-b2c-access-token> \
//   CHANNEL_BASE_URL=https://www.dev.pollen.js-devops.co.uk \
//   npx playwright test channel-management
//
// Read/update tests need a valid Bearer token. The create→delete lifecycle is `test.fixme` because
// admin_createMedia / admin_deleteMedia are INFERRED (not in the HAR) and destructive — confirm the
// real mutation names against the schema, then remove the .fixme.

import { expect, test } from '@playwright/test';
import {
  ChannelApi,
  ChannelFactory,
  PlaywrightGraphQLTransport,
  resolveToken
} from '../src/index.js';

const TOKEN = resolveToken({});
const EXISTING_ID = process.env.CHANNEL_TEST_MEDIA_ID;

// Feature flags the SPA sends; some endpoints behave differently without them. Optional.
const extraHeaders = process.env.CHANNEL_FEATURE_FLAGS
  ? { 'enabled-feature-flags': process.env.CHANNEL_FEATURE_FLAGS }
  : undefined;

function makeApi(request: ConstructorParameters<typeof PlaywrightGraphQLTransport>[0]): ChannelApi {
  return new ChannelApi(new PlaywrightGraphQLTransport(request, { extraHeaders }));
}

test.describe('@channel channel CRUD (GraphQL media)', () => {
  test.skip(!TOKEN, 'set CHANNEL_BEARER_TOKEN (Azure B2C access token) to run live channel tests');

  test('read: list channels and read one', async ({ request }) => {
    const api = makeApi(request);

    const channels = await api.getEvery({ businessGroup: 'sainsburys' });
    expect(Array.isArray(channels)).toBe(true);
    test.skip(channels.length === 0, 'no channels returned for this environment/filter');

    const first = await api.get(channels[0].id);
    expect(first.id).toBe(channels[0].id);
    expect(first.name).toBeTruthy();
  });

  test('update: change any field on an existing channel and read it back', async ({ request }) => {
    test.skip(!EXISTING_ID, 'set CHANNEL_TEST_MEDIA_ID to a disposable channel to run the update test');
    const api = makeApi(request);

    const before = await api.get(EXISTING_ID as string);
    const newDeadline = (before.inStore?.timeline.bookingDeadlineDays ?? 0) + 1;

    // The "change any field" method: read → set deep path → update.
    const after = await api.updateField(EXISTING_ID as string, 'inStore.timeline.bookingDeadlineDays', newDeadline);
    expect(after.inStore?.timeline.bookingDeadlineDays).toBe(newDeadline);

    // restore
    await api.updateField(EXISTING_ID as string, 'inStore.timeline.bookingDeadlineDays', before.inStore?.timeline.bookingDeadlineDays ?? null);
  });

  // Full lifecycle. INFERRED create/delete + destructive => fixme until the mutation names are confirmed.
  test.fixme('create → read → update → delete lifecycle', async ({ request }) => {
    const api = makeApi(request);

    // Factory picks a realistic recipe; Builder customizes any fields.
    const input = ChannelFactory.inStoreTrolley(ChannelFactory.uniqueName('QA Trolleys'))
      .description('Created by channel-crud.spec.ts')
      .set('inStore.cost.managedService.minimumSpend', 0)
      .build();

    const created = await api.create(input);
    expect(created.id).toBeTruthy();

    try {
      const read = await api.get(created.id);
      expect(read.name).toBe(input.name);

      const updated = await api.patch(created.id, {
        description: 'Updated by channel-crud.spec.ts',
        inStore: { timeline: { bookingDeadlineDays: 42 } }
      });
      expect(updated.description).toBe('Updated by channel-crud.spec.ts');
      expect(updated.inStore?.timeline.bookingDeadlineDays).toBe(42);
    } finally {
      const deleted = await api.delete(created.id);
      expect(deleted.id).toBe(created.id);
    }
  });
});
