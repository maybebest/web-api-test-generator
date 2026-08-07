import { test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type ApiCallOptions = {
  data?: unknown;
  /**
   * Multipart form fields. The OAuth token endpoint insists on
   * multipart/form-data; everything else on this API is JSON. Field values
   * are never attached to the report — the login password travels here.
   */
  multipart?: Record<string, string>;
  params?: Record<string, string | number | boolean>;
  headers?: Record<string, string>;
  /** Per-call timeout; the whole suite follows the "no fetch without a deadline" rule. */
  timeoutMs?: number;
  /**
   * Keep this call out of the report. Use it for calls made in a waiting
   * loop, otherwise one wait fills the report with hundreds of entries.
   */
  quiet?: boolean;
};

export type ApiResult<T = unknown> = {
  status: number;
  ok: boolean;
  /** Parsed JSON body, or undefined when the response is empty / not JSON. */
  body: T | undefined;
  /** Raw response text as received (for non-JSON and diagnostic output). */
  text: string;
};

/**
 * Stage occasionally answers a chat write in ~20s; 15s produced spurious
 * failures that looked like product bugs.
 */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Small typed wrapper over the Playwright API client.
 *
 * Every call becomes a step in the report and attaches the request and the
 * response as JSON (the Authorization header is hidden). That way a failed
 * run can be read from the HTML report alone.
 *
 * The client never throws on a 4xx or 5xx answer. Tests check the status
 * themselves, because some checks expect an error on purpose.
 */
export class ApiClient {
  constructor(
    private readonly request: APIRequestContext,
    private readonly bearerToken?: string
  ) {}

  /** Same underlying context, requests signed with the given user/agent token. */
  withToken(token: string): ApiClient {
    return new ApiClient(this.request, token);
  }

  get<T>(path: string, options?: ApiCallOptions): Promise<ApiResult<T>> {
    return this.send('GET', path, options);
  }

  post<T>(path: string, options?: ApiCallOptions): Promise<ApiResult<T>> {
    return this.send('POST', path, options);
  }

  put<T>(path: string, options?: ApiCallOptions): Promise<ApiResult<T>> {
    return this.send('PUT', path, options);
  }

  patch<T>(path: string, options?: ApiCallOptions): Promise<ApiResult<T>> {
    return this.send('PATCH', path, options);
  }

  delete<T>(path: string, options?: ApiCallOptions): Promise<ApiResult<T>> {
    return this.send('DELETE', path, options);
  }

  async send<T>(method: HttpMethod, path: string, options: ApiCallOptions = {}): Promise<ApiResult<T>> {
    if (options.quiet) {
      return this.call(method, path, options);
    }
    return test.step(`API ${method} ${path}`, async () => {
      const result = await this.call<T>(method, path, options);
      await attachExchange(method, path, this.headersOf(options), options, result);
      return result;
    });
  }

  private headersOf(options: ApiCallOptions): Record<string, string> {
    const headers: Record<string, string> = { ...options.headers };
    if (this.bearerToken && !headers.Authorization) {
      headers.Authorization = `Bearer ${this.bearerToken}`;
    }
    return headers;
  }

  private async call<T>(method: HttpMethod, path: string, options: ApiCallOptions): Promise<ApiResult<T>> {
    const response = await this.request.fetch(path, {
      method,
      headers: this.headersOf(options),
      params: options.params,
      data: options.data,
      multipart: options.multipart,
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      failOnStatusCode: false
    });

    const text = await response.text();
    return {
      status: response.status(),
      ok: response.ok(),
      body: parseJsonOrUndefined<T>(text),
      text
    };
  }
}

function parseJsonOrUndefined<T>(text: string): T | undefined {
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

async function attachExchange(
  method: HttpMethod,
  path: string,
  headers: Record<string, string>,
  options: ApiCallOptions,
  result: ApiResult<unknown>
): Promise<void> {
  const exchange = {
    request: {
      method,
      path,
      headers: redactSecrets(headers),
      body: options.data ?? null
    },
    response: {
      status: result.status,
      body: result.body ?? result.text ?? null
    }
  };

  await test.info().attach(`${method} ${path} → ${result.status}`, {
    body: JSON.stringify(exchange, null, 2),
    contentType: 'application/json'
  });
}

function redactSecrets(headers: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    redacted[name] = /authorization|token|password/i.test(name) ? '<redacted>' : value;
  }
  return redacted;
}
