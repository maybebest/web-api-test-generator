// Domain types for Pollen "channel" management.
//
// In this app a *channel* is a GraphQL `media` entity: the admin UI route
// /admin/channel-management/<id>/instore edits it via `admin_editMedia(mediaId, input)`.
// These types are derived from the Channel-management HAR capture (the admin_editMedia input
// and the admin_getMedia selection set). Fields only observed for one activation surface are
// typed precisely; the others are kept open because the capture only exercised `inStore`.

/** Keeps editor autocomplete for known values while still accepting any string. */
export type BusinessGroup = 'sainsburys' | 'argos' | 'nectar' | (string & {});

/** The four mutually-exclusive activation surfaces; exactly one is populated on a channel. */
export type ChannelActivationKind = 'inStore' | 'onSite' | 'offSite' | 'atHome';

export interface BaseAssetType {
  id: number;
  name: string;
}

export interface ManagedServiceFee {
  /** e.g. 'NONE' | 'FIXED' | 'PERCENTAGE' */
  type: string;
  value: number;
}

export interface CostStoreVolume {
  /** e.g. 'LESS_THAN' | 'BETWEEN' | 'MORE_THAN' */
  pricingCondition: string;
  quantity: number;
  maxQuantity: number;
  cost: number;
}

export interface PricingModel {
  /** e.g. 'COST_PER_UNIT_STORE_VOLUME_DEPENDENT' */
  pricingModel: string;
  cost: number;
  costStoreVolume?: CostStoreVolume[] | null;
  numberOfWeeks?: number | null;
}

export interface ServiceCost {
  minimumSpend: number | null;
  managedServiceFee?: ManagedServiceFee | null;
  pricingModels: PricingModel[];
}

export interface ChannelCost {
  selfServe: ServiceCost | null;
  managedService: ServiceCost | null;
}

export interface InStoreAudienceAndTargeting {
  minAudienceVolume: number | null;
  maxAudienceVolume: number | null;
  minStoreVolume: number | null;
  maxStoreVolume: number | null;
  hasHFSSRestrictions: boolean;
  restrictedCategories: string[];
  shouldApplyToEverywhereRanged: boolean;
  hasSetStoreList: boolean;
  /** e.g. 'ALL_USERS' */
  whoCanBuildTargeting: string;
  isPollenTargetingRequired: boolean;
  canClientSetPreferentialStoreList: boolean;
}

export interface Timeline {
  minCampaignDurationDays: number | null;
  bookingDeadlineDays: number | null;
  targetingDeadlineDays: number | null;
  creativeDeadlineDays: number | null;
  lateBookingDeadlineDays: number | null;
}

export interface MaxFileSize {
  value: number | null;
  unit: string | null;
}

export interface Setup {
  maxHeroSKUs: number | null;
  minHeroSKUs: number | null;
  totalSKUs: number | null;
  ABTestingOptions: string[];
  maxFileSize: MaxFileSize;
}

export interface ExampleImage {
  actualFilename: string;
  internalFilename: string;
}

export interface Creative {
  channelSpecsLink: string;
  contentHubLink: string;
  exampleImage: ExampleImage | null;
}

/** Boolean show/hide flags; the exact set varies per channel type, so the shape is open. */
export type QuestionFlags = Record<string, boolean>;

/** Fully observed `inStore` activation block (the channel surface the capture exercised). */
export interface InStoreActivation {
  /** e.g. 'TROLLEY' */
  type: string;
  storeType?: string | null;
  subType?: string | null;
  isTargetedChannel: boolean;
  isCmsBroadsignMedia?: boolean | null;
  audienceAndTargeting: InStoreAudienceAndTargeting;
  cost: ChannelCost;
  timeline: Timeline;
  setup: Setup;
  creative: Creative;
  planningQuestions: QuestionFlags;
  piggyBackAssets?: unknown[] | null;
  /** Other channel-type question blocks (posQuestions, samplingQuestions, ...) when applicable. */
  [extra: string]: unknown;
}

// onSite/offSite/atHome inputs were not exercised by the capture; keep them open but hinted.
export interface OnSiteActivation {
  type?: string;
  [key: string]: unknown;
}
export interface OffSiteActivation {
  type?: string;
  provider?: string;
  [key: string]: unknown;
}
export interface AtHomeActivation {
  type?: string;
  subType?: string;
  [key: string]: unknown;
}

/**
 * `admin_MediaInput` — the channel WRITE model accepted by admin_editMedia and the (inferred)
 * admin_createMedia. Exactly one of inStore/onSite/offSite/atHome should be non-null.
 */
export interface MediaInput {
  name: string;
  description: string;
  secondaryDescription: string;
  businessGroup: BusinessGroup;
  baseAssetType: BaseAssetType;
  isManagedService: boolean;
  isSelfServe: boolean;
  isVisible: boolean;
  isVisibleArgos: boolean;
  isVisibleToInternalOnly: boolean;
  isIncrementalFundingAvailable: boolean | null;
  inStore?: InStoreActivation | null;
  onSite?: OnSiteActivation | null;
  offSite?: OffSiteActivation | null;
  atHome?: AtHomeActivation | null;
}

/**
 * Channel READ model returned by admin_getMedia / admin_getEveryMedia: the writable input fields
 * plus server-managed fields. The read type is WIDER than `MediaInput` (it carries output-only
 * fields such as citrusAdPlacementLabel), so a read→write roundtrip is projected via
 * `ChannelBuilder.toInput` before being sent back.
 */
export interface Channel extends MediaInput {
  id: string;
  channelType?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export type DeepPartial<T> = T extends (infer U)[]
  ? DeepPartial<U>[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;
