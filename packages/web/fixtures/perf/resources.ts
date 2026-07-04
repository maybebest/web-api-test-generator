// Resource Timing collector: every resource the page loaded (document/script/stylesheet/image/font/
// xhr/fetch/…), read once at teardown from performance.getEntriesByType('resource'). Complements the
// API-only `network` block (which is XHR/fetch only) with the full asset picture. Defensive: returns
// an empty block on any error. Web-only. Browser globals are reached via a globalThis cast (no DOM lib).
import type { Page } from '@playwright/test';
import type { ResourceBlock, ResourceEntry } from './types';
import { redactUrl } from './redact';

const SLOWEST_LIMIT = 8;

const EMPTY: ResourceBlock = {
  summary: { count: 0, totalTransferBytes: 0, totalDecodedBytes: 0, byType: {}, slowest: [] },
  list: []
};

export async function collectResourceTiming(page: Page): Promise<ResourceBlock> {
  if (page.isClosed()) {
    return EMPTY;
  }
  try {
    const raw = await page.evaluate(() => {
      const perf = (globalThis as unknown as {
        performance?: { getEntriesByType(type: string): unknown[] };
      }).performance;
      if (!perf) {
        return [] as Array<Record<string, unknown>>;
      }
      const round = (n: unknown): number | null =>
        typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (perf.getEntriesByType('resource') as any[]).map((e: any) => ({
        name: String(e.name ?? ''),
        initiatorType: typeof e.initiatorType === 'string' ? e.initiatorType : null,
        protocol: typeof e.nextHopProtocol === 'string' && e.nextHopProtocol ? e.nextHopProtocol : null,
        renderBlocking: typeof e.renderBlockingStatus === 'string' ? e.renderBlockingStatus : null,
        transferSize: round(e.transferSize),
        encodedBodySize: round(e.encodedBodySize),
        decodedBodySize: round(e.decodedBodySize),
        timing: {
          dnsMs: round(e.domainLookupEnd - e.domainLookupStart),
          tcpMs: round(e.connectEnd - e.connectStart),
          tlsMs: e.secureConnectionStart > 0 ? round(e.connectEnd - e.secureConnectionStart) : null,
          ttfbMs: round(e.responseStart - e.requestStart),
          downloadMs: round(e.responseEnd - e.responseStart),
          totalMs: round(e.duration)
        }
      }));
    });

    const list: ResourceEntry[] = (raw as unknown as ResourceEntry[]).map((entry) => ({
      ...entry,
      name: redactUrl(entry.name)
    }));
    return { summary: summarize(list), list };
  } catch {
    return EMPTY;
  }
}

function summarize(list: ResourceEntry[]): ResourceBlock['summary'] {
  const byType: Record<string, number> = {};
  let totalTransferBytes = 0;
  let totalDecodedBytes = 0;
  for (const entry of list) {
    const type = entry.initiatorType ?? 'other';
    byType[type] = (byType[type] ?? 0) + 1;
    if (typeof entry.transferSize === 'number') {
      totalTransferBytes += entry.transferSize;
    }
    if (typeof entry.decodedBodySize === 'number') {
      totalDecodedBytes += entry.decodedBodySize;
    }
  }
  const slowest = [...list]
    .filter((entry) => typeof entry.timing.totalMs === 'number')
    .sort((a, b) => (b.timing.totalMs ?? 0) - (a.timing.totalMs ?? 0))
    .slice(0, SLOWEST_LIMIT)
    .map((entry) => ({
      name: entry.name,
      initiatorType: entry.initiatorType,
      totalMs: entry.timing.totalMs,
      transferBytes: entry.transferSize
    }));
  return { count: list.length, totalTransferBytes, totalDecodedBytes, byType, slowest };
}
