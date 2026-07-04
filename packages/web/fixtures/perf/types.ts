// Shared, JSON-serialisable shapes for front-end performance capture.
//
// Web-only — this module (and everything under fixtures/perf/) must NOT import from packages/api.
// Every metric is `number | null` so a missing / degraded value is explicit rather than absent:
// consumers should always tolerate null (e.g. Paint timing on firefox, CDP on non-chromium, or a
// page that closed before teardown).

// Single source of truth for the vitals list: the runtime array and the union type cannot drift
// (collect.ts and reporter.ts previously hand-duplicated this list with a non-exhaustive
// VitalName[] annotation, which the compiler would not flag on divergence).
export const VITALS = ['LCP', 'CLS', 'INP', 'TTFB', 'FCP'] as const;
export type VitalName = (typeof VITALS)[number];

export type VitalRating = 'good' | 'needs-improvement' | 'poor' | null;

export type VitalAttribution = {
  // Populated per metric by web-vitals attribution: LCP -> element/url, CLS -> largestShiftTarget,
  // INP -> interactionTarget. Fields that don't apply to a metric stay null.
  element: string | null;
  url: string | null;
  largestShiftTarget: string | null;
  interactionTarget: string | null;
};

export type VitalSample = {
  value: number | null;
  rating: VitalRating;
  attribution: VitalAttribution | null;
};

export type WebVitals = Record<VitalName, VitalSample | null>;

export type NavigationTiming = {
  ttfb: number | null;
  domInteractive: number | null;
  domContentLoaded: number | null;
  load: number | null;
  transferSize: number | null;
  encodedBodySize: number | null;
  decodedBodySize: number | null;
  type: string | null;
} | null;

export type PaintTiming = {
  firstPaint: number | null;
  firstContentfulPaint: number | null;
};

export type CdpMetrics = {
  JSHeapUsedSize: number | null;
  JSHeapTotalSize: number | null;
  TaskDuration: number | null;
  ScriptDuration: number | null;
  LayoutCount: number | null;
  RecalcStyleCount: number | null;
  LayoutDuration: number | null;
  RecalcStyleDuration: number | null;
  Documents: number | null;
  Frames: number | null;
  Nodes: number | null;
  JSEventListeners: number | null;
  LayoutObjects: number | null;
  FirstMeaningfulPaint: number | null;
};

export type DomCounters = {
  documents: number | null;
  nodes: number | null;
  jsEventListeners: number | null;
};

export type CdpBlock = {
  // false on firefox/webkit (no CDP) or on any collection error; metrics is null then.
  available: boolean;
  metrics: CdpMetrics | null;
  dom: DomCounters | null;
};

export type NetworkTiming = {
  ttfbMs: number | null; // responseStart - requestStart
  downloadMs: number | null; // responseEnd - responseStart
  totalMs: number | null; // responseEnd (relative to request start)
};

export type NetworkRequest = {
  // URLs are redacted: sensitive query params (token/code/secret/…) are replaced with ***.
  url: string;
  method: string;
  type: string; // resourceType, filtered to 'xhr' | 'fetch'
  status: number | null;
  failed: boolean;
  errorText: string | null;
  responseBodyBytes: number | null;
  responseHeadersBytes: number | null;
  timing: NetworkTiming;
};

export type NetworkSummary = {
  total: number;
  byStatusClass: { '2xx': number; '3xx': number; '4xx': number; '5xx': number; failed: number };
  byType: Record<string, number>;
  totalResponseBodyBytes: number;
  slowest: Array<{ url: string; method: string; status: number | null; totalMs: number | null }>;
  failures: Array<{ url: string; method: string; errorText: string | null }>;
};

export type NetworkBlock = {
  summary: NetworkSummary;
  requests: NetworkRequest[];
};

// ---- Resource Timing (ALL resources: doc/script/css/img/font/xhr/fetch/…) ------------------
export type ResourceEntry = {
  name: string; // URL, redacted
  initiatorType: string | null;
  protocol: string | null; // nextHopProtocol: h2/h3/http/1.1
  renderBlocking: string | null;
  transferSize: number | null;
  encodedBodySize: number | null;
  decodedBodySize: number | null;
  timing: {
    dnsMs: number | null;
    tcpMs: number | null;
    tlsMs: number | null;
    ttfbMs: number | null;
    downloadMs: number | null;
    totalMs: number | null;
  };
};

export type ResourceBlock = {
  summary: {
    count: number;
    totalTransferBytes: number;
    totalDecodedBytes: number;
    byType: Record<string, number>;
    slowest: Array<{ name: string; initiatorType: string | null; totalMs: number | null; transferBytes: number | null }>;
  };
  list: ResourceEntry[];
};

// ---- Long Tasks (main-thread blocking > 50ms) + Total Blocking Time -------------------------
export type LongTasksBlock = {
  count: number;
  totalMs: number;
  totalBlockingTimeMs: number; // sum of max(0, duration - 50)
  longestMs: number;
  tasks: Array<{ startMs: number; durationMs: number }>;
};

// ---- Layout Shifts (raw CLS shifts with the nodes that moved) -------------------------------
export type LayoutShiftsBlock = {
  count: number;
  totalValue: number;
  largest: { value: number; sources: string[] } | null;
};

// ---- User Timing (performance.mark / measure emitted by the app) ----------------------------
export type UserTimingBlock = {
  marks: Array<{ name: string; startMs: number }>;
  measures: Array<{ name: string; startMs: number; durationMs: number }>;
};

// ---- JS/CSS code coverage (chromium only) — how much shipped code is unused -----------------
export type CoverageSummary = {
  totalBytes: number;
  usedBytes: number;
  unusedBytes: number;
  unusedPct: number;
  files: Array<{ url: string; totalBytes: number; unusedBytes: number }>;
};

export type CoverageBlock = {
  available: boolean; // false on non-chromium or on error
  js: CoverageSummary | null;
  css: CoverageSummary | null;
};

// ---- Console + uncaught page errors during the test ----------------------------------------
export type ConsoleBlock = {
  errors: number;
  warnings: number;
  logs: number;
  pageErrors: Array<{ message: string }>;
};

export type PerfReport = {
  schema: 'web-perf/v2';
  test: {
    title: string;
    file: string;
    project: string;
    browser: string;
    status: string | undefined;
    url: string | null;
    durationMs: number;
  };
  webVitals: WebVitals | null;
  navigationTiming: NavigationTiming;
  paintTiming: PaintTiming;
  cdp: CdpBlock;
  // API network activity (XHR/fetch only): a summary plus the per-request list.
  network: NetworkBlock;
  // All resources (doc/script/css/img/font/xhr/…) via the Resource Timing API.
  resources: ResourceBlock;
  longTasks: LongTasksBlock;
  layoutShifts: LayoutShiftsBlock;
  userTiming: UserTimingBlock;
  coverage: CoverageBlock;
  console: ConsoleBlock;
  // Machine-readable notes on what could not be collected, e.g. "cdp-unavailable: firefox",
  // "web-vitals: no INP".
  degradation: string[];
};

// ---- Aggregated report (performance/summary.json), written by fixtures/perf/reporter.ts --------
// One sample per logical test: reporter keys by Playwright test.id, latest retry attempt wins, and
// samples from earlier playwright invocations in the same performance/ dir are merged by testId.
export type PerfSample = PerfReport & {
  testId: string;
  attempt: number;
};

export type PerfRollupStat = {
  p50: number | null;
  p75: number | null;
  p95: number | null;
  count: number;
};

// project name -> metric name (vitals + load/net.*/tbt/res.*/js.unusedBytes) -> percentiles
export type PerfRollup = Record<string, Record<string, PerfRollupStat>>;

export type PerfSummary = {
  schema: 'web-perf-summary/v2';
  generatedAt: string;
  count: number;
  byProjectMetric: PerfRollup;
  samples: PerfSample[];
};
