// Reusable GraphQL client for the Nectar AI media-planner admin + planning operations.
//
// Built from real dev-environment captures (see nectar-api.queries.ts). These are the functions the
// SKU test-data helpers were blocked on: set a plan session's Hero/Measurement SKUs
// (planningAI_updateState) and set a channel's maxHeroSKUs (admin_getMedia -> admin_editMedia).
//
// Auth: a Bearer token. Resolution order — an explicit `token` option, then env
// (API_AUTHORIZATION / API_TOKEN / CHANNEL_BEARER_TOKEN), then the MSAL idToken embedded in the
// Playwright storage state at E2E_AUTH_STATE_PATH (default playwright/.auth/user.json). That last
// path lets these functions run straight from a saved session with no extra token wiring.
//
// Web-only — must NOT import from packages/api (the transport mirrors channel-management.fixture.ts).
import fs from 'node:fs';
import {
  ADMIN_EDIT_MEDIA,
  ADMIN_GET_EVERY_MEDIA,
  ADMIN_GET_MEDIA,
  NECTAR_GET_ADVERTISERS_ALL,
  PLANNING_CHAT,
  PLANNING_CHAT_HISTORY,
  PLANNING_GET_CATEGORIES,
  PLANNING_GET_PLAN,
  PLANNING_GET_SKUS,
  PLANNING_GET_SKUS_BY_SKU_ID,
  PLANNING_UPDATE_STATE
} from './nectar-api.queries';

const ENDPOINT_PATH = '/api/graphql/';
const DEFAULT_BASE_URL = 'https://www.dev.pollen.js-devops.co.uk';

export type SkuSelection = { skuId: number; isHero: boolean };
export type MediaChannel = 'inStore' | 'offSite' | 'onSite' | 'atHome';

export type NectarApiOptions = {
  token?: string;
  baseUrl?: string;
  businessGroup?: string;
};

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== '' ? value : undefined;
}

type MsalCache = { idToken?: string; refreshToken?: string };

// Pull the MSAL idToken + refreshToken (the JWTs in `secret`) out of a Playwright storage state file.
// MSAL stores them under localStorage keys containing '-idtoken-' / '-refreshtoken-'.
function readMsalCache(): MsalCache {
  const statePath = env('E2E_AUTH_STATE_PATH') ?? 'playwright/.auth/user.json';
  const cache: MsalCache = {};
  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8')) as {
      origins?: Array<{ localStorage?: Array<{ name: string; value: string }> }>;
    };
    for (const origin of state.origins ?? []) {
      for (const item of origin.localStorage ?? []) {
        const secret = /-idtoken-|-refreshtoken-/i.test(item.name)
          ? (JSON.parse(item.value) as { secret?: string }).secret
          : undefined;
        if (!secret) {
          continue;
        }
        if (/-idtoken-/i.test(item.name)) {
          cache.idToken = secret;
        } else if (/-refreshtoken-/i.test(item.name)) {
          cache.refreshToken = secret;
        }
      }
    }
  } catch {
    // no state file / unreadable
  }
  return cache;
}

function decodeJwt(jwt: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(Buffer.from(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()) as Record<
      string,
      unknown
    >;
  } catch {
    return undefined;
  }
}

function isFresh(jwt: string): boolean {
  const exp = decodeJwt(jwt)?.exp;
  return typeof exp === 'number' && exp - Math.floor(Date.now() / 1000) > 60;
}

// Exchange the (long-lived, ~hours) MSAL refresh token for a fresh short-lived idToken via the B2C
// token endpoint — the same refresh the app does in the browser. Endpoint + policy + clientId are
// derived from the OLD idToken's claims (iss / acr / aud), so no environment-specific config is
// baked in. Returns the fresh idToken JWT, or undefined on failure.
async function refreshIdToken(cache: MsalCache): Promise<string | undefined> {
  if (!cache.refreshToken || !cache.idToken) {
    return undefined;
  }
  const claims = decodeJwt(cache.idToken);
  const iss = typeof claims?.iss === 'string' ? claims.iss : undefined;
  const policy = typeof claims?.acr === 'string' ? claims.acr : undefined;
  const clientId = typeof claims?.aud === 'string' ? claims.aud : undefined;
  if (!iss || !policy || !clientId) {
    return undefined;
  }
  const issBase = iss.replace(/\/v2\.0\/?$/, '');
  const tokenEndpoint = `${issBase}/${policy}/oauth2/v2.0/token`;
  try {
    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: cache.refreshToken,
        scope: `openid ${clientId} offline_access`
      })
    });
    if (!response.ok) {
      return undefined;
    }
    const json = (await response.json()) as { id_token?: string };
    return json.id_token;
  } catch {
    return undefined;
  }
}

// In-memory cache of a refreshed idToken so we refresh at most once per validity window per process.
let cachedBearer: string | undefined;

// Resolve a usable Bearer token: an explicit/env value wins; otherwise use the saved-session idToken
// while it is fresh, and transparently B2C-refresh it (via the refresh token) when it has expired.
export async function resolveFreshBearerToken(explicit?: string): Promise<string | undefined> {
  const direct = explicit ?? env('API_AUTHORIZATION') ?? env('API_TOKEN') ?? env('CHANNEL_BEARER_TOKEN');
  if (direct) {
    return direct.startsWith('Bearer ') ? direct : `Bearer ${direct}`;
  }
  if (cachedBearer && isFresh(cachedBearer.replace(/^Bearer /, ''))) {
    return cachedBearer;
  }
  const cache = readMsalCache();
  if (cache.idToken && isFresh(cache.idToken)) {
    cachedBearer = `Bearer ${cache.idToken}`;
    return cachedBearer;
  }
  const refreshed = await refreshIdToken(cache);
  if (refreshed) {
    cachedBearer = `Bearer ${refreshed}`;
    return cachedBearer;
  }
  return undefined;
}

function resolveBaseUrl(explicit?: string): string {
  return (explicit ?? env('CHANNEL_BASE_URL') ?? env('BASE_URL') ?? env('PLAYWRIGHT_TEST_BASE_URL') ?? DEFAULT_BASE_URL).replace(/\/$/, '');
}

// Core transport. operationName is echoed in the URL `?op=` (matches the observed requests) and the
// body. Throws on HTTP failure or GraphQL errors so a caller never silently seeds nothing.
// documentOperationName is what goes in the BODY, for the rare op whose URL ?op= label differs from
// the document's own operation name (nectar_getAdvertisers_all): a body operationName that does not
// appear in the document is an HTTP 400, while `null` omits the field entirely — mirroring the
// captured bodies, which carried no operationName (verified accepted live).
export async function nectarGraphql<T>(
  operationName: string,
  query: string,
  variables: Record<string, unknown>,
  options?: NectarApiOptions,
  documentOperationName: string | null = operationName
): Promise<T> {
  const token = await resolveFreshBearerToken(options?.token);
  if (!token) {
    throw new Error(
      'nectar-api: no bearer token available. Set API_AUTHORIZATION/API_TOKEN or provide a Playwright ' +
        'storage state at E2E_AUTH_STATE_PATH (default playwright/.auth/user.json) with a valid refresh token.'
    );
  }
  const url = `${resolveBaseUrl(options?.baseUrl)}${ENDPOINT_PATH}?op=${encodeURIComponent(operationName)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: token,
      ...(env('CHANNEL_FEATURE_FLAGS') ? { 'enabled-feature-flags': env('CHANNEL_FEATURE_FLAGS') as string } : {})
    },
    body: JSON.stringify(
      documentOperationName === null ? { query, variables } : { operationName: documentOperationName, query, variables }
    )
  });
  if (!response.ok) {
    throw new Error(`${operationName} failed: HTTP ${response.status}`);
  }
  const json = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) {
    throw new Error(`${operationName} GraphQL errors: ${json.errors.map((error) => error.message).join('; ')}`);
  }
  if (json.data === undefined) {
    throw new Error(`${operationName} returned no data`);
  }
  return json.data;
}

// ---- Planning session SKUs (Media plan edit sku HAR) --------------------------------------------

// Replace a plan session's ENTIRE SKU selection. isHero:true = Hero SKU, false = Measurement SKU.
// One call is authoritative for the whole set, so pass the union of Hero + Measurement.
export async function setPlanningSkus(sessionId: string, skus: SkuSelection[], options?: NectarApiOptions): Promise<void> {
  await nectarGraphql<{ planningAI_updateState: unknown }>(
    'planningAI_updateState',
    PLANNING_UPDATE_STATE,
    { sessionId, state: { action: 'SET_SKUS', value: skus } },
    options
  );
}

// Drive the assistant chat. Returns the sessionId (pass sessionId:null to create one).
export async function planningChat(
  input: { sessionId?: string | null; message: string; data?: unknown; action?: string | null },
  options?: NectarApiOptions
): Promise<string> {
  const data = await nectarGraphql<{ planningAI_chat: { sessionId: string } }>(
    'planningAI_chat',
    PLANNING_CHAT,
    { sessionId: input.sessionId ?? null, message: input.message, data: input.data ?? {}, action: input.action ?? null },
    options
  );
  return data.planningAI_chat.sessionId;
}

export type PlanningSession = {
  id: string;
  planId: string | null;
  status: string | null;
  state: unknown;
};

export async function getPlanningSession(sessionId: string, options?: NectarApiOptions): Promise<PlanningSession | null> {
  const data = await nectarGraphql<{ planningAI_chatHistory: PlanningSession | null }>(
    'PlanningAIChatHistory',
    PLANNING_CHAT_HISTORY,
    { sessionId },
    options
  );
  return data.planningAI_chatHistory ?? null;
}

// ---- Admin media / channel config (Max-hero-sku HAR) --------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Media = Record<string, any>;

export async function getMedia(mediaId: string, options?: NectarApiOptions): Promise<Media> {
  const data = await nectarGraphql<{ admin_getMedia: Media }>('admin_getMedia', ADMIN_GET_MEDIA, { mediaId }, options);
  return data.admin_getMedia;
}

export async function editMedia(mediaId: string, input: Media, options?: NectarApiOptions): Promise<string> {
  const data = await nectarGraphql<{ admin_editMedia: { id: string } }>(
    'admin_editMedia',
    ADMIN_EDIT_MEDIA,
    { mediaId, input },
    options
  );
  return data.admin_editMedia.id;
}

export type MediaSummary = { id: string; name: string };

export async function getEveryMedia(options?: NectarApiOptions): Promise<MediaSummary[]> {
  const data = await nectarGraphql<{ admin_getEveryMedia: MediaSummary[] }>(
    'admin_getEveryMedia',
    ADMIN_GET_EVERY_MEDIA,
    { businessGroup: options?.businessGroup ?? 'sainsburys' },
    options
  );
  return data.admin_getEveryMedia ?? [];
}

// Resolve a channel's mediaId by (case-insensitive) name match, e.g. "Offsite Display".
export async function findMediaId(name: string, options?: NectarApiOptions): Promise<string | undefined> {
  const wanted = name.trim().toLowerCase();
  const media = await getEveryMedia(options);
  return media.find((entry) => entry.name.trim().toLowerCase() === wanted)?.id;
}

// admin_MediaInput is strict (extra fields error), so strip GraphQL-only keys from the read-back
// media before sending it to editMedia.
function stripReadonly<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripReadonly(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === '__typename') {
        continue;
      }
      out[key] = stripReadonly(child);
    }
    return out as unknown as T;
  }
  return value;
}

export type ChannelSetup = {
  maxHeroSKUs: number | null;
  minHeroSKUs: number | null;
  totalSKUs: number | null;
  [key: string]: unknown;
};

// Read one channel's `setup` block (maxHeroSKUs / minHeroSKUs / ...) off a media, or undefined when
// that delivery-mode channel is null on the media.
export async function getMediaChannelSetup(
  mediaId: string,
  channel: MediaChannel,
  options?: NectarApiOptions
): Promise<ChannelSetup | undefined> {
  const media = await getMedia(mediaId, options);
  const channelObj = media[channel];
  return channelObj && typeof channelObj === 'object' ? (channelObj.setup as ChannelSetup | undefined) : undefined;
}

// Full-object channel-config write: read the media, shallow-merge `patch` into the requested channel's
// `setup`, and write the whole object back (admin_MediaInput is a full replacement — there is no
// partial-update mutation). Captured for inStore.setup on media "DD Trolleys" (maxHeroSKUs/minHeroSKUs);
// offSite/onSite/atHome share the same setup shape but were null in the capture — verify against the
// live schema before trusting a write to those modes.
async function patchMediaChannelSetup(
  mediaId: string,
  channel: MediaChannel,
  patch: Partial<ChannelSetup>,
  options?: NectarApiOptions
): Promise<void> {
  const media = await getMedia(mediaId, options);
  const input = stripReadonly<Media>(media);
  delete input.id;
  const channelInput = input[channel];
  if (!channelInput || typeof channelInput !== 'object') {
    throw new Error(`media ${mediaId} has no "${channel}" channel to configure setup on`);
  }
  channelInput.setup = { ...(channelInput.setup ?? {}), ...patch };
  await editMedia(mediaId, input, options);
}

export function setMediaChannelMaxHeroSkus(
  mediaId: string,
  channel: MediaChannel,
  max: number | null,
  options?: NectarApiOptions
): Promise<void> {
  return patchMediaChannelSetup(mediaId, channel, { maxHeroSKUs: max }, options);
}

export function setMediaChannelMinHeroSkus(
  mediaId: string,
  channel: MediaChannel,
  min: number | null,
  options?: NectarApiOptions
): Promise<void> {
  return patchMediaChannelSetup(mediaId, channel, { minHeroSKUs: min }, options);
}

// ---- Planning SKU / category / advertiser / plan reads (Media plan HARs) -------------------------

// A planning SKU as returned by the planning_getSkus / planning_getSkusBySkuId / category-tree
// selections. Only the live-observed core fields are typed; the index signature covers the rest of
// the selection (catLevelXName, manufacturer, isHFSS, isSensitive, sensitivity, updatedAt, ...).
export type PlanningSku = {
  id: string;
  skuName: string;
  skuId: number;
  brandName: string;
  catLevel1Id: number;
  catLevel2Id: number;
  catLevel3Id: number;
  catLevel4Id: number;
  catLevel5Id: number;
  [key: string]: unknown;
};

// Resolve SKUs directly by their numeric skuIds. Unknown ids are silently omitted from the result.
export async function getSkusBySkuId(skuIds: number[], options?: NectarApiOptions): Promise<PlanningSku[]> {
  const data = await nectarGraphql<{ planning_getSkusBySkuId: PlanningSku[] }>(
    'planning_getSkusBySkuId',
    PLANNING_GET_SKUS_BY_SKU_ID,
    { skuIds, businessGroup: options?.businessGroup ?? 'sainsburys' },
    options
  );
  return data.planning_getSkusBySkuId ?? [];
}

// Search a brand's SKUs within one full category path (the schema requires all five catLevel ids —
// take them from getCategories). searchQuery filters by name; null/omitted returns everything.
export async function getBrandSkus(
  input: {
    brandNames: string[];
    sainsburysBrandIds?: string[];
    catLevel1Id: number;
    catLevel2Id: number;
    catLevel3Id: number;
    catLevel4Id: number;
    catLevel5Id: number;
    searchQuery?: string | null;
  },
  options?: NectarApiOptions
): Promise<PlanningSku[]> {
  const data = await nectarGraphql<{ planning_getSkus: PlanningSku[] }>(
    'planning_getSkus',
    PLANNING_GET_SKUS,
    {
      brandNames: input.brandNames,
      catLevel1Id: input.catLevel1Id,
      catLevel2Id: input.catLevel2Id,
      catLevel3Id: input.catLevel3Id,
      catLevel4Id: input.catLevel4Id,
      catLevel5Id: input.catLevel5Id,
      searchQuery: input.searchQuery ?? null,
      businessGroup: options?.businessGroup ?? 'sainsburys',
      sainsburysBrandIds: input.sainsburysBrandIds
    },
    options
  );
  return data.planning_getSkus ?? [];
}

// One node of the planning_getCategories tree. The selection nests subCategories five levels deep;
// only the deepest level carries rootLevelIds/brands/skus (the captured response body was not kept,
// so the value types are the conservative reading of the selection — hence the index signature).
export type PlanningCategory = {
  id: number;
  name: string;
  subCategories?: PlanningCategory[] | null;
  rootLevelIds?: number[] | null;
  brands?: string[] | null;
  skus?: PlanningSku[] | null;
  [key: string]: unknown;
};

// Category tree for a brand — the source of the catLevel1..5 ids that getBrandSkus needs.
export async function getCategories(
  input: { brandNames: string[]; sainsburysBrandIds?: string[]; searchQuery?: string },
  options?: NectarApiOptions
): Promise<PlanningCategory[]> {
  const data = await nectarGraphql<{ planning_getCategories: PlanningCategory[] }>(
    'planning_getCategories',
    PLANNING_GET_CATEGORIES,
    {
      brandNames: input.brandNames,
      searchQuery: input.searchQuery ?? '',
      businessGroup: options?.businessGroup ?? 'sainsburys',
      sainsburysBrandIds: input.sainsburysBrandIds
    },
    options
  );
  return data.planning_getCategories ?? [];
}

// An advertiser as returned by nectar_getAdvertisers_all (field allAdvertisers). displayName /
// customName carry the human names; brands link to Sainsburys brand ids for the planning_* reads.
export type Advertiser = {
  id: string;
  displayName: string;
  customName?: string | null;
  businessGroup?: string | null;
  brands?: Array<{ id: string; displayName: string; customName?: string | null; [key: string]: unknown }> | null;
  [key: string]: unknown;
};

// List every advertiser (URL ?op=nectar_getAdvertisers_all, matching the observed request, even
// though the document's own operation name is allAdvertisersWithBrandName — hence the body
// operationName is omitted like the captured request, or the server 400s on the mismatch).
export async function getAdvertisers(options?: NectarApiOptions): Promise<Advertiser[]> {
  const data = await nectarGraphql<{ allAdvertisers: Advertiser[] }>(
    'nectar_getAdvertisers_all',
    NECTAR_GET_ADVERTISERS_ALL,
    { shouldDisplayOnlyOffsite: false },
    options,
    null
  );
  return data.allAdvertisers ?? [];
}

// The full media-plan object. The planning_getPlan selection is huge, so keep it loosely typed
// (same treatment as Media above).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Plan = Record<string, any>;

export async function getPlan(planId: string, options?: NectarApiOptions): Promise<Plan> {
  const data = await nectarGraphql<{ planning_getPlan: Plan }>('planning_getPlan', PLANNING_GET_PLAN, { planId }, options);
  return data.planning_getPlan;
}
