import { describe, expect, it } from 'vitest';
import {
  CHANNEL_OPERATIONS,
  ChannelApi,
  ChannelBuilder,
  ChannelFactory,
  CREATE_CHANNEL,
  DELETE_CHANNEL,
  EDIT_CHANNEL,
  GET_CHANNEL,
  GET_EVERY_CHANNEL,
  deepMerge,
  type Channel,
  type ChannelOperation,
  type GraphQLTransport,
  type MediaInput
} from '../../channel-management/src/index.js';

// A recording transport: captures the (operation, variables) the client sends and returns canned data.
class RecordingTransport implements GraphQLTransport {
  readonly calls: Array<{ operation: ChannelOperation; variables: Record<string, unknown> }> = [];
  constructor(private readonly responder: (op: ChannelOperation, vars: Record<string, unknown>) => unknown) {}
  async execute<TData>(operation: ChannelOperation, variables: Record<string, unknown>): Promise<TData> {
    this.calls.push({ operation, variables });
    return this.responder(operation, variables) as TData;
  }
}

describe('channel operations registry', () => {
  it('exposes exactly the five CRUD operations', () => {
    expect(CHANNEL_OPERATIONS.map((operation) => operation.crud)).toEqual([
      'create',
      'read',
      'readList',
      'update',
      'delete'
    ]);
  });

  it('marks update/read/readList as observed and create/delete as inferred', () => {
    expect(EDIT_CHANNEL.observed).toBe(true);
    expect(GET_CHANNEL.observed).toBe(true);
    expect(GET_EVERY_CHANNEL.observed).toBe(true);
    expect(CREATE_CHANNEL.observed).toBe(false);
    expect(DELETE_CHANNEL.observed).toBe(false);
  });

  it('uses the captured ?op values and operationNames', () => {
    expect(EDIT_CHANNEL.op).toBe('admin-update-media');
    expect(EDIT_CHANNEL.operationName).toBe('admin_editMedia');
    expect(GET_EVERY_CHANNEL.op).toBe('query-admin_getEveryMedia');
    expect(EDIT_CHANNEL.document).toContain('mutation admin_editMedia($mediaId: ID!, $input: admin_MediaInput!)');
    expect(GET_CHANNEL.document).toContain('query admin_getMedia($mediaId: ID!)');
  });
});

describe('ChannelFactory + ChannelBuilder', () => {
  it('clones the observed trolley channel and exposes exactly one activation', () => {
    const channel = ChannelFactory.create('inStoreTrolley');
    expect(channel.name).toBe('DD Trolleys');
    expect(channel.businessGroup).toBe('sainsburys');
    expect(channel.inStore).not.toBeNull();
    expect(channel.onSite).toBeNull();
    expect(channel.offSite).toBeNull();
    expect(channel.atHome).toBeNull();
    expect(channel.inStore?.cost.managedService?.pricingModels[0]?.cost).toBe(410);
  });

  it('changes ANY deep field via .set(path, value)', () => {
    const channel = ChannelFactory.inStoreTrolley()
      .set('inStore.cost.managedService.minimumSpend', 250)
      .set('inStore.cost.managedService.pricingModels[0].cost', 999)
      .set('inStore.timeline.bookingDeadlineDays', 30)
      .build();

    expect(channel.inStore?.cost.managedService?.minimumSpend).toBe(250);
    expect(channel.inStore?.cost.managedService?.pricingModels[0]?.cost).toBe(999);
    expect(channel.inStore?.timeline.bookingDeadlineDays).toBe(30);
  });

  it('merges a deep partial without dropping untouched fields', () => {
    const channel = ChannelFactory.inStoreTrolley()
      .merge({ name: 'DD Trolleys (QA)', inStore: { timeline: { creativeDeadlineDays: 14 } } })
      .build();

    expect(channel.name).toBe('DD Trolleys (QA)');
    expect(channel.inStore?.timeline.creativeDeadlineDays).toBe(14);
    // untouched sibling survives the merge
    expect(channel.inStore?.timeline.bookingDeadlineDays).toBe(49);
  });

  it('builds a minimal skeleton for each activation kind', () => {
    expect(ChannelFactory.create('inStore').inStore).not.toBeNull();
    expect(ChannelFactory.create('onSite').onSite).not.toBeNull();
    expect(ChannelFactory.create('offSite').offSite).not.toBeNull();
    expect(ChannelFactory.create('atHome').atHome).not.toBeNull();
  });

  it('rejects a build with missing required fields', () => {
    expect(() => ChannelBuilder.create().build()).toThrow(/missing required field/i);
  });

  it('rejects a build with zero or multiple activation surfaces', () => {
    expect(() =>
      ChannelBuilder.create().name('x').businessGroup('sainsburys').baseAssetType(1, 'A').build()
    ).toThrow(/exactly one activation/i);

    const twoActivations = ChannelFactory.inStoreTrolley();
    twoActivations.apply((draft) => {
      draft.onSite = { type: 'BANNER' };
    });
    expect(() => twoActivations.build()).toThrow(/exactly one activation/i);
  });

  it('projects a read model to writable input (drops server + output-only fields)', () => {
    const readModel: Channel = {
      ...ChannelFactory.create('inStoreTrolley'),
      id: '695e5ecda2034acce1334fc2',
      channelType: 'inStore',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-06-01T00:00:00Z'
    };
    // inject an output-only nested field that the write input must not carry
    (readModel.inStore as Record<string, unknown>).citrusAdPlacementLabel = 'should be stripped';

    const input = ChannelBuilder.toInput(readModel) as Record<string, unknown>;
    expect(input.id).toBeUndefined();
    expect(input.channelType).toBeUndefined();
    expect(input.createdAt).toBeUndefined();
    expect((input.inStore as Record<string, unknown>).citrusAdPlacementLabel).toBeUndefined();
    // a real field survives
    expect((input.inStore as Record<string, unknown>).type).toBe('TROLLEY');
  });
});

describe('deepMerge semantics', () => {
  it('replaces arrays and scalars but merges nested objects', () => {
    const merged = deepMerge(
      { a: 1, list: [1, 2, 3], nested: { keep: true, change: 1 } },
      { list: [9], nested: { change: 2 } }
    );
    expect(merged).toEqual({ a: 1, list: [9], nested: { keep: true, change: 2 } });
  });
});

describe('ChannelApi CRUD wiring (transport stub)', () => {
  const sampleChannel = (id: string): Channel => ({
    ...ChannelFactory.create('inStoreTrolley'),
    id
  });

  it('read -> change one field -> update sends admin_editMedia with the changed field', async () => {
    const transport = new RecordingTransport((op) => {
      if (op === GET_CHANNEL) return { admin_getMedia: sampleChannel('abc123') };
      if (op === EDIT_CHANNEL) return { admin_editMedia: { id: 'abc123' } };
      throw new Error(`unexpected op ${op.operationName}`);
    });
    const api = new ChannelApi(transport);

    await api.updateField('abc123', 'inStore.timeline.bookingDeadlineDays', 30);

    const edit = transport.calls.find((call) => call.operation === EDIT_CHANNEL);
    expect(edit).toBeDefined();
    expect(edit?.variables.mediaId).toBe('abc123');
    const input = edit?.variables.input as MediaInput;
    expect(input.inStore?.timeline.bookingDeadlineDays).toBe(30);
    // projected to input: no server id leaks into the write payload
    expect((input as unknown as Record<string, unknown>).id).toBeUndefined();
  });

  it('create posts admin_createMedia then reads the new id back', async () => {
    const transport = new RecordingTransport((op) => {
      if (op === CREATE_CHANNEL) return { admin_createMedia: { id: 'new-1' } };
      if (op === GET_CHANNEL) return { admin_getMedia: sampleChannel('new-1') };
      throw new Error(`unexpected op ${op.operationName}`);
    });
    const api = new ChannelApi(transport);

    const created = await api.create(ChannelFactory.create('inStoreTrolley'));
    expect(created.id).toBe('new-1');
    expect(transport.calls[0].operation).toBe(CREATE_CHANNEL);
    expect(transport.calls[1].operation).toBe(GET_CHANNEL);
  });

  it('getEvery sends all filter args (null when unset)', async () => {
    const transport = new RecordingTransport(() => ({ admin_getEveryMedia: [] }));
    const api = new ChannelApi(transport);

    await api.getEvery({ businessGroup: 'sainsburys', isVisible: true });

    expect(transport.calls[0].variables).toEqual({
      businessGroup: 'sainsburys',
      channelType: null,
      mediaType: null,
      isVisible: true,
      isVisibleArgos: null,
      planId: null
    });
  });

  it('delete sends admin_deleteMedia with the id', async () => {
    const transport = new RecordingTransport(() => ({ admin_deleteMedia: { id: 'gone' } }));
    const api = new ChannelApi(transport);

    const result = await api.delete('gone');
    expect(result.id).toBe('gone');
    expect(transport.calls[0].operation).toBe(DELETE_CHANNEL);
    expect(transport.calls[0].variables).toEqual({ mediaId: 'gone' });
  });
});
