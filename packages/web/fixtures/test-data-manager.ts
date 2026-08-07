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
// HeroSkus) are implemented from the same contract. Catalogue reads use the captured
// planning_getCategories query. Live schema introspection exposes candidate plan save/channel/delete
// mutations, but not enough nullable-id or nested-input semantics to guarantee rollback; it exposes
// no per-SKU brand-link mutation. Writes therefore run only through an explicitly supplied,
// independently verified TestDataContracts adapter. Every mutation is preflighted with its inverse
// cleanup operation and ownership-checked before restoration.
//
// EXECUTION STATUS (2026-07-03) — the seeding pipeline is LIVE-PROVEN end-to-end: real catalogue
// skuIds (specs/skus/.sku-pools.json), a pinned QA-owned planningAI session via
// NECTAR_PLANNING_SESSION_ID, healed locators, and a no-op SET_SKUS guard
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
  getCategories,
  getMedia,
  getMediaChannelSetup,
  getPlanningSession,
  setMediaChannelMaxHeroSkus,
  setMediaChannelMinHeroSkus,
  setMediaChannelSkuConfig,
  setPlanningSkus,
  type MediaChannel,
  type SkuSelection
} from './nectar-api';
import { decideChannelRestore, decideSkuRestore } from '../data/restore-ownership';

// In-process leases prevent two Playwright manager instances from mutating the same external
// resource concurrently. Cross-process/shared-session mutation has no backend CAS and is therefore
// unsupported; external projects run with one worker and restore refuses any observed divergence.
const ACTIVE_RESOURCE_LEASES = new Map<string, symbol>();

// Feature flags the planner expects on (today set imperatively in PlanningPage.goto via localStorage).
export const PLANNER_FEATURE_FLAGS: Readonly<Record<string, boolean>> = {
  FEATURE_NECTAR_AI: true,
  FEATURE_NUP: true,
  FEATURE_NECTAR_AI_MP: true
};

export class NotImplementedTestDataError extends Error {
  constructor(fn: string, needs: string) {
    super(
      `test-data helper has no verified runtime contract: ${fn}. ` +
        `Needs: ${needs}. ` +
        `Supply the corresponding TestDataContracts adapter (see fixtures/test-data-manager.ts) ` +
        `before a test that depends on this precondition can run unattended.`
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

export type ChannelStoreBounds = {
  minStoreVolume: number | null;
  maxStoreVolume: number | null;
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

  // ---- Implemented channel configuration/read surface -------------------------------------
  setChannelMaxHeroSkus(channel: string, max: number | null): Promise<void>;
  setChannelMinHeroSkus(channel: string, min: number | null): Promise<void>;
  getChannelSkuConfig(channel: string): Promise<ChannelSkuConfig>;
  /** Live admin-configured store-volume bounds for the named media channel. */
  getChannelStoreBounds(channel: string): Promise<ChannelStoreBounds>;
  resetChannelConfig(channel: string): Promise<void>;

  // ---- Catalogue / brand / SKU linkage (areas: indicators, all-brand-linked, prompt parse) ----
  ensureBrandLinkedSkus(brand: string, skus: string[]): Promise<void>;
  linkSkuToBrand(sku: string, brand: string): Promise<void>;
  unlinkSkuFromBrand(sku: string, brand: string): Promise<void>;
  listBrandLinkedSkus(brand: string): Promise<string[]>;

  // ---- Media-plan seeding (skip the assistant UI for precondition setup) -------------------
  /**
   * Resolve the pinned QA-owned planningAI sessionId. Missing configuration fails closed because
   * the captured API has no session-delete operation.
   */
  ensurePlanningSession(): Promise<string>;
  createMediaPlan(advertiser: string, brand: string): Promise<string>;
  assignChannelToPlan(planId: string, channel: string, budget: string, startOffsetDays: number): Promise<void>;
  setPlanHeroSkus(planId: string, channel: string, skus: string[]): Promise<void>;
  setPlanMeasurementSkus(planId: string, channel: string, skus: string[]): Promise<void>;
  deleteMediaPlan(planId: string): Promise<void>;

  // ---- Feature flags + cleanup -------------------------------------------------------------
  setFeatureFlags(flags: Record<string, boolean>): Promise<void>;
  /** Restore only state this manager still owns (compare-before-restore race protection). */
  restoreMutatedTestData(): Promise<void>;
  /**
   * Restore manager-owned mutations and delete disposable plans created through supplied contracts.
   * Cleanup is ownership-aware and aggregates failures instead of silently leaking test data.
   */
  cleanupCreatedTestData(): Promise<void>;
}

/**
 * Environment-specific write contracts that are deliberately not inferred from read captures.
 * Implementations must target disposable non-production data and must resolve only after the
 * requested mutation is durable. createMediaPlan must create a new disposable plan; it must never
 * return a shared or pre-existing plan id.
 */
export interface TestDataContracts {
  /** Optional test seam; production defaults to the captured planning_getCategories read. */
  listBrandLinkedSkus?(brand: string): Promise<string[]>;
  linkSkuToBrand?(sku: string, brand: string): Promise<void>;
  unlinkSkuFromBrand?(sku: string, brand: string): Promise<void>;
  createMediaPlan?(advertiser: string, brand: string): Promise<string>;
  assignChannelToPlan?(planId: string, channel: string, budget: string, startOffsetDays: number): Promise<void>;
  deleteMediaPlan?(planId: string): Promise<void>;
  /** Browser/runtime bridge. The Playwright fixture supplies a localStorage implementation. */
  setFeatureFlags?(flags: Readonly<Record<string, boolean>>): Promise<void>;
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

function requireNonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`test-data helper: ${label} must be a non-empty string`);
  }
  return normalized;
}

function normalizeSku(raw: string): string {
  const value = requireNonEmpty(raw, 'sku');
  if (!/^\d+$/.test(value)) {
    throw new Error(`test-data helper: sku must be a positive integer id, got "${raw}"`);
  }
  const sku = BigInt(value);
  if (sku <= 0n || sku > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`test-data helper: sku must be a positive safe-integer id, got "${raw}"`);
  }
  return sku.toString();
}

type CategorySkuNode = {
  skus?: readonly { skuId: number }[] | null;
  subCategories?: readonly CategorySkuNode[] | null;
};

export function extractCategorySkuIds(categories: readonly CategorySkuNode[]): string[] {
  const ids = new Set<string>();
  const visit = (category: CategorySkuNode): void => {
    for (const sku of category.skus ?? []) {
      if (Number.isSafeInteger(sku.skuId) && sku.skuId > 0) {
        ids.add(String(sku.skuId));
      }
    }
    for (const child of category.subCategories ?? []) {
      visit(child);
    }
  };
  categories.forEach(visit);
  return [...ids].sort((left, right) => {
    const a = BigInt(left);
    const b = BigInt(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

function equalStringSets(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function validateFeatureFlags(flags: Record<string, boolean>): Readonly<Record<string, boolean>> {
  if (!flags || typeof flags !== 'object' || Array.isArray(flags)) {
    throw new Error('test-data helper: feature flags must be a string-to-boolean object');
  }
  const normalized: Record<string, boolean> = {};
  for (const [name, enabled] of Object.entries(flags)) {
    if (!/^[A-Z][A-Z0-9_]{0,127}$/.test(name) || typeof enabled !== 'boolean') {
      throw new Error(`test-data helper: invalid feature flag entry ${JSON.stringify(name)}`);
    }
    normalized[name] = enabled;
  }
  return Object.freeze(normalized);
}


export function createTestDataManager(contracts: TestDataContracts = {}): TestDataManager {
  const managerLease = Symbol('test-data-manager');
  const ownedLeases = new Set<string>();
  function acquireLease(resource: string): void {
    const owner = ACTIVE_RESOURCE_LEASES.get(resource);
    if (owner && owner !== managerLease) {
      throw new Error(`test-data lease conflict for ${resource}; concurrent mutation is refused`);
    }
    ACTIVE_RESOURCE_LEASES.set(resource, managerLease);
    ownedLeases.add(resource);
  }
  function releaseLease(resource: string): void {
    if (ACTIVE_RESOURCE_LEASES.get(resource) === managerLease) {
      ACTIVE_RESOURCE_LEASES.delete(resource);
    }
    ownedLeases.delete(resource);
  }
  // planningAI_updateState SET_SKUS replaces the ENTIRE selection, so Hero and Measurement writes for
  // the same session must be unioned. Accumulate per resolved sessionId (skuId -> isHero) across the
  // Hero/Measurement calls a single case makes on this manager instance.
  const skuSelectionBySession = new Map<string, Map<number, boolean>>();
  const originalSkuSelectionBySession = new Map<string, SkuSelection[]>();
  const lastWrittenSkuSelectionBySession = new Map<string, SkuSelection[]>();
  const originalChannelConfig = new Map<
    string,
    { mediaId: string; mode: MediaChannel; maxHeroSKUs: number | null; minHeroSKUs: number | null }
  >();
  const lastWrittenChannelConfig = new Map<string, { maxHeroSKUs: number | null; minHeroSKUs: number | null }>();
  const brandSnapshots = new Map<
    string,
    { brand: string; original: Set<string>; lastWritten: Set<string> }
  >();
  const createdPlanIds: string[] = [];
  let activeFeatureFlags: Readonly<Record<string, boolean>> = Object.freeze({ ...PLANNER_FEATURE_FLAGS });

  async function readBrandLinkedSkus(brandInput: string): Promise<string[]> {
    const brand = requireNonEmpty(brandInput, 'brand');
    const raw = contracts.listBrandLinkedSkus
      ? await contracts.listBrandLinkedSkus(brand)
      : extractCategorySkuIds(await getCategories({ brandNames: [brand], searchQuery: '' }));
    if (!Array.isArray(raw)) {
      throw new Error('test-data helper: listBrandLinkedSkus contract returned a non-array value');
    }
    return [...new Set(raw.map(normalizeSku))].sort((left, right) => {
      const a = BigInt(left);
      const b = BigInt(right);
      return a < b ? -1 : a > b ? 1 : 0;
    });
  }

  async function mutateBrandLink(brandInput: string, skuInput: string, shouldExist: boolean): Promise<void> {
    const brand = requireNonEmpty(brandInput, 'brand');
    const sku = normalizeSku(skuInput);
    const key = brand.toLocaleLowerCase('en-US');
    const resource = `brand:${key}`;
    const current = new Set(await readBrandLinkedSkus(brand));
    if (current.has(sku) === shouldExist) {
      return;
    }
    if (!contracts.linkSkuToBrand || !contracts.unlinkSkuFromBrand) {
      notImplemented(
        `${shouldExist ? 'linkSkuToBrand' : 'unlinkSkuFromBrand'}(${sku}, ${brand})`,
        'verified catalogue link AND unlink mutations. Both TestDataContracts methods are required before a reversible shared-catalogue write is allowed; no such mutation exists in the captured repository traffic'
      );
    }

    acquireLease(resource);
    const existing = brandSnapshots.get(key);
    if (existing && !equalStringSets(current, existing.lastWritten)) {
      throw new Error(
        `test-data mutation conflict for brand ${brand}: live catalogue links diverged from this manager's last write; refusing to clobber concurrent changes`
      );
    }
    const snapshot = existing ?? { brand, original: new Set(current), lastWritten: new Set(current) };
    const intended = new Set(current);
    if (shouldExist) {
      intended.add(sku);
    } else {
      intended.delete(sku);
    }
    snapshot.lastWritten = intended;
    brandSnapshots.set(key, snapshot);

    try {
      if (shouldExist) {
        await contracts.linkSkuToBrand(sku, brand);
      } else {
        await contracts.unlinkSkuFromBrand(sku, brand);
      }
      const verified = new Set(await readBrandLinkedSkus(brand));
      if (!equalStringSets(verified, intended)) {
        throw new Error(
          `test-data helper: catalogue ${shouldExist ? 'link' : 'unlink'} contract resolved without producing the requested brand state`
        );
      }
    } catch (error) {
      throw new Error(
        `test-data helper: failed to ${shouldExist ? 'link' : 'unlink'} SKU ${sku} ${shouldExist ? 'to' : 'from'} brand ${brand}`,
        { cause: error }
      );
    }
  }

  async function ensureBrandLinkedSkus(brandInput: string, requested: string[]): Promise<void> {
    const brand = requireNonEmpty(brandInput, 'brand');
    if (!Array.isArray(requested)) {
      throw new Error('test-data helper: skus must be an array');
    }
    const wanted = [...new Set(requested.map(normalizeSku))];
    if (wanted.length === 0) {
      return;
    }
    const linked = new Set(await readBrandLinkedSkus(brand));
    for (const sku of wanted) {
      if (!linked.has(sku)) {
        await mutateBrandLink(brand, sku, true);
        linked.add(sku);
      }
    }
  }

  async function restoreBrandLinks(): Promise<Error[]> {
    const failures: Error[] = [];
    for (const [key, snapshot] of [...brandSnapshots]) {
      const resource = `brand:${key}`;
      try {
        const live = new Set(await readBrandLinkedSkus(snapshot.brand));
        if (equalStringSets(live, snapshot.original)) {
          brandSnapshots.delete(key);
          releaseLease(resource);
          continue;
        }
        if (!equalStringSets(live, snapshot.lastWritten)) {
          throw new Error(
            `test-data restore conflict for brand ${snapshot.brand}: live catalogue links diverged from this manager's last write; refusing to clobber concurrent changes`
          );
        }
        if (!contracts.linkSkuToBrand || !contracts.unlinkSkuFromBrand) {
          throw new Error(`test-data restore contract disappeared for brand ${snapshot.brand}`);
        }
        for (const sku of snapshot.lastWritten) {
          if (!snapshot.original.has(sku)) {
            await contracts.unlinkSkuFromBrand(sku, snapshot.brand);
          }
        }
        for (const sku of snapshot.original) {
          if (!snapshot.lastWritten.has(sku)) {
            await contracts.linkSkuToBrand(sku, snapshot.brand);
          }
        }
        const restored = new Set(await readBrandLinkedSkus(snapshot.brand));
        if (!equalStringSets(restored, snapshot.original)) {
          throw new Error(`test-data restore verification failed for brand ${snapshot.brand}`);
        }
        brandSnapshots.delete(key);
        releaseLease(resource);
      } catch (error) {
        failures.push(error instanceof Error ? error : new Error(String(error)));
      }
    }
    return failures;
  }

  async function createDisposableMediaPlan(advertiserInput: string, brandInput: string): Promise<string> {
    const advertiser = requireNonEmpty(advertiserInput, 'advertiser');
    const brand = requireNonEmpty(brandInput, 'brand');
    if (!contracts.createMediaPlan || !contracts.deleteMediaPlan) {
      return notImplemented(
        `createMediaPlan(${advertiser}, ${brand})`,
        'a reversible create/delete adapter. Introspection found planning_savePartialCampaignDetailsAndBudget / planning_saveCompleteCampaignDetailsAndBudget and planning_deletePlan, but save may return null briefId/advertiserId while delete requires planId, briefId, and advertiserId; disposable-create and rollback semantics are therefore not yet guaranteed'
      );
    }
    const planId = requireNonEmpty(await contracts.createMediaPlan(advertiser, brand), 'created plan id');
    if (createdPlanIds.includes(planId)) {
      throw new Error(`test-data helper: createMediaPlan returned duplicate plan id ${planId}`);
    }
    acquireLease(`plan:${planId}`);
    createdPlanIds.push(planId);
    return planId;
  }

  async function deleteOwnedMediaPlan(planIdInput: string): Promise<void> {
    const planId = requireNonEmpty(planIdInput, 'plan id');
    const index = createdPlanIds.lastIndexOf(planId);
    if (index < 0) {
      throw new Error(
        `test-data helper: refusing to delete media plan ${planId}; this manager did not create it`
      );
    }
    if (!contracts.deleteMediaPlan) {
      return notImplemented(`deleteMediaPlan(${planId})`, 'the verified media-plan delete mutation supplied at creation time');
    }
    await contracts.deleteMediaPlan(planId);
    createdPlanIds.splice(index, 1);
    releaseLease(`plan:${planId}`);
  }

  // A pinned, QA-owned session is mandatory. The available API contract cannot delete sessions,
  // so silently creating one per test would accumulate external data indefinitely.
  async function ensurePlanningSession(): Promise<string> {
    const pinned = process.env.NECTAR_PLANNING_SESSION_ID?.trim();
    if (pinned) {
      return pinned;
    }
    throw new Error(
      'test-data helper: NECTAR_PLANNING_SESSION_ID is required. Automatic session creation is disabled because no session-delete contract is available; pin a disposable QA-owned session instead.'
    );
  }

  async function applyPlanSkus(plan: string, skus: string[], isHero: boolean): Promise<void> {
    // 'current' resolves through the required pinned session; any other value is taken to BE a live
    // planningAI sessionId (header caveat b).
    const sessionId = plan === 'current' ? await ensurePlanningSession() : plan;
    const sessionResource = `session:${sessionId}`;
    acquireLease(sessionResource);
    let live: Array<{ skuId: number; isHero: boolean }>;
    try {
      const current = (await getPlanningSession(sessionId))?.state as
        | { campaignSkus?: Array<{ skuId: number; isHero: boolean }> }
        | undefined;
      live = Array.isArray(current?.campaignSkus)
        ? current.campaignSkus.map(({ skuId, isHero: hero }) => ({ skuId, isHero: hero }))
        : [];
    } catch (error) {
      if (!originalSkuSelectionBySession.has(sessionId)) {
        releaseLease(sessionResource);
      }
      throw new Error(
        `test-data helper: refusing to mutate session ${sessionId} because its current SKU selection could not be captured for cleanup`,
        { cause: error }
      );
    }
    if (!originalSkuSelectionBySession.has(sessionId)) {
      originalSkuSelectionBySession.set(sessionId, live);
    }

    const selection =
      skuSelectionBySession.get(sessionId) ?? new Map<number, boolean>(live.map((sku) => [sku.skuId, sku.isHero]));

    // Each helper replaces its own role selection. Hero entries that are no longer Hero remain
    // selected as Measurement until the Measurement helper supplies its authoritative list; old
    // Measurement-only entries are removed before that list is applied. This makes [] meaningful
    // and prevents data from a pinned session leaking into the requested precondition.
    if (isHero) {
      for (const [skuId, hero] of selection) {
        if (hero) {
          selection.set(skuId, false);
        }
      }
    } else {
      for (const [skuId, hero] of selection) {
        if (!hero) {
          selection.delete(skuId);
        }
      }
    }
    for (const raw of skus) {
      const skuId = Number(normalizeSku(raw));
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
    if (
      live.length === union.length &&
      union.every((entry) => live.some((s) => s.skuId === entry.skuId && s.isHero === entry.isHero))
    ) {
      return;
    }
    lastWrittenSkuSelectionBySession.set(sessionId, union.map((sku) => ({ ...sku })));
    // Record the intended state before awaiting: a transport error can occur after the backend
    // commits. Teardown rereads and safely handles original/intended/diverged outcomes.
    await setPlanningSkus(sessionId, union);
  }

  async function snapshotChannelConfig(channel: string): Promise<{
    mediaId: string;
    mode: MediaChannel;
    maxHeroSKUs: number | null;
    minHeroSKUs: number | null;
  }> {
    const { mediaId, mode } = await resolveChannelTarget(channel);
    const key = `${mediaId}:${mode}`;
    acquireLease(`channel:${key}`);
    const existing = originalChannelConfig.get(key);
    if (existing) {
      return existing;
    }
    let setup;
    try {
      setup = await getMediaChannelSetup(mediaId, mode);
    } catch (error) {
      releaseLease(`channel:${key}`);
      throw error;
    }
    const snapshot = {
      mediaId,
      mode,
      maxHeroSKUs: setup?.maxHeroSKUs ?? null,
      minHeroSKUs: setup?.minHeroSKUs ?? null
    };
    originalChannelConfig.set(key, snapshot);
    return snapshot;
  }

  async function restoreChannelSnapshot(snapshot: {
    mediaId: string;
    mode: MediaChannel;
    maxHeroSKUs: number | null;
    minHeroSKUs: number | null;
  }): Promise<void> {
    const key = `${snapshot.mediaId}:${snapshot.mode}`;
    const lastWritten = lastWrittenChannelConfig.get(key);
    if (!lastWritten) {
      originalChannelConfig.delete(key);
      releaseLease(`channel:${key}`);
      return;
    }
    const liveSetup = await getMediaChannelSetup(snapshot.mediaId, snapshot.mode);
    const liveConfig = {
      maxHeroSKUs: liveSetup?.maxHeroSKUs ?? null,
      minHeroSKUs: liveSetup?.minHeroSKUs ?? null
    };
    const decision = decideChannelRestore(liveConfig, snapshot, lastWritten);
    if (decision === 'conflict') {
      throw new Error(
        `test-data restore conflict for ${key}: live channel config diverged from this manager's last write; refusing to clobber concurrent changes`
      );
    }
    if (decision === 'restore-owned-state') {
      await setMediaChannelSkuConfig(snapshot.mediaId, snapshot.mode, {
        maxHeroSKUs: snapshot.maxHeroSKUs,
        minHeroSKUs: snapshot.minHeroSKUs
      });
    }
    originalChannelConfig.delete(key);
    lastWrittenChannelConfig.delete(key);
    releaseLease(`channel:${key}`);
  }

  async function restoreMutatedTestData(): Promise<void> {
    const failures: Error[] = [];

    for (const [sessionId, original] of originalSkuSelectionBySession) {
      try {
        const lastWritten = lastWrittenSkuSelectionBySession.get(sessionId);
        if (!lastWritten) {
          originalSkuSelectionBySession.delete(sessionId);
          skuSelectionBySession.delete(sessionId);
          releaseLease(`session:${sessionId}`);
          continue;
        }
        const current = (await getPlanningSession(sessionId))?.state as
          | { campaignSkus?: Array<{ skuId: number; isHero: boolean }> }
          | undefined;
        const live = Array.isArray(current?.campaignSkus) ? current.campaignSkus : [];
        const decision = decideSkuRestore(live, original, lastWritten);
        if (decision === 'conflict') {
          throw new Error(
            `test-data restore conflict for session ${sessionId}: live SKU state diverged from this manager's last write; refusing to clobber concurrent changes`
          );
        }
        if (decision === 'restore-owned-state') {
          await setPlanningSkus(sessionId, original);
        }
        originalSkuSelectionBySession.delete(sessionId);
        skuSelectionBySession.delete(sessionId);
        lastWrittenSkuSelectionBySession.delete(sessionId);
        releaseLease(`session:${sessionId}`);
      } catch (error) {
        failures.push(error instanceof Error ? error : new Error(String(error)));
      }
    }

    for (const snapshot of [...originalChannelConfig.values()]) {
      try {
        await restoreChannelSnapshot(snapshot);
      } catch (error) {
        failures.push(error instanceof Error ? error : new Error(String(error)));
      }
    }

    failures.push(...(await restoreBrandLinks()));

    if (failures.length > 0) {
      throw new AggregateError(failures, 'test-data restore failed safely; shared non-production state was not overwritten');
    }
  }

  async function cleanupCreatedTestData(): Promise<void> {
    const failures: Error[] = [];
    try {
      await restoreMutatedTestData();
    } catch (error) {
      if (error instanceof AggregateError) {
        failures.push(...error.errors.map((cause) => (cause instanceof Error ? cause : new Error(String(cause)))));
      } else {
        failures.push(error instanceof Error ? error : new Error(String(error)));
      }
    }
    for (const planId of [...createdPlanIds].reverse()) {
      try {
        await deleteOwnedMediaPlan(planId);
      } catch (error) {
        failures.push(error instanceof Error ? error : new Error(String(error)));
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'test-data cleanup failed; one or more owned resources need manual inspection');
    }
  }

  return {
    configuredChannels: () => CONFIGURED_CHANNELS,
    channelRuleConfig: () => resolveChannelConfig(),
    liveGroupChannels: (businessGroup = 'sainsburys') => readLiveGroupChannels(businessGroup),
    featureFlags: () => activeFeatureFlags,

    setChannelMaxHeroSkus: async (channel, max) => {
      const snapshot = await snapshotChannelConfig(channel);
      const { mediaId, mode } = snapshot;
      const key = `${mediaId}:${mode}`;
      const previous = lastWrittenChannelConfig.get(key) ?? snapshot;
      lastWrittenChannelConfig.set(key, { maxHeroSKUs: max, minHeroSKUs: previous.minHeroSKUs });
      await setMediaChannelMaxHeroSkus(mediaId, mode, max);
    },
    setChannelMinHeroSkus: async (channel, min) => {
      const snapshot = await snapshotChannelConfig(channel);
      const { mediaId, mode } = snapshot;
      const key = `${mediaId}:${mode}`;
      const previous = lastWrittenChannelConfig.get(key) ?? snapshot;
      lastWrittenChannelConfig.set(key, { maxHeroSKUs: previous.maxHeroSKUs, minHeroSKUs: min });
      await setMediaChannelMinHeroSkus(mediaId, mode, min);
    },
    getChannelSkuConfig: async (channel) => {
      const { mediaId, mode } = await resolveChannelTarget(channel);
      const setup = await getMediaChannelSetup(mediaId, mode);
      return { maxHeroSkus: setup?.maxHeroSKUs ?? null, minHeroSkus: setup?.minHeroSKUs ?? null };
    },
    getChannelStoreBounds: async (channel) => {
      const { mediaId, mode } = await resolveChannelTarget(channel);
      const media = await getMedia(mediaId);
      const targeting = media[mode]?.audienceAndTargeting as
        | { minStoreVolume?: number | null; maxStoreVolume?: number | null }
        | undefined;
      return {
        minStoreVolume: typeof targeting?.minStoreVolume === 'number' ? targeting.minStoreVolume : null,
        maxStoreVolume: typeof targeting?.maxStoreVolume === 'number' ? targeting.maxStoreVolume : null
      };
    },
    resetChannelConfig: async (channel) => {
      const { mediaId, mode } = await resolveChannelTarget(channel);
      const snapshot = originalChannelConfig.get(`${mediaId}:${mode}`);
      if (snapshot) {
        await restoreChannelSnapshot(snapshot);
      }
    },

    ensureBrandLinkedSkus,
    linkSkuToBrand: (sku, brand) => mutateBrandLink(brand, sku, true),
    unlinkSkuFromBrand: (sku, brand) => mutateBrandLink(brand, sku, false),
    listBrandLinkedSkus: readBrandLinkedSkus,

    ensurePlanningSession,
    createMediaPlan: createDisposableMediaPlan,
    assignChannelToPlan: async (planIdInput, channelInput, budgetInput, startOffsetDays) => {
      const planId = requireNonEmpty(planIdInput, 'plan id');
      const channel = requireNonEmpty(channelInput, 'channel');
      const budget = requireNonEmpty(budgetInput, 'budget');
      if (!Number.isSafeInteger(startOffsetDays) || startOffsetDays < 0) {
        throw new Error('test-data helper: startOffsetDays must be a non-negative safe integer');
      }
      if (!createdPlanIds.includes(planId)) {
        throw new Error(
          `test-data helper: refusing to assign a channel to media plan ${planId}; this manager did not create it`
        );
      }
      if (!contracts.assignChannelToPlan) {
        return notImplemented(
          `assignChannelToPlan(${planId}, ${channel}, ${budget}, +${startOffsetDays}d)`,
          'a reversible channel-assignment adapter. Introspection found planning_savePartialChannelsAndMedia / planning_saveCompleteChannelsAndMedia, but the nested channel/media payload, identifier, budget/date, merge-vs-replace, and rollback semantics remain unverified'
        );
      }
      await contracts.assignChannelToPlan(planId, channel, budget, startOffsetDays);
    },
    // NB: the captured planningAI_updateState SET_SKUS contract is session-wide (no channel
    // dimension), so `channel` is accepted for call-site parity but does not scope the write — the
    // Hero/Measurement union is applied to the whole session. Documented in the header caveat.
    setPlanHeroSkus: (planId, _channel, skus) => applyPlanSkus(planId, skus, true),
    setPlanMeasurementSkus: (planId, _channel, skus) => applyPlanSkus(planId, skus, false),
    deleteMediaPlan: deleteOwnedMediaPlan,

    setFeatureFlags: async (flags) => {
      const validated = validateFeatureFlags(flags);
      const effective = Object.freeze({ ...PLANNER_FEATURE_FLAGS, ...validated });
      if (!contracts.setFeatureFlags) {
        return notImplemented(
          `setFeatureFlags(${JSON.stringify(effective)})`,
          'a browser/runtime feature-flag bridge. The Playwright dataManager fixture supplies one; direct manager construction must supply TestDataContracts.setFeatureFlags'
        );
      }
      await contracts.setFeatureFlags(effective);
      activeFeatureFlags = effective;
    },
    restoreMutatedTestData,
    cleanupCreatedTestData
  };
}

// Machine-readable enumeration of environment-specific backend contracts that are not present in
// repository captures. The manager methods themselves are implemented and deterministically tested,
// but these five writes cannot run against a real target until a verified adapter is supplied.
export interface MissingTestDataHelper {
  name: string;
  group: 'channel-config' | 'catalogue' | 'media-plan' | 'feature-flags';
  needs: string;
  usedByAreas: string[];
  /** True only for the helpers the current generated SKU suites actually call (the critical path). */
  critical?: boolean;
}

export const REQUIRED_EXTERNAL_TEST_DATA_CONTRACTS: readonly MissingTestDataHelper[] = [
  { name: 'linkSkuToBrand', group: 'catalogue', needs: 'a per-SKU brand-link mutation; none exists among the 189 introspected mutations', usedByAreas: ['Hero-SKU indicators / all-brand-linked modal'] },
  { name: 'unlinkSkuFromBrand', group: 'catalogue', needs: 'an inverse per-SKU brand-unlink mutation; none exists among the 189 introspected mutations', usedByAreas: ['Channel-level Hero edit, per-channel SKU definition & deletion sync'] },
  { name: 'createMediaPlan', group: 'media-plan', needs: 'safe disposable-create semantics for planning_savePartial/CompleteCampaignDetailsAndBudget plus guaranteed non-null briefId and advertiserId needed by rollback', usedByAreas: ['all (fast precondition seeding)'] },
  { name: 'assignChannelToPlan', group: 'media-plan', needs: 'verified enum/domain mapping plus merge and rollback semantics for planning_savePartial/CompleteChannelsAndMedia', usedByAreas: ['all (fast precondition seeding)'] },
  { name: 'deleteMediaPlan', group: 'media-plan', needs: 'guaranteed planId, briefId, and advertiserId for planning_deletePlan(planId:ID!, briefId:ID!, advertiserId:ID!)->Boolean plus verified idempotency', usedByAreas: ['entity-creating teardown'] }
] as const;

/** Backward-compatible name used by older diagnostics. These are missing external contracts, not stubs. */
export const MISSING_TEST_DATA_FUNCTIONS = REQUIRED_EXTERNAL_TEST_DATA_CONTRACTS;

// Implemented helpers backed by captured contracts or safe local cleanup semantics. Listed for
// provenance/traceability; suites needing a missing roadmap helper remain pending automation.
export const IMPLEMENTED_CRITICAL_TEST_DATA_FUNCTIONS: readonly string[] = [
  'setChannelMaxHeroSkus',
  'setChannelMinHeroSkus',
  'getChannelSkuConfig',
  'getChannelStoreBounds',
  'resetChannelConfig',
  'listBrandLinkedSkus',
  'ensureBrandLinkedSkus',
  'linkSkuToBrand',
  'unlinkSkuFromBrand',
  'createMediaPlan',
  'assignChannelToPlan',
  'deleteMediaPlan',
  'setFeatureFlags',
  'setPlanHeroSkus',
  'setPlanMeasurementSkus',
  'restoreMutatedTestData',
  'cleanupCreatedTestData'
] as const;
