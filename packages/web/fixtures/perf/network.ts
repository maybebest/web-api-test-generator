// Per-test API network capture (XHR/fetch only) via Playwright request events. Cross-browser, no CDP.
//
// The collector registers `requestfinished` / `requestfailed` listeners at fixture setup (before the
// page navigates) and just stores the Request objects synchronously — the async details (status,
// sizes) are read once at teardown, when every request has settled, avoiding a race with async event
// handlers. Web-only — must NOT import from packages/api.
//
// PII: URLs can carry tokens in the query string. We redact sensitive params and never read request
// or response BODIES or headers, so nothing secret is written. Output still lands only in the
// gitignored performance/ + test-results/ trees.
import type { Page, Request } from '@playwright/test';
import type { NetworkBlock, NetworkRequest, NetworkSummary } from './types';
import { redactUrl } from './redact';

// Only application data calls, not static assets (js/css/img/font/media/document).
const API_TYPES = new Set(['xhr', 'fetch']);
const SLOWEST_LIMIT = 5;

function round(value: number): number | null {
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

async function toRecord(request: Request, isFailed: boolean): Promise<NetworkRequest> {
  const timing = request.timing();
  const ttfbMs =
    timing.responseStart >= 0 && timing.requestStart >= 0 ? round(timing.responseStart - timing.requestStart) : null;
  const downloadMs =
    timing.responseEnd >= 0 && timing.responseStart >= 0 ? round(timing.responseEnd - timing.responseStart) : null;

  let status: number | null = null;
  let responseBodyBytes: number | null = null;
  let responseHeadersBytes: number | null = null;
  if (!isFailed) {
    try {
      const response = await request.response();
      status = response ? response.status() : null;
    } catch {
      // A closing context can reject response() — leave status null.
    }
    try {
      const sizes = await request.sizes();
      responseBodyBytes = Number.isFinite(sizes.responseBodySize) ? sizes.responseBodySize : null;
      responseHeadersBytes = Number.isFinite(sizes.responseHeadersSize) ? sizes.responseHeadersSize : null;
    } catch {
      // sizes() can reject if the request never completed — leave sizes null.
    }
  }

  return {
    url: redactUrl(request.url()),
    method: request.method(),
    type: request.resourceType(),
    status,
    failed: isFailed,
    errorText: isFailed ? (request.failure()?.errorText ?? null) : null,
    responseBodyBytes,
    responseHeadersBytes,
    timing: { ttfbMs, downloadMs, totalMs: round(timing.responseEnd) }
  };
}

function summarize(requests: NetworkRequest[]): NetworkSummary {
  const byStatusClass = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, failed: 0 };
  const byType: Record<string, number> = {};
  let totalResponseBodyBytes = 0;

  for (const request of requests) {
    byType[request.type] = (byType[request.type] ?? 0) + 1;
    if (typeof request.responseBodyBytes === 'number') {
      totalResponseBodyBytes += request.responseBodyBytes;
    }
    if (request.failed) {
      byStatusClass.failed += 1;
    } else if (typeof request.status === 'number') {
      const bucket = `${Math.floor(request.status / 100)}xx` as keyof typeof byStatusClass;
      if (bucket in byStatusClass) {
        byStatusClass[bucket] += 1;
      }
    }
  }

  const slowest = requests
    .filter((request) => typeof request.timing.totalMs === 'number')
    .sort((a, b) => (b.timing.totalMs ?? 0) - (a.timing.totalMs ?? 0))
    .slice(0, SLOWEST_LIMIT)
    .map((request) => ({ url: request.url, method: request.method, status: request.status, totalMs: request.timing.totalMs }));

  const failures = requests
    .filter((request) => request.failed)
    .map((request) => ({ url: request.url, method: request.method, errorText: request.errorText }));

  return { total: requests.length, byStatusClass, byType, totalResponseBodyBytes, slowest, failures };
}

export function emptyNetworkBlock(): NetworkBlock {
  return {
    summary: { total: 0, byStatusClass: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, failed: 0 }, byType: {}, totalResponseBodyBytes: 0, slowest: [], failures: [] },
    requests: []
  };
}

export type NetworkCollector = {
  finalize(): Promise<NetworkBlock>;
};

export function createNetworkCollector(page: Page): NetworkCollector {
  const finished: Request[] = [];
  const failed: Request[] = [];
  const onFinished = (request: Request): void => {
    if (API_TYPES.has(request.resourceType())) {
      finished.push(request);
    }
  };
  const onFailed = (request: Request): void => {
    if (API_TYPES.has(request.resourceType())) {
      failed.push(request);
    }
  };
  page.on('requestfinished', onFinished);
  page.on('requestfailed', onFailed);

  return {
    async finalize(): Promise<NetworkBlock> {
      page.off('requestfinished', onFinished);
      page.off('requestfailed', onFailed);
      try {
        const requests: NetworkRequest[] = [
          ...(await Promise.all(finished.map((request) => toRecord(request, false)))),
          ...(await Promise.all(failed.map((request) => toRecord(request, true))))
        ];
        return { summary: summarize(requests), requests };
      } catch {
        return emptyNetworkBlock();
      }
    }
  };
}
