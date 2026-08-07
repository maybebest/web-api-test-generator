// GraphQL operation documents for the Nectar AI media-planner admin + planning API, captured
// verbatim from real dev-environment traffic (Media plan / Media plan edit sku / Max-hero-sku HARs).
// Web-only — no packages/api import. Keep these strings byte-faithful to the observed requests; the
// backend input/output types are strict, so trimming a field can break a mutation.

// Read the full media object (needed for the maxHeroSKUs read-modify-write). This is the same query
// the admin UI issues before admin_editMedia, so its selection is a superset of admin_MediaInput.
export const ADMIN_GET_MEDIA = `query admin_getMedia($mediaId: ID!) {
    admin_getMedia(mediaId: $mediaId) {
      
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

    }
  }
`;

// Minimal listing used to resolve a channel name -> mediaId.
export const ADMIN_GET_EVERY_MEDIA = `query admin_getEveryMedia($businessGroup: BusinessGroup) {
  admin_getEveryMedia(businessGroup: $businessGroup) {
    id
    name
  }
}`;

// Full-object channel-config write. input is an admin_MediaInput (no __typename); mediaId is separate.
export const ADMIN_EDIT_MEDIA = `mutation admin_editMedia($mediaId: ID!, $input: admin_MediaInput!) {
  admin_editMedia(mediaId: $mediaId, input: $input) {
    id
  }
}`;

// Directly set the plan session SKU set. state = { action: "SET_SKUS", value: [{ skuId, isHero }] }.
// One call replaces the WHOLE set (hero + measurement together), so callers must send the union.
export const PLANNING_UPDATE_STATE = `mutation planningAI_updateState($sessionId: String!, $state: JSON!) {
  planningAI_updateState(sessionId: $sessionId, state: $state)
}`;

// Drive the assistant. Returns the sessionId (create a session by passing sessionId: null).
export const PLANNING_CHAT = `mutation planningAI_chat($sessionId: String, $message: String!, $data: JSON, $action: String) {
  planningAI_chat(sessionId: $sessionId, message: $message, data: $data, action: $action) {
    sessionId
  }
}`;

// Read a planning session (state carries the current SKU selection; planId links to the media plan).
export const PLANNING_CHAT_HISTORY = `query PlanningAIChatHistory($sessionId: String!) {
  planningAI_chatHistory(sessionId: $sessionId) {
    id
    userId
    planId
    status
    statusMessage
    createdAt
    updatedAt
    errorMessage
    state
    history
  }
}`;

// ---- Planning SKU / category / advertiser / plan reads (Media plan / Media plan edit sku HARs).
// The captured request bodies for these five ops carry no operationName field, but the server
// accepts one (verified live), so nectarGraphql can send it as usual.

// Brand SKU search scoped to one full category path (all five catLevel ids are required Floats;
// searchQuery/sainsburysBrandIds/businessGroup are optional).
export const PLANNING_GET_SKUS = `
    query planning_getSkus(
      $brandNames: [String!]!
      $catLevel1Id: Float!
      $catLevel2Id: Float!
      $catLevel3Id: Float!
      $catLevel4Id: Float!
      $catLevel5Id: Float!
      $searchQuery: String
      $businessGroup: BusinessGroup
      $sainsburysBrandIds: [String!]
    ) {
      planning_getSkus(
        brandNames: $brandNames
        catLevel1Id: $catLevel1Id
        catLevel2Id: $catLevel2Id
        catLevel3Id: $catLevel3Id
        catLevel4Id: $catLevel4Id
        catLevel5Id: $catLevel5Id
        searchQuery: $searchQuery
        businessGroup: $businessGroup
        sainsburysBrandIds: $sainsburysBrandIds
      ) {
        id
        skuName
        skuId
        brandName
        catLevel1Id
        catLevel1Name
        catLevel2Id
        catLevel2Name
        catLevel3Id
        catLevel3Name
        catLevel4Id
        catLevel4Name
        catLevel5Id
        catLevel5Name
        manufacturer
        isHFSS
        isSensitive
        sensitivity
        updatedAt
      }
    }
  `;

// Resolve SKUs directly by their numeric skuIds (Long). Unknown ids are omitted from the result.
export const PLANNING_GET_SKUS_BY_SKU_ID = `
    query planning_getSkusBySkuId($skuIds: [Long!]! $businessGroup: BusinessGroup) {
      planning_getSkusBySkuId(skuIds: $skuIds, businessGroup: $businessGroup) {
        id
        skuName
        skuId
        brandName
        catLevel1Id
        catLevel1Name
        catLevel2Id
        catLevel2Name
        catLevel3Id
        catLevel3Name
        catLevel4Id
        catLevel4Name
        catLevel5Id
        catLevel5Name
        manufacturer
        isAgeRestricted
        isHFSS
        isSensitive
        sensitivity
        updatedAt
      }
    }
  `;

// Category tree for a brand: five nested subCategories levels; the deepest level carries
// rootLevelIds/brands/skus. The catLevelXId inputs of planning_getSkus come from this tree.
export const PLANNING_GET_CATEGORIES = `
    query planning_getCategories($brandNames: [String!]!, $sainsburysBrandIds:[String!], $searchQuery: String, $businessGroup: BusinessGroup) {
      planning_getCategories(brandNames: $brandNames, sainsburysBrandIds: $sainsburysBrandIds, searchQuery: $searchQuery, businessGroup: $businessGroup) {
        id
        name
        subCategories {
          id
          name
          subCategories {
            id
            name
            subCategories {
              id
              name
              subCategories {
                id
                name
                rootLevelIds
                brands
                skus {
                  id
                  skuName
                  skuId
                  brandName
                  catLevel1Id
                  catLevel1Name
                  catLevel2Id
                  catLevel2Name
                  catLevel3Id
                  catLevel3Name
                  catLevel4Id
                  catLevel4Name
                  catLevel5Id
                  catLevel5Name
                  manufacturer
                  isHFSS
                  isSensitive
                  sensitivity
                  updatedAt
                  isAgeRestricted
                }
              }
            }
          }
        }
      }
    }
  `;

// Advertiser list incl. brands + linked Sainsburys brands. The UI sends this with URL
// ?op=nectar_getAdvertisers_all even though the document's own operation name is
// allAdvertisersWithBrandName resolving the allAdvertisers field.
export const NECTAR_GET_ADVERTISERS_ALL = `query allAdvertisersWithBrandName($shouldDisplayOnlyOffsite: Boolean) {
      allAdvertisers(shouldDisplayOnlyOffsite: $shouldDisplayOnlyOffsite) {
        id
        advertiserId
        displayName
        customName
        businessGroup
        activeChannels
        brands {
          id
          displayName
          customName
          advertiserId
          linkedToSainsburysBrand {
            id
            name
          }
        }
      }
    }`;

// Read a full media plan by id (the plan-edit page load query; selection is huge, keep verbatim).
export const PLANNING_GET_PLAN = `
  query planning_getPlan($planId: ID!)
  {
    planning_getPlan(planId: $planId) {
      #graphql
    id
    name
    briefId
    advertiserId
    basePipelineConfidenceLevel
    basePipelineEventId
    basePipelineId
    basePipelineStatus
    baseCampaignId
    bookedAt
    partner {
      _id
      name
    }
    advertiser {
      id
      displayName
      businessGroup
      newBusinessClient
      sipAccess
      planningPriorityClient
      customName
    }
    brandIds
    brands {
      id
      displayName
      customName
      availableChannels
      linkedToSainsburysBrand {
        id
      }
      agencyCitrusAdTeamMapper {
        partnerId
        citrusAdTeamId
      }
    }
    campaignDetailsAndBudget {
      campaignName
      campaignBudget
      campaignDateOption
      foodGroup
      cycleNumber
      objectives
      campaignStartDate
      campaignEndDate
      argosCampaignContext {
        compliance {
          isRequiredComplianceMessaging
          whatComplianceMessaging
        }
        productLaunch {
          isNewProductLaunch
          areRestrictionsAroundLaunch
          whatRestrictionsAroundLaunch
        }
        offer {
          isPartOfOffer
          whatIsOffer
        }
      }

    }
    citrusAdWallets {
      id
      name
      type
      paymentReference
      initialBalance
      wallet {
        id
        name
        availableBalance
        currentBalance
      }
      topupHistory {
        amount
        timestamp
        attachment
        topup {
          currentBalance
        }
      }
    }
    skuDetails {
      selectedSkus {
        skuId
        isSwappedSku
        isHeroSku
        sku {
          id
          skuName
          skuId
          brandName
          isHFSS
          isSensitive
          sensitivity
          catLevel1Id
          catLevel1Name
          catLevel2Id
          catLevel2Name
          catLevel3Id
          catLevel3Name
          catLevel4Id
          catLevel4Name
          catLevel5Id
          catLevel5Name
          isAgeRestricted
        }
      }
      unknownSkus {
        skuName
        skuId
        brandId
        brand {
          id
          customName
          displayName
        }
        isHFSS
        isSensitive
        sensitivity
        launchDate
        preOrderSkuNumber
        liveSkuNumber
        isAgeRestricted
        isHeroSku
      }
    }
    channels {
      onsite {
        id
        mediaId
        mediaName
        mediaType
        isVisibleToInternalOnly
        campaign {
          id
          actualCampaignId
          citrusAdWalletId
          actualCitrusAdWalletId
        }
        isTargetedChannel
        hasHFSSRestrictions
        isPollenTargetingRequired
        whoCanBuildTargeting
        restrictedCategories
        minHeroSKUs
        minBudget
        baseAssetType {
          id
          name
        }
        budget
        overriddenCost
        budgetDiscount
        channelService
        
        poNumber
        liveDates {
          startDate
          endDate
        }
        abTest
        heroSKUs {
          known {
            skuId
            isHFSS
            isSensitive
          }
          unknown {
            skuName
            skuId
            brandId
            isHFSS
            isSensitive
            sensitivity
            launchDate
            isAgeRestricted
          }
        }
        citrusAdWallet {
          id
          name
          type
          paymentReference
          initialBalance
          wallet {
            id
            name
          }
        }
        eCouponSetup {
          budget
          foodGroup
          cycleNumber
          pointsToGiveOff
          isSkuNectarPrice1
          skuRspPrice1
          skuNectarPrice1
          isSkuNectarPrice2
          skuRspPrice2
          redemptionCost
        }
        redemptionCost
        redemptionCostPoNumber
        businessGroup
        costToArgos
        provider
        periods {
          period
          start
          end
          overlapStart
          overlapEnd
          days
          cost
        }
        marketingClaim {
          needsMarketingClaim
          canProvideSubstantiation
          substantiationDocuments {
            internalFilename
            actualFilename
          }
        }
        urlType
        calculatedMediaCost {
          mediaCost
          managedServiceCost
          managedServiceCostPoNumber
          selfServiceCost
          selectedChannelService
        }
        channelMediaName
        channelMediaCost  {
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
        }
        incrementallyFunded
      }
      offsite {
        id
        mediaId
        mediaName
        mediaType
        hasHFSSRestrictions
        isPollenTargetingRequired
        whoCanBuildTargeting
        restrictedCategories
        minHeroSKUs
        minBudget
        isVisibleToInternalOnly
        baseAssetType {
          id
          name
        }
        budget
        overriddenCost
        budgetDiscount
        channelService
        
        poNumber
        liveDates {
          startDate
          endDate

        }
        abTest
        heroSKUs {
          known {
            skuId
            isHFSS
            isSensitive
          }
          unknown {
            skuName
            skuId
            brandId
            isHFSS
            isSensitive
            sensitivity
            launchDate
            isAgeRestricted
          }
        }
        provider
        periods {
          period
          start
          end
          overlapStart
          overlapEnd
          days
          cost
        }
        marketingClaim {
          needsMarketingClaim
          canProvideSubstantiation
          substantiationDocuments {
            internalFilename
            actualFilename
          }
        }
        splitCampaign {
          isSplitCampaign
          proposedSplitDate
        }
        campaign {
          id
        }
        businessGroup
        costToArgos
        calculatedMediaCost {
          mediaCost
          managedServiceCost
          managedServiceCostPoNumber
          selfServiceCost
          selectedChannelService
        }
        channelMediaName
        channelMediaCost {
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
        incrementallyFunded
      }
      instore {
        id
        mediaId
        mediaName
        mediaType
        isCmsBroadsignMedia
        selectedCmsScreenTypeId
        storeType
        storeLocation
        mediaSubType
        templateType
        isTargetedChannel
        hasHFSSRestrictions
        isPollenTargetingRequired
        whoCanBuildTargeting
        restrictedCategories
        minHeroSKUs
        minBudget
        isVisibleToInternalOnly
        baseAssetType {
          id
          name
        }
        budget
        overriddenCost
        budgetDiscount
        channelService
        
        poNumber
        abTest
        foodGroup
        cycleNumber
        runBackToBackCycle
        liveDates {
          startDate
          endDate
        }
        atmMediaSetup {
          bespokeDesignCreative
        }
        digitalSixSheetsSetup {
          vinylWrap
          numberOfSlots
          additionalScreen
        }
        petrolPumpSetup {
          petrolPumpCycleNumber
        }
        posSetup {
          dualSite
          abTest
          additionalPOSItems
          categories {
            id
            name
          }
        }
        couponAtTillSetup {
          messageToCommunicate
          messageToCommunicateInExtendedBox
          numberOfIngredientsKnown
          numberOfIngredients
          namesOfIngredients
          recipeExists
          numberOfRecipeSteps
          nutritionalInformation
          provideAdditionalNutritionalInformation
          partOfWiderCompetitionCampaign
          isSkuNectarPrice
          skuRspPrice
          skuNectarPrice
          specificAssetsToDisplay
          bonusNectarPoints
        }
        samplingSetup {
          samplingDays
          additionalHoursNeeded
          additionalHours
          strutCard
          samplingLeaflet
          typeOfLeaflet
          bespokeOrBoxHeader
          bespokeBackboard
          freeStandingDisplayUnit
          typeOfStandingDisplayUnitHeader
          additionalClientAmbassador
          numberOfAmbassadors
          additionalRELAmbassador
          numberOfRELAmbassadors
          ambassadorTraining
          typeOfAmbassadorTraining
          clientTraining
          typeOfClientTraining
        }
        heroSKUs {
          known {
            skuId
            isHFSS
            isSensitive
          }
          unknown {
            skuName
            skuId
            brandId
            isHFSS
            isSensitive
            sensitivity
            launchDate
            isAgeRestricted
          }
          invalidSkus
        }
        redemptionCost
        redemptionCostPoNumber
        businessGroup
        costToArgos
        marketingClaim {
          needsMarketingClaim
          canProvideSubstantiation
          substantiationDocuments {
            internalFilename
            actualFilename
          }
        }
        calculatedMediaCost {
          mediaCost
          managedServiceCost
          managedServiceCostPoNumber
          selfServiceCost
          selectedChannelService
        }
        piggyBackAssets {
          id
          quantity
        }
        audienceAndTargeting {
          shouldApplyToEverywhereRanged
          hasSetStoreList
        }
        channelMediaCost {
          selfServe {
            minimumSpend
            pricingModels {
              pricingModel
            }
          }
          managedService {
            minimumSpend
            pricingModels {
              pricingModel
            }
          }
        }
        incrementallyFunded
      }
      athome {
        id
        mediaId
        mediaName
        mediaType
        mediaSubType
        isTargetedChannel
        hasHFSSRestrictions
        isPollenTargetingRequired
        whoCanBuildTargeting
        restrictedCategories
        minHeroSKUs
        minBudget
        isVisibleToInternalOnly
        baseAssetType {
          id
          name
        }
        budget
        overriddenCost
        budgetDiscount
        channelService
        
        poNumber
        foodGroup
        cycleNumber
        liveDates {
          startDate
          endDate
        }
        abTest
        onlineMagazineSetup {
          bookingMonths
          productionChosen
        }
        printMagazineSetup {
          bookingMonths
          shootForAdvertorials
          couponOnArtwork
        }
        emailSetup {
          deploymentWeek
          preferredSendDate
          typeOfPromotion
          competitionDetails
          promotionBonusNectarPoints
          winnerCount
          assets
          designAtAdditionalCost
          brief
          numberOfIngredientsKnown
          numberOfIngredients
          namesOfIngredients
          recipeExists
          numberOfRecipeSteps
          nutritionalInformation
          provideAdditionalNutritionalInformation
          partOfWiderCompetitionCampaign
          isSkuNectarPrice
          skuRspPrice
          skuNectarPrice
          bonusNectarPoints
          messageToCommunicate
          emailObjective
        }
        marketingClaim {
          needsMarketingClaim
          canProvideSubstantiation
          substantiationDocuments {
            internalFilename
            actualFilename
          }
        }
        nectarAppSetup {
          redemptionSkusExist
          redemptionSkus
          nectarPointsOfferMethod
          isPushNotificationSelected
          isFeaturedShopSelected
          typeOfPod
        }
        heroSKUs {
          known {
            skuId
            isHFSS
            isSensitive
          }
          unknown {
            skuName
            skuId
            brandId
            isHFSS
            isSensitive
            sensitivity
            launchDate
            isAgeRestricted
          }
        }
        redemptionCost
        redemptionCostPoNumber
        businessGroup
        costToArgos
        calculatedMediaCost {
          mediaCost
          managedServiceCost
          managedServiceCostPoNumber
          selfServiceCost
          selectedChannelService
        }
        incrementallyFunded
      }
    }
    audiencePlan {
      skipTargetingSetByChannel {
        athome
        instore
        offsite
        onsite
      }
      requestNectarToBuildTargetingSetByChannel {
        athome
        instore
        offsite
        onsite
        targetingBrief {
          offsite
        }
      }
    }
    additionalServices {
      selectedServices {
        serviceName
        cost
        poNumber
      }
    }
    reviewDetails {
      uploadedDocuments {
        internalFilename
        actualFilename
      }
    }
    qualifyingQuestions {
      campaignDateOption
      selectedObjective
      budget
      specificChannels
      isEmpOnly
      channelsList {
        athome
        instore
        offsite {
          id
          name
          mediaType
        }
        onsite
      }
      argosAccessSIP
      argosAgreedMediaSpendBuyer
      proposedStartDate
    }
    status
    createdAt
    updatedAt
    isInternal
    excludeFromMTA
    draftStep
    type
    linkedBookingId
    linkedBookingDetails {
      status
      channels {
        onsite {
          id
          mediaId
          provider
          status
        }
        offsite {
          id
          mediaId
          provider
          status
        }
        athome {
          id
          mediaId
          provider
          status
        }
        instore {
          id
          mediaId
          provider
          status
          piggyBackAssets {
            id
            name
            mandatory
            quantity
          }
        }
      }
    }
    indicativeMediaCosts {
      mediaId
      mediaCampaignId
      cost
      discount
      indicativeStoresCount {
        storeVolume
        status
      }
      refinedSkus {
      skuId
      name
      }
      calculatedEndDate
      invalidSkus
    }
    proofOfPayments {
      document {
        internalFilename
        actualFilename
      }
      uploadedBy
    }
    targetingSet {
      #graphql
  id
  name
  advertiser {
    id
    businessGroup
    displayName
    activeChannels
    customName
  }
  brands {
    id
    displayName
    customName
    availableChannels
    linkedToSainsburysBrand {
      id
    }
  }
  brandNames
  planId
  bookingId
  aisleRules {
    categoryId
    categoryName
    sensitivity
    selected
    isAdditional
  }
  createdAt
  createdBy {
    _id
    name
  }
  heroSKUs {
    skuId
    sku {
      id
      skuName
      skuId
      catLevel1Id
      catLevel1Name
      catLevel2Id
      catLevel2Name
      catLevel3Id
      catLevel3Name
      catLevel4Id
      catLevel4Name
      catLevel5Id
      catLevel5Name
      isHFSS
      sensitivity
    }
    isRedemptionSku
    isNPDSku
  }
  objectives
  redemptionSkuRangeLocations {
    name
    storeId
  }
  rangedLocationStatus
  offsiteCount
  instoreCount
  emailCouponCount
  IsPublished
  datePublished
  offsiteAudiences {
    id
    nectarCount
    audiences {
      id
      name
      status
      createdAt
      nectarCount
      capCount
      updatedAt
      splitAudiences{
        id
        nectarCount
      }
      groups{
      productGroups{
      name
      ... on ab_ProductGroupByBasketModeller {
      inputSKUs
 }
        }

      }
    }
  }
  offsiteMetadata {
    isReadyToPublish
    isVisible
    media
    refreshFrequencyInWeeks
    lastRefreshDate
    selectedMedia {
      id
      name
      provider
      isVisibleToInternalOnly
    }
    showRefreshNotification
  }
  audiencesChanges {
    removedAudiences
    removedEmailAndCouponsAudiences
    addedSkus
    removedSkus
    addedUnknownSkus
    removedUnknownSkus
    haveAllAudiencesBeenRemoved
    haveAllEmailAndCouponsAudiencesBeenRemoved
    requiredUnknownSkuCount
    isChangeFromLinkedPlan
  }
  isInstoreStoreListMarkedAsReady
  instoreAudienceParent {
    rangedLocationKeys {
      name
      storeId
      type
    }
    audiences {
      id
      name
      filteredLocationKeys
      isNPD
      demographicsAndCustomerInsights {
        type
        categories
      }
      selectedMedia {
        id
        name
        isVisibleToInternalOnly
        mediaCampaignId
        mediaCampaignName
      }
      isVisible
      status
      storeTypes
      storeFeatures
      rangedLocationKeys {
        name
        storeId
      }
      cappedRangedLocationKeys {
        storeId
      }
      updatedRangedLocationKeys
      regions
      hasOverlay
      unselectedStoreIds
      refinedSKUs
      postNominationStoreList
      postNotifiedAt
    }
    status
    refinedStores
    dedupedFinalStoreList
  }
  isEmailAndCouponMarkedAsReady
  emailCouponMetadata {
    imported
  }
  emailCouponAudiences {
    id
    name
    couponIds
    storeIds
    consentFlag
    groupsOperator
    consentFlag
    selectedMedia {
        id
        name
    }
    groups {
      operator
      productGroups {
        id
        name
        lastBought {
          weeksStartPoint
          weeks
          from
          to
        }
        targetScope {
          targetingType
          type
          from
          to

        }
        type
        nectarCount
        aisleCount
        dedupCount
        ... on ab_ProductGroupBySKU {
          productSKUs
        }
        ... on ab_ProductGroupByProducts {
          products
        }
        ... on ab_ProductGroupByPreBuilt {
          preBuiltId
        }
        ... on ab_ProductGroupByCustomSelection {
          selectedProductGroup {
            id
            name
            level
          }
        }
        ... on ab_ProductGroupByCategories {
          categories {
            id
            name
            level
          }
        }
        ... on ab_ProductGroupByBasketModeller {
          inputSKUs
          associationLevel
          volumeCap
        }
      }
      name
      isRecommended
    }
    channels {
      channel
      status
      platformCount
    }
    demographicGroups {
      type
      categories
    }
    nectarCount
    createdAt
    updatedAt
    capCount
    capVolume
    splitAudiences {
      id
      name
      volume
      nectarCount
    }
    status
    isTemporary
  }
  isVisibleToClient
  isPrebuilt
  aisleRuleChanges {
  hasPreSelectedAisleRulesChanged
  hasAdditionalAisleRulesChanged
  previousAisleRules {
    categoryId
    categoryName
    sensitivity
    selected
    isAdditional
   }
 }

    }

    }
  }
`;

// planning_getCost — the backend-computed per-media cost for a plan (Media plan HAR). This is the
// price the summary panel renders, so a UI E2E can assert the displayed cost against this without
// re-implementing any pricing-model arithmetic.
export const PLANNING_GET_COST = `
    query planning_getCost($advertiserId: ID!, $planId: ID!) {
      planning_getCost(advertiserId: $advertiserId, planId: $planId) {
        cost
        discount
        currency
        mediaId
        campaignMediaId
      }
    }`;
