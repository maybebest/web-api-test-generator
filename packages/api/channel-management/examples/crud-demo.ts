// Standalone channel CRUD demo using global fetch (no Playwright). Run with:
//   CHANNEL_BEARER_TOKEN=<token> npx tsx channel-management/examples/crud-demo.ts
//
// Mutating steps (create/update/delete) are guarded behind CHANNEL_DEMO_WRITE=true so an accidental
// run is read-only. create/delete call INFERRED operations — verify them against the schema first.

import {
  ChannelApi,
  ChannelFactory,
  FetchGraphQLTransport,
  resolveToken
} from '../src/index.js';

async function main(): Promise<void> {
  if (!resolveToken({})) {
    throw new Error('Set CHANNEL_BEARER_TOKEN (Azure B2C access token) before running this demo.');
  }

  const api = new ChannelApi(new FetchGraphQLTransport());

  // READ list
  const channels = await api.getEvery({ businessGroup: 'sainsburys' });
  console.log(`read ${channels.length} channels`);
  if (channels.length > 0) {
    const one = await api.get(channels[0].id);
    console.log(`read channel ${one.id}: ${one.name}`);
  }

  if (process.env.CHANNEL_DEMO_WRITE !== 'true') {
    console.log('write steps skipped (set CHANNEL_DEMO_WRITE=true to create/update/delete)');
    return;
  }

  // CREATE — Factory recipe + Builder customization
  const input = ChannelFactory.inStoreTrolley(ChannelFactory.uniqueName('Demo Trolleys'))
    .set('inStore.cost.managedService.minimumSpend', 0)
    .build();
  const created = await api.create(input);
  console.log(`created channel ${created.id}`);

  // UPDATE — change any field
  const updated = await api.updateField(created.id, 'inStore.timeline.bookingDeadlineDays', 42);
  console.log(`updated bookingDeadlineDays -> ${updated.inStore?.timeline.bookingDeadlineDays}`);

  // DELETE
  const deleted = await api.delete(created.id);
  console.log(`deleted channel ${deleted.id}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1;
});
