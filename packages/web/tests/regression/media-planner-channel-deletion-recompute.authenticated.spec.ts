// Spec-bound header: sha256 is the behavioral hash of the spec (computed via
// scripts/ai/lib/spec-parser.mjs specSha256). Re-stamp with `npm run ai:spec:stamp`
// if the spec's behavioral sections change.
/* spec: specs/special-preconditions/media-planner-channel-deletion-recompute.md version:2.0.0 sha256:fae968f0cb17e0d4e16c4fe9b750d64851a4da9fa392584d6999f56200ebd7bd */
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
const DATES = '15/08/2026 - 14/09/2026';

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

async function buildTwoChannelPlan(planningPage: PlanningPage): Promise<void> {
  await buildPlanToChannelStage(planningPage);
  await planningPage.enterChannelRequest(`Onsite, ${channelA}, £15000, ${DATES}, Self-Serve`, channelA);
  await planningPage.enterChannelRequest(`Onsite, SmartShop Handset Home Page, £10000, ${DATES}, Self-Serve`, channelB);
}

test.describe.serial(
  'Media Planner channel deletion budget recompute',
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

    test('AC-002 the guided setup completes and the assistant requests a channel', async ({ page }) => {
      test.slow();
      const planningPage = new PlanningPage(page);
      await test.step('Complete the guided plan setup (advertiser, brand, objective, SKU)', async () => {
        await buildPlanToChannelStage(planningPage);
      });
      await test.step('Assert AC-002: the assistant requests a channel, a budget and a timeline', async () => {
        await expect(planningPage.assistantChatPanel()).toContainText('channel');
        await expect(planningPage.assistantChatPanel()).toContainText('budget');
        await expect(planningPage.assistantChatPanel()).toContainText('timeline');
      });
    });

    test('DC-001 AC-003 adding two channels shows both rows and a combined Total Budget', async ({ page }) => {
      test.setTimeout(360_000);
      const planningPage = new PlanningPage(page);
      await test.step('Build the plan and add channelA and channelB', async () => {
        await buildTwoChannelPlan(planningPage);
      });
      await test.step('Assert AC-003: both channels appear and Total Budget is £25,000', async () => {
        await expect(planningPage.summaryChannel(channelA)).toBeVisible();
        await expect(planningPage.summaryChannel(channelB)).toBeVisible();
        await expect(planningPage.summaryTotalBudget()).toContainText('£25,000');
      });
    });

    test('DC-001 AC-004 deleting one channel recomputes the Total Budget to the remaining channel', async ({ page }) => {
      test.setTimeout(360_000);
      const planningPage = new PlanningPage(page);
      await test.step('Build the two-channel plan and delete channelA', async () => {
        await buildTwoChannelPlan(planningPage);
        await planningPage.deleteChannel(channelA);
      });
      await test.step('Assert AC-004: Total Budget recomputes to £10,000 and channelA is gone', async () => {
        await expect(planningPage.summaryTotalBudget()).toContainText('£10,000');
        await expect(planningPage.summaryChannel(channelA)).toHaveCount(0);
        await expect(planningPage.summaryChannel(channelB)).toBeVisible();
      });
    });

    test('NEG-001 deleting every channel returns the Total Budget to the empty state', async ({ page }) => {
      test.setTimeout(360_000);
      const planningPage = new PlanningPage(page);
      await test.step('Build the two-channel plan and delete both channels', async () => {
        await buildTwoChannelPlan(planningPage);
        await planningPage.deleteChannel(channelA);
        await planningPage.deleteChannel(channelB);
      });
      await test.step('Assert NEG-001: Total Budget returns to the empty-state £-- with no channels', async () => {
        await expect(planningPage.summaryTotalBudget()).toContainText('£--');
        await expect(planningPage.summaryChannel(channelA)).toHaveCount(0);
        await expect(planningPage.summaryChannel(channelB)).toHaveCount(0);
      });
    });
  }
);
