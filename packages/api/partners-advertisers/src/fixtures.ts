// Reference advertiser payloads. The capture did not include response bodies, so this is a
// representative AdvertiserInput built from the observed read selection + captured ids. Use it as a
// realistic factory seed; adjust field values to match your environment's data.

import type { AdvertiserInput } from './types.js';

/** Ids observed in the capture (handy for live read tests). */
export const OBSERVED_ADVERTISER_ID = '5f9ff4589a3425000931293a';
export const OBSERVED_PARTNER_ID = '6a1eceda422c9d574e7e69af';

export const SAMPLE_ADVERTISER: AdvertiserInput = {
  displayName: 'Sample Advertiser',
  customName: 'Sample Advertiser (QA)',
  businessGroup: 'sainsburys',
  websiteUrl: 'https://example.com',
  baseCompanyId: null,
  level2ReportingEnabled: false,
  newBusinessClient: false,
  strategicClient: false,
  goldClient: false,
  planningPriorityClient: false,
  sipAccess: false,
  sainsburysGSA: false,
  futureBrand: false,
  clientAgreement: null,
  clientAgreementDocument: null,
  brands: [
    { displayName: 'Sample Brand', customName: 'Sample Brand (QA)' }
  ]
};
