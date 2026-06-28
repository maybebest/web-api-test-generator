// Channel-management data fixture for media-planner tests.
//
// This is a self-contained adaptation of the canonical client in the sibling repo
// `har-api-tests-sains-2.final/channel-management` (ChannelApi / PlaywrightGraphQLTransport).
// The current project's tsconfig is scoped + CommonJS/Node, so the sibling ESM
// module cannot be imported directly without breaking `typecheck`; this mirrors its
// transport + the OBSERVED read op (`admin_getEveryMedia`) instead.
//
// Scope: READ-ONLY. We resolve the configured channel-rule values that the gate
// assertions need (booking deadline, minimum duration, store band) and optionally
// verify the four group channels exist via the GraphQL API. We deliberately do NOT
// create/update/delete channels here: in the canonical client `admin_createMedia`
// and `admin_deleteMedia` are INFERRED (not observed) and destructive, and the spec
// treats the channel configuration as read-only with env-overrides as the source of
// truth. To mutate config, use the sibling client's observed `api.updateField(...)`.

const CHANNEL_ENDPOINT_PATH = '/api/graphql/';
const CHANNEL_DEFAULT_BASE_URL = 'https://www.dev.pollen.js-devops.co.uk';

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== '' ? value : undefined;
}

function numberEnv(name: string, fallback: number): number {
  const raw = env(name);
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// The four pre-configured group channels (read-only) the spec depends on.
export const CONFIGURED_CHANNELS = {
  onsite: env('E2E_MP_ONSITE_CHANNEL') ?? 'Onsite Display',
  offsite: env('E2E_MP_OFFSITE_CHANNEL') ?? 'Offsite Display',
  atHome: env('E2E_MP_ATHOME_CHANNEL') ?? 'Direct Mail',
  inStore: env('E2E_MP_INSTORE_CHANNEL') ?? 'In-store Radio'
} as const;

export type ChannelRuleConfig = {
  bookingDeadlineDays: number;
  minimumDurationDays: number;
  minStores: number;
  maxStores: number;
};

// Source of truth per the spec: env-override variables, falling back to the
// documented dev defaults (2 / 20 / 50 / 200).
export function resolveChannelConfig(): ChannelRuleConfig {
  return {
    bookingDeadlineDays: numberEnv('E2E_MP_CHANNEL_BOOKING_DEADLINE_DAYS', 2),
    minimumDurationDays: numberEnv('E2E_MP_CHANNEL_MIN_DURATION_DAYS', 20),
    minStores: numberEnv('E2E_MP_CHANNEL_MIN_STORES', 50),
    maxStores: numberEnv('E2E_MP_CHANNEL_MAX_STORES', 200)
  };
}

export type LiveChannel = { id: string; name: string; bookingDeadlineDays: number | null };

// Minimal GraphQL read query (observed op). Field selection trimmed to what the
// precondition guard needs; the canonical client selects the full media shape.
const ADMIN_GET_EVERY_MEDIA = `query admin_getEveryMedia($businessGroup: BusinessGroup) {
  admin_getEveryMedia(businessGroup: $businessGroup) {
    id
    name
    inStore { timeline { bookingDeadlineDays } }
  }
}`;

/**
 * Self-contained read client mirroring the sibling channel-management transport.
 * Returns the live group channels (for a precondition existence/config guard), or
 * an empty list when no `CHANNEL_BEARER_TOKEN` is configured (gates run offline).
 */
export async function readLiveGroupChannels(businessGroup = 'sainsburys'): Promise<LiveChannel[]> {
  const token = env('CHANNEL_BEARER_TOKEN') ?? env('API_AUTHORIZATION') ?? env('API_TOKEN');
  if (!token) {
    return [];
  }
  const baseUrl = (env('CHANNEL_BASE_URL') ?? env('BASE_URL') ?? CHANNEL_DEFAULT_BASE_URL).replace(/\/$/, '');
  const url = `${baseUrl}${CHANNEL_ENDPOINT_PATH}?op=${encodeURIComponent('query-admin_getEveryMedia')}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}`,
      ...(env('CHANNEL_FEATURE_FLAGS') ? { 'enabled-feature-flags': env('CHANNEL_FEATURE_FLAGS') as string } : {})
    },
    body: JSON.stringify({
      operationName: 'admin_getEveryMedia',
      query: ADMIN_GET_EVERY_MEDIA,
      variables: { businessGroup }
    })
  });

  if (!response.ok) {
    throw new Error(`channel-management read failed: HTTP ${response.status}`);
  }
  const json = (await response.json()) as {
    data?: { admin_getEveryMedia?: Array<{ id: string; name: string; inStore?: { timeline?: { bookingDeadlineDays?: number | null } } }> };
    errors?: Array<{ message: string }>;
  };
  if (json.errors?.length) {
    throw new Error(`channel-management GraphQL errors: ${json.errors.map((e) => e.message).join('; ')}`);
  }
  return (json.data?.admin_getEveryMedia ?? []).map((m) => ({
    id: m.id,
    name: m.name,
    bookingDeadlineDays: m.inStore?.timeline?.bookingDeadlineDays ?? null
  }));
}
