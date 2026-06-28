// Live Playwright demo of advertiser CRUD via GraphQL, using the Builder + Factory patterns.
//
// Run explicitly against a real environment:
//   ADVERTISER_BEARER_TOKEN=<azure-b2c-access-token> \
//   ADVERTISER_PARTNER_ID=<partner-id> \
//   npx playwright test partners-advertisers
//
// Read tests need a valid token + partnerId. The create→delete lifecycle is `test.fixme` because
// admin_createAdvertiser / admin_editAdvertiser / admin_deleteAdvertiser are INFERRED (not in the
// HAR). Confirm the real mutation names + AdvertiserInput shape against the schema, then remove .fixme.

import { expect, test } from '@playwright/test';
import {
  AdvertiserApi,
  AdvertiserFactory,
  PlaywrightGraphQLTransport,
  resolveDefaultPartnerId,
  resolveToken
} from '../src/index.js';

const TOKEN = resolveToken({});
const PARTNER_ID = resolveDefaultPartnerId();
const EXISTING_ID = process.env.ADVERTISER_TEST_ID;

const extraHeaders = process.env.ADVERTISER_FEATURE_FLAGS
  ? { 'enabled-feature-flags': process.env.ADVERTISER_FEATURE_FLAGS }
  : undefined;

function makeApi(request: ConstructorParameters<typeof PlaywrightGraphQLTransport>[0]): AdvertiserApi {
  return new AdvertiserApi(new PlaywrightGraphQLTransport(request, { extraHeaders }));
}

test.describe('@advertiser advertiser CRUD (GraphQL)', () => {
  test.skip(!TOKEN, 'set ADVERTISER_BEARER_TOKEN (Azure B2C access token) to run live advertiser tests');
  test.skip(!PARTNER_ID, 'set ADVERTISER_PARTNER_ID to run live advertiser tests');

  test('read: list advertisers for a partner and read one', async ({ request }) => {
    const api = makeApi(request);

    const advertisers = await api.list();
    expect(Array.isArray(advertisers)).toBe(true);
    test.skip(advertisers.length === 0, 'no advertisers returned for this partner');

    const first = await api.get(advertisers[0].id);
    expect(first.id).toBe(advertisers[0].id);
    expect(first.displayName).toBeTruthy();
  });

  test('update: change any field on an existing advertiser and read it back', async ({ request }) => {
    test.skip(!EXISTING_ID, 'set ADVERTISER_TEST_ID to a disposable advertiser to run the update test');
    const api = makeApi(request);

    const before = await api.get(EXISTING_ID as string);

    // The "change any field" method: read → set deep path → update.
    const after = await api.updateField(EXISTING_ID as string, 'goldClient', !before.goldClient);
    expect(after.goldClient).toBe(!before.goldClient);

    // restore
    await api.updateField(EXISTING_ID as string, 'goldClient', before.goldClient ?? false);
  });

  // Full lifecycle. INFERRED create/update/delete => fixme until the mutations are confirmed.
  test.fixme('create → read → update → assign → delete lifecycle', async ({ request }) => {
    const api = makeApi(request);

    const input = AdvertiserFactory.sample(AdvertiserFactory.uniqueName('QA Advertiser'))
      .websiteUrl('https://qa.example.com')
      .goldClient(true)
      .build();

    const created = await api.create(input);
    expect(created.id).toBeTruthy();

    try {
      const read = await api.get(created.id);
      expect(read.displayName).toBe(input.displayName);

      const updated = await api.patch(created.id, { strategicClient: true, websiteUrl: 'https://qa2.example.com' });
      expect(updated.strategicClient).toBe(true);
      expect(updated.websiteUrl).toBe('https://qa2.example.com');

      const assigned = await api.assignToPartner(created.id);
      expect(assigned.id).toBeTruthy();
    } finally {
      const deleted = await api.delete(created.id);
      expect(deleted.id).toBe(created.id);
    }
  });
});
