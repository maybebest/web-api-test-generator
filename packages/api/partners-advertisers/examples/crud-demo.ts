// Standalone advertiser CRUD demo using global fetch (no Playwright). Run with:
//   ADVERTISER_BEARER_TOKEN=<token> ADVERTISER_PARTNER_ID=<id> npx tsx partners-advertisers/examples/crud-demo.ts
//
// Mutating steps (create/update/assign/delete) are guarded behind ADVERTISER_DEMO_WRITE=true so an
// accidental run is read-only. create/update/delete call INFERRED operations — verify them first.

import {
  AdvertiserApi,
  AdvertiserFactory,
  FetchGraphQLTransport,
  resolveDefaultPartnerId,
  resolveToken
} from '../src/index.js';

async function main(): Promise<void> {
  if (!resolveToken({})) {
    throw new Error('Set ADVERTISER_BEARER_TOKEN (Azure B2C access token) before running this demo.');
  }
  if (!resolveDefaultPartnerId()) {
    throw new Error('Set ADVERTISER_PARTNER_ID before running this demo.');
  }

  const api = new AdvertiserApi(new FetchGraphQLTransport());

  // READ list
  const advertisers = await api.list();
  console.log(`read ${advertisers.length} advertisers for partner`);
  if (advertisers.length > 0) {
    const one = await api.get(advertisers[0].id);
    console.log(`read advertiser ${one.id}: ${one.displayName}`);
  }

  if (process.env.ADVERTISER_DEMO_WRITE !== 'true') {
    console.log('write steps skipped (set ADVERTISER_DEMO_WRITE=true to create/update/assign/delete)');
    return;
  }

  // CREATE — Factory recipe + Builder customization
  const input = AdvertiserFactory.sample(AdvertiserFactory.uniqueName('Demo Advertiser'))
    .goldClient(true)
    .build();
  const created = await api.create(input);
  console.log(`created advertiser ${created.id}`);

  // UPDATE — change any field
  const updated = await api.updateField(created.id, 'strategicClient', true);
  console.log(`updated strategicClient -> ${updated.strategicClient}`);

  // ASSIGN to partner (observed mutation)
  const assigned = await api.assignToPartner(created.id);
  console.log(`assigned advertiser ${assigned.id} to partner`);

  // DELETE
  const deleted = await api.delete(created.id);
  console.log(`deleted advertiser ${deleted.id}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1;
});
