// Verbatim GraphQL documents for Pollen Partners/Advertisers management.
// Source of truth: Partners-advertisers.har, captured against
//   POST https://www.dev.pollen.js-devops.co.uk/api/graphql/?op=<op>
//
// OBSERVED in the capture (do not change without re-capturing):
//   admin_getAdvertisers, admin_getAdvertiser, admin_assignAdvertiserToExternalPartner, base_getCompanies
// CREATE / UPDATE / DELETE / UNASSIGN were NOT present in the capture — their documents below are
// INFERRED from the observed naming convention and MUST be verified against the live GraphQL schema
// before use (the AdvertiserInput shape is likewise inferred from the read selection).

// READ list — observed op `admin_getAdvertisers` (advertisers belonging to a partner).
export const ADMIN_GET_ADVERTISERS = `query  admin_getAdvertisers($partnerId: ID!) {
        admin_getAdvertisers(partnerId: $partnerId) {
            id
            displayName
            createdAt
            businessGroup
            activeChannels
            customName
            brands {
              customName
              displayName
              id
            }
            baseCompanyId
        }
      }`;

// READ one — observed op `admin_getAdvertiser` (full advertiser detail).
export const ADMIN_GET_ADVERTISER = `query  admin_getAdvertiser($advertiserId: ID!, $partnerId: ID!) {
        admin_getAdvertiser(advertiserId: $advertiserId, partnerId: $partnerId) {
  id
  displayName
  customName
  createdAt
  businessGroup
  activeChannels
  brands {
    displayName
    id
    availableChannels
  }
  baseCompanyId
  level2ReportingEnabled
  newBusinessClient
  strategicClient
  websiteUrl
  goldClient
  planningPriorityClient
  sipAccess
  sainsburysGSA
  futureBrand
  agencyBaseAdvertiserMapper {
    partnerId
    partnerName
    baseId
  }
  clientAgreement
  clientAgreementDocument {
    actualFilename
    internalFilename
  }
        }
      }`;

// ASSIGN advertiser to an external partner — observed op `admin_assignAdvertiserToExternalPartner`.
export const ADMIN_ASSIGN_ADVERTISER_TO_PARTNER = `mutation admin_assignAdvertiserToExternalPartner($advertiserId: ID!,$partnerId: ID!){
        admin_assignAdvertiserToExternalPartner(advertiserId: $advertiserId, partnerId: $partnerId){
          id
        }
      }`;

// Supporting lookup — observed op `base_getCompanies` (id/name of base companies).
export const BASE_GET_COMPANIES = `query base_getCompanies {
      base_getCompanies {
        id
        name
      }
    }`;

// CREATE — INFERRED (not in capture). Verify mutation name + AdvertiserInput shape against the schema.
export const ADMIN_CREATE_ADVERTISER = `mutation admin_createAdvertiser($input: admin_AdvertiserInput!) {
  admin_createAdvertiser(input: $input) {
    id
  }
}`;

// UPDATE — INFERRED (not in capture). Verify mutation name + AdvertiserInput shape against the schema.
export const ADMIN_EDIT_ADVERTISER = `mutation admin_editAdvertiser($advertiserId: ID!, $input: admin_AdvertiserInput!) {
  admin_editAdvertiser(advertiserId: $advertiserId, input: $input) {
    id
  }
}`;

// DELETE — INFERRED (not in capture). Verify mutation name + return shape against the schema.
export const ADMIN_DELETE_ADVERTISER = `mutation admin_deleteAdvertiser($advertiserId: ID!) {
  admin_deleteAdvertiser(advertiserId: $advertiserId) {
    id
  }
}`;

// UNASSIGN advertiser from a partner — INFERRED (inverse of the observed assign mutation).
export const ADMIN_UNASSIGN_ADVERTISER_FROM_PARTNER = `mutation admin_unassignAdvertiserFromExternalPartner($advertiserId: ID!, $partnerId: ID!) {
  admin_unassignAdvertiserFromExternalPartner(advertiserId: $advertiserId, partnerId: $partnerId) {
    id
  }
}`;
