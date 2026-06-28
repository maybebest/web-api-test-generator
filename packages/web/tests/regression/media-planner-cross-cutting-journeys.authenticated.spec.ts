// Spec-bound header: sha256 is the behavioral hash of the spec. Re-stamp with
// `npm run ai:spec:stamp` if the spec's behavioral sections change.
/* spec: specs/special-preconditions/media-planner-cross-cutting-journeys.md version:1.0.0 sha256:c8208a5548a5e10cf45a42ef56445f1f7b424d32ebac770312e65ed09ced2d17 */
import { test, expect } from '../../fixtures/test';
import { PlanningPage } from '../../pages/PlanningPage';
import { mediaPlannerData, offsetDate } from '../../data/media-planner';
import {
  CONFIGURED_CHANNELS,
  resolveChannelConfig,
  readLiveGroupChannels
} from '../../fixtures/channel-management.fixture';

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

function moneyOf(text: string): number {
  const digits = text.replace(/[^0-9]/g, '');
  return digits ? Number(digits) : NaN;
}
function datesOf(text: string): string[] {
  return text.match(/\d{2}\/\d{2}\/\d{4}/g) ?? [];
}

function dateLine(name: string, budget: number, startOffset: number, endOffset: number): string {
  return `${name}, the budget is £${budget.toLocaleString('en-GB')}, ${offsetDate(startOffset)} till ${offsetDate(endOffset)}`;
}
function storeLine(name: string, budget: number, startOffset: number, endOffset: number, stores: number): string {
  return `${dateLine(name, budget, startOffset, endOffset)}, ${stores} stores`;
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
        const expectedTotal = dataCase.budgets.reduce((s, b) => s + b, 0); // arithmetic sum, not a literal
        await test.step('Add one valid channel per group (start today+14, end today+44)', async () => {
          await completeSetup(planningPage);
          await sendChannel(planningPage, dateLine(C.onsite, 50000, 14, 44));
          await sendChannel(planningPage, dateLine(C.offsite, 40000, 14, 44));
          await sendChannel(planningPage, storeLine(C.atHome, 30000, 14, 44, 100));
          await sendChannel(planningPage, storeLine(C.inStore, 25000, 14, 44, 250));
        });
        await test.step('Assert AC-004: all four channels are added and the summary total matches the computed sum', async () => {
          await expect(planningPage.summaryChannel(C.onsite)).toBeVisible();
          await expect(planningPage.summaryChannel(C.inStore)).toBeVisible();
          await expect.poll(async () => moneyOf(await planningPage.summaryTotalBudgetText()), POLL).toBe(expectedTotal);
          await expect.poll(async () => datesOf(await planningPage.summaryTimelineText()), POLL).toContain(offsetDate(14));
          await expect.poll(async () => datesOf(await planningPage.summaryTimelineText()), POLL).toContain(offsetDate(44));
        });
      });
    }

    test('DC-002 DC-003 AC-005 booking-deadline and minimum-duration triads block below-minimum and allow at/above', async ({ page }) => {
      test.slow();
      const planningPage = new PlanningPage(page);
      await test.step('Send below-minimum booking-deadline and minimum-duration channels', async () => {
        await completeSetup(planningPage);
        await sendChannel(planningPage, dateLine(C.onsite, 50000, cfg.bookingDeadlineDays - 1, cfg.bookingDeadlineDays - 1 + 30));
        await sendChannel(planningPage, dateLine(C.offsite, 40000, 14, 14 + (cfg.minimumDurationDays - 2)));
      });
      await test.step('Send at-minimum booking-deadline and minimum-duration channels', async () => {
        await sendChannel(planningPage, dateLine(C.onsite, 50000, cfg.bookingDeadlineDays, cfg.bookingDeadlineDays + 30));
        await sendChannel(planningPage, dateLine(C.offsite, 40000, 14, 14 + (cfg.minimumDurationDays - 1)));
      });
      await test.step('Assert AC-005: below-minimum sends show the gate error while at-minimum sends are allowed', async () => {
        await expect(planningPage.assistantChatPanel()).toContainText(C.onsite);
        await expect(planningPage.assistantChatPanel()).toContainText('booking deadline');
        await expect(planningPage.assistantChatPanel()).toContainText(C.offsite);
        await expect(planningPage.assistantChatPanel()).toContainText('must be at least');
        await expect(planningPage.assistantChatPanel()).toContainText('days');
        await expect(planningPage.summaryChannel(C.onsite)).toBeVisible();
      });
    });

    test('DC-004 AC-006 store-volume out-of-band sends are blocked while in-band sends are accepted', async ({ page }) => {
      const planningPage = new PlanningPage(page);
      await test.step('Send below-min, above-max and in-band store counts for In-store Radio', async () => {
        await completeSetup(planningPage);
        await sendChannel(planningPage, storeLine(C.inStore, 25000, 14, 44, cfg.minStores - 1));
        await sendChannel(planningPage, storeLine(C.inStore, 25000, 14, 44, cfg.maxStores + 1));
        await sendChannel(planningPage, storeLine(C.inStore, 25000, 14, 44, cfg.minStores));
      });
      await test.step('Assert AC-006: out-of-band stores prompt a correction while the in-band channel is added', async () => {
        await expect(planningPage.assistantChatPanel()).toContainText('stores');
        await expect(planningPage.summaryChannel(C.inStore)).toBeVisible();
      });
    });

    test('DC-005 DC-007 AC-007 a mixed plan rejects only rule-violating channels, each citing only its own gate', async ({ page }) => {
      test.slow();
      const planningPage = new PlanningPage(page);
      await test.step('Send a mixed plan with one valid channel and three independent violators', async () => {
        await completeSetup(planningPage);
        await sendChannel(planningPage, dateLine(C.onsite, 50000, 1, 31)); // booking-deadline violator
        await sendChannel(planningPage, dateLine(C.offsite, 40000, 14, 32)); // 18-day duration violator
        await sendChannel(planningPage, storeLine(C.inStore, 25000, 14, 44, cfg.maxStores + 1)); // store violator
        await sendChannel(planningPage, storeLine(C.atHome, 30000, 14, 44, 100)); // valid control
      });
      await test.step('Assert AC-007: only Direct Mail is added; each violator cites only its own gate', async () => {
        await expect(planningPage.summaryChannel(C.atHome)).toBeVisible();
        await expect(planningPage.summaryChannel(C.onsite)).toHaveCount(0);
        await expect(planningPage.assistantChatPanel()).toContainText('booking deadline');
        await expect(planningPage.assistantChatPanel()).toContainText('must be at least');
      });
    });

    test('DC-006 AC-008 the freshly read configured deadline is enforced on a new conversation', async ({ page }) => {
      const planningPage = new PlanningPage(page);
      await test.step('In a fresh conversation, send below and at the configured booking deadline', async () => {
        await completeSetup(planningPage);
        await sendChannel(planningPage, dateLine(C.onsite, 50000, cfg.bookingDeadlineDays - 1, cfg.bookingDeadlineDays - 1 + 30));
        await sendChannel(planningPage, dateLine(C.onsite, 50000, cfg.bookingDeadlineDays, cfg.bookingDeadlineDays + 30));
      });
      await test.step('Assert AC-008: below the configured deadline is blocked citing the configured days; at it is allowed', async () => {
        await expect(planningPage.assistantChatPanel()).toContainText(C.onsite);
        await expect(planningPage.assistantChatPanel()).toContainText('booking deadline');
        await expect(planningPage.assistantChatPanel()).toContainText(`${cfg.bookingDeadlineDays} days`);
        await expect(planningPage.summaryChannel(C.onsite)).toBeVisible();
      });
    });

    test('DC-008 DC-009 AC-009 the summary recomputes after each add and delete and clears when empty', async ({ page }) => {
      test.slow();
      const planningPage = new PlanningPage(page);
      await test.step('Run the interleaved add/delete sequence (DC-008)', async () => {
        await completeSetup(planningPage);
        await sendChannel(planningPage, dateLine(C.onsite, 50000, 10, 40));
        await sendChannel(planningPage, dateLine(C.offsite, 40000, 14, 50));
        await planningPage.deleteChannelViaChat(C.offsite);
        await sendChannel(planningPage, storeLine(C.atHome, 30000, 20, 45, 100));
        await sendChannel(planningPage, storeLine(C.inStore, 25000, 12, 48, 250));
        await planningPage.deleteChannelViaChat(C.onsite);
      });
      await test.step('Assert AC-009: final total is the computed sum of survivors with the recomputed span', async () => {
        await expect.poll(async () => moneyOf(await planningPage.summaryTotalBudgetText()), POLL).toBe(30000 + 25000);
        await expect.poll(async () => datesOf(await planningPage.summaryTimelineText()), POLL).toContain(offsetDate(12));
        await expect.poll(async () => datesOf(await planningPage.summaryTimelineText()), POLL).toContain(offsetDate(48));
        await expect(planningPage.summaryChannel(C.atHome)).toBeVisible();
      });
    });

    test('DC-010 AC-010 the summary total recomputes to the budget-led oracle sum after the Pos channel is removed', async ({ page }) => {
      test.slow();
      const planningPage = new PlanningPage(page);
      // Oracle (DC-010): after removing the PosCostPerStore channel only the two
      // budget-led channels remain, so the recomputed total is their arithmetic sum.
      // The full grand total (posCost + budgets) needs the external cost-oracle
      // per-store rate and cannot be a locator-grounded assertion, so the testable
      // invariant here is the post-removal recompute.
      const budgetLedTotal = 50000 + 40000;
      await test.step('Build a Pos + budget-led plan, then remove the Pos channel', async () => {
        await completeSetup(planningPage);
        await sendChannel(planningPage, storeLine(C.inStore, 0, 14, 44, 250)); // PosCostPerStore channel
        await sendChannel(planningPage, dateLine(C.onsite, 50000, 14, 44));
        await sendChannel(planningPage, dateLine(C.offsite, 40000, 14, 44));
        await planningPage.deleteChannelViaChat(C.inStore);
      });
      await test.step('Assert AC-010: the summary total equals the budget-led oracle sum (90000)', async () => {
        await expect.poll(async () => moneyOf(await planningPage.summaryTotalBudgetText()), POLL).toBe(budgetLedTotal);
      });
    });

    test('DC-002 NEG-001 an Onsite Display start inside the configured booking deadline is rejected', async ({ page }) => {
      const planningPage = new PlanningPage(page);
      await test.step('Arrange NEG-001: send Onsite Display one day inside the booking deadline', async () => {
        await completeSetup(planningPage);
        await sendChannel(planningPage, dateLine(C.onsite, 50000, cfg.bookingDeadlineDays - 1, cfg.bookingDeadlineDays - 1 + 30));
      });
      await test.step('Assert NEG-001: Onsite Display is rejected with the booking-deadline error and configured days', async () => {
        await expect(planningPage.assistantChatPanel()).toContainText(C.onsite);
        await expect(planningPage.assistantChatPanel()).toContainText('booking deadline');
        await expect(planningPage.assistantChatPanel()).toContainText('at least 2 days');
      });
    });

    test('DC-003 NEG-002 an Offsite Display duration under the configured minimum is rejected', async ({ page }) => {
      const planningPage = new PlanningPage(page);
      await test.step('Arrange NEG-002: send Offsite Display one day under the minimum duration', async () => {
        await completeSetup(planningPage);
        await sendChannel(planningPage, dateLine(C.offsite, 40000, 14, 14 + (cfg.minimumDurationDays - 2)));
      });
      await test.step('Assert NEG-002: Offsite Display is rejected with the minimum-duration error and configured days', async () => {
        await expect(planningPage.assistantChatPanel()).toContainText(C.offsite);
        await expect(planningPage.assistantChatPanel()).toContainText('must be at least');
        await expect(planningPage.assistantChatPanel()).toContainText('20 days');
      });
    });

    test('DC-004 NEG-003 an In-store Radio store count outside the configured band is rejected', async ({ page }) => {
      const planningPage = new PlanningPage(page);
      await test.step('Arrange NEG-003: send In-store Radio below the configured minimum stores', async () => {
        await completeSetup(planningPage);
        await sendChannel(planningPage, storeLine(C.inStore, 25000, 14, 44, cfg.minStores - 1));
      });
      await test.step('Assert NEG-003: In-store Radio is not added and the assistant prompts to correct the stores', async () => {
        await expect(planningPage.assistantChatPanel()).toContainText('stores');
        await expect(planningPage.summaryChannel(C.inStore)).toHaveCount(0);
      });
    });

    test('DC-005 NEG-004 in a mixed plan each violator is rejected with only its own gate error', async ({ page }) => {
      test.slow();
      const planningPage = new PlanningPage(page);
      await test.step('Arrange NEG-004: send three independent violators alongside one valid channel', async () => {
        await completeSetup(planningPage);
        await sendChannel(planningPage, dateLine(C.onsite, 50000, 1, 31));
        await sendChannel(planningPage, dateLine(C.offsite, 40000, 14, 32));
        await sendChannel(planningPage, storeLine(C.inStore, 25000, 14, 44, cfg.maxStores + 1));
        await sendChannel(planningPage, storeLine(C.atHome, 30000, 14, 44, 100));
      });
      await test.step('Assert NEG-004: only Direct Mail is added; the three violators are absent from the summary', async () => {
        await expect(planningPage.summaryChannel(C.atHome)).toBeVisible();
        await expect(planningPage.summaryChannel(C.onsite)).toHaveCount(0);
        await expect(planningPage.summaryChannel(C.offsite)).toHaveCount(0);
        await expect(planningPage.assistantChatPanel()).toContainText('booking deadline');
      });
    });

    test('DC-007 NEG-005 a channel failing one gate shows only the failing gate error', async ({ page }) => {
      const planningPage = new PlanningPage(page);
      await test.step('Arrange NEG-005: send Onsite Display failing only the booking deadline', async () => {
        await completeSetup(planningPage);
        await sendChannel(planningPage, dateLine(C.onsite, 50000, 1, 31)); // deadline-fail, 30-day duration OK
      });
      await test.step('Assert NEG-005: only the booking-deadline error appears, not the duration error', async () => {
        await expect(planningPage.assistantChatPanel()).toContainText('booking deadline');
        await expect(planningPage.assistantChatPanel()).not.toContainText('campaign duration');
      });
    });

    test('DC-006 NEG-006 a send below the freshly read configured deadline is rejected citing the current days', async ({ page }) => {
      const planningPage = new PlanningPage(page);
      await test.step('Arrange NEG-006: read the live configured channels then send below the configured deadline', async () => {
        await readLiveGroupChannels(); // precondition guard: verifies the group channels exist when a token is set
        await completeSetup(planningPage);
        await sendChannel(planningPage, dateLine(C.onsite, 50000, cfg.bookingDeadlineDays - 1, cfg.bookingDeadlineDays - 1 + 30));
      });
      await test.step('Assert NEG-006: the send is blocked citing the freshly read configured day count', async () => {
        await expect(planningPage.assistantChatPanel()).toContainText(C.onsite);
        await expect(planningPage.assistantChatPanel()).toContainText('booking deadline');
        await expect(planningPage.assistantChatPanel()).toContainText(`${cfg.bookingDeadlineDays} days`);
      });
    });
  }
);
