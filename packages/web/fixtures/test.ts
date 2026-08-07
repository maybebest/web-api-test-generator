import fs from 'node:fs';
import path from 'node:path';
import { test as base, expect, type APIRequestContext } from '@playwright/test';

import { defaultTestData, type TestData } from '../data/test-data';
import { createTestDataManager, type TestDataManager } from './test-data-manager';
import {
  buildPerfReport,
  collectCdpMetrics,
  collectLayoutShifts,
  collectLongTasks,
  collectNavigationTiming,
  collectPaintTiming,
  collectUserTiming,
  readWebVitals
} from './perf/collect';
import { createConsoleCollector, emptyConsoleBlock } from './perf/console';
import { startCoverage, stopCoverage } from './perf/coverage';
import { createNetworkCollector, emptyNetworkBlock } from './perf/network';
import { buildObserversInitScript } from './perf/observers-inject';
import { shouldCollectPerformance } from './perf/policy';
import { collectResourceTiming } from './perf/resources';
import { buildWebVitalsInitScript } from './perf/web-vitals-inject';

type ApiHelpers = {
  getJson<T>(path: string): Promise<T>;
};

type Fixtures = {
  testData: TestData;
  api: ApiHelpers;
  // API-driven test-data management (channel config, catalogue, plan seeding). Supported field
  // mutations are ownership-restored automatically. Environment-specific backend writes require
  // explicit TestDataContracts; feature flags use this fixture's browser-localStorage bridge.
  dataManager: TestDataManager;
  // Opt-in front-end performance capture: Web Vitals (LCP/CLS/INP/TTFB/FCP) + navigation/paint
  // timing + chromium CDP internals. Only active when COLLECT_PERF=true; then it runs for every
  // eligible non-authenticated browser test with no per-test wiring, writing a per-test
  // performance.json and attaching it (the perf reporter aggregates the attachments). Auth setup
  // and chromium-auth are excluded because their URLs and free-text telemetry may be private.
  perf: void;
};

// OPT-IN: performance collection runs ONLY when COLLECT_PERF=true (matches the repo's other opt-in
// env flags, e.g. E2E_AUTH_ENABLED / ASSERT_RESPONSE_TIME). Unset or any other value => no injection,
// no collection, no performance/ report — a normal run is completely unaffected.
const PERF_ENABLED = process.env.COLLECT_PERF === 'true';

export const test = base.extend<Fixtures>({
  testData: async ({}, use) => {
    await use(defaultTestData);
  },

  api: async ({ request }, use) => {
    await use(createApiHelpers(request));
  },

  dataManager: async ({ page }, use) => {
    const manager = createTestDataManager({
      setFeatureFlags: async (flags) => {
        const serialized = JSON.stringify(flags);
        await page.addInitScript((value) => {
          globalThis.localStorage.setItem('feature-flags', value);
        }, serialized);
        if (page.url() !== 'about:blank') {
          await page.evaluate((value) => {
            globalThis.localStorage.setItem('feature-flags', value);
          }, serialized);
        }
      }
    });
    try {
      await use(manager);
    } finally {
      await manager.cleanupCreatedTestData();
    }
  },

  // Auto-fixture (no per-test import/edit). Depends on `page`, so it activates for browser tests.
  // The fixture body runs during setup — before the test body calls PlanningPage.goto() — so the
  // web-vitals init script is registered ahead of the app's first navigation (init scripts run in
  // registration order). All collection is defensive and wrapped so perf never fails a test.
  perf: [
    async ({ page }, use, testInfo) => {
      // The auth `setup` project only exercises the login page; its metrics are noise, not app perf.
      const isChromium = /chromium|mobile-chrome/i.test(testInfo.project.name);

      // Network + console listeners register now, before the test navigates; observers + coverage
      // must also be installed pre-navigation so they see the whole page lifetime.
      const active = shouldCollectPerformance(PERF_ENABLED, testInfo.project.name);
      const network = active ? createNetworkCollector(page) : undefined;
      const consoleCollector = active ? createConsoleCollector(page) : undefined;
      let coverageStarted = false;
      if (active) {
        try {
          // Perf SETUP must never fail a test. buildWebVitalsInitScript() reads a hardcoded web-vitals
          // dist filename; if a future major renames it, this degrades to no injection (the reporter's
          // zero-vitals warning then surfaces the breakage) instead of throwing in fixture setup.
          await page.addInitScript({ content: buildWebVitalsInitScript() });
          await page.addInitScript({ content: buildObserversInitScript() });
          coverageStarted = await startCoverage(page, isChromium);
        } catch {
          // swallow — collection is best-effort and opt-in
        }
      }

      await use();

      if (!active) {
        return;
      }
      try {
        const [vitals, nav, paint, cdp, net, resources, longTasks, layoutShifts, userTiming, coverage] = await Promise.all([
          readWebVitals(page),
          collectNavigationTiming(page),
          collectPaintTiming(page),
          collectCdpMetrics(page, isChromium),
          network ? network.finalize() : Promise.resolve(emptyNetworkBlock()),
          collectResourceTiming(page),
          collectLongTasks(page),
          collectLayoutShifts(page),
          collectUserTiming(page),
          stopCoverage(page, coverageStarted)
        ]);
        const consoleData = consoleCollector ? consoleCollector.finalize() : emptyConsoleBlock();
        const report = buildPerfReport(testInfo, page, {
          vitals,
          nav,
          paint,
          cdp,
          network: net,
          resources,
          longTasks,
          layoutShifts,
          userTiming,
          coverage,
          console: consoleData,
          isChromium
        });
        fs.mkdirSync(testInfo.outputDir, { recursive: true });
        fs.writeFileSync(path.join(testInfo.outputDir, 'performance.json'), `${JSON.stringify(report, null, 2)}\n`);
        await testInfo.attach('performance', { body: JSON.stringify(report), contentType: 'application/json' });
      } catch {
        // Perf bookkeeping must never fail a test at teardown.
      }
    },
    { auto: true }
  ]
});

function createApiHelpers(request: APIRequestContext): ApiHelpers {
  return {
    async getJson<T>(path: string): Promise<T> {
      const response = await request.get(path);
      expect(response.ok(), `GET ${path} should return a successful response`).toBeTruthy();
      return (await response.json()) as T;
    }
  };
}

export { expect };
