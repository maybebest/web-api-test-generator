// Test-data management surface for the Nectar AI media-planner suites (specs/test-cases-skus-2.yaml).
//
// The 138 Hero-SKU / channel-validation cases need their preconditions SET UP via API (configure a
// channel's maxHeroSkus, link SKUs to a brand catalogue, seed a plan with Hero/Measurement SKUs,
// etc.) instead of clicking through the slow assistant flow for every case. This module is the
// single place those helpers live.
//
// The three CRITICAL Hero-SKU helpers the generated SKU suites call — setChannelMaxHeroSkus,
// setPlanHeroSkus, setPlanMeasurementSkus — are now IMPLEMENTED against real captured GraphQL
// contracts (fixtures/nectar-api.ts, built from dev-environment admin_getMedia/admin_editMedia and
// planningAI_updateState captures). The channel read helpers (getChannelSkuConfig, setChannelMin-
// HeroSkus) are implemented from the same contract. The remaining mutating helpers (catalogue,
// plan create/delete, cleanup) are still typed stubs that throw `notImplemented(...)` naming the
// backend op they need — so a generated test that depends on them FAILS LOUDLY, and the gaps are
// enumerated in MISSING_TEST_DATA_FUNCTIONS at the bottom.
//
// EXECUTION STATUS (2026-07-03) — the seeding pipeline is LIVE-PROVEN end-to-end: real catalogue
// skuIds (specs/skus/.sku-pools.json), a live planningAI session via ensurePlanningSession
// (NECTAR_PLANNING_SESSION_ID or a created session), healed locators, and a no-op SET_SKUS guard
// (the backend rejects an update identical to the current state). The three emitted SKU suites run
// fully green against dev (27/27). Framework policy is E2E-only: source cases whose preconditions
// cannot be arranged for real (channel config via setChannelMaxHeroSkus — no resolvable channel
// media in this dev catalogue + a shared admin_editMedia write; warning cases needing the missing
// assignChannelToPlan; UI-flow expectations) get NO generated test and are enumerated per spec
// under "Pending Automation". The planning SET_SKUS contract remains session-wide (no channel
// dimension) — the `channel` parameter on setPlanHeroSkus/setPlanMeasurementSkus is accepted for
// signature parity but does not scope the write.

import {
  CONFIGURED_CHANNELS,
  readLiveGroupChannels,
  resolveChannelConfig,
  type ChannelRuleConfig,
  type LiveChannel
} from './channel-management.fixture';
import {
  findMediaId,
  getMedia,
  getMediaChannelSetup,
  getPlanningSession,
  planningChat,
  setMediaChannelMaxHeroSkus,
  setMediaChannelMinHeroSkus,
  setPlanningSkus,
  type MediaChannel,
  type SkuSelection
} from './nectar-api';

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

  // ---- Media-plan seeding (skip the assistant UI for precondition setup) -------------------
  /**
   * Resolve the planningAI sessionId tests should seed: NECTAR_PLANNING_SESSION_ID when set
   * (pin an existing live session), otherwise create a fresh session via planningAI_chat and
   * cache it for the rest of this manager instance.
   */
  ensurePlanningSession(): Promise<string>;
  createMediaPlan(advertiser: string, brand: string): Promise<string>;
  assignChannelToPlan(planId: string, channel: string, budget: string, startOffsetDays: number): Promise<void>;
  setPlanHeroSkus(planId: string, channel: string, skus: string[]): Promise<void>;
  setPlanMeasurementSkus(planId: string, channel: string, skus: string[]): Promise<void>;
  deleteMediaPlan(planId: string): Promise<void>;

  // ---- Missing: feature flags + cleanup ----------------------------------------------------
  setFeatureFlags(flags: Record<string, boolean>): Promise<void>;
  cleanupCreatedTestData(): Promise<void>;
}

// Map a generated data-case `channel` to a resolvable media. The four configured group channels
// resolve to a known media name + delivery mode; any other value (e.g. a media name like
// "Sponsored Search") is treated as a direct media name whose non-null delivery mode is auto-detected.
const CHANNEL_KEY_TO_MODE: Readonly<Record<string, MediaChannel>> = {
  onsite: 'onSite',
  offsite: 'offSite',
  atHome: 'atHome',
  inStore: 'inStore'
};

const DELIVERY_MODES: readonly MediaChannel[] = ['inStore', 'offSite', 'onSite', 'atHome'];

function channelToMediaName(channel: string): string {
  return (CONFIGURED_CHANNELS as Record<string, string>)[channel] ?? channel;
}

// Resolve a data-case channel to a concrete { mediaId, mode }. Reads admin_getEveryMedia to find the
// media by name, then the configured delivery mode (or the media's single non-null mode) to target.
async function resolveChannelTarget(channel: string): Promise<{ mediaId: string; mode: MediaChannel }> {
  const mediaName = channelToMediaName(channel);
  const mediaId = await findMediaId(mediaName);
  if (!mediaId) {
    throw new Error(
      `test-data helper: no media named "${mediaName}" (from channel "${channel}") in admin_getEveryMedia. ` +
        `Pass a configured channel key (${Object.keys(CHANNEL_KEY_TO_MODE).join('/')}) or an exact media name.`
    );
  }
  const configuredMode = CHANNEL_KEY_TO_MODE[channel];
  if (configuredMode) {
    return { mediaId, mode: configuredMode };
  }
  const media = await getMedia(mediaId);
  const mode = DELIVERY_MODES.find((m) => media[m] && typeof media[m] === 'object');
  if (!mode) {
    throw new Error(`media "${mediaName}" has no non-null delivery channel to configure Hero SKUs on`);
  }
  return { mediaId, mode };
}


export function createTestDataManager(): TestDataManager {
  // planningAI_updateState SET_SKUS replaces the ENTIRE selection, so Hero and Measurement writes for
  // the same session must be unioned. Accumulate per resolved sessionId (skuId -> isHero) across the
  // Hero/Measurement calls a single case makes on this manager instance.
  const skuSelectionBySession = new Map<string, Map<number, boolean>>();

  // One session per manager instance (one per test via the fixture): pinned via env, else created
  // once through the real assistant entry mutation and reused for every seed call in the test.
  let createdSessionId: string | undefined;
  async function ensurePlanningSession(): Promise<string> {
    const pinned = process.env.NECTAR_PLANNING_SESSION_ID?.trim();
    if (pinned) {
      return pinned;
    }
    if (!createdSessionId) {
      createdSessionId = await planningChat({
        sessionId: null,
        message: 'Help me build a plan based on my objective & budget'
      });
    }
    return createdSessionId;
  }

  async function applyPlanSkus(plan: string, skus: string[], isHero: boolean): Promise<void> {
    // 'current' resolves through ensurePlanningSession (pinned env id, else one created session per
    // manager); any other value is taken to BE a live planningAI sessionId (header caveat b).
    const sessionId = plan === 'current' ? await ensurePlanningSession() : plan;
    const selection = skuSelectionBySession.get(sessionId) ?? new Map<number, boolean>();
    for (const raw of skus) {
      const skuId = Number(raw);
      if (!Number.isFinite(skuId)) {
        throw new Error(`test-data helper: SET_SKUS needs numeric catalogue skuIds, got "${raw}"`);
      }
      // App model (observed live in the Edit SKU modal: "5 selected - 4 Hero SKUs"): hero SKUs are a
      // SUBSET of the selected set, so a SKU named in both the Hero and Measurement lists stays
      // hero — a later measurement write must not downgrade an already-hero id.
      selection.set(skuId, selection.get(skuId) === true ? true : isHero);
    }
    skuSelectionBySession.set(sessionId, selection);
    const union: SkuSelection[] = [...selection].map(([skuId, hero]) => ({ skuId, isHero: hero }));
    // The backend REJECTS a no-op SET_SKUS (an update identical to the session's current
    // campaignSkus fails with "Nectar AI API request failed" — reproduced live 2026-07-03), so
    // when the precondition already holds, skip the write instead of erroring the arrange step.
    try {
      const current = (await getPlanningSession(sessionId))?.state as
        | { campaignSkus?: Array<{ skuId: number; isHero: boolean }> }
        | undefined;
      const live = current?.campaignSkus;
      if (
        Array.isArray(live) &&
        live.length === union.length &&
        union.every((entry) => live.some((s) => s.skuId === entry.skuId && s.isHero === entry.isHero))
      ) {
        return;
      }
    } catch {
      // state unreadable -> attempt the write anyway; a real failure surfaces from setPlanningSkus
    }
    await setPlanningSkus(sessionId, union);
  }

  return {
    configuredChannels: () => CONFIGURED_CHANNELS,
    channelRuleConfig: () => resolveChannelConfig(),
    liveGroupChannels: (businessGroup = 'sainsburys') => readLiveGroupChannels(businessGroup),
    featureFlags: () => PLANNER_FEATURE_FLAGS,

    setChannelMaxHeroSkus: async (channel, max) => {
      const { mediaId, mode } = await resolveChannelTarget(channel);
      await setMediaChannelMaxHeroSkus(mediaId, mode, max);
    },
    setChannelMinHeroSkus: async (channel, min) => {
      const { mediaId, mode } = await resolveChannelTarget(channel);
      await setMediaChannelMinHeroSkus(mediaId, mode, min);
    },
    getChannelSkuConfig: async (channel) => {
      const { mediaId, mode } = await resolveChannelTarget(channel);
      const setup = await getMediaChannelSetup(mediaId, mode);
      return { maxHeroSkus: setup?.maxHeroSKUs ?? null, minHeroSkus: setup?.minHeroSKUs ?? null };
    },
    resetChannelConfig: (channel) =>
      notImplemented(`resetChannelConfig(${channel})`, 'a captured dev-default channel config to restore after a test mutated maxHeroSkus/minHeroSkus (the values are not versioned, so a safe restore needs the pre-test snapshot or a documented default)'),

    ensureBrandLinkedSkus: (brand, skus) =>
      notImplemented(`ensureBrandLinkedSkus(${brand}, [${skus.join(',')}])`, 'catalogue API to assert/create the brand->SKU links the planner search resolves against'),
    linkSkuToBrand: (sku, brand) =>
      notImplemented(`linkSkuToBrand(${sku}, ${brand})`, 'catalogue mutation to associate a SKU with a brand'),
    unlinkSkuFromBrand: (sku, brand) =>
      notImplemented(`unlinkSkuFromBrand(${sku}, ${brand})`, 'catalogue mutation to remove a brand->SKU link (for deletion-sync cases)'),
    listBrandLinkedSkus: (brand) =>
      notImplemented(`listBrandLinkedSkus(${brand})`, 'catalogue read op listing a brand’s linked SKUs'),

    ensurePlanningSession,
    createMediaPlan: (advertiser, brand) =>
      notImplemented(`createMediaPlan(${advertiser}, ${brand})`, 'media-plan create mutation returning a plan id, to seed preconditions without the assistant UI'),
    assignChannelToPlan: (planId, channel, budget, startOffsetDays) =>
      notImplemented(`assignChannelToPlan(${planId}, ${channel}, ${budget}, +${startOffsetDays}d)`, 'media-plan mutation to add a channel with budget/dates'),
    // NB: the captured planningAI_updateState SET_SKUS contract is session-wide (no channel
    // dimension), so `channel` is accepted for call-site parity but does not scope the write — the
    // Hero/Measurement union is applied to the whole session. Documented in the header caveat.
    setPlanHeroSkus: (planId, _channel, skus) => applyPlanSkus(planId, skus, true),
    setPlanMeasurementSkus: (planId, _channel, skus) => applyPlanSkus(planId, skus, false),
    deleteMediaPlan: (planId) =>
      notImplemented(`deleteMediaPlan(${planId})`, 'media-plan delete mutation for post-test cleanup'),

    setFeatureFlags: (flags) =>
      notImplemented(`setFeatureFlags(${JSON.stringify(flags)})`, 'a programmatic flag setter (today flags are injected into localStorage in PlanningPage.goto, not via API)'),
    cleanupCreatedTestData: () =>
      notImplemented('cleanupCreatedTestData()', 'delete mutations for any plans/links/config a test created, to keep the shared dev env clean')
  };
}

// Machine-readable enumeration of the helpers that still need building (mirrors the stubs above).
// Kept in code next to the stubs so the two stay in sync when a helper is implemented. The seeding
// helpers the emitted SKU suites call (setPlanHeroSkus / setPlanMeasurementSkus / ensurePlanning-
// Session) plus the channel read helpers are IMPLEMENTED against nectar-api and live-proven (see
// header); what remains is a forward-looking roadmap (catalogue / plan-create / cleanup) that no
// current test exercises. The highest-value missing helper is assignChannelToPlan: it unblocks the
// warning/booking cases parked under "Pending Automation" in the SKU specs.
export interface MissingTestDataHelper {
  name: string;
  group: 'channel-config' | 'catalogue' | 'media-plan' | 'feature-flags' | 'cleanup';
  needs: string;
  usedByAreas: string[];
  /** True only for the helpers the current generated SKU suites actually call (the critical path). */
  critical?: boolean;
}

export const MISSING_TEST_DATA_FUNCTIONS: readonly MissingTestDataHelper[] = [
  { name: 'resetChannelConfig', group: 'channel-config', needs: 'a captured dev-default channel config (or pre-test snapshot) to restore after a test mutated maxHeroSkus/minHeroSkus', usedByAreas: ['all (teardown)'] },
  { name: 'ensureBrandLinkedSkus', group: 'catalogue', needs: 'catalogue API (assert/create brand->SKU links)', usedByAreas: ['Hero-SKU indicators / all-brand-linked modal', 'Single-prompt Hero + Measurement parsing'] },
  { name: 'linkSkuToBrand', group: 'catalogue', needs: 'catalogue mutation (associate SKU with brand)', usedByAreas: ['Hero-SKU indicators / all-brand-linked modal'] },
  { name: 'unlinkSkuFromBrand', group: 'catalogue', needs: 'catalogue mutation (remove brand->SKU link)', usedByAreas: ['Channel-level Hero edit, per-channel SKU definition & deletion sync'] },
  { name: 'listBrandLinkedSkus', group: 'catalogue', needs: 'catalogue read op (list brand SKUs)', usedByAreas: ['Hero-SKU indicators / all-brand-linked modal'] },
  { name: 'createMediaPlan', group: 'media-plan', needs: 'media-plan create mutation (returns plan id)', usedByAreas: ['all (fast precondition seeding)'] },
  { name: 'assignChannelToPlan', group: 'media-plan', needs: 'media-plan mutation (add channel + budget + dates)', usedByAreas: ['all (fast precondition seeding)'] },
  { name: 'deleteMediaPlan', group: 'media-plan', needs: 'media-plan delete mutation', usedByAreas: ['all (teardown)'] },
  { name: 'setFeatureFlags', group: 'feature-flags', needs: 'programmatic flag setter (today localStorage-only in PlanningPage.goto)', usedByAreas: ['all'] },
  { name: 'cleanupCreatedTestData', group: 'cleanup', needs: 'delete mutations for created plans/links/config', usedByAreas: ['all (teardown)'] }
] as const;

// The critical Hero-SKU helpers now backed by real captured GraphQL contracts (fixtures/nectar-api.ts).
// Listed for provenance/traceability; see this module's header caveat for why the SKU suites still
// cannot execute green despite these being implemented.
export const IMPLEMENTED_CRITICAL_TEST_DATA_FUNCTIONS: readonly string[] = [
  'setChannelMaxHeroSkus',
  'setChannelMinHeroSkus',
  'getChannelSkuConfig',
  'setPlanHeroSkus',
  'setPlanMeasurementSkus'
] as const;
