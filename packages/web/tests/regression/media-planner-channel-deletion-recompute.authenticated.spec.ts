// Spec-bound header: sha256 is the behavioral hash of the spec (computed via
// scripts/ai/lib/spec-parser.mjs specSha256). Re-stamp with `npm run ai:spec:stamp`
// if the spec's behavioral sections change.
/* spec: specs/special-preconditions/media-planner-channel-deletion-recompute.md version:2.1.0 sha256:a54528cd887d7b0b632f39c284f6d769921812fb2059fe7fc023e28d3e641ae7 */
import { test, expect } from '../../fixtures/test';
import { PlanningPage } from '../../pages/PlanningPage';

// Spec FLOW-MP-008 (suite mode): one focused test per acceptance criterion. The whole
// guided flow + channel adds is replayed per test for retry-determinism on the shared
// dev environment, so each test is marked slow.
const plan = {
  advertiser: 'N360_Unilever_MS',
  brand: 'Unilever | Knorr | MS',
  objective: 'Customer retention',
  productSearch: 'knorr'
} as const;

// Two onsite channels that resolve by exact name in the dev environment, with the
// budgets the summary renders. Override per environment via E2E_MP_RECOMPUTE_CHANNEL_*.
const channelA = process.env.E2E_MP_RECOMPUTE_CHANNEL_A ?? 'Homepage Sponsored Product';
const channelB = process.env.E2E_MP_RECOMPUTE_CHANNEL_B ?? 'SmartShop Handset Home Page (DEMO)';
const budgetA = 15_000;
const budgetB = 10_000;
// The campaign window is computed at runtime (start ~45 days out, 30-day duration) so the suite
// never rots into past-dated requests; a hardcoded window was a time-bomb after its start date.
const formatDdMmYyyy = (date: Date): string =>
  `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
const addDays = (anchor: Date, days: number): Date => {
  const date = new Date(anchor);
  date.setDate(date.getDate() + days);
  return date;
};
const dates = (anchor: Date): string => `${formatDdMmYyyy(addDays(anchor, 45))} - ${formatDdMmYyyy(addDays(anchor, 75))}`;
// The chat request phrasing omits the catalogue's ' (DEMO)' suffix; derive it from the resolved
// name so an E2E_MP_RECOMPUTE_CHANNEL_B override changes both the request and the row assertion.
const channelBRequestName = channelB.replace(/\s*\(DEMO\)\s*$/, '');

async function buildPlanToChannelStage(planningPage: PlanningPage): Promise<void> {
  await planningPage.goto();
  await planningPage.startNectarAiPlanner();
  await planningPage.chooseBuildByObjectiveAndBudget();
  await planningPage.selectAdvertiser(plan.advertiser);
  await planningPage.selectBrand(plan.brand);
  await planningPage.confirmAdvertiserAndBrand();
  await planningPage.enterObjective(plan.objective);
  await planningPage.searchProducts(plan.productSearch);
  await planningPage.selectFirstProduct();
  await planningPage.confirmProducts();
}

function formatWholeGbp(value: number): string {
  return `£${value.toLocaleString('en-GB')}`;
}

function calendarKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

async function buildTwoChannelPlan(planningPage: PlanningPage, calendarAnchor: Date): Promise<void> {
  await buildPlanToChannelStage(planningPage);
  const campaignDates = dates(calendarAnchor);
  await planningPage.enterChannelRequest(`Onsite, ${channelA}, £${budgetA}, ${campaignDates}, Self-Serve`, channelA);
  await planningPage.enterChannelRequest(`Onsite, ${channelBRequestName}, £${budgetB}, ${campaignDates}, Self-Serve`, channelB);
}

test.describe.serial(
  'Media Planner channel deletion budget recompute',
  { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@special-preconditions'] },
  () => {
    test('AC-001 the planner entry path reaches the guided flow', async ({ page }) => {
      const planningPage = new PlanningPage(page);

      await test.step('Walk the real entry journey (landing -> Try now)', async () => {
        await planningPage.goto();
        await planningPage.startNectarAiPlanner();
      });

      await test.step('Assert AC-001: the guided objective-and-budget flow is reachable', async () => {
        await expect(planningPage.buildByObjectiveButton()).toBeVisible();
      });
    });

    test('AC-002 the guided setup completes and the assistant requests a channel', async ({ page }) => {
      // 4+ streamed assistant turns at 30-60s+ each: the 30s default (even tripled by
      // test.slow()) cannot cover the journey; use the same explicit budget as the siblings.
      test.setTimeout(360_000);
      const planningPage = new PlanningPage(page);

      await test.step('Complete the guided plan setup (advertiser, brand, objective, SKU)', async () => {
        await buildPlanToChannelStage(planningPage);
      });

      await test.step('Assert AC-002: the assistant requests a channel, a budget and a timeline', async () => {
        // Case-insensitive: this is streamed LLM copy, and casing/wording drifts turn to turn.
        await expect(planningPage.assistantChatPanel()).toContainText(/channel/i);
        await expect(planningPage.assistantChatPanel()).toContainText(/budget/i);
        await expect(planningPage.assistantChatPanel()).toContainText(/timeline|dates?/i);
      });
    });

    test('DC-001 AC-003 adding two channels shows both rows and a combined Total Budget', async ({ page }) => {
      test.setTimeout(360_000);
      const planningPage = new PlanningPage(page);
      const calendarAnchor = new Date();
      const combinedTotal = budgetA + budgetB;

      await test.step('Build the plan and add channelA and channelB', async () => {
        await buildTwoChannelPlan(planningPage, calendarAnchor);
      });

      await test.step('Assert AC-003: both channels appear and labelled Total Budget equals their computed sum', async () => {
        await expect(planningPage.summaryChannel(channelA)).toBeVisible();
        await expect(planningPage.summaryChannel(channelB)).toBeVisible();
        await expect(planningPage.summaryPanel()).toContainText('Total Budget');
        await expect(planningPage.summaryTotalBudget()).toContainText(formatWholeGbp(combinedTotal));
        await expect.poll(() => formatWholeGbp(combinedTotal)).toBe('£25,000');
        await expect.poll(() => calendarKey(new Date())).toBe(calendarKey(calendarAnchor));
      });
    });

    test('DC-001 AC-004 deleting one channel recomputes the Total Budget to the remaining channel', async ({ page }) => {
      test.setTimeout(360_000);
      const planningPage = new PlanningPage(page);
      const calendarAnchor = new Date();

      await test.step('Build the two-channel plan and delete channelA', async () => {
        await buildTwoChannelPlan(planningPage, calendarAnchor);
        await planningPage.deleteChannel(channelA);
      });

      await test.step('Assert AC-004: Total Budget recomputes to the numeric survivor budget and channelA is gone', async () => {
        await expect(planningPage.summaryPanel()).toContainText('Total Budget');
        await expect(planningPage.summaryTotalBudget()).toContainText(formatWholeGbp(budgetB));
        await expect.poll(() => formatWholeGbp(budgetB)).toBe('£10,000');
        await expect(planningPage.summaryChannel(channelA)).toHaveCount(0);
        await expect(planningPage.summaryChannel(channelB)).toBeVisible();
        await expect.poll(() => calendarKey(new Date())).toBe(calendarKey(calendarAnchor));
      });
    });

    test('NEG-001 deleting every channel returns the Total Budget to the empty state', async ({ page }) => {
      test.setTimeout(360_000);
      const planningPage = new PlanningPage(page);
      const calendarAnchor = new Date();

      await test.step('Build the two-channel plan and delete both channels', async () => {
        await buildTwoChannelPlan(planningPage, calendarAnchor);
        await planningPage.deleteChannel(channelA);
        await planningPage.deleteChannel(channelB);
      });

      await test.step('Assert NEG-001: Total Budget returns to the empty-state £-- with no channels', async () => {
        await expect(planningPage.summaryTotalBudget()).toContainText('£--');
        await expect(planningPage.summaryChannel(channelA)).toHaveCount(0);
        await expect(planningPage.summaryChannel(channelB)).toHaveCount(0);
        await expect.poll(() => calendarKey(new Date())).toBe(calendarKey(calendarAnchor));
      });
    });
  }
);
