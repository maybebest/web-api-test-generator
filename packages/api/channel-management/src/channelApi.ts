// Channel CRUD client.
//
// One method per CRUD operation, plus three "change any field" update helpers built on a
// read-modify-write cycle (the update mutation takes the FULL input, so changing one field means
// read the channel, project it to input, change the field, send it back):
//   - update(id, input)            full replace
//   - updateField(id, path, value) change exactly one field, however deep
//   - patch(id, partialChannel)    change any subset of fields (deep merge)
//   - edit(id, builder => ...)     change fields via a ChannelBuilder callback

import { ChannelBuilder } from './channelBuilder.js';
import {
  CREATE_CHANNEL,
  DELETE_CHANNEL,
  EDIT_CHANNEL,
  GET_CHANNEL,
  GET_EVERY_CHANNEL
} from './operations.js';
import type { GraphQLTransport } from './transport.js';
import type { Channel, DeepPartial, MediaInput } from './types.js';
import type { PathInput } from './deepObject.js';

export interface ChannelListFilter {
  businessGroup?: string;
  /** ChannelActivation enum value, e.g. 'inStore' | 'onSite' | 'offSite' | 'atHome'. */
  channelType?: string;
  mediaType?: string;
  isVisible?: boolean;
  isVisibleArgos?: boolean;
  planId?: string;
}

export class ChannelApi {
  constructor(private readonly transport: GraphQLTransport) {}

  // --- CREATE (inferred op — verify admin_createMedia against the schema) -------------------------

  /** Create a channel and return the freshly-read entity. */
  async create(input: MediaInput): Promise<Channel> {
    const data = await this.transport.execute<{ admin_createMedia: { id: string } }>(CREATE_CHANNEL, {
      input
    });
    return this.get(data.admin_createMedia.id);
  }

  /** Create and return only the new id (skips the follow-up read). */
  async createReturningId(input: MediaInput): Promise<string> {
    const data = await this.transport.execute<{ admin_createMedia: { id: string } }>(CREATE_CHANNEL, {
      input
    });
    return data.admin_createMedia.id;
  }

  // --- READ --------------------------------------------------------------------------------------

  /** Read a single channel by id (full field selection). */
  async get(id: string): Promise<Channel> {
    const data = await this.transport.execute<{ admin_getMedia: Channel }>(GET_CHANNEL, {
      mediaId: id
    });
    return data.admin_getMedia;
  }

  /** Read every channel, optionally filtered. Unset filters are sent as null. */
  async getEvery(filter: ChannelListFilter = {}): Promise<Channel[]> {
    const data = await this.transport.execute<{ admin_getEveryMedia: Channel[] }>(GET_EVERY_CHANNEL, {
      businessGroup: filter.businessGroup ?? null,
      channelType: filter.channelType ?? null,
      mediaType: filter.mediaType ?? null,
      isVisible: filter.isVisible ?? null,
      isVisibleArgos: filter.isVisibleArgos ?? null,
      planId: filter.planId ?? null
    });
    return data.admin_getEveryMedia;
  }

  /** Convenience: find the first channel matching a predicate across the (filtered) list. */
  async find(predicate: (channel: Channel) => boolean, filter?: ChannelListFilter): Promise<Channel | undefined> {
    return (await this.getEvery(filter)).find(predicate);
  }

  // --- UPDATE ------------------------------------------------------------------------------------

  /** Full replace: send a complete `MediaInput` to admin_editMedia and return the updated channel. */
  async update(id: string, input: MediaInput): Promise<Channel> {
    const data = await this.transport.execute<{ admin_editMedia: { id: string } }>(EDIT_CHANNEL, {
      mediaId: id,
      input
    });
    return this.get(data.admin_editMedia.id);
  }

  /** Change ANY single field by path (read → set → update). */
  async updateField(id: string, path: PathInput, value: unknown): Promise<Channel> {
    const current = await this.get(id);
    const input = ChannelBuilder.from(current).set(path, value).build();
    return this.update(id, input);
  }

  /** Change any subset of fields via a deep partial (read → deep-merge → update). */
  async patch(id: string, changes: DeepPartial<MediaInput>): Promise<Channel> {
    const current = await this.get(id);
    const input = ChannelBuilder.from(current).merge(changes).build();
    return this.update(id, input);
  }

  /** Change fields through a ChannelBuilder callback (read → mutate builder → update). */
  async edit(id: string, mutate: (builder: ChannelBuilder) => void): Promise<Channel> {
    const current = await this.get(id);
    const builder = ChannelBuilder.from(current);
    mutate(builder);
    return this.update(id, builder.build());
  }

  // --- DELETE (inferred op — verify admin_deleteMedia against the schema) -------------------------

  /** Delete a channel by id. */
  async delete(id: string): Promise<{ id: string }> {
    const data = await this.transport.execute<{ admin_deleteMedia: { id: string } }>(DELETE_CHANNEL, {
      mediaId: id
    });
    return data.admin_deleteMedia;
  }
}
