// Test-data management surface for the Nectar AI media-planner suites (specs/test-cases-skus-2.yaml).
//
// The 138 Hero-SKU / channel-validation cases need their preconditions SET UP via API (configure a
// channel's maxHeroSkus, link SKUs to a brand catalogue, seed a plan with Hero/Measurement SKUs,
// etc.) instead of clicking through the slow assistant flow for every case. This module is the
// single place those helpers live.
//
// What is implemented today is READ-ONLY (mirroring fixtures/channel-management.fixture.ts, the only
// observed GraphQL op). Every MUTATING helper is a typed stub that throws `notImplemented(...)` with
// the exact backend operation (or capture) it needs — so a generated test that depends on it FAILS
// LOUDLY with guidance rather than passing vacuously, and the gaps are enumerable (see
// MISSING_TEST_DATA_FUNCTIONS at the bottom, and `npm run` greps for `notImplemented(`).
//
// To implement a stub you need the mutation contract from a captured admin session (the sibling
// har-api-tests channel-management client exposes `api.updateField(...)` / builder.set(...); the
// observed read here is `admin_getEveryMedia`, but `admin_updateMedia` / `admin_createMedia` are
// INFERRED and unobserved). Capture the network call, then wire it through the same transport.

import {
  CONFIGURED_CHANNELS,
  readLiveGroupChannels,
  resolveChannelConfig,
  type ChannelRuleConfig,
  type LiveChannel
} from './channel-management.fixture';

// Feature flags the planner expects on (today set imperatively in PlanningPage.goto via localStorage).
export const PLANNER_FEATURE_FLAGS: Readonly<Record<string, boolean>> = {
  FEATURE_NECTAR_AI: true,
  FEATURE_NUP: true,
  FEATURE_NECTAR_AI_MP: true
};

export class NotImplementedTestDataError extends Error {
  constructor(fn: string, needs: string) {
    super(
      `test-data helper not implemented: ${fn}. ` +
        `Needs: ${needs}. ` +
        `Implement it against the admin GraphQL API (see fixtures/test-data-manager.ts header) before ` +
        `a test that depends on this precondition can run unattended.`
    );
    this.name = 'NotImplementedTestDataError';
  }
}

function notImplemented(fn: string, needs: string): never {
  throw new NotImplementedTestDataError(fn, needs);
}

export type ChannelSkuConfig = {
  maxHeroSkus: number | null;
  minHeroSkus: number | null;
};

export interface TestDataManager {
  // ---- Implemented (read-only) -------------------------------------------------------------
  /** The four pre-configured group channels (env-overridable). */
  configuredChannels(): typeof CONFIGURED_CHANNELS;
  /** Channel rule values (booking deadline / duration / store band) from env + dev defaults. */
  channelRuleConfig(): ChannelRuleConfig;
  /** Live group channels via the observed `admin_getEveryMedia` read (empty without a token). */
  liveGroupChannels(businessGroup?: string): Promise<LiveChannel[]>;
  /** Feature flags the planner is exercised with. */
  featureFlags(): Readonly<Record<string, boolean>>;

  // ---- Missing: channel Hero-SKU configuration (areas: Max Hero SKUs, Channel-level Hero edit) ----
  setChannelMaxHeroSkus(channel: string, max: number | null): Promise<void>;
  setChannelMinHeroSkus(channel: string, min: number | null): Promise<void>;
  getChannelSkuConfig(channel: string): Promise<ChannelSkuConfig>;
  resetChannelConfig(channel: string): Promise<void>;

  // ---- Missing: catalogue / brand / SKU linkage (areas: indicators, all-brand-linked, prompt parse) ----
  ensureBrandLinkedSkus(brand: string, skus: string[]): Promise<void>;
  linkSkuToBrand(sku: string, brand: string): Promise<void>;
  unlinkSkuFromBrand(sku: string, brand: string): Promise<void>;
  listBrandLinkedSkus(brand: string): Promise<string[]>;

  // ---- Missing: media-plan seeding (skip the assistant UI for precondition setup) ----------
  createMediaPlan(advertiser: string, brand: string): Promise<string>;
  assignChannelToPlan(planId: string, channel: string, budget: string, startOffsetDays: number): Promise<void>;
  setPlanHeroSkus(planId: string, channel: string, skus: string[]): Promise<void>;
  setPlanMeasurementSkus(planId: string, channel: string, skus: string[]): Promise<void>;
  deleteMediaPlan(planId: string): Promise<void>;

  // ---- Missing: feature flags + cleanup ----------------------------------------------------
  setFeatureFlags(flags: Record<string, boolean>): Promise<void>;
  cleanupCreatedTestData(): Promise<void>;
}

export function createTestDataManager(): TestDataManager {
  return {
    configuredChannels: () => CONFIGURED_CHANNELS,
    channelRuleConfig: () => resolveChannelConfig(),
    liveGroupChannels: (businessGroup = 'sainsburys') => readLiveGroupChannels(businessGroup),
    featureFlags: () => PLANNER_FEATURE_FLAGS,

    setChannelMaxHeroSkus: (channel, max) =>
      notImplemented(`setChannelMaxHeroSkus(${channel}, ${max})`, 'admin_updateMedia mutation that sets the per-channel maxHeroSkus (currently only env-configured / read)'),
    setChannelMinHeroSkus: (channel, min) =>
      notImplemented(`setChannelMinHeroSkus(${channel}, ${min})`, 'admin_updateMedia mutation that sets the per-channel minHeroSkus'),
    getChannelSkuConfig: (channel) =>
      notImplemented(`getChannelSkuConfig(${channel})`, 'a read op exposing per-channel maxHeroSkus/minHeroSkus (admin_getEveryMedia does not select them)'),
    resetChannelConfig: (channel) =>
      notImplemented(`resetChannelConfig(${channel})`, 'admin_updateMedia mutation to restore a channel to dev defaults after a test mutated it'),

    ensureBrandLinkedSkus: (brand, skus) =>
      notImplemented(`ensureBrandLinkedSkus(${brand}, [${skus.join(',')}])`, 'catalogue API to assert/create the brand->SKU links the planner search resolves against'),
    linkSkuToBrand: (sku, brand) =>
      notImplemented(`linkSkuToBrand(${sku}, ${brand})`, 'catalogue mutation to associate a SKU with a brand'),
    unlinkSkuFromBrand: (sku, brand) =>
      notImplemented(`unlinkSkuFromBrand(${sku}, ${brand})`, 'catalogue mutation to remove a brand->SKU link (for deletion-sync cases)'),
    listBrandLinkedSkus: (brand) =>
      notImplemented(`listBrandLinkedSkus(${brand})`, 'catalogue read op listing a brand’s linked SKUs'),

    createMediaPlan: (advertiser, brand) =>
      notImplemented(`createMediaPlan(${advertiser}, ${brand})`, 'media-plan create mutation returning a plan id, to seed preconditions without the assistant UI'),
    assignChannelToPlan: (planId, channel, budget, startOffsetDays) =>
      notImplemented(`assignChannelToPlan(${planId}, ${channel}, ${budget}, +${startOffsetDays}d)`, 'media-plan mutation to add a channel with budget/dates'),
    setPlanHeroSkus: (planId, channel, skus) =>
      notImplemented(`setPlanHeroSkus(${planId}, ${channel}, [${skus.join(',')}])`, 'media-plan mutation to set a channel’s Hero SKUs directly'),
    setPlanMeasurementSkus: (planId, channel, skus) =>
      notImplemented(`setPlanMeasurementSkus(${planId}, ${channel}, [${skus.join(',')}])`, 'media-plan mutation to set a channel’s Measurement SKUs directly'),
    deleteMediaPlan: (planId) =>
      notImplemented(`deleteMediaPlan(${planId})`, 'media-plan delete mutation for post-test cleanup'),

    setFeatureFlags: (flags) =>
      notImplemented(`setFeatureFlags(${JSON.stringify(flags)})`, 'a programmatic flag setter (today flags are injected into localStorage in PlanningPage.goto, not via API)'),
    cleanupCreatedTestData: () =>
      notImplemented('cleanupCreatedTestData()', 'delete mutations for any plans/links/config a test created, to keep the shared dev env clean')
  };
}

// Machine-readable enumeration of the helpers that still need building (mirrors the stubs above).
// Kept in code so it cannot drift from the implementation and can be asserted in a self-test.
export interface MissingTestDataHelper {
  name: string;
  group: 'channel-config' | 'catalogue' | 'media-plan' | 'feature-flags' | 'cleanup';
  needs: string;
  usedByAreas: string[];
}

export const MISSING_TEST_DATA_FUNCTIONS: readonly MissingTestDataHelper[] = [
  { name: 'setChannelMaxHeroSkus', group: 'channel-config', needs: 'admin_updateMedia mutation (per-channel maxHeroSkus)', usedByAreas: ['Maximum Hero SKUs per channel validation', 'Channel-level Hero edit'] },
  { name: 'setChannelMinHeroSkus', group: 'channel-config', needs: 'admin_updateMedia mutation (per-channel minHeroSkus)', usedByAreas: ['Maximum Hero SKUs per channel validation'] },
  { name: 'getChannelSkuConfig', group: 'channel-config', needs: 'read op selecting per-channel max/min Hero SKUs', usedByAreas: ['Maximum Hero SKUs per channel validation'] },
  { name: 'resetChannelConfig', group: 'channel-config', needs: 'admin_updateMedia mutation to restore dev defaults', usedByAreas: ['all (teardown)'] },
  { name: 'ensureBrandLinkedSkus', group: 'catalogue', needs: 'catalogue API (assert/create brand->SKU links)', usedByAreas: ['Hero-SKU indicators / all-brand-linked modal', 'Single-prompt Hero + Measurement parsing'] },
  { name: 'linkSkuToBrand', group: 'catalogue', needs: 'catalogue mutation (associate SKU with brand)', usedByAreas: ['Hero-SKU indicators / all-brand-linked modal'] },
  { name: 'unlinkSkuFromBrand', group: 'catalogue', needs: 'catalogue mutation (remove brand->SKU link)', usedByAreas: ['Channel-level Hero edit, per-channel SKU definition & deletion sync'] },
  { name: 'listBrandLinkedSkus', group: 'catalogue', needs: 'catalogue read op (list brand SKUs)', usedByAreas: ['Hero-SKU indicators / all-brand-linked modal'] },
  { name: 'createMediaPlan', group: 'media-plan', needs: 'media-plan create mutation (returns plan id)', usedByAreas: ['all (fast precondition seeding)'] },
  { name: 'assignChannelToPlan', group: 'media-plan', needs: 'media-plan mutation (add channel + budget + dates)', usedByAreas: ['all (fast precondition seeding)'] },
  { name: 'setPlanHeroSkus', group: 'media-plan', needs: 'media-plan mutation (set channel Hero SKUs)', usedByAreas: ['Maximum Hero SKUs', 'Channel-level Hero edit', '"Edit SKU list" modal'] },
  { name: 'setPlanMeasurementSkus', group: 'media-plan', needs: 'media-plan mutation (set channel Measurement SKUs)', usedByAreas: ['Hero-SKU indicators, auto-add & count recompute'] },
  { name: 'deleteMediaPlan', group: 'media-plan', needs: 'media-plan delete mutation', usedByAreas: ['all (teardown)'] },
  { name: 'setFeatureFlags', group: 'feature-flags', needs: 'programmatic flag setter (today localStorage-only in PlanningPage.goto)', usedByAreas: ['all'] },
  { name: 'cleanupCreatedTestData', group: 'cleanup', needs: 'delete mutations for created plans/links/config', usedByAreas: ['all (teardown)'] }
] as const;
