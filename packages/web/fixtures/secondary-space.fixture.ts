import {
  getPlan,
  nectarGraphql,
  type Plan
} from './nectar-api';

const BUSINESS_GROUP = 'sainsburys';

const PROFILE_QUERY = `query me {
  me {
    id
    partner { id type }
  }
}`;

const MEDIA_QUERY = `query admin_getEveryMedia($businessGroup: BusinessGroup) {
  admin_getEveryMedia(businessGroup: $businessGroup) {
    id
    name
    isVisible
    isVisibleToInternalOnly
    baseAssetType { id name }
    inStore { type storeLocation }
  }
}`;

const BASE_MEDIA_QUERY = `query base_getMediaDetails($input: GetMediaDetailsInput!) {
  base_getMediaDetails(input: $input) {
    id
    name
    piggyBackAssetTypes { id mandatory name }
  }
}`;

const ADVERTISER_CHANNEL_QUERY = `query allAdvertisersWithBrandName($shouldDisplayOnlyOffsite: Boolean) {
  allAdvertisers(shouldDisplayOnlyOffsite: $shouldDisplayOnlyOffsite) {
    displayName
    customName
    brands {
      displayName
      customName
      availableChannels
    }
  }
}`;

const PLANNING_CYCLES_QUERY = `query planning_getCycles($campaignStartDate: String) {
  planning_getCycles(campaignStartDate: $campaignStartDate) {
    foodGroup
    formattedFoodGroup
    cycle
    formattedCycle
    startDate
    endDate
  }
}`;

const SESSION_OWNERSHIP_QUERY = `query PlanningAIChatHistory($sessionId: String!) {
  planningAI_chatHistory(sessionId: $sessionId) {
    id
    userId
    planId
    createdAt
    status
  }
}`;

const PLAN_SECONDARY_SPACE_QUERY = `query planning_getPlan($planId: ID!) {
  planning_getPlan(planId: $planId) {
    id
    name
    status
    briefId
    advertiserId
    channels {
      instore {
        id
        mediaId
        mediaName
        piggyBackAssets { id quantity }
      }
    }
  }
}`;

const DELETE_PLAN_MUTATION = `mutation planning_deletePlan(
  $planId: ID!,
  $briefId: ID!,
  $advertiserId: ID!
) {
  planning_deletePlan(planId: $planId, briefId: $briefId, advertiserId: $advertiserId)
}`;

export type SecondarySpaceAsset = {
  id: number;
  mandatory: boolean;
  name: string | null;
};

export type BaseSecondarySpaceMedia = {
  id: number;
  name: string;
  piggyBackAssetTypes: SecondarySpaceAsset[];
};

export type SecondarySpaceMedia = {
  id: string;
  name: string;
  isVisible: boolean;
  isVisibleToInternalOnly: boolean;
  baseAssetType: { id: number; name: string };
  inStore: { type: string; storeLocation: string | null } | null;
};

export type SecondarySpaceFixtureSnapshot = {
  profile: { id: string; partner: { id: string; type: string } };
  publicMedia: SecondarySpaceMedia;
  internalMedia: SecondarySpaceMedia;
  publicDirect: BaseSecondarySpaceMedia;
  publicCache: BaseSecondarySpaceMedia;
  internalDirect: BaseSecondarySpaceMedia;
  internalCache: BaseSecondarySpaceMedia;
};

export type PersistedSecondarySpaceChannel = {
  id: string;
  mediaId: string;
  mediaName: string;
  piggyBackAssets: Array<{ id: number; quantity: number }>;
};

export type SecondarySpacePlanSnapshot = {
  id: string;
  name: string;
  status: string;
  briefId: string | null;
  advertiserId: string;
  channels: { instore: PersistedSecondarySpaceChannel[] };
};

export type SecondarySpaceCycleFixture = {
  foodGroup: string;
  formattedFoodGroup: string;
  cycle: string;
  formattedCycle: string;
  startDate: string;
  endDate: string;
};

type SessionOwnership = {
  id: string;
  userId: string;
  planId: string | null;
  createdAt: string | number;
  status: string;
};

type AdvertiserChannelAvailability = {
  displayName: string;
  customName: string | null;
  brands: Array<{
    displayName: string;
    customName: string | null;
    availableChannels: string[];
  }>;
};

export const secondarySpaceFixtureNames = {
  publicMedia: process.env.E2E_SECONDARY_SPACE_PUBLIC_CHANNEL?.trim() || 'e2e-do-not-update-piggyback',
  internalMedia: process.env.E2E_SECONDARY_SPACE_INTERNAL_CHANNEL?.trim() || 'OK_SecondSpace_BarkerEar'
} as const;

function oneMedia(media: SecondarySpaceMedia[], name: string): SecondarySpaceMedia {
  const matches = media.filter((entry) => entry.name === name);
  if (matches.length !== 1) {
    throw new Error(`secondary-space preflight: expected one visible media named "${name}", found ${matches.length}`);
  }
  const match = matches[0];
  if (!match.baseAssetType?.id || !match.inStore) {
    throw new Error(`secondary-space preflight: media "${name}" is not a Base-linked in-store channel`);
  }
  return match;
}

async function readProfile(): Promise<SecondarySpaceFixtureSnapshot['profile']> {
  const data = await nectarGraphql<{ me: SecondarySpaceFixtureSnapshot['profile'] }>('me', PROFILE_QUERY, {});
  return data.me;
}

async function readMedia(): Promise<SecondarySpaceMedia[]> {
  const data = await nectarGraphql<{ admin_getEveryMedia: SecondarySpaceMedia[] }>(
    'admin_getEveryMedia',
    MEDIA_QUERY,
    { businessGroup: BUSINESS_GROUP }
  );
  return data.admin_getEveryMedia ?? [];
}

export async function readBaseSecondarySpaceMedia(
  mediaId: number,
  fetchFromCache: boolean
): Promise<BaseSecondarySpaceMedia> {
  const data = await nectarGraphql<{ base_getMediaDetails: BaseSecondarySpaceMedia | null }>(
    'base_getMediaDetails',
    BASE_MEDIA_QUERY,
    { input: { mediaId, fetchFromCache } }
  );
  if (!data.base_getMediaDetails) {
    throw new Error(`secondary-space preflight: Base media ${mediaId} returned null`);
  }
  return data.base_getMediaDetails;
}

export async function readSecondarySpaceFixtureSnapshot(): Promise<SecondarySpaceFixtureSnapshot> {
  const [profile, media] = await Promise.all([readProfile(), readMedia()]);
  const publicMedia = oneMedia(media, secondarySpaceFixtureNames.publicMedia);
  const internalMedia = oneMedia(media, secondarySpaceFixtureNames.internalMedia);
  const [publicDirect, publicCache, internalDirect, internalCache] = await Promise.all([
    readBaseSecondarySpaceMedia(publicMedia.baseAssetType.id, false),
    readBaseSecondarySpaceMedia(publicMedia.baseAssetType.id, true),
    readBaseSecondarySpaceMedia(internalMedia.baseAssetType.id, false),
    readBaseSecondarySpaceMedia(internalMedia.baseAssetType.id, true)
  ]);
  return { profile, publicMedia, internalMedia, publicDirect, publicCache, internalDirect, internalCache };
}

export async function readSecondarySpaceCycleFixture(now = Date.now()): Promise<SecondarySpaceCycleFixture> {
  const data = await nectarGraphql<{ planning_getCycles: SecondarySpaceCycleFixture[] }>(
    'planning_getCycles',
    PLANNING_CYCLES_QUERY,
    { campaignStartDate: null }
  );
  const minimumStart = now + 60 * 24 * 60 * 60 * 1_000;
  const candidates = (data.planning_getCycles ?? [])
    .filter(
      (cycle) =>
        cycle.foodGroup === '2' &&
        cycle.formattedFoodGroup.startsWith('Group 2 -') &&
        /^\d+$/.test(cycle.cycle) &&
        Number.isFinite(Date.parse(cycle.startDate)) &&
        Number.isFinite(Date.parse(cycle.endDate))
    )
    .sort((left, right) => Date.parse(left.startDate) - Date.parse(right.startDate));
  const selected = candidates.find((cycle) => Date.parse(cycle.startDate) >= minimumStart);
  if (!selected) {
    throw new Error(
      'secondary-space preflight: no regular Group 2 cycle starts at least 60 days in the future; refresh the validated cycle fixture'
    );
  }
  return selected;
}

export function requireSecondarySpaceMutationPolicy(): void {
  if (process.env.E2E_SECONDARY_SPACE_MUTATION_ENABLED !== 'true') {
    throw new Error(
      'secondary-space mutation is denied by machine policy: set E2E_SECONDARY_SPACE_MUTATION_ENABLED=true only for disposable non-production plans with verified cleanup'
    );
  }
}

export async function requireInStoreAdvertiserBrand(advertiserName: string, brandName: string): Promise<void> {
  const data = await nectarGraphql<{ allAdvertisers: AdvertiserChannelAvailability[] }>(
    'allAdvertisersWithBrandName',
    ADVERTISER_CHANNEL_QUERY,
    { shouldDisplayOnlyOffsite: false }
  );
  const advertisers = (data.allAdvertisers ?? []).filter(
    (entry) => entry.customName === advertiserName || entry.displayName === advertiserName
  );
  if (advertisers.length !== 1) {
    throw new Error(`secondary-space preflight: expected one advertiser named "${advertiserName}", found ${advertisers.length}`);
  }
  const brands = advertisers[0].brands.filter(
    (entry) => entry.customName === brandName || entry.displayName === brandName
  );
  if (brands.length !== 1) {
    throw new Error(`secondary-space preflight: expected one brand named "${brandName}", found ${brands.length}`);
  }
  if (!brands[0].availableChannels.includes('INSTORE')) {
    throw new Error(`secondary-space preflight: brand "${brandName}" is not enabled for INSTORE`);
  }
}

async function readSessionOwnership(sessionId: string): Promise<SessionOwnership> {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(sessionId)) {
    throw new Error('secondary-space cleanup: refusing an invalid planning session id');
  }
  const data = await nectarGraphql<{ planningAI_chatHistory: SessionOwnership | null }>(
    'PlanningAIChatHistory',
    SESSION_OWNERSHIP_QUERY,
    { sessionId }
  );
  if (!data.planningAI_chatHistory) {
    throw new Error('secondary-space cleanup: the captured session does not exist or is not owned by this user');
  }
  return data.planningAI_chatHistory;
}

export async function readSecondarySpacePlan(sessionId: string): Promise<SecondarySpacePlanSnapshot> {
  const session = await readSessionOwnership(sessionId);
  if (!session.planId) {
    throw new Error('secondary-space persistence: the captured session has no planId');
  }
  const data = await nectarGraphql<{ planning_getPlan: SecondarySpacePlanSnapshot }>(
    'planning_getPlan',
    PLAN_SECONDARY_SPACE_QUERY,
    { planId: session.planId }
  );
  return data.planning_getPlan;
}

function stringField(plan: Plan, field: string): string | undefined {
  const value: unknown = plan[field];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export async function deleteOwnedSecondarySpacePlan(sessionId: string, createdAfterMs: number): Promise<void> {
  const [session, profile] = await Promise.all([readSessionOwnership(sessionId), readProfile()]);
  if (!session.planId) {
    return;
  }
  if (session.userId !== profile.id) {
    throw new Error('secondary-space cleanup: the captured session is not owned by the authenticated user');
  }
  const rawCreatedAt = String(session.createdAt);
  const numericCreatedAt = /^\d{13}$/.test(rawCreatedAt) ? Number(rawCreatedAt) : Number.NaN;
  const createdAt = Number.isFinite(numericCreatedAt) ? numericCreatedAt : Date.parse(rawCreatedAt);
  if (!Number.isFinite(createdAt) || createdAt < createdAfterMs - 120_000 || createdAt > Date.now() + 120_000) {
    throw new Error(
      'secondary-space cleanup: the captured session predates this test run; refusing to delete a non-owned plan'
    );
  }

  const plan = await getPlan(session.planId);
  const advertiserId = stringField(plan, 'advertiserId') ??
    (typeof plan.advertiser === 'object' && plan.advertiser !== null && typeof plan.advertiser.id === 'string'
      ? plan.advertiser.id
      : undefined);
  if (!advertiserId) {
    throw new Error('secondary-space cleanup: the captured plan has no advertiserId');
  }
  // The live delete contract requires ID! but accepts an empty value for Nectar AI
  // plans whose read model has briefId=null (verified against dev with a successful
  // delete and a post-delete "plan does not exist" read oracle on 2026-07-13).
  const briefId = stringField(plan, 'briefId') ?? '';

  const deleted = await nectarGraphql<{ planning_deletePlan: boolean }>(
    'planning_deletePlan',
    DELETE_PLAN_MUTATION,
    { planId: session.planId, briefId, advertiserId }
  );
  if (deleted.planning_deletePlan !== true) {
    throw new Error('secondary-space cleanup: planning_deletePlan did not confirm deletion');
  }

  try {
    await getPlan(session.planId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/plan does not exist within the users access/i.test(message)) {
      return;
    }
    throw error;
  }
  throw new Error('secondary-space cleanup: the captured plan still exists after planning_deletePlan');
}
