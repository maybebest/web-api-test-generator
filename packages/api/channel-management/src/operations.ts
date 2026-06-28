// The full list of GraphQL API calls to manage a channel (CRUD).
//
// All calls are POSTs to the single GraphQL endpoint, distinguished by the ?op= query param that
// the SPA attaches (kept here so generated traffic matches the real app):
//   POST https://www.dev.pollen.js-devops.co.uk/api/graphql/?op=<op>
//
//   CRUD     | op (?op=)                    | operationName        | observed in HAR?
//   ---------+------------------------------+----------------------+------------------
//   create   | admin-create-media           | admin_createMedia    | NO  (inferred)
//   read     | admin_getMedia               | admin_getMedia       | yes
//   readList | query-admin_getEveryMedia    | admin_getEveryMedia  | yes
//   update   | admin-update-media           | admin_editMedia      | yes
//   delete   | admin-delete-media           | admin_deleteMedia    | NO  (inferred)

import {
  ADMIN_CREATE_MEDIA,
  ADMIN_DELETE_MEDIA,
  ADMIN_EDIT_MEDIA,
  ADMIN_GET_EVERY_MEDIA,
  ADMIN_GET_MEDIA
} from './documents.js';

export const CHANNEL_DEFAULT_BASE_URL = 'https://www.dev.pollen.js-devops.co.uk';
export const CHANNEL_ENDPOINT_PATH = '/api/graphql/';

export type CrudRole = 'create' | 'read' | 'readList' | 'update' | 'delete';

export interface ChannelOperation {
  /** Value of the `?op=` query param the SPA sends for this call. */
  op: string;
  /** GraphQL operationName sent in the request body. */
  operationName: string;
  /** The GraphQL document (query/mutation text). */
  document: string;
  kind: 'query' | 'mutation';
  /** Where this operation sits in CRUD. */
  crud: CrudRole;
  /** true = seen verbatim in the HAR; false = inferred from the naming convention, verify first. */
  observed: boolean;
}

export const CREATE_CHANNEL: ChannelOperation = {
  op: 'admin-create-media',
  operationName: 'admin_createMedia',
  document: ADMIN_CREATE_MEDIA,
  kind: 'mutation',
  crud: 'create',
  observed: false
};

export const GET_CHANNEL: ChannelOperation = {
  op: 'admin_getMedia',
  operationName: 'admin_getMedia',
  document: ADMIN_GET_MEDIA,
  kind: 'query',
  crud: 'read',
  observed: true
};

export const GET_EVERY_CHANNEL: ChannelOperation = {
  op: 'query-admin_getEveryMedia',
  operationName: 'admin_getEveryMedia',
  document: ADMIN_GET_EVERY_MEDIA,
  kind: 'query',
  crud: 'readList',
  observed: true
};

export const EDIT_CHANNEL: ChannelOperation = {
  op: 'admin-update-media',
  operationName: 'admin_editMedia',
  document: ADMIN_EDIT_MEDIA,
  kind: 'mutation',
  crud: 'update',
  observed: true
};

export const DELETE_CHANNEL: ChannelOperation = {
  op: 'admin-delete-media',
  operationName: 'admin_deleteMedia',
  document: ADMIN_DELETE_MEDIA,
  kind: 'mutation',
  crud: 'delete',
  observed: false
};

/** Every channel operation, ordered create → read → readList → update → delete. */
export const CHANNEL_OPERATIONS: readonly ChannelOperation[] = [
  CREATE_CHANNEL,
  GET_CHANNEL,
  GET_EVERY_CHANNEL,
  EDIT_CHANNEL,
  DELETE_CHANNEL
];
