// GraphQL transport for advertiser operations.
//
// Injectable seam (Dependency Injection): the same CRUD client runs against Playwright's
// APIRequestContext in tests OR plain `fetch` standalone. Auth + base URL are read from the
// environment and never logged.

import {
  ADVERTISER_DEFAULT_BASE_URL,
  ADVERTISER_ENDPOINT_PATH,
  type AdvertiserOperation
} from './operations.js';

export interface GraphQLErrorShape {
  message: string;
  path?: Array<string | number>;
  extensions?: Record<string, unknown>;
}

export interface TransportConfig {
  /** Defaults to env ADVERTISER_BASE_URL / BASE_URL, then the captured origin. */
  baseUrl?: string;
  /** GraphQL endpoint path. Defaults to '/api/graphql/'. */
  endpointPath?: string;
  /** Bearer token. Defaults to env ADVERTISER_BEARER_TOKEN / API_AUTHORIZATION / API_TOKEN. */
  token?: string;
  /** Extra headers merged onto every request (e.g. enabled-feature-flags). */
  extraHeaders?: Record<string, string>;
}

export interface GraphQLTransport {
  execute<TData>(operation: AdvertiserOperation, variables: Record<string, unknown>): Promise<TData>;
}

/** Thrown for transport (non-2xx / non-JSON) and GraphQL (`errors[]`) failures. Never echoes secrets. */
export class AdvertiserApiError extends Error {
  constructor(
    message: string,
    readonly details: {
      operation: string;
      status?: number;
      graphQLErrors?: GraphQLErrorShape[];
      body?: string;
    }
  ) {
    super(message);
    this.name = 'AdvertiserApiError';
  }
}

function env(name: string): string | undefined {
  const value = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name];
  return value && value.trim() !== '' ? value : undefined;
}

export function resolveBaseUrl(config: TransportConfig): string {
  const baseUrl = config.baseUrl ?? env('ADVERTISER_BASE_URL') ?? env('BASE_URL') ?? ADVERTISER_DEFAULT_BASE_URL;
  return baseUrl.replace(/\/$/, '');
}

export function resolveToken(config: TransportConfig): string | undefined {
  return config.token ?? env('ADVERTISER_BEARER_TOKEN') ?? env('API_AUTHORIZATION') ?? env('API_TOKEN');
}

/** Default partner id (admin_getAdvertisers/getAdvertiser require one). From env ADVERTISER_PARTNER_ID. */
export function resolveDefaultPartnerId(): string | undefined {
  return env('ADVERTISER_PARTNER_ID');
}

export function buildRequestUrl(config: TransportConfig, operation: AdvertiserOperation): string {
  const path = config.endpointPath ?? ADVERTISER_ENDPOINT_PATH;
  return `${resolveBaseUrl(config)}${path}?op=${encodeURIComponent(operation.op)}`;
}

export function buildRequestHeaders(config: TransportConfig): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const token = resolveToken(config);
  if (token) {
    headers.authorization = /^bearer\s/i.test(token) ? token : `Bearer ${token}`;
  }
  return { ...headers, ...(config.extraHeaders ?? {}) };
}

export function buildRequestBody(operation: AdvertiserOperation, variables: Record<string, unknown>): string {
  return JSON.stringify({
    operationName: operation.operationName,
    query: operation.document,
    variables
  });
}

export function parseGraphQLResponse<TData>(
  operation: AdvertiserOperation,
  status: number,
  bodyText: string
): TData {
  let parsed: { data?: TData; errors?: GraphQLErrorShape[] };
  try {
    parsed = JSON.parse(bodyText) as { data?: TData; errors?: GraphQLErrorShape[] };
  } catch {
    throw new AdvertiserApiError(`${operation.operationName} returned non-JSON (HTTP ${status})`, {
      operation: operation.operationName,
      status,
      body: bodyText.slice(0, 500)
    });
  }

  if (parsed.errors && parsed.errors.length > 0) {
    throw new AdvertiserApiError(
      `${operation.operationName} GraphQL error: ${parsed.errors.map((error) => error.message).join('; ')}`,
      { operation: operation.operationName, status, graphQLErrors: parsed.errors }
    );
  }

  if (status < 200 || status >= 300) {
    throw new AdvertiserApiError(`${operation.operationName} failed with HTTP ${status}`, {
      operation: operation.operationName,
      status
    });
  }

  if (parsed.data === undefined) {
    throw new AdvertiserApiError(`${operation.operationName} returned no data`, {
      operation: operation.operationName,
      status
    });
  }

  return parsed.data;
}

// --- Playwright transport ----------------------------------------------------------------------

export interface PlaywrightApiResponse {
  status(): number;
  text(): Promise<string>;
}

export interface PlaywrightApiRequestContext {
  fetch(
    url: string,
    options: { method?: string; headers?: Record<string, string>; data?: string }
  ): Promise<PlaywrightApiResponse>;
}

/** Runs GraphQL calls through a Playwright APIRequestContext (the `request` fixture). */
export class PlaywrightGraphQLTransport implements GraphQLTransport {
  constructor(
    private readonly request: PlaywrightApiRequestContext,
    private readonly config: TransportConfig = {}
  ) {}

  async execute<TData>(operation: AdvertiserOperation, variables: Record<string, unknown>): Promise<TData> {
    const response = await this.request.fetch(buildRequestUrl(this.config, operation), {
      method: 'POST',
      headers: buildRequestHeaders(this.config),
      data: buildRequestBody(operation, variables)
    });
    return parseGraphQLResponse<TData>(operation, response.status(), await response.text());
  }
}

// --- fetch transport ---------------------------------------------------------------------------

export type FetchLike = (
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<{ status: number; text(): Promise<string> }>;

/** Runs GraphQL calls through global `fetch` (Node 18+/browser) or any fetch-compatible impl. */
export class FetchGraphQLTransport implements GraphQLTransport {
  constructor(
    private readonly config: TransportConfig = {},
    private readonly fetchImpl: FetchLike = (globalThis as unknown as { fetch: FetchLike }).fetch
  ) {
    if (typeof this.fetchImpl !== 'function') {
      throw new Error('FetchGraphQLTransport: no fetch implementation available; pass one explicitly.');
    }
  }

  async execute<TData>(operation: AdvertiserOperation, variables: Record<string, unknown>): Promise<TData> {
    const response = await this.fetchImpl(buildRequestUrl(this.config, operation), {
      method: 'POST',
      headers: buildRequestHeaders(this.config),
      body: buildRequestBody(operation, variables)
    });
    return parseGraphQLResponse<TData>(operation, response.status, await response.text());
  }
}
