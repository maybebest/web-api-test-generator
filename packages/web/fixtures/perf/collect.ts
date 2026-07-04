// Defensive, read-only performance collectors + the per-test report builder.
//
// Every collector returns null / { available:false } on ANY error (closed page, blank page,
// cross-origin, evaluate rejection, non-chromium) and NEVER throws into test teardown — perf
// bookkeeping must not fail a test. Web-only — must NOT import from packages/api.
//
// page.evaluate callbacks run in the BROWSER, but this package compiles with no DOM lib
// (tsconfig `types: ["node","@playwright/test"]`). So browser globals are reached through a
// `globalThis` cast (the same pattern PlanningPage.goto uses), never the DOM typings.
import path from 'node:path';
import type { CDPSession, Page, TestInfo } from '@playwright/test';
import { VITALS } from './types';
import type {
  CdpBlock,
  ConsoleBlock,
  CoverageBlock,
  LayoutShiftsBlock,
  LongTasksBlock,
  NavigationTiming,
  NetworkBlock,
  PaintTiming,
  PerfReport,
  ResourceBlock,
  UserTimingBlock,
  WebVitals
} from './types';
import { redactSecrets, redactUrl } from './redact';

function isCollectablePage(page: Page): boolean {
  if (page.isClosed()) {
    return false;
  }
  const url = page.url();
  return Boolean(url) && url !== 'about:blank';
}

export async function readWebVitals(page: Page): Promise<WebVitals | null> {
  if (!isCollectablePage(page)) {
    return null;
  }
  try {
    const raw = await page.evaluate(() => {
      const store = (globalThis as unknown as { __WEB_VITALS__?: Record<string, unknown> }).__WEB_VITALS__;
      return store ?? null;
    });
    const vitals = (raw as WebVitals | null) ?? null;
    // LCP attribution carries the largest element's resource URL (e.g. a presigned image ...?sig=),
    // so redact it just like network/resource URLs before it enters the persisted report.
    if (vitals) {
      for (const name of VITALS) {
        const attribution = vitals[name]?.attribution;
        if (attribution && typeof attribution.url === 'string' && attribution.url) {
          attribution.url = redactUrl(attribution.url);
        }
      }
    }
    return vitals;
  } catch {
    return null;
  }
}

export async function collectNavigationTiming(page: Page): Promise<NavigationTiming> {
  if (!isCollectablePage(page)) {
    return null;
  }
  try {
    return await page.evaluate(() => {
      const perf = (globalThis as unknown as {
        performance?: { getEntriesByType(type: string): unknown[] };
      }).performance;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nav = perf?.getEntriesByType('navigation')[0] as any;
      if (!nav) {
        return null;
      }
      const round = (n: unknown): number | null =>
        typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : null;
      return {
        ttfb: round(nav.responseStart - nav.requestStart),
        domInteractive: round(nav.domInteractive),
        domContentLoaded: round(nav.domContentLoadedEventEnd),
        load: round(nav.loadEventEnd),
        transferSize: round(nav.transferSize),
        encodedBodySize: round(nav.encodedBodySize),
        decodedBodySize: round(nav.decodedBodySize),
        type: typeof nav.type === 'string' ? (nav.type as string) : null
      };
    });
  } catch {
    return null;
  }
}

export async function collectPaintTiming(page: Page): Promise<PaintTiming> {
  const empty: PaintTiming = { firstPaint: null, firstContentfulPaint: null };
  if (!isCollectablePage(page)) {
    return empty;
  }
  try {
    return await page.evaluate(() => {
      const perf = (globalThis as unknown as {
        performance?: { getEntriesByType(type: string): Array<{ name: string; startTime: number }> };
      }).performance;
      const paints = perf?.getEntriesByType('paint') ?? [];
      const find = (name: string): number | null => {
        const entry = paints.find((p) => p.name === name);
        return entry && Number.isFinite(entry.startTime) ? Math.round(entry.startTime) : null;
      };
      return { firstPaint: find('first-paint'), firstContentfulPaint: find('first-contentful-paint') };
    });
  } catch {
    return empty;
  }
}

export async function collectCdpMetrics(page: Page, isChromium: boolean): Promise<CdpBlock> {
  if (!isChromium || page.isClosed()) {
    return { available: false, metrics: null, dom: null };
  }
  let session: CDPSession | undefined;
  try {
    session = await page.context().newCDPSession(page);
    await session.send('Performance.enable');
    const response = await session.send('Performance.getMetrics');
    const byName = new Map<string, number>(response.metrics.map((m) => [m.name, m.value] as [string, number]));
    const get = (name: string): number | null => {
      const value = byName.get(name);
      return typeof value === 'number' && Number.isFinite(value) ? value : null;
    };

    // DOM counters (nodes / documents / listeners) — a live snapshot of page weight.
    let dom = null as CdpBlock['dom'];
    try {
      const counters = await session.send('Memory.getDOMCounters');
      dom = {
        documents: typeof counters.documents === 'number' ? counters.documents : null,
        nodes: typeof counters.nodes === 'number' ? counters.nodes : null,
        jsEventListeners: typeof counters.jsEventListeners === 'number' ? counters.jsEventListeners : null
      };
    } catch {
      dom = null;
    }

    return {
      available: true,
      metrics: {
        JSHeapUsedSize: get('JSHeapUsedSize'),
        JSHeapTotalSize: get('JSHeapTotalSize'),
        TaskDuration: get('TaskDuration'),
        ScriptDuration: get('ScriptDuration'),
        LayoutCount: get('LayoutCount'),
        RecalcStyleCount: get('RecalcStyleCount'),
        LayoutDuration: get('LayoutDuration'),
        RecalcStyleDuration: get('RecalcStyleDuration'),
        Documents: get('Documents'),
        Frames: get('Frames'),
        Nodes: get('Nodes'),
        JSEventListeners: get('JSEventListeners'),
        LayoutObjects: get('LayoutObjects'),
        FirstMeaningfulPaint: get('FirstMeaningfulPaint')
      },
      dom
    };
  } catch {
    return { available: false, metrics: null, dom: null };
  } finally {
    try {
      await session?.detach();
    } catch {
      // Best-effort detach: a closing context can reject, which is not a test failure.
    }
  }
}

// Long Tasks accumulated by the injected observer (self.__PERF_OBS__.longTasks). TBT = the blocking
// portion of each long task (duration - 50ms) summed — a strong responsiveness signal.
export async function collectLongTasks(page: Page): Promise<LongTasksBlock> {
  const empty: LongTasksBlock = { count: 0, totalMs: 0, totalBlockingTimeMs: 0, longestMs: 0, tasks: [] };
  if (!isCollectablePage(page)) {
    return empty;
  }
  try {
    const tasks = await page.evaluate(() => {
      const store = (globalThis as unknown as { __PERF_OBS__?: { longTasks?: Array<{ startMs: number; durationMs: number }> } }).__PERF_OBS__;
      return store?.longTasks ?? [];
    });
    let totalMs = 0;
    let totalBlockingTimeMs = 0;
    let longestMs = 0;
    for (const task of tasks) {
      totalMs += task.durationMs;
      totalBlockingTimeMs += Math.max(0, task.durationMs - 50);
      longestMs = Math.max(longestMs, task.durationMs);
    }
    return { count: tasks.length, totalMs, totalBlockingTimeMs, longestMs, tasks };
  } catch {
    return empty;
  }
}

// Individual layout shifts (raw CLS contributors) from the injected observer.
export async function collectLayoutShifts(page: Page): Promise<LayoutShiftsBlock> {
  const empty: LayoutShiftsBlock = { count: 0, totalValue: 0, largest: null };
  if (!isCollectablePage(page)) {
    return empty;
  }
  try {
    const shifts = await page.evaluate(() => {
      const store = (globalThis as unknown as { __PERF_OBS__?: { layoutShifts?: Array<{ value: number; sources: string[] }> } }).__PERF_OBS__;
      return store?.layoutShifts ?? [];
    });
    let totalValue = 0;
    let largest: { value: number; sources: string[] } | null = null;
    for (const shift of shifts) {
      totalValue += shift.value;
      if (!largest || shift.value > largest.value) {
        largest = { value: shift.value, sources: shift.sources };
      }
    }
    return { count: shifts.length, totalValue, largest };
  } catch {
    return empty;
  }
}

// App-emitted performance.mark / performance.measure entries.
export async function collectUserTiming(page: Page): Promise<UserTimingBlock> {
  const empty: UserTimingBlock = { marks: [], measures: [] };
  if (!isCollectablePage(page)) {
    return empty;
  }
  try {
    const raw = await page.evaluate(() => {
      const perf = (globalThis as unknown as {
        performance?: { getEntriesByType(type: string): unknown[] };
      }).performance;
      if (!perf) {
        return { marks: [], measures: [] };
      }
      const round = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : 0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const marks = (perf.getEntriesByType('mark') as any[]).map((e: any) => ({ name: String(e.name), startMs: round(e.startTime) }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const measures = (perf.getEntriesByType('measure') as any[]).map((e: any) => ({
        name: String(e.name),
        startMs: round(e.startTime),
        durationMs: round(e.duration)
      }));
      return { marks, measures };
    });
    // Mark/measure names are arbitrary app strings (a common pattern is performance.measure(`fetch
    // ${url}`)) — the only free-text channel besides pageErrors — so scrub them like console.ts
    // scrubs error messages, and cap length the same way.
    const clean = (name: string): string => redactSecrets(name).slice(0, 300);
    return {
      marks: raw.marks.map((mark) => ({ ...mark, name: clean(mark.name) })),
      measures: raw.measures.map((measure) => ({ ...measure, name: clean(measure.name) }))
    };
  } catch {
    return empty;
  }
}

export function buildPerfReport(
  testInfo: TestInfo,
  page: Page,
  parts: {
    vitals: WebVitals | null;
    nav: NavigationTiming;
    paint: PaintTiming;
    cdp: CdpBlock;
    network: NetworkBlock;
    resources: ResourceBlock;
    longTasks: LongTasksBlock;
    layoutShifts: LayoutShiftsBlock;
    userTiming: UserTimingBlock;
    coverage: CoverageBlock;
    console: ConsoleBlock;
    isChromium: boolean;
  }
): PerfReport {
  const { vitals, nav, paint, cdp, network, resources, longTasks, layoutShifts, userTiming, coverage, console: consoleBlock, isChromium } =
    parts;
  const degradation: string[] = [];
  if (!cdp.available) {
    degradation.push(`cdp-unavailable: ${testInfo.project.name}`);
  }
  for (const name of VITALS) {
    if (!vitals || !vitals[name]) {
      degradation.push(`web-vitals: no ${name}`);
    }
  }

  const projectName = testInfo.project.name;
  const browser = isChromium
    ? 'chromium'
    : /firefox/i.test(projectName)
      ? 'firefox'
      : /webkit|safari/i.test(projectName)
        ? 'webkit'
        : projectName;

  let url: string | null = null;
  try {
    // The final page URL can carry a token (magic-link/reset callback) — redact before persisting.
    const rawUrl = page.isClosed() ? null : page.url() || null;
    url = rawUrl ? redactUrl(rawUrl) : null;
  } catch {
    url = null;
  }

  if (!coverage.available) {
    degradation.push(`coverage-unavailable: ${projectName}`);
  }

  return {
    schema: 'web-perf/v2',
    test: {
      title: testInfo.title,
      file: path.relative(testInfo.project.testDir, testInfo.file),
      project: projectName,
      browser,
      status: testInfo.status,
      url,
      durationMs: testInfo.duration
    },
    webVitals: vitals,
    navigationTiming: nav,
    paintTiming: paint,
    cdp,
    network,
    resources,
    longTasks,
    layoutShifts,
    userTiming,
    coverage,
    console: consoleBlock,
    degradation
  };
}
