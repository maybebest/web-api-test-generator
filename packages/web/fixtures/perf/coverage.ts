// JS/CSS code-coverage collector (chromium only) — measures how much shipped code actually ran, so
// you can see unused bytes / dead code. Coverage must be STARTED before navigation and STOPPED at
// teardown. On non-chromium (page.coverage throws) or any error it degrades to available:false.
// Web-only — no packages/api import.
import type { Page } from '@playwright/test';
import type { CoverageBlock, CoverageSummary } from './types';
import { redactUrl } from './redact';

const FILES_LIMIT = 10;

export async function startCoverage(page: Page, isChromium: boolean): Promise<boolean> {
  if (!isChromium || !page.coverage) {
    return false;
  }
  try {
    await page.coverage.startJSCoverage({ resetOnNavigation: false });
    await page.coverage.startCSSCoverage({ resetOnNavigation: false });
    return true;
  } catch {
    return false;
  }
}

export async function stopCoverage(page: Page, started: boolean): Promise<CoverageBlock> {
  if (!started || page.isClosed() || !page.coverage) {
    return { available: false, js: null, css: null };
  }
  try {
    const js = await page.coverage.stopJSCoverage();
    const css = await page.coverage.stopCSSCoverage();
    return {
      available: true,
      js: summarizeJs(js),
      css: summarizeCss(css)
    };
  } catch {
    return { available: false, js: null, css: null };
  }
}

// Merge [start,end) intervals and sum their covered length (ranges can overlap / nest).
function mergedLength(intervals: Array<[number, number]>): number {
  if (intervals.length === 0) {
    return 0;
  }
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [curStart, curEnd] = sorted[0];
  for (let i = 1; i < sorted.length; i += 1) {
    const [start, end] = sorted[i];
    if (start <= curEnd) {
      if (end > curEnd) {
        curEnd = end;
      }
    } else {
      total += curEnd - curStart;
      curStart = start;
      curEnd = end;
    }
  }
  return total + (curEnd - curStart);
}

function finalize(rawFiles: Array<{ url: string; totalBytes: number; usedBytes: number }>): CoverageSummary {
  // With resetOnNavigation:false, Playwright accumulates a coverage ENTRY PER NAVIGATION for the
  // same script/stylesheet URL, so summing raw entries double-counts a bundle once per page load.
  // Dedup by URL first: totalBytes is the same script, so take the max; usedBytes takes the max
  // observed (a later navigation can only exercise more of the same source).
  const byUrl = new Map<string, { url: string; totalBytes: number; usedBytes: number }>();
  for (const file of rawFiles) {
    const existing = byUrl.get(file.url);
    if (!existing) {
      byUrl.set(file.url, { ...file });
    } else {
      existing.totalBytes = Math.max(existing.totalBytes, file.totalBytes);
      existing.usedBytes = Math.max(existing.usedBytes, file.usedBytes);
    }
  }
  const files = [...byUrl.values()];

  const totalBytes = files.reduce((sum, f) => sum + f.totalBytes, 0);
  const usedBytes = files.reduce((sum, f) => sum + Math.min(f.usedBytes, f.totalBytes), 0);
  const unusedBytes = Math.max(0, totalBytes - usedBytes);
  return {
    totalBytes,
    usedBytes,
    unusedBytes,
    unusedPct: totalBytes > 0 ? Math.round((100 * unusedBytes) / totalBytes) : 0,
    files: files
      .map((f) => ({ url: redactUrl(f.url), totalBytes: f.totalBytes, unusedBytes: Math.max(0, f.totalBytes - Math.min(f.usedBytes, f.totalBytes)) }))
      .sort((a, b) => b.unusedBytes - a.unusedBytes)
      .slice(0, FILES_LIMIT)
  };
}

// V8 block coverage nests ranges: the whole-script range has count>0 and *contains* the ranges of
// uncalled functions (count 0). So a byte is used only if the INNERMOST range covering it has
// count>0 — a plain union of count>0 ranges overcounts. Paint outer-first so inner count-0 ranges
// carve out the unused regions, then count the still-used bytes.
function usedBytesV8(functions: Array<{ ranges: Array<{ startOffset: number; endOffset: number; count: number }> }>, totalBytes: number): number {
  if (totalBytes === 0) {
    return 0;
  }
  const ranges = functions.flatMap((fn) => fn.ranges ?? []);
  if (ranges.length === 0) {
    return 0;
  }
  ranges.sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
  const marks = new Uint8Array(totalBytes); // 0 = unset, 1 = used, 2 = uncovered
  for (const range of ranges) {
    const start = Math.max(0, Math.min(totalBytes, range.startOffset));
    const end = Math.max(0, Math.min(totalBytes, range.endOffset));
    marks.fill(range.count > 0 ? 1 : 2, start, end);
  }
  let used = 0;
  for (let i = 0; i < totalBytes; i += 1) {
    if (marks[i] === 1) {
      used += 1;
    }
  }
  return used;
}

function summarizeJs(entries: Awaited<ReturnType<Page['coverage']['stopJSCoverage']>>): CoverageSummary {
  return finalize(
    entries.map((entry) => {
      const totalBytes = entry.source ? entry.source.length : 0;
      return { url: entry.url, totalBytes, usedBytes: usedBytesV8(entry.functions ?? [], totalBytes) };
    })
  );
}

function summarizeCss(entries: Awaited<ReturnType<Page['coverage']['stopCSSCoverage']>>): CoverageSummary {
  return finalize(
    entries.map((entry) => {
      const totalBytes = entry.text ? entry.text.length : 0;
      const intervals: Array<[number, number]> = (entry.ranges ?? []).map((range) => [range.start, range.end]);
      return { url: entry.url, totalBytes, usedBytes: mergedLength(intervals) };
    })
  );
}
