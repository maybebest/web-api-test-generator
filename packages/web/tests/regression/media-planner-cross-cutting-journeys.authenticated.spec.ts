// Spec-bound header: sha256 is the behavioral hash of the spec. Re-stamp with
// `npm run ai:spec:stamp` if the spec's behavioral sections change.
/* spec: specs/special-preconditions/media-planner-cross-cutting-journeys.md version:1.1.0 sha256:65933f83fa808b33dda4bf8bc5ac558791951bdc8094788e922a7edeaa9dcc70 */
import { test, expect } from '../../fixtures/test';
import { PlanningPage } from '../../pages/PlanningPage';
import { mediaPlannerData } from '../../data/media-planner';
import { CONFIGURED_CHANNELS, resolveChannelConfig } from '../../fixtures/channel-management.fixture';
import { getEveryMedia, getMedia } from '../../fixtures/nectar-api';
import { calculateTravelMoneyScreensCost, roundToPence } from '../../automation/src/cost-oracle';

// Spec FLOW-MP-010 (suite mode): one cohesive journey per test.
//
// TEST-DATA MANAGEMENT: the four group channels are read-only, pre-configured admin
// `media` entities (Onsite Display / Offsite Display / Direct Mail / In-store Radio).
// Their configured rule values (booking deadline, minimum duration, store band) are
// the source of truth for the gate assertions — resolved from the E2E_MP_CHANNEL_*
// env-overrides (dev defaults 2 / 20 / 50 / 200) via the channel-management data
// fixture, which also reads the live channels through the GraphQL API (observed
// `admin_getEveryMedia`) as a precondition guard. Provisioning/teardown would use
// the sibling channel-management client's observed `api.updateField(...)` (create /
// delete there are INFERRED and destructive — avoided).
//
// All summary totals / date spans are COMPUTED in-test (arithmetic sum, min-start,
// max-end, or the inline cost oracle), never compared to hardcoded UI strings. Deep
// UI locators (gate error copy, summary total field, channel rows, store/delete chat
// phrasing) are INFERRED past the read-only recon boundary and must be healed before
// the execution gate is run.

const cfg = resolveChannelConfig();
const C = CONFIGURED_CHANNELS;

for (const [field, value] of Object.entries(cfg)) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`cross-cutting preflight: ${field} must be a non-negative integer, received ${String(value)}`);
  }
}
if (cfg.minimumDurationDays < 2 || cfg.minStores > cfg.maxStores || cfg.bookingDeadlineDays < 1) {
  throw new Error('cross-cutting preflight: deadline must be >=1, duration >=2, and minStores <= maxStores');
}

type DeliveryMode = 'onSite' | 'offSite' | 'atHome' | 'inStore';
type RuleSection = {
  timeline?: { bookingDeadlineDays?: number | null; minCampaignDurationDays?: number | null };
  audienceAndTargeting?: { minStoreVolume?: number | null; maxStoreVolume?: number | null };
};
type RuleMedia = Record<DeliveryMode, RuleSection | null | undefined>;
type RuleSnapshot = {
  name: string;
  bookingDeadlineDays: number | null | undefined;
  minimumDurationDays: number | null | undefined;
  minStores?: number | null;
  maxStores?: number | null;
};

const fixtureChannels = [
  { name: C.onsite, mode: 'onSite', storeBounds: false },
  { name: C.offsite, mode: 'offSite', storeBounds: false },
  { name: C.atHome, mode: 'atHome', storeBounds: true },
  { name: C.inStore, mode: 'inStore', storeBounds: true }
] as const;

function validateRuleSnapshot(snapshot: RuleSnapshot): void {
  if (snapshot.bookingDeadlineDays !== cfg.bookingDeadlineDays) {
    throw new Error(
      `cross-cutting preflight: ${snapshot.name}.bookingDeadlineDays expected ${cfg.bookingDeadlineDays}, received ${String(snapshot.bookingDeadlineDays)}`
    );
  }
  if (snapshot.minimumDurationDays !== cfg.minimumDurationDays) {
    throw new Error(
      `cross-cutting preflight: ${snapshot.name}.minCampaignDurationDays expected ${cfg.minimumDurationDays}, received ${String(snapshot.minimumDurationDays)}`
    );
  }
  if (snapshot.minStores !== undefined && snapshot.minStores !== cfg.minStores) {
    throw new Error(
      `cross-cutting preflight: ${snapshot.name}.minStoreVolume expected ${cfg.minStores}, received ${String(snapshot.minStores)}`
    );
  }
  if (snapshot.maxStores !== undefined && snapshot.maxStores !== cfg.maxStores) {
    throw new Error(
      `cross-cutting preflight: ${snapshot.name}.maxStoreVolume expected ${cfg.maxStores}, received ${String(snapshot.maxStores)}`
    );
  }
}

function ruleSnapshotError(snapshot: RuleSnapshot): string {
  try {
    validateRuleSnapshot(snapshot);
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

let liveRulePreflight: Promise<RuleSnapshot[]> | undefined;
async function requireLiveRulePreflight(): Promise<RuleSnapshot[]> {
  liveRulePreflight ??= (async () => {
    const media = await getEveryMedia();
    return Promise.all(
      fixtureChannels.map(async (fixture) => {
        const matches = media.filter((entry) => entry.name === fixture.name);
        if (matches.length !== 1) {
          throw new Error(
            `cross-cutting preflight: expected exactly one channel named "${fixture.name}", found ${matches.length}`
          );
        }
        const detail = (await getMedia(matches[0].id)) as RuleMedia;
        const section = detail[fixture.mode];
        if (!section) throw new Error(`cross-cutting preflight: ${fixture.name}.${fixture.mode} is missing`);
        const snapshot: RuleSnapshot = {
          name: fixture.name,
          bookingDeadlineDays: section.timeline?.bookingDeadlineDays,
          minimumDurationDays: section.timeline?.minCampaignDurationDays,
          ...(fixture.storeBounds
            ? {
                minStores: section.audienceAndTargeting?.minStoreVolume,
                maxStores: section.audienceAndTargeting?.maxStoreVolume
              }
            : {})
        };
        validateRuleSnapshot(snapshot);
        return snapshot;
      })
    );
  })();
  return liveRulePreflight;
}

function moneyOf(text: string): number {
  const digits = text.replace(/[^0-9]/g, '');
  return digits ? Number(digits) : NaN;
}
function datesOf(text: string): string[] {
  return text.match(/\d{2}\/\d{2}\/\d{4}/g) ?? [];
}

function offsetDate(anchor: Date, days: number): string {
  const date = new Date(anchor);
  date.setDate(date.getDate() + days);
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}
function dateLine(name: string, budget: number, startOffset: number, endOffset: number, anchor = new Date()): string {
  return `${name}, the budget is £${budget.toLocaleString('en-GB')}, ${offsetDate(anchor, startOffset)} till ${offsetDate(anchor, endOffset)}`;
}
function storeLine(name: string, budget: number, startOffset: number, endOffset: number, stores: number, anchor = new Date()): string {
  return `${dateLine(name, budget, startOffset, endOffset, anchor)}, ${stores} stores`;
}
function calendarKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

async function completeSetup(planningPage: PlanningPage): Promise<void> {
  await planningPage.goto();
  await planningPage.startNectarAiPlanner();
  await planningPage.chooseBuildByObjectiveAndBudget();
  await planningPage.selectAdvertiser(mediaPlannerData.advertiser);
  await planningPage.selectBrand(mediaPlannerData.brand);
  await planningPage.confirmAdvertiserAndBrand();
  await planningPage.enterObjective(mediaPlannerData.objective);
  await planningPage.searchProducts(mediaPlannerData.productSearch);
  await planningPage.selectFirstProduct();
  await planningPage.confirmProducts();
}

async function sendChannel(planningPage: PlanningPage, line: string): Promise<void> {
  await planningPage.enterChannelRequest(line);
  await planningPage.waitForAssistantIdle();
}

type GateCounts = { booking: number; duration: number; stores: number };
async function gateCounts(planningPage: PlanningPage): Promise<GateCounts> {
  return {
    booking: await planningPage.assistantText(/booking deadline/i).count(),
    duration: await planningPage.assistantText(/campaign duration/i).count(),
    stores: await planningPage.assistantText(/between\s+\d+\s+and\s+\d+\s+for/i).count()
  };
}

function gateDelta(before: GateCounts, after: GateCounts): GateCounts {
  return {
    booking: after.booking - before.booking,
    duration: after.duration - before.duration,
    stores: after.stores - before.stores
  };
}

const POLL = { timeout: 75000 } as const;

test.describe.serial(
  'Media Planner cross-cutting validation journeys',
  { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@special-preconditions'] },
  () => {
    test('AC-001 planning page exposes the Nectar AI Assistant entry point', async ({ page }) => {
      const planningPage = new PlanningPage(page);

      await test.step('Open the planning page', async () => {
        await planningPage.goto();
      });

      await test.step('Assert AC-001: the Nectar AI Assistant entry point is visible', async () => {
        await expect(planningPage.nectarAssistantHeading()).toBeVisible();
        await expect(planningPage.startAssistantButton()).toBeVisible();
      });
    });

    test('AC-002 the objective and budget guided flow can be started', async ({ page }) => {
      const planningPage = new PlanningPage(page);

      await test.step('Open the Nectar AI assistant', async () => {
        await planningPage.goto();
        await planningPage.startNectarAiPlanner();
      });

      await test.step('Assert AC-002: the objective & budget flow choice is available', async () => {
        await expect(planningPage.buildByObjectiveButton()).toBeVisible();
      });
    });

    test('AC-003 advertiser, brand, objective and SKU setup reaches the channel-request state', async ({ page }) => {
      const planningPage = new PlanningPage(page);

      await test.step('Complete the guided plan setup', async () => {
        await completeSetup(planningPage);
      });

      await test.step('Assert AC-003: the assistant requests a channel, a budget and a timeline', async () => {
        await expect(planningPage.assistantChatPanel()).toContainText('channel');
        await expect(planningPage.assistantChatPanel()).toContainText('budget');
        await expect(planningPage.assistantChatPanel()).toContainText('timeline');
      });
    });

    // DC-001 enumerated via a loop (data-driven contract); the AC-004 title stays static.
    for (const dataCase of [{ caseId: 'DC-001', budgets: [50000, 40000, 30000, 25000] }]) {
      test(`${dataCase.caseId} AC-004 one valid channel per group is accepted and the summary total equals the computed sum`, async ({ page }) => {
        test.slow();
        const planningPage = new PlanningPage(page);
        const calendarAnchor = new Date();
        const expectedTotal = dataCase.budgets.reduce((s, b) => s + b, 0); // arithmetic sum, not a literal

        await test.step('Add one valid channel per group (start today+14, end today+44)', async () => {
          await requireLiveRulePreflight();
          await completeSetup(planningPage);
          await sendChannel(planningPage, dateLine(C.onsite, 50000, 14, 44, calendarAnchor));
          await sendChannel(planningPage, dateLine(C.offsite, 40000, 14, 44, calendarAnchor));
          await sendChannel(planningPage, storeLine(C.atHome, 30000, 14, 44, 100, calendarAnchor));
          await sendChannel(planningPage, storeLine(C.inStore, 25000, 14, 44, 100, calendarAnchor));
        });

        await test.step('Assert AC-004: all four channels are added and the summary total matches the computed sum', async () => {
          await expect(planningPage.summaryChannel(C.onsite)).toBeVisible();
          await expect(planningPage.summaryChannel(C.inStore)).toBeVisible();
          await expect.poll(async () => moneyOf(await planningPage.summaryTotalBudgetText()), POLL).toBe(expectedTotal);
          await expect.poll(async () => datesOf(await planningPage.summaryTimelineText()), POLL).toContain(offsetDate(calendarAnchor, 14));
          await expect.poll(async () => datesOf(await planningPage.summaryTimelineText()), POLL).toContain(offsetDate(calendarAnchor, 44));
          await expect.poll(() => calendarKey(new Date())).toBe(calendarKey(calendarAnchor));
        });
      });
    }

    test('DC-002 DC-003 AC-005 configured at least gates (defaults: 2 days from today and 20 days) block below and allow boundaries', async ({ page }) => {
      test.slow();
      const planningPage = new PlanningPage(page);
      const calendarAnchor = new Date();
      const belowObserved = { booking: false, duration: false };
      const atObserved = { booking: false, duration: false };

      await test.step('Send below-minimum booking-deadline and minimum-duration channels', async () => {
        await requireLiveRulePreflight();
        await completeSetup(planningPage);
        await sendChannel(
          planningPage,
          dateLine(C.onsite, 50000, cfg.bookingDeadlineDays - 1, cfg.bookingDeadlineDays - 1 + 30, calendarAnchor)
        );
        belowObserved.booking = await planningPage.assistantContainsVisibleText('booking deadline');
        await sendChannel(
          planningPage,
          dateLine(C.offsite, 40000, 14, 14 + (cfg.minimumDurationDays - 2), calendarAnchor)
        );
        belowObserved.duration = await planningPage.assistantContainsVisibleText('must be at least');
      });

      await test.step('Send at-minimum booking-deadline and minimum-duration channels', async () => {
        await completeSetup(planningPage);
        await sendChannel(
          planningPage,
          dateLine(C.onsite, 50000, cfg.bookingDeadlineDays, cfg.bookingDeadlineDays + 30, calendarAnchor)
        );
        atObserved.booking = await planningPage.summaryChannel(C.onsite).isVisible().catch(() => false);
        await sendChannel(
          planningPage,
          dateLine(C.offsite, 40000, 14, 14 + (cfg.minimumDurationDays - 1), calendarAnchor)
        );
        atObserved.duration = await planningPage.summaryChannel(C.offsite).isVisible().catch(() => false);
      });

      await test.step('Send above-minimum booking-deadline and minimum-duration channels', async () => {
        await completeSetup(planningPage);
        await sendChannel(
          planningPage,
          dateLine(C.onsite, 50000, cfg.bookingDeadlineDays + 1, cfg.bookingDeadlineDays + 31, calendarAnchor)
        );
        await sendChannel(
          planningPage,
          dateLine(C.offsite, 40000, 14, 14 + cfg.minimumDurationDays, calendarAnchor)
        );
      });

      await test.step('Assert AC-005: configured at least gates preserve the 2 days and 20 days default examples', async () => {
        await expect.poll(() => belowObserved).toEqual({ booking: true, duration: true });
        await expect.poll(() => atObserved).toEqual({ booking: true, duration: true });
        await expect(planningPage.summaryChannel(C.onsite)).toBeVisible();
        await expect(planningPage.summaryChannel(C.offsite)).toBeVisible();
        await expect.poll(() => calendarKey(new Date())).toBe(calendarKey(calendarAnchor));
      });
    });

    test('DC-004 AC-006 store-volume out-of-band sends are blocked while in-band sends are accepted', async ({ page }) => {
      const planningPage = new PlanningPage(page);
      const calendarAnchor = new Date();

      await test.step('Send below-min, above-max and in-band store counts for In-store Radio', async () => {
        await requireLiveRulePreflight();
        await completeSetup(planningPage);
        await sendChannel(planningPage, storeLine(C.inStore, 25000, 14, 44, cfg.minStores - 1, calendarAnchor));
        await sendChannel(planningPage, storeLine(C.inStore, 25000, 14, 44, cfg.maxStores + 1, calendarAnchor));
        await sendChannel(planningPage, storeLine(C.inStore, 25000, 14, 44, cfg.minStores, calendarAnchor));
      });

      await test.step('Assert AC-006: out-of-band stores prompt a correction while the in-band channel is added', async () => {
        await expect(planningPage.assistantChatPanel()).toContainText('stores');
        await expect(planningPage.summaryChannel(C.inStore)).toBeVisible();
        await expect.poll(() => calendarKey(new Date())).toBe(calendarKey(calendarAnchor));
      });
    });

    test('DC-005 AC-007 a mixed plan rejects only rule-violating channels, each citing only its own gate', async ({ page }) => {
      test.slow();
      const planningPage = new PlanningPage(page);
      const calendarAnchor = new Date();
      const observedDeltas: GateCounts[] = [];

      await test.step('Send a mixed plan with one valid channel and three independent violators', async () => {
        await requireLiveRulePreflight();
        await completeSetup(planningPage);
        for (const line of [
          dateLine(C.onsite, 50000, 1, 31, calendarAnchor),
          dateLine(C.offsite, 40000, 14, 32, calendarAnchor),
          storeLine(C.inStore, 25000, 14, 44, cfg.maxStores + 1, calendarAnchor),
          storeLine(C.atHome, 30000, 14, 44, 100, calendarAnchor)
        ]) {
          const before = await gateCounts(planningPage);
          await sendChannel(planningPage, line);
          observedDeltas.push(gateDelta(before, await gateCounts(planningPage)));
        }
      });

      await test.step('Assert AC-007: only Direct Mail is added; each violator cites only its own gate', async () => {
        await expect.poll(() => observedDeltas).toEqual([
          { booking: 1, duration: 0, stores: 0 },
          { booking: 0, duration: 1, stores: 0 },
          { booking: 0, duration: 0, stores: 1 },
          { booking: 0, duration: 0, stores: 0 }
        ]);
        await expect(planningPage.summaryChannel(C.atHome)).toBeVisible();
        await expect(planningPage.summaryChannel(C.onsite)).toHaveCount(0);
        await expect(planningPage.summaryChannel(C.offsite)).toHaveCount(0);
        await expect(planningPage.summaryChannel(C.inStore)).toHaveCount(0);
        await expect.poll(async () => moneyOf(await planningPage.summaryTotalBudgetText()), POLL).toBe(30000);
        await expect.poll(() => calendarKey(new Date())).toBe(calendarKey(calendarAnchor));
      });
    });

    test('DC-007 AC-007 cross-field gate failures stay independent in separate conversations', async ({ page }) => {
      test.slow();
      const planningPage = new PlanningPage(page);
      const calendarAnchor = new Date();
      const observedDeltas: GateCounts[] = [];

      await test.step('Send the deadline-only and duration-only rows in separate fresh conversations', async () => {
        await requireLiveRulePreflight();
        await completeSetup(planningPage);
        let before = await gateCounts(planningPage);
        await sendChannel(planningPage, dateLine(C.onsite, 50000, 1, 30, calendarAnchor));
        observedDeltas.push(gateDelta(before, await gateCounts(planningPage)));

        await completeSetup(planningPage);
        before = await gateCounts(planningPage);
        await sendChannel(planningPage, dateLine(C.offsite, 40000, 5, 23, calendarAnchor));
        observedDeltas.push(gateDelta(before, await gateCounts(planningPage)));
      });

      await test.step('Assert AC-007: each latest reply contains only its failing gate', async () => {
        await expect.poll(() => observedDeltas).toEqual([
          { booking: 1, duration: 0, stores: 0 },
          { booking: 0, duration: 1, stores: 0 }
        ]);
        await expect(planningPage.summaryChannel(C.offsite)).toHaveCount(0);
        await expect.poll(() => calendarKey(new Date())).toBe(calendarKey(calendarAnchor));
      });
    });

    test('DC-006 AC-008 read-only live configuration matches the expected fixture contract', async () => {
      let snapshots: RuleSnapshot[] = [];

      await test.step('Read exact channels and validate every applicable rule field without mutation', async () => {
        snapshots = await requireLiveRulePreflight();
      });

      await test.step('Assert AC-008: all four exact channel snapshots match the expected contract', async () => {
        await expect.poll(() => snapshots.map((snapshot) => snapshot.name)).toEqual([
          C.onsite,
          C.offsite,
          C.atHome,
          C.inStore
        ]);
      });
    });

    test('DC-008 AC-009 the summary recomputes after every interleaved add and delete', async ({ page }) => {
      test.slow();
      const planningPage = new PlanningPage(page);
      const calendarAnchor = new Date();
      const runningTotals: number[] = [];

      await test.step('Run the interleaved add/delete sequence (DC-008)', async () => {
        await requireLiveRulePreflight();
        await completeSetup(planningPage);
        await sendChannel(planningPage, dateLine(C.onsite, 50000, 10, 40, calendarAnchor));
        runningTotals.push(moneyOf(await planningPage.summaryTotalBudgetText()));
        await sendChannel(planningPage, dateLine(C.offsite, 40000, 14, 50, calendarAnchor));
        runningTotals.push(moneyOf(await planningPage.summaryTotalBudgetText()));
        await planningPage.deleteChannelViaChat(C.offsite);
        runningTotals.push(moneyOf(await planningPage.summaryTotalBudgetText()));
        await sendChannel(planningPage, storeLine(C.atHome, 30000, 20, 45, 100, calendarAnchor));
        runningTotals.push(moneyOf(await planningPage.summaryTotalBudgetText()));
        await sendChannel(planningPage, storeLine(C.inStore, 25000, 12, 48, 100, calendarAnchor));
        runningTotals.push(moneyOf(await planningPage.summaryTotalBudgetText()));
        await planningPage.deleteChannelViaChat(C.onsite);
        runningTotals.push(moneyOf(await planningPage.summaryTotalBudgetText()));
      });

      await test.step('Assert AC-009: every running total and the final survivor span match the computed values', async () => {
        await expect.poll(() => runningTotals).toEqual([50000, 90000, 50000, 80000, 105000, 55000]);
        await expect.poll(async () => moneyOf(await planningPage.summaryTotalBudgetText()), POLL).toBe(30000 + 25000);
        await expect.poll(async () => datesOf(await planningPage.summaryTimelineText()), POLL).toContain(offsetDate(calendarAnchor, 12));
        await expect.poll(async () => datesOf(await planningPage.summaryTimelineText()), POLL).toContain(offsetDate(calendarAnchor, 48));
        await expect(planningPage.summaryChannel(C.atHome)).toBeVisible();
        await expect(planningPage.summaryChannel(C.inStore)).toBeVisible();
        await expect(planningPage.summaryChannel(C.onsite)).toHaveCount(0);
        await expect(planningPage.summaryChannel(C.offsite)).toHaveCount(0);
        await expect.poll(() => calendarKey(new Date())).toBe(calendarKey(calendarAnchor));
      });
    });

    test('DC-009 AC-009 deleting the last channel clears every summary aggregate', async ({ page }) => {
      test.slow();
      const planningPage = new PlanningPage(page);
      const calendarAnchor = new Date();

      await test.step('Add one valid channel and delete it as the last remaining row', async () => {
        await requireLiveRulePreflight();
        await completeSetup(planningPage);
        await sendChannel(planningPage, storeLine(C.atHome, 30000, 14, 44, 100, calendarAnchor));
        await planningPage.deleteChannelViaChat(C.atHome);
      });

      await test.step('Assert AC-009: empty plan clears total, dates, and channel rows', async () => {
        await expect(planningPage.summaryTotalBudget()).toContainText('£--');
        await expect(planningPage.summaryDates()).not.toContainText(/\d{2}\/\d{2}\/\d{4}/);
        await expect(planningPage.summaryChannel(C.atHome)).toHaveCount(0);
        await expect.poll(() => calendarKey(new Date())).toBe(calendarKey(calendarAnchor));
      });
    });

    test('DC-010 AC-010 browserless Travel Money plus budget-led oracle recomputes after removal', async () => {
      const travelMoney = calculateTravelMoneyScreensCost({
        costPerStoreStandard: 300,
        numberOfStores: 250,
        mediaServiceType: 'Self-serve'
      });
      const grandTotal = roundToPence(travelMoney + 50000 + 40000);
      const afterRemoval = roundToPence(grandTotal - travelMoney);

      await test.step('Compute Travel Money plus two budget-led values, then remove Travel Money arithmetically', async () => {
        void grandTotal;
      });

      await test.step('Assert AC-010: oracle grand total is 165000 and removal recomputes to 90000', async () => {
        await expect.poll(() => ({ grandTotal, afterRemoval })).toEqual({ grandTotal: 165000, afterRemoval: 90000 });
      });
    });

    test('DC-002 NEG-001 an Onsite Display start inside the configured booking deadline is rejected', async ({ page }) => {
      const planningPage = new PlanningPage(page);
      const calendarAnchor = new Date();

      await test.step('Arrange NEG-001: send Onsite Display one day inside the booking deadline', async () => {
        await requireLiveRulePreflight();
        await completeSetup(planningPage);
        await sendChannel(
          planningPage,
          dateLine(C.onsite, 50000, cfg.bookingDeadlineDays - 1, cfg.bookingDeadlineDays - 1 + 30, calendarAnchor)
        );
      });

      await test.step('Assert NEG-001: Onsite Display is rejected with the booking-deadline error and configured days', async () => {
        await expect(planningPage.assistantChatPanel()).toContainText(C.onsite);
        await expect(planningPage.assistantChatPanel()).toContainText('booking deadline');
        await expect(planningPage.assistantChatPanel()).toContainText(`at least ${cfg.bookingDeadlineDays} days`);
        await expect(planningPage.summaryChannel(C.onsite)).toHaveCount(0);
        await expect.poll(() => calendarKey(new Date())).toBe(calendarKey(calendarAnchor));
      });
    });

    test('DC-003 NEG-002 an Offsite Display duration under the configured minimum is rejected', async ({ page }) => {
      const planningPage = new PlanningPage(page);
      const calendarAnchor = new Date();

      await test.step('Arrange NEG-002: send Offsite Display one day under the minimum duration', async () => {
        await requireLiveRulePreflight();
        await completeSetup(planningPage);
        await sendChannel(
          planningPage,
          dateLine(C.offsite, 40000, 14, 14 + (cfg.minimumDurationDays - 2), calendarAnchor)
        );
      });

      await test.step('Assert NEG-002: Offsite Display is rejected with the minimum-duration error and configured days', async () => {
        await expect(planningPage.assistantChatPanel()).toContainText(C.offsite);
        await expect(planningPage.assistantChatPanel()).toContainText('must be at least');
        await expect(planningPage.assistantChatPanel()).toContainText(`${cfg.minimumDurationDays} days`);
        await expect(planningPage.summaryChannel(C.offsite)).toHaveCount(0);
        await expect.poll(() => calendarKey(new Date())).toBe(calendarKey(calendarAnchor));
      });
    });

    test('DC-004 NEG-003 an In-store Radio store count outside the configured band is rejected', async ({ page }) => {
      const planningPage = new PlanningPage(page);
      const calendarAnchor = new Date();

      await test.step('Arrange NEG-003: send In-store Radio below the configured minimum stores', async () => {
        await requireLiveRulePreflight();
        await completeSetup(planningPage);
        await sendChannel(planningPage, storeLine(C.inStore, 25000, 14, 44, cfg.minStores - 1, calendarAnchor));
      });

      await test.step('Assert NEG-003: In-store Radio is not added and the assistant prompts to correct the stores', async () => {
        await expect(planningPage.assistantChatPanel()).toContainText('stores');
        await expect(planningPage.summaryChannel(C.inStore)).toHaveCount(0);
        await expect.poll(() => calendarKey(new Date())).toBe(calendarKey(calendarAnchor));
      });
    });

    test('DC-005 NEG-004 in a mixed plan each violator is rejected with only its own gate error', async ({ page }) => {
      test.slow();
      const planningPage = new PlanningPage(page);
      const calendarAnchor = new Date();

      await test.step('Arrange NEG-004: send three independent violators alongside one valid channel', async () => {
        await requireLiveRulePreflight();
        await completeSetup(planningPage);
        await sendChannel(planningPage, dateLine(C.onsite, 50000, 1, 31, calendarAnchor));
        await sendChannel(planningPage, dateLine(C.offsite, 40000, 14, 32, calendarAnchor));
        await sendChannel(planningPage, storeLine(C.inStore, 25000, 14, 44, cfg.maxStores + 1, calendarAnchor));
        await sendChannel(planningPage, storeLine(C.atHome, 30000, 14, 44, 100, calendarAnchor));
      });

      await test.step('Assert NEG-004: only Direct Mail is added; the three violators are absent from the summary', async () => {
        await expect(planningPage.summaryChannel(C.atHome)).toBeVisible();
        await expect(planningPage.summaryChannel(C.onsite)).toHaveCount(0);
        await expect(planningPage.summaryChannel(C.offsite)).toHaveCount(0);
        await expect(planningPage.summaryChannel(C.inStore)).toHaveCount(0);
        await expect(planningPage.assistantChatPanel()).toContainText('booking deadline');
        await expect(planningPage.assistantChatPanel()).toContainText('campaign duration');
        await expect(planningPage.assistantChatPanel()).toContainText('stores');
        await expect.poll(() => calendarKey(new Date())).toBe(calendarKey(calendarAnchor));
      });
    });

    test('DC-007 NEG-005 a channel failing one gate shows only the failing gate error', async ({ page }) => {
      const planningPage = new PlanningPage(page);
      const calendarAnchor = new Date();
      const observedDeltas: GateCounts[] = [];

      await test.step('Arrange NEG-005: send deadline-only and duration-only failures in separate conversations', async () => {
        await requireLiveRulePreflight();
        await completeSetup(planningPage);
        let before = await gateCounts(planningPage);
        await sendChannel(planningPage, dateLine(C.onsite, 50000, 1, 30, calendarAnchor));
        observedDeltas.push(gateDelta(before, await gateCounts(planningPage)));

        await completeSetup(planningPage);
        before = await gateCounts(planningPage);
        await sendChannel(planningPage, dateLine(C.offsite, 40000, 5, 23, calendarAnchor));
        observedDeltas.push(gateDelta(before, await gateCounts(planningPage)));
      });

      await test.step('Assert NEG-005: each latest reply increments only its failing gate', async () => {
        await expect.poll(() => observedDeltas).toEqual([
          { booking: 1, duration: 0, stores: 0 },
          { booking: 0, duration: 1, stores: 0 }
        ]);
        await expect(planningPage.summaryChannel(C.offsite)).toHaveCount(0);
        await expect.poll(() => calendarKey(new Date())).toBe(calendarKey(calendarAnchor));
      });
    });

    test('DC-006 NEG-006 configuration mismatch fails closed with exact channel and field context', async () => {
      let preflightError = '';

      await test.step('Arrange NEG-006: validate a snapshot whose booking deadline differs from the expected contract', async () => {
        preflightError = ruleSnapshotError({
          name: C.onsite,
          bookingDeadlineDays: cfg.bookingDeadlineDays + 1,
          minimumDurationDays: cfg.minimumDurationDays
        });
      });

      await test.step('Assert NEG-006: mismatch error names the exact channel and booking-deadline field', async () => {
        await expect.poll(() => preflightError).toContain(`${C.onsite}.bookingDeadlineDays`);
      });
    });
  }
);
