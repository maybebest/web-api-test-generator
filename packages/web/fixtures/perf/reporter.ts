// Aggregates each test's `performance` attachment into a dedicated performance/ folder:
//   - samples.jsonl : one PerfSample (PerfReport + testId/attempt) per line
//   - summary.json  : PerfSummary — all samples + a per project+metric p50/p75/p95 rollup
//   - summary.md    : a human-readable table
//
// Samples are BUFFERED per Playwright test.id (latest retry attempt wins) and written once in
// onEnd. onEnd also MERGES with any samples.jsonl already on disk, keyed by testId (new wins) —
// so the multiple sequential playwright invocations of a CI job accumulate into one report instead
// of clobbering each other, while a local re-run of the same tests replaces its own rows. Delete
// the performance/ dir for a fresh start (CI runners start clean; clean-tree forbids shipping it).
//
// Registered as a path-based reporter in playwright.config.ts. Web-only — no packages/api import.
import fs from 'node:fs';
import path from 'node:path';
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { VITALS } from './types';
import type { PerfReport, PerfRollup, PerfSample, PerfSummary } from './types';

// OUT_DIR is anchored to the package (fixtures/perf -> ../.. = packages/web), NOT process.cwd(), so a
// root-cwd `playwright test -c packages/web/playwright.config.ts` run cannot write perf output to the
// repo root. An absolute PERF_OUTPUT_DIR still wins; a relative one resolves under packages/web.
const OUT_DIR = path.resolve(__dirname, '..', '..', process.env.PERF_OUTPUT_DIR ?? 'performance');
const JSONL = path.join(OUT_DIR, 'samples.jsonl');
const SUMMARY_JSON = path.join(OUT_DIR, 'summary.json');
const SUMMARY_MD = path.join(OUT_DIR, 'summary.md');

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) {
    return null;
  }
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

// Prior-invocation samples from samples.jsonl, keyed by testId. Bad/legacy lines (unparseable or
// missing testId) are dropped rather than crashing reporting.
function readExistingSamples(): Map<string, PerfSample> {
  const existing = new Map<string, PerfSample>();
  let raw: string;
  try {
    raw = fs.readFileSync(JSONL, 'utf8');
  } catch {
    return existing;
  }
  for (const line of raw.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    try {
      const sample = JSON.parse(line) as PerfSample;
      if (sample && typeof sample.testId === 'string' && sample.testId) {
        existing.set(sample.testId, sample);
      }
    } catch {
      // skip malformed line
    }
  }
  return existing;
}

export default class PerformanceReporter implements Reporter {
  // Keyed by testId so a retried test collapses to ONE sample (Playwright fires onTestEnd once per
  // attempt; the latest attempt wins). Nothing is written until onEnd, so an ordinary run with no
  // perf attachments creates no dir.
  private readonly byTest = new Map<string, PerfSample>();

  onTestEnd(test: TestCase, result: TestResult): void {
    const attachment = result.attachments.find((entry) => entry.name === 'performance' && Boolean(entry.body));
    if (!attachment?.body) {
      return;
    }
    try {
      const report = JSON.parse(attachment.body.toString('utf8')) as PerfReport;
      const existing = this.byTest.get(test.id);
      if (!existing || result.retry >= existing.attempt) {
        this.byTest.set(test.id, { ...report, testId: test.id, attempt: result.retry });
      }
    } catch {
      // A malformed / partial per-test attachment must not crash the run's reporting.
    }
  }

  onEnd(_result: FullResult): void {
    if (this.byTest.size === 0) {
      return;
    }
    fs.mkdirSync(OUT_DIR, { recursive: true });

    // Merge with prior invocations in this performance/ dir: earlier rows survive unless this
    // invocation re-ran the same test (testId match -> new sample wins).
    const merged = readExistingSamples();
    for (const [testId, sample] of this.byTest) {
      merged.set(testId, sample);
    }
    const samples = [...merged.values()];

    fs.writeFileSync(JSONL, `${samples.map((sample) => JSON.stringify(sample)).join('\n')}\n`);
    const byProjectMetric = this.rollup(samples);
    const summary: PerfSummary = {
      schema: 'web-perf-summary/v2',
      generatedAt: new Date().toISOString(),
      count: samples.length,
      byProjectMetric,
      samples
    };
    fs.writeFileSync(SUMMARY_JSON, `${JSON.stringify(summary, null, 2)}\n`);
    fs.writeFileSync(SUMMARY_MD, this.renderMarkdown(byProjectMetric, samples.length));

    const noVitalsAnywhere = samples.every(
      (sample) => !sample.webVitals || VITALS.every((name) => !sample.webVitals?.[name])
    );
    if (noVitalsAnywhere) {
      console.warn(
        '[perf] every sample reported zero Web Vitals — the web-vitals injection may be broken (dist filename / global changed across a major).'
      );
    }
  }

  private rollup(samples: PerfSample[]): PerfRollup {
    const byProject = new Map<string, Map<string, number[]>>();
    const push = (bucket: Map<string, number[]>, metric: string, value: number | null | undefined): void => {
      if (typeof value === 'number' && Number.isFinite(value)) {
        const arr = bucket.get(metric) ?? [];
        arr.push(value);
        bucket.set(metric, arr);
      }
    };

    for (const sample of samples) {
      const bucket = byProject.get(sample.test.project) ?? new Map<string, number[]>();
      byProject.set(sample.test.project, bucket);
      for (const name of VITALS) {
        push(bucket, name, sample.webVitals?.[name]?.value);
      }
      push(bucket, 'load', sample.navigationTiming?.load);
      push(bucket, 'net.requests', sample.network?.summary.total);
      push(bucket, 'net.responseBytes', sample.network?.summary.totalResponseBodyBytes);
      push(bucket, 'tbt', sample.longTasks?.totalBlockingTimeMs);
      push(bucket, 'res.count', sample.resources?.summary.count);
      push(bucket, 'res.transferBytes', sample.resources?.summary.totalTransferBytes);
      push(bucket, 'js.unusedBytes', sample.coverage?.js?.unusedBytes);
    }

    const out: PerfRollup = {};
    for (const [project, metrics] of byProject) {
      out[project] = {};
      for (const [metric, values] of metrics) {
        const sorted = [...values].sort((a, b) => a - b);
        out[project][metric] = {
          p50: percentile(sorted, 50),
          p75: percentile(sorted, 75),
          p95: percentile(sorted, 95),
          count: sorted.length
        };
      }
    }
    return out;
  }

  private renderMarkdown(rollup: PerfRollup, count: number): string {
    const lines: string[] = ['# Web performance summary', '', `Samples: ${count}`, ''];
    for (const [project, metrics] of Object.entries(rollup)) {
      lines.push(`## ${project}`, '', '| Metric | p50 | p75 | p95 | n |', '|---|---|---|---|---|');
      for (const [metric, stats] of Object.entries(metrics)) {
        lines.push(`| ${metric} | ${stats.p50 ?? '—'} | ${stats.p75 ?? '—'} | ${stats.p95 ?? '—'} | ${stats.count} |`);
      }
      lines.push('');
    }
    return `${lines.join('\n')}\n`;
  }
}
