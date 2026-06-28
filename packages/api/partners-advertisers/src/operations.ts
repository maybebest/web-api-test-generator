// The full list of GraphQL API calls to manage advertisers (CRUD) and their partner relationship.
//
// All calls are POSTs to the single GraphQL endpoint, distinguished by the ?op= query param the SPA
// attaches:  POST https://www.dev.pollen.js-devops.co.uk/api/graphql/?op=<op>
//
//   CRUD      | op (?op=)                                  | observed in HAR?
//   ----------+--------------------------------------------+------------------
//   create    | admin_createAdvertiser                     | NO  (inferred)
//   read      | admin_getAdvertiser                        | yes
//   readList  | admin_getAdvertisers                       | yes
//   update    | admin_editAdvertiser                       | NO  (inferred)
//   delete    | admin_deleteAdvertiser                     | NO  (inferred)
//   assign    | admin_assignAdvertiserToExternalPartner    | yes
//   unassign  | admin_unassignAdvertiserFromExternalPartner| NO  (inferred)
//   companies | base_getCompanies                          | yes (lookup)

import {
  ADMIN_ASSIGN_ADVERTISER_TO_PARTNER,
  ADMIN_CREATE_ADVERTISER,
  ADMIN_DELETE_ADVERTISER,
  ADMIN_EDIT_ADVERTISER,
  ADMIN_GET_ADVERTISER,
  ADMIN_GET_ADVERTISERS,
  ADMIN_UNASSIGN_ADVERTISER_FROM_PARTNER,
  BASE_GET_COMPANIES
} from './documents.js';

export const ADVERTISER_DEFAULT_BASE_URL = 'https://www.dev.pollen.js-devops.co.uk';
export const ADVERTISER_ENDPOINT_PATH = '/api/graphql/';

export type CrudRole =
  | 'create'
  | 'read'
  | 'readList'
  | 'update'
  | 'delete'
  | 'assign'
  | 'unassign'
  | 'lookup';

export interface AdvertiserOperation {
  /** Value of the `?op=` query param the SPA sends for this call. */
  op: string;
  /** GraphQL operationName sent in the request body. */
  operationName: string;
  /** The GraphQL document text. */
  document: string;
  kind: 'query' | 'mutation';
  crud: CrudRole;
  /** true = seen verbatim in the HAR; false = inferred from naming convention, verify first. */
  observed: boolean;
}

export const CREATE_ADVERTISER: AdvertiserOperation = {
  op: 'admin_createAdvertiser',
  operationName: 'admin_createAdvertiser',
  document: ADMIN_CREATE_ADVERTISER,
  kind: 'mutation',
  crud: 'create',
  observed: false
};

export const GET_ADVERTISER: AdvertiserOperation = {
  op: 'admin_getAdvertiser',
  operationName: 'admin_getAdvertiser',
  document: ADMIN_GET_ADVERTISER,
  kind: 'query',
  crud: 'read',
  observed: true
};

export const GET_ADVERTISERS: AdvertiserOperation = {
  op: 'admin_getAdvertisers',
  operationName: 'admin_getAdvertisers',
  document: ADMIN_GET_ADVERTISERS,
  kind: 'query',
  crud: 'readList',
  observed: true
};

export const EDIT_ADVERTISER: AdvertiserOperation = {
  op: 'admin_editAdvertiser',
  operationName: 'admin_editAdvertiser',
  document: ADMIN_EDIT_ADVERTISER,
  kind: 'mutation',
  crud: 'update',
  observed: false
};

export const DELETE_ADVERTISER: AdvertiserOperation = {
  op: 'admin_deleteAdvertiser',
  operationName: 'admin_deleteAdvertiser',
  document: ADMIN_DELETE_ADVERTISER,
  kind: 'mutation',
  crud: 'delete',
  observed: false
};

export const ASSIGN_ADVERTISER_TO_PARTNER: AdvertiserOperation = {
  op: 'admin_assignAdvertiserToExternalPartner',
  operationName: 'admin_assignAdvertiserToExternalPartner',
  document: ADMIN_ASSIGN_ADVERTISER_TO_PARTNER,
  kind: 'mutation',
  crud: 'assign',
  observed: true
};

export const UNASSIGN_ADVERTISER_FROM_PARTNER: AdvertiserOperation = {
  op: 'admin_unassignAdvertiserFromExternalPartner',
  operationName: 'admin_unassignAdvertiserFromExternalPartner',
  document: ADMIN_UNASSIGN_ADVERTISER_FROM_PARTNER,
  kind: 'mutation',
  crud: 'unassign',
  observed: false
};

export const GET_COMPANIES: AdvertiserOperation = {
  op: 'base_getCompanies',
  operationName: 'base_getCompanies',
  document: BASE_GET_COMPANIES,
  kind: 'query',
  crud: 'lookup',
  observed: true
};

/** Every advertiser operation. */
export const ADVERTISER_OPERATIONS: readonly AdvertiserOperation[] = [
  CREATE_ADVERTISER,
  GET_ADVERTISER,
  GET_ADVERTISERS,
  EDIT_ADVERTISER,
  DELETE_ADVERTISER,
  ASSIGN_ADVERTISER_TO_PARTNER,
  UNASSIGN_ADVERTISER_FROM_PARTNER,
  GET_COMPANIES
];
