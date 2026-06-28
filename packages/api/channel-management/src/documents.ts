// Verbatim GraphQL documents for Pollen "channel" management (a channel == a `media` entity).
// Source of truth: Channel-management.har, captured against
//   POST https://www.dev.pollen.js-devops.co.uk/api/graphql/?op=<op>
//
// OBSERVED in the capture (do not change without re-capturing): admin_getMedia, admin_getEveryMedia,
// admin_editMedia. CREATE and DELETE were NOT present in the capture — their documents below are
// INFERRED from the observed naming convention (admin_editMedia -> admin_createMedia /
// admin_deleteMedia) and MUST be verified against the live GraphQL schema before use.
//
// This file is generated/extracted; the field selection is the full observed read contract.

/** Full `media` field selection observed in admin_getMedia (the complete read contract). */
export const CHANNEL_DETAIL_FIELDS = `
    id
    name
    businessGroup
    baseAssetType {
      id
      name
    }
    isSelfServe
    isManagedService
    description
    secondaryDescription
    isVisible
    isVisibleArgos
    isVisibleToInternalOnly
    isIncrementalFundingAvailable
    onSite {
      #graphql
      type
      isTargetedChannel
      citrusAdPlacement
      citrusAdPlacementLabel
      audienceAndTargeting {
        maxAudienceVolume
        minAudienceVolume
        isAudienceTargetingAvailable
        isMediaPartOfEMP
        hasHFSSRestrictions
        restrictedCategories
        whoCanBuildTargeting
        isPollenTargetingRequired
      }
      cost {
        selfServe {
          minimumSpend
          pricingModels {
            pricingModel
            cost
          }
        }
        managedService {
          minimumSpend
          pricingModels {
            pricingModel
            cost
          }
          managedServiceFee {
            type
            value
          }
        }
        tierBasedOnVolumeImpressions
        tierBasedCategories {
          tier
          discount
          categories
        }
      }
      timeline {
        minCampaignDurationDays
        bookingDeadlineDays
        targetingDeadlineDays
        creativeDeadlineDays
        lateBookingDeadlineDays
      }
      setup {
        maxHeroSKUs
        minHeroSKUs
        totalSKUs
        ABTestingOptions
        maxFileSize {
          value
          unit
        }
      }
      creative {
        exampleImage {
          internalFilename
          actualFilename
        }
        contentHubLink
        channelSpecsLink
      }
      planningQuestions {
        showBudgetToInternal
        showBudgetToExternal
        showLiveDatesToInternal
        showLiveDatesToExternal
        showABTestingToInternal
        showABTestingToExternal
        showIsThisPromoLedToInternal
        showIsThisPromoLedToExternal
        showPartOfferToInternal
        showPartOfferToExternal
        showLaunchToInternal
        showLaunchToExternal
        showComplianceMessagingToInternal
        showComplianceMessagingToExternal
        showExistingUrlLinkToInternal
        showExistingUrlLinkToExternal
        showAssetMarketingClaimToInternal
        showAssetMarketingClaimToExternal
      }
      eCouponQuestions {
        showInclusiveBudgetToInternal
        showInclusiveBudgetToExternal
        showRedemptionCostToInternal
        showRedemptionCostToExternal
        skuOnNectarPriceInternal
        skuOnNectarPriceExternal
        skuOnNectarPriceInternal2
        skuOnNectarPriceExternal2
        selectFoodGroupAndCycleNoToInternal
        selectFoodGroupAndCycleNoToExternal
        pointsToGiveOffInternal
        pointsToGiveOffExternal
      }

    }
    offSite {
      #graphql
      type
      provider
      audienceAndTargeting {
        hasHFSSRestrictions
        restrictedCategories
        isPollenTargetingRequired
        whoCanBuildTargeting
        maxAudienceVolume
        minAudienceVolume
        matchRate
      }
      cost {
        selfServe {
          pricingModel
          cost
          fixedMediaRunTimeWeeks
          minimumSpend
        }
        managedService {
          pricingModel
          cost
          fixedMediaRunTimeWeeks
          minimumSpend
          managedServiceFee {
            type
            value
          }
        }
      }
      timeline {
        minCampaignDurationDays
        bookingDeadlineDays
        targetingDeadlineDays
        creativeDeadlineDays
        lateBookingDeadlineDays
      }
      setup {
        maxHeroSKUs
        minHeroSKUs
        totalSKUs
        ABTestingOptions
        maxFileSize {
          value
          unit
        }
      }
      creative {
        exampleImage {
          internalFilename
          actualFilename
        }
        contentHubLink
        channelSpecsLink
      }
      planningQuestions {
        showBudgetToInternal
        showBudgetToExternal
        showLiveDatesToInternal
        showLiveDatesToExternal
        showABTestingToInternal
        showABTestingToExternal
        showAssetMarketingClaimToExternal
        showAssetMarketingClaimToInternal
        showComplianceMessagingToExternal
        showComplianceMessagingToInternal
        showLaunchToInternal
        showLaunchToExternal
        showPartOfferToExternal
        showPartOfferToInternal
        showSplitCampaignToExternal
        showSplitCampaignToInternal
      }

    }
    inStore {
      type
      storeType
      storeLocation
      subType
      templateType
      isTargetedChannel
      isCmsBroadsignMedia
      selectedCmsScreenTypeId
      cost {
        selfServe {
          minimumSpend
          pricingModels {
            pricingModel
            cost
            costStoreVolume {
              pricingCondition
              quantity
              maxQuantity
              cost
            }
            numberOfWeeks
          }
        }
        managedService {
          minimumSpend
          managedServiceFee {
            type
            value
          }
          pricingModels {
            pricingModel
            cost
            costStoreVolume {
              pricingCondition
              quantity
              maxQuantity
              cost
            }
              numberOfWeeks
          }
        }
      }
      audienceAndTargeting {
        minAudienceVolume
        maxAudienceVolume
        minStoreVolume
        maxStoreVolume
        hasHFSSRestrictions
        restrictedCategories
        shouldApplyToEverywhereRanged
        hasSetStoreList
        whoCanBuildTargeting
        isPollenTargetingRequired
        canClientSetPreferentialStoreList

      }
      timeline {
        minCampaignDurationDays
        bookingDeadlineDays
        targetingDeadlineDays
        creativeDeadlineDays
        lateBookingDeadlineDays
      }
      setup {
        maxHeroSKUs
        minHeroSKUs
        totalSKUs
        ABTestingOptions
        maxFileSize {
          value
          unit
        }
      }
      creative {
        exampleImage {
          internalFilename
          actualFilename
        }
        contentHubLink
        channelSpecsLink
      }
      planningQuestions {
        showFoodGroupAndCycleToInternal
        showFoodGroupAndCycleToExternal
        showFoodGroupAndCycleMultiSelectionToInternal
        showFoodGroupAndCycleMultiSelectionToExternal
        showBackToBackCycleToInternal
        showBackToBackCycleToExternal
        showABTestingToInternal
        showABTestingToExternal
        showBudgetToInternal
        showBudgetToExternal
        showCampaignLiveDatesToInternal
        showCampaignLiveDatesToExternal
        showAssetMarketingClaimToInternal
        showAssetMarketingClaimToExternal
      }
      posQuestions {
        showAdditionalPosItemsToExternal
        showAdditionalPosItemsToInternal
        showDualSiteToInternal
        showDualSiteToExternal
      }
      samplingQuestions {
        showSamplingDayMonTueWedToInternal
        showSamplingDayMonTueWedToExternal
        showSamplingDayThuFriToInternal
        showSamplingDayThuFriToExternal
        showSamplingDaySatSunToInternal
        showSamplingDaySatSunToExternal
        showSamplingAllDayToInternal
        showSamplingAllDayToExternal
        showAdditionalHoursToInternal
        showAdditionalHoursToExternal
        showStrutCardToInternal
        showStrutCardToExternal
        showLeafletToInternal
        showLeafletToExternal
        showBespokeOrBoxToInternal
        showBespokeOrBoxToExternal
        showBespokeBackboardToInternal
        showBespokeBackboardToExternal
        showFreeStandingDisplayToInternal
        showFreeStandingDisplayToExternal
        showClientAmbassadorToInternal
        showClientAmbassadorToExternal
        showRelAmbassadorToInternal
        showRelAmbassadorToExternal
      }
      atmAdsQuestions {
        showBespokeDesignCreativeToInternal
        showBespokeDesignCreativeToExternal
      }
      digitalSixSheetsQuestions {
        showVinylWrapToInternal
        showVinylWrapToExternal
        showBudgetToInternal
        showBudgetToExternal
        showSlotsPerScreenToInternal
        showSlotsPerScreenToExternal
        showAdditionalScreenToInternal
        showAdditionalScreenToExternal
      }
      petrolPumpQuestions {
        showBudgetToInternal
        showBudgetToExternal
      }
      couponAtTillQuestions {
        showBudgetToInternal
        showBudgetToExternal
        showRedemptionCostToInternal
        showRedemptionCostToExternal
        showMessageToInternal
        showMessageToExternal
        showMessageInExtendedTextBoxToInternal
        showMessageInExtendedTextBoxToExternal
        showNumberOfIngredientsToInternal
        showNumberOfIngredientsToExternal
        showStepsInRecipeToInternal
        showStepsInRecipeToExternal
        showNutritionalInfoToInternal
        showNutritionalInfoToExternal
        showSkuOnNectarToInternal
        showSkuOnNectarToExternal
        showWiderCampaignToInternal
        showWiderCampaignToExternal
        showBonusNectarPointAmountToInternal
        showBonusNectarPointAmountToExternal
      }
      piggyBackAssets {
        id
        name
        mandatory
      }
    }
    atHome {
      type
      subType
      isTargetedChannel
      cost {
        selfServe {
          minimumSpend
          pricingModels {
            pricingModel
            cost
            costStoreVolume {
              pricingCondition
              quantity
              maxQuantity
              cost
            }
          }
        }
        managedService {
          minimumSpend
          managedServiceFee {
            type
            value
          }
          pricingModels {
            pricingModel
            cost
            costStoreVolume {
              pricingCondition
              quantity
              maxQuantity
              cost
            }
          }
        }
      }
      audienceAndTargeting {
        minAudienceVolume
        maxAudienceVolume
        hasHFSSRestrictions
        restrictedCategories
        whoCanBuildTargeting
        isPollenTargetingRequired
      }
      timeline {
        minCampaignDurationDays
        bookingDeadlineDays
        targetingDeadlineDays
        creativeDeadlineDays
        lateBookingDeadlineDays
      }
      setup {
        maxHeroSKUs
        minHeroSKUs
        totalSKUs
        ABTestingOptions
        maxFileSize {
          value
          unit
        }
      }
      creative {
        exampleImage {
          internalFilename
          actualFilename
        }
        contentHubLink
        channelSpecsLink
      }
      planningQuestions {
        showFoodGroupAndCycleToInternal
        showFoodGroupAndCycleToExternal
        showABTestingToInternal
        showABTestingToExternal
        showBudgetToInternal
        showBudgetToExternal
      }
      onlineMagazineQuestions {
        showMonthToInternal
        showMonthToExternal
        showProductionInternal
        showProductionExternal
      }
      printQuestions {
        ... on PrintQuestionsSains {
          showMonthToInternal
          showMonthToExternal
          showAdvertorialsToInternal
          showAdvertorialsToExternal
          showArtworkCouponExternal
          showArtworkCouponInternal
        }
        ... on PrintQuestionsArgos {
          showAssetMarketingClaimToInternal
          showAssetMarketingClaimToExternal
          showBudgetToInternal
          showBudgetToExternal
          showMonthToInternal
          showMonthToExternal
        }
      }
      emailQuestions {
        ... on EmailQuestionsSains {
          showNumberOfIngredientsToInternal
          showNumberOfIngredientsToExternal
          showRecipeToInternal
          showRecipeToExternal
          showBudgetToInternal
          showBudgetToExternal
          showNutritionToInternal
          showNutritionToExternal
          showSkuOnNectarToInternal
          showSkuOnNectarToExternal
          showBonusNectarPointAmountToInternal
          showBonusNectarPointAmountToExternal
          showWiderCompetitionToInternal
          showWiderCompetitionToExternal
          showAssetsToInternal
          showAssetsToExternal
          showDeploymentWeekToInternal
          showDeploymentWeekToExternal
          showTypeOfPromotionToInternal
          showTypeOfPromotionToExternal
          showRedemptionCostToInternal
          showRedemptionCostToExternal
          showMessageToCommunicateToInternal
          showMessageToCommunicateToExternal
        }
        ... on EmailQuestionsArgos {
          showWiderCompetitionToInternal
          showWiderCompetitionToExternal
          showAssetsToInternal
          showAssetsToExternal
          showDeploymentWeekToInternal
          showDeploymentWeekToExternal
          showObjectiveToInternal
          showObjectiveToExternal
          showABTestingToInternal
          showABTestingToExternal
          showAssetMarketingClaimToInternal
          showAssetMarketingClaimToExternal
          showBudgetToInternal
          showBudgetToExternal

        }
      }
      nectarAppQuestions {
        ... on NectarAppQuestionsSains {
          showRedemptionSkuToInternal
          showRedemptionSkuToExternal
          showBonusNectarPointsToInternal
          showBonusNectarPointsToExternal
          showBudgetToInternal
          showBudgetToExternal
          showRedemptionCostToInternal
          showRedemptionCostToExternal
          showPushNotificationToInternal
          showPushNotificationToExternal
          showFeaturedShopToInternal
          showFeaturedShopToExternal
          showTypeOfPodToInternal
          showTypeOfPodToExternal
        }
        ... on NectarAppQuestionsArgos {
          showBudgetToInternal
          showBudgetToExternal
          showRedemptionCostToInternal
          showRedemptionCostToExternal
          showRedemptionSkuToInternal
          showRedemptionSkuToExternal
          showABTestingToInternal
          showABTestingToExternal
          showAssetMarketingClaimToInternal
          showAssetMarketingClaimToExternal
          showLiveDatesToInternal
          showLiveDatesToExternal
        }
      }
    }
    createdAt
    updatedAt
    channelType
`;

/** READ one — observed op `admin_getMedia`. */
export const ADMIN_GET_MEDIA = `query admin_getMedia($mediaId: ID!) {
  admin_getMedia(mediaId: $mediaId) {
${CHANNEL_DETAIL_FIELDS}
  }
}`;

/** READ list — observed op `query-admin_getEveryMedia` (same field selection, filter args). */
export const ADMIN_GET_EVERY_MEDIA = `query admin_getEveryMedia($businessGroup: BusinessGroup, $channelType: ChannelActivation, $mediaType: String, $isVisible: Boolean, $isVisibleArgos: Boolean, $planId: String) {
  admin_getEveryMedia(businessGroup: $businessGroup, channelType: $channelType, mediaType: $mediaType, isVisible: $isVisible, isVisibleArgos: $isVisibleArgos, planId: $planId) {
${CHANNEL_DETAIL_FIELDS}
  }
}`;

/** UPDATE — observed op `admin-update-media` (operationName admin_editMedia). */
export const ADMIN_EDIT_MEDIA = `mutation admin_editMedia($mediaId: ID!, $input: admin_MediaInput!) {
      admin_editMedia(mediaId: $mediaId, input: $input) {
          id
        }
      }`;

/** CREATE — INFERRED (not in capture). Verify the mutation name + return shape against the schema. */
export const ADMIN_CREATE_MEDIA = `mutation admin_createMedia($input: admin_MediaInput!) {
  admin_createMedia(input: $input) {
    id
  }
}`;

/** DELETE — INFERRED (not in capture). Verify the mutation name + return shape against the schema. */
export const ADMIN_DELETE_MEDIA = `mutation admin_deleteMedia($mediaId: ID!) {
  admin_deleteMedia(mediaId: $mediaId) {
    id
  }
}`;
