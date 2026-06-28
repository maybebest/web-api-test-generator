import { describe, expect, it } from 'vitest';
import {
  ADVERTISER_OPERATIONS,
  AdvertiserApi,
  AdvertiserBuilder,
  AdvertiserFactory,
  ASSIGN_ADVERTISER_TO_PARTNER,
  CREATE_ADVERTISER,
  DELETE_ADVERTISER,
  EDIT_ADVERTISER,
  GET_ADVERTISER,
  GET_ADVERTISERS,
  deepMerge,
  type Advertiser,
  type AdvertiserInput,
  type AdvertiserOperation,
  type GraphQLTransport
} from '../../partners-advertisers/src/index.js';

class RecordingTransport implements GraphQLTransport {
  readonly calls: Array<{ operation: AdvertiserOperation; variables: Record<string, unknown> }> = [];
  constructor(private readonly responder: (op: AdvertiserOperation, vars: Record<string, unknown>) => unknown) {}
  async execute<TData>(operation: AdvertiserOperation, variables: Record<string, unknown>): Promise<TData> {
    this.calls.push({ operation, variables });
    return this.responder(operation, variables) as TData;
  }
}

describe('advertiser operations registry', () => {
  it('marks read/list/assign as observed and create/update/delete/unassign as inferred', () => {
    expect(GET_ADVERTISER.observed).toBe(true);
    expect(GET_ADVERTISERS.observed).toBe(true);
    expect(ASSIGN_ADVERTISER_TO_PARTNER.observed).toBe(true);
    expect(CREATE_ADVERTISER.observed).toBe(false);
    expect(EDIT_ADVERTISER.observed).toBe(false);
    expect(DELETE_ADVERTISER.observed).toBe(false);
  });

  it('uses the captured operationNames and documents', () => {
    expect(GET_ADVERTISERS.document).toContain('query  admin_getAdvertisers($partnerId: ID!)');
    expect(GET_ADVERTISER.document).toContain('admin_getAdvertiser(advertiserId: $advertiserId, partnerId: $partnerId)');
    expect(ASSIGN_ADVERTISER_TO_PARTNER.document).toContain('admin_assignAdvertiserToExternalPartner');
    expect(ADVERTISER_OPERATIONS.length).toBe(8);
  });
});

describe('AdvertiserFactory + AdvertiserBuilder', () => {
  it('builds a sample advertiser with the required displayName', () => {
    const advertiser = AdvertiserFactory.create('sample');
    expect(advertiser.displayName).toBe('Sample Advertiser');
    expect(advertiser.businessGroup).toBe('sainsburys');
  });

  it('changes ANY field via .set(path, value), including nested brands', () => {
    const advertiser = AdvertiserFactory.sample()
      .set('goldClient', true)
      .set('brands[0].displayName', 'Renamed Brand')
      .set('websiteUrl', 'https://changed.example.com')
      .build();

    expect(advertiser.goldClient).toBe(true);
    expect(advertiser.brands?.[0]?.displayName).toBe('Renamed Brand');
    expect(advertiser.websiteUrl).toBe('https://changed.example.com');
  });

  it('merges a deep partial without dropping untouched fields', () => {
    const advertiser = AdvertiserFactory.sample()
      .merge({ strategicClient: true, brands: [{ displayName: 'Only Brand' }] })
      .build();
    expect(advertiser.strategicClient).toBe(true);
    expect(advertiser.brands).toEqual([{ displayName: 'Only Brand' }]);
    // untouched field survives
    expect(advertiser.displayName).toBe('Sample Advertiser');
  });

  it('rejects a build with missing displayName', () => {
    expect(() => AdvertiserBuilder.create().build()).toThrow(/displayName/i);
  });

  it('projects a read model to writable input (drops server + output-only fields)', () => {
    const readModel: Advertiser = {
      ...AdvertiserFactory.create('sample'),
      id: '5f9ff4589a3425000931293a',
      createdAt: '2026-01-01T00:00:00Z',
      activeChannels: 3,
      agencyBaseAdvertiserMapper: [{ partnerId: 'p', partnerName: 'P', baseId: 'b' }],
      brands: [{ id: 'b1', displayName: 'Brand', availableChannels: ['inStore'] }]
    };

    const input = AdvertiserBuilder.toInput(readModel) as Record<string, unknown>;
    expect(input.id).toBeUndefined();
    expect(input.createdAt).toBeUndefined();
    expect(input.activeChannels).toBeUndefined();
    expect(input.agencyBaseAdvertiserMapper).toBeUndefined();
    expect((input.brands as Array<Record<string, unknown>>)[0].availableChannels).toBeUndefined();
    expect((input.brands as Array<Record<string, unknown>>)[0].displayName).toBe('Brand');
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

describe('AdvertiserApi CRUD wiring (transport stub)', () => {
  const sample = (id: string): Advertiser => ({
    ...AdvertiserFactory.create('sample'),
    id,
    brands: [{ id: 'brand-1', displayName: 'Sample Brand' }]
  });
  const partnerId = '6a1eceda422c9d574e7e69af';

  it('read -> change one field -> update sends admin_editAdvertiser with the changed field', async () => {
    const transport = new RecordingTransport((op) => {
      if (op === GET_ADVERTISER) return { admin_getAdvertiser: sample('adv1') };
      if (op === EDIT_ADVERTISER) return { admin_editAdvertiser: { id: 'adv1' } };
      throw new Error(`unexpected op ${op.operationName}`);
    });
    const api = new AdvertiserApi(transport, { partnerId });

    await api.updateField('adv1', 'goldClient', true);

    const edit = transport.calls.find((call) => call.operation === EDIT_ADVERTISER);
    expect(edit?.variables.advertiserId).toBe('adv1');
    const input = edit?.variables.input as AdvertiserInput;
    expect(input.goldClient).toBe(true);
    expect((input as unknown as Record<string, unknown>).id).toBeUndefined();
  });

  it('list/get require and forward the partnerId', async () => {
    const transport = new RecordingTransport((op) =>
      op === GET_ADVERTISERS ? { admin_getAdvertisers: [] } : { admin_getAdvertiser: sample('x') }
    );
    const api = new AdvertiserApi(transport, { partnerId });

    await api.list();
    await api.get('x');
    expect(transport.calls[0].variables).toEqual({ partnerId });
    expect(transport.calls[1].variables).toEqual({ advertiserId: 'x', partnerId });
  });

  it('throws a clear error when no partnerId is available', async () => {
    const transport = new RecordingTransport(() => ({ admin_getAdvertisers: [] }));
    const api = new AdvertiserApi(transport, {});
    await expect(api.list()).rejects.toThrow(/partnerId is required/i);
  });

  it('assignToPartner sends the observed mutation with both ids', async () => {
    const transport = new RecordingTransport(() => ({ admin_assignAdvertiserToExternalPartner: { id: 'adv1' } }));
    const api = new AdvertiserApi(transport, { partnerId });

    const result = await api.assignToPartner('adv1');
    expect(result.id).toBe('adv1');
    expect(transport.calls[0].operation).toBe(ASSIGN_ADVERTISER_TO_PARTNER);
    expect(transport.calls[0].variables).toEqual({ advertiserId: 'adv1', partnerId });
  });

  it('delete sends admin_deleteAdvertiser with the id', async () => {
    const transport = new RecordingTransport(() => ({ admin_deleteAdvertiser: { id: 'gone' } }));
    const api = new AdvertiserApi(transport, { partnerId });

    const result = await api.delete('gone');
    expect(result.id).toBe('gone');
    expect(transport.calls[0].operation).toBe(DELETE_ADVERTISER);
    expect(transport.calls[0].variables).toEqual({ advertiserId: 'gone' });
  });
});
