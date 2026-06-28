// Reference channel payloads. OBSERVED_TROLLEY_CHANNEL is the exact `admin_MediaInput` sent by
// admin_editMedia in the Channel-management HAR (the "DD Trolleys" in-store channel). It is the
// seed the factory clones for a realistic, fully-populated channel.

import type { MediaInput } from './types.js';

export const OBSERVED_TROLLEY_CHANNEL: MediaInput = {
  baseAssetType: {
    id: 1982,
    name: 'Trolleys'
  },
  businessGroup: 'sainsburys',
  description:
    "Communicate with the Sainsbury's customer throughout their shopping trip, by advertising on panels on the inside and outside of trolleys ensuring your brand is at the front of the shoppers' mind.",
  isManagedService: true,
  isSelfServe: false,
  isVisible: true,
  isVisibleArgos: false,
  isVisibleToInternalOnly: false,
  isIncrementalFundingAvailable: null,
  name: 'DD Trolleys',
  secondaryDescription: '',
  offSite: null,
  onSite: null,
  atHome: null,
  inStore: {
    type: 'TROLLEY',
    isCmsBroadsignMedia: null,
    storeType: 'MAIN_ESTATE',
    subType: 'MAIN',
    isTargetedChannel: false,
    audienceAndTargeting: {
      minAudienceVolume: null,
      maxAudienceVolume: null,
      minStoreVolume: 10,
      maxStoreVolume: 351,
      hasHFSSRestrictions: true,
      restrictedCategories: ['BWS'],
      shouldApplyToEverywhereRanged: false,
      hasSetStoreList: false,
      whoCanBuildTargeting: 'ALL_USERS',
      isPollenTargetingRequired: true,
      canClientSetPreferentialStoreList: true
    },
    cost: {
      selfServe: null,
      managedService: {
        minimumSpend: 0,
        managedServiceFee: {
          type: 'NONE',
          value: 0
        },
        pricingModels: [
          {
            pricingModel: 'COST_PER_UNIT_STORE_VOLUME_DEPENDENT',
            cost: 410,
            costStoreVolume: [
              { pricingCondition: 'LESS_THAN', quantity: 200, maxQuantity: 1, cost: 2 },
              { pricingCondition: 'BETWEEN', quantity: 200, maxQuantity: 300, cost: 3 },
              { pricingCondition: 'MORE_THAN', quantity: 300, maxQuantity: 1, cost: 4 }
            ],
            numberOfWeeks: null
          }
        ]
      }
    },
    timeline: {
      minCampaignDurationDays: null,
      bookingDeadlineDays: 49,
      targetingDeadlineDays: null,
      creativeDeadlineDays: 21,
      lateBookingDeadlineDays: null
    },
    setup: {
      maxHeroSKUs: 5,
      minHeroSKUs: 1,
      totalSKUs: null,
      ABTestingOptions: [],
      maxFileSize: { value: null, unit: null }
    },
    creative: {
      channelSpecsLink: 'https://www.dev.rtd.js-devops.co.uk/',
      contentHubLink: 'https://www.dev.rtd.js-devops.co.uk/',
      exampleImage: {
        actualFilename: '2026-01-07_13h35_17.png',
        internalFilename: '2026-01-07T13:25:30.334Z_zbAhrymD0cbwtr6cGXRQw_2026-01-07_13h35_17.png'
      }
    },
    planningQuestions: {
      showFoodGroupAndCycleToInternal: true,
      showFoodGroupAndCycleToExternal: false,
      showFoodGroupAndCycleMultiSelectionToInternal: false,
      showFoodGroupAndCycleMultiSelectionToExternal: false,
      showBackToBackCycleToInternal: false,
      showBackToBackCycleToExternal: false,
      showABTestingToInternal: false,
      showABTestingToExternal: false,
      showBudgetToInternal: false,
      showBudgetToExternal: false
    },
    piggyBackAssets: null
  }
};
