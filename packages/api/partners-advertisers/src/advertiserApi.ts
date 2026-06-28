// Advertiser CRUD client (+ partner relationship).
//
// The read operations require a partnerId, so the client carries a default partner context
// (constructor option or env ADVERTISER_PARTNER_ID) that every method can override per call. The
// update mutation takes the FULL input, so "change any field" is read → modify → write:
//   - update(id, input)               full replace
//   - updateField(id, path, value)    change exactly one field, however deep
//   - patch(id, partial)              change any subset of fields (deep merge)
//   - edit(id, builder => ...)        change fields via an AdvertiserBuilder callback

import { AdvertiserBuilder } from './advertiserBuilder.js';
import {
  ASSIGN_ADVERTISER_TO_PARTNER,
  CREATE_ADVERTISER,
  DELETE_ADVERTISER,
  EDIT_ADVERTISER,
  GET_ADVERTISER,
  GET_ADVERTISERS,
  GET_COMPANIES,
  UNASSIGN_ADVERTISER_FROM_PARTNER
} from './operations.js';
import { resolveDefaultPartnerId, type GraphQLTransport } from './transport.js';
import type { Advertiser, AdvertiserInput, Company, DeepPartial } from './types.js';
import type { PathInput } from './deepObject.js';

export interface AdvertiserApiOptions {
  /** Default partner context for read operations (overridable per call). */
  partnerId?: string;
}

export class AdvertiserApi {
  private readonly defaultPartnerId?: string;

  constructor(
    private readonly transport: GraphQLTransport,
    options: AdvertiserApiOptions = {}
  ) {
    this.defaultPartnerId = options.partnerId ?? resolveDefaultPartnerId();
  }

  private requirePartnerId(partnerId?: string): string {
    const resolved = partnerId ?? this.defaultPartnerId;
    if (!resolved) {
      throw new Error(
        'A partnerId is required. Pass it to the method or set ADVERTISER_PARTNER_ID / the constructor option.'
      );
    }
    return resolved;
  }

  // --- CREATE (inferred op — verify admin_createAdvertiser against the schema) --------------------

  /** Create an advertiser and read it back (within the given/default partner context). */
  async create(input: AdvertiserInput, partnerId?: string): Promise<Advertiser> {
    const id = await this.createReturningId(input);
    return this.get(id, partnerId);
  }

  /** Create and return only the new id. */
  async createReturningId(input: AdvertiserInput): Promise<string> {
    const data = await this.transport.execute<{ admin_createAdvertiser: { id: string } }>(CREATE_ADVERTISER, {
      input
    });
    return data.admin_createAdvertiser.id;
  }

  // --- READ --------------------------------------------------------------------------------------

  /** Read a single advertiser by id within a partner context. */
  async get(advertiserId: string, partnerId?: string): Promise<Advertiser> {
    const data = await this.transport.execute<{ admin_getAdvertiser: Advertiser }>(GET_ADVERTISER, {
      advertiserId,
      partnerId: this.requirePartnerId(partnerId)
    });
    return data.admin_getAdvertiser;
  }

  /** Read every advertiser for a partner. */
  async list(partnerId?: string): Promise<Advertiser[]> {
    const data = await this.transport.execute<{ admin_getAdvertisers: Advertiser[] }>(GET_ADVERTISERS, {
      partnerId: this.requirePartnerId(partnerId)
    });
    return data.admin_getAdvertisers;
  }

  /** Find the first advertiser matching a predicate within a partner context. */
  async find(predicate: (advertiser: Advertiser) => boolean, partnerId?: string): Promise<Advertiser | undefined> {
    return (await this.list(partnerId)).find(predicate);
  }

  /** Supporting lookup: list base companies (id/name). */
  async getCompanies(): Promise<Company[]> {
    const data = await this.transport.execute<{ base_getCompanies: Company[] }>(GET_COMPANIES, {});
    return data.base_getCompanies;
  }

  // --- UPDATE (inferred op — verify admin_editAdvertiser against the schema) ----------------------

  /** Full replace: send a complete `AdvertiserInput` and read the advertiser back. */
  async update(advertiserId: string, input: AdvertiserInput, partnerId?: string): Promise<Advertiser> {
    const data = await this.transport.execute<{ admin_editAdvertiser: { id: string } }>(EDIT_ADVERTISER, {
      advertiserId,
      input
    });
    return this.get(data.admin_editAdvertiser.id, partnerId);
  }

  /** Change ANY single field by path (read → set → update). */
  async updateField(advertiserId: string, path: PathInput, value: unknown, partnerId?: string): Promise<Advertiser> {
    const current = await this.get(advertiserId, partnerId);
    const input = AdvertiserBuilder.from(current).set(path, value).build();
    return this.update(advertiserId, input, partnerId);
  }

  /** Change any subset of fields via a deep partial (read → deep-merge → update). */
  async patch(advertiserId: string, changes: DeepPartial<AdvertiserInput>, partnerId?: string): Promise<Advertiser> {
    const current = await this.get(advertiserId, partnerId);
    const input = AdvertiserBuilder.from(current).merge(changes).build();
    return this.update(advertiserId, input, partnerId);
  }

  /** Change fields through an AdvertiserBuilder callback (read → mutate builder → update). */
  async edit(advertiserId: string, mutate: (builder: AdvertiserBuilder) => void, partnerId?: string): Promise<Advertiser> {
    const current = await this.get(advertiserId, partnerId);
    const builder = AdvertiserBuilder.from(current);
    mutate(builder);
    return this.update(advertiserId, builder.build(), partnerId);
  }

  // --- DELETE (inferred op — verify admin_deleteAdvertiser against the schema) --------------------

  /** Delete an advertiser by id. */
  async delete(advertiserId: string): Promise<{ id: string }> {
    const data = await this.transport.execute<{ admin_deleteAdvertiser: { id: string } }>(DELETE_ADVERTISER, {
      advertiserId
    });
    return data.admin_deleteAdvertiser;
  }

  // --- PARTNER relationship ----------------------------------------------------------------------

  /** Assign an advertiser to an external partner (observed mutation). */
  async assignToPartner(advertiserId: string, partnerId?: string): Promise<{ id: string }> {
    const data = await this.transport.execute<{ admin_assignAdvertiserToExternalPartner: { id: string } }>(
      ASSIGN_ADVERTISER_TO_PARTNER,
      { advertiserId, partnerId: this.requirePartnerId(partnerId) }
    );
    return data.admin_assignAdvertiserToExternalPartner;
  }

  /** Unassign an advertiser from a partner (INFERRED inverse mutation — verify before use). */
  async unassignFromPartner(advertiserId: string, partnerId?: string): Promise<{ id: string }> {
    const data = await this.transport.execute<{ admin_unassignAdvertiserFromExternalPartner: { id: string } }>(
      UNASSIGN_ADVERTISER_FROM_PARTNER,
      { advertiserId, partnerId: this.requirePartnerId(partnerId) }
    );
    return data.admin_unassignAdvertiserFromExternalPartner;
  }
}
