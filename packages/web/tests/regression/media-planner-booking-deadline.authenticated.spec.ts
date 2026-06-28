// Spec-bound header: sha256 is the behavioral hash of the spec (computed via
// scripts/ai/lib/spec-parser.mjs specSha256). Re-stamp with `npm run ai:spec:drift`
// if the spec's behavioral sections change.
/* spec: specs/special-preconditions/media-planner-booking-deadline.md version:1.0.0 sha256:9cec1178311dc28c890315653e5ead00a4c7969b6cb12d71dcbac0671f60fc75 */
import { test, expect } from '../../fixtures/test';
import { PlanningPage } from '../../pages/PlanningPage';

// Spec FLOW-MP-005 (suite mode): one focused test per acceptance criterion plus a
// dedicated test per negative case. The guided-setup data uses the spec contract
// values; the advertiser/brand/SKU selection and the channel-add behaviour are
// INFERRED past the read-only DOM recon boundary and must be confirmed against the
// live app before the execution gate is run.
const plan = {
  advertiser: 'N360_Unilever_MS',
  brand: 'Unilever | Knorr | MS',
  objective: 'Customer retention',
  // Search term for the measurement/hero SKU step. A product NAME is used (not a bare
  // SKU) so the live search reliably returns rows for this advertiser/brand.
  productSearch: 'knorr'
} as const;

const ONSITE = 'Onsite Display';
const OFFSITE = 'Offsite Display';

// Dates are derived from relative offsets to the current date (never hardcoded),
// per the spec. End date is always start + 30 days so the separate
// minimum-campaign-duration rule cannot mask booking-deadline validation.
function offsetDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${date.getFullYear()}`;
}

function channelRequest(channelName: string, startOffsetDays: number): string {
  return `${channelName}, ${offsetDate(startOffsetDays)} till ${offsetDate(startOffsetDays + 30)}, the budget is 7k`;
}

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

// Stability Requirements declare Parallel Safe = no, so the suite runs serially.
test.describe.serial(
  'Media Planner booking deadline validation',
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

    test('DC-006 AC-003 plan setup prompts for a channel, budget and timeline', async ({ page }) => {
      const planningPage = new PlanningPage(page);
      await test.step('Complete the guided plan setup (advertiser, brand, objective, SKU)', async () => {
        await buildPlanToChannelStage(planningPage);
      });
      await test.step('Assert AC-003: the assistant requests a channel, a budget and a timeline', async () => {
        await expect(planningPage.assistantChatPanel()).toContainText('channel');
        await expect(planningPage.assistantChatPanel()).toContainText('budget');
        await expect(planningPage.assistantChatPanel()).toContainText('timeline');
      });
    });

    test('DC-001 AC-004 a below-deadline Onsite Display start date is blocked', async ({ page }) => {
      const planningPage = new PlanningPage(page);
      await test.step('Set up the plan and send Onsite Display one day below the earliest allowed start', async () => {
        await buildPlanToChannelStage(planningPage);
        await planningPage.enterChannelRequest(channelRequest(ONSITE, 1));
      });
      await test.step('Assert AC-004: Onsite Display is rejected with a booking-deadline error', async () => {
        await expect(planningPage.assistantChatPanel()).toContainText('Onsite Display');
        await expect(planningPage.assistantChatPanel()).toContainText('at least 2 days from today');
      });
    });

    // DC-002 (at-minimum) and DC-003 (above-minimum) are enumerated by looping
    // over the case rows, per the data-driven contract for multi-case specs.
    for (const dataCase of [
      { caseId: 'DC-002', startOffsetDays: 2 },
      { caseId: 'DC-003', startOffsetDays: 3 }
    ]) {
      test(`${dataCase.caseId} AC-005 Onsite Display at or above the earliest allowed start is allowed`, async ({ page }) => {
        const planningPage = new PlanningPage(page);
        await test.step('Set up the plan and send the Onsite Display channel', async () => {
          await buildPlanToChannelStage(planningPage);
          await planningPage.enterChannelRequest(channelRequest(ONSITE, dataCase.startOffsetDays));
        });
        await test.step('Assert AC-005: Onsite Display is added to the summary channel list', async () => {
          await expect(planningPage.summaryChannel(ONSITE)).toBeVisible();
        });
      });
    }

    test('DC-004 AC-006 a no-deadline Offsite Display channel accepts a today start', async ({ page }) => {
      const planningPage = new PlanningPage(page);
      await test.step('Set up the plan and send Offsite Display with a today start', async () => {
        await buildPlanToChannelStage(planningPage);
        await planningPage.enterChannelRequest(channelRequest(OFFSITE, 0));
      });
      await test.step('Assert AC-006: Offsite Display is added despite the early start', async () => {
        await expect(planningPage.summaryChannel(OFFSITE)).toBeVisible();
      });
    });

    test('DC-005 AC-007 booking-deadline enforcement is per channel in a mixed batch', async ({ page }) => {
      const planningPage = new PlanningPage(page);
      await test.step('Set up the plan and send a mixed batch (violating Onsite + compliant Offsite)', async () => {
        await buildPlanToChannelStage(planningPage);
        await planningPage.enterChannelRequest(`${channelRequest(ONSITE, 1)}; ${channelRequest(OFFSITE, 5)}`);
      });
      await test.step('Assert AC-007: only Offsite Display is added while Onsite Display is rejected', async () => {
        await expect(planningPage.summaryChannel(OFFSITE)).toBeVisible();
        await expect(planningPage.assistantChatPanel()).toContainText('Onsite Display');
      });
    });

    test('DC-001 NEG-001 below-deadline Onsite Display is blocked with a named error', async ({ page }) => {
      const planningPage = new PlanningPage(page);
      await test.step('Arrange NEG-001: send Onsite Display one day below the earliest allowed start', async () => {
        await buildPlanToChannelStage(planningPage);
        await planningPage.enterChannelRequest(channelRequest(ONSITE, 1));
      });
      await test.step('Assert NEG-001: Onsite Display is rejected naming the channel and lead time', async () => {
        await expect(planningPage.assistantChatPanel()).toContainText('Onsite Display');
        await expect(planningPage.assistantChatPanel()).toContainText('at least 2 days from today');
      });
    });

    test('DC-005 NEG-002 the violating channel is absent from the summary while the compliant channel is added', async ({ page }) => {
      const planningPage = new PlanningPage(page);
      await test.step('Arrange NEG-002: send a mixed batch (violating Onsite + compliant Offsite)', async () => {
        await buildPlanToChannelStage(planningPage);
        await planningPage.enterChannelRequest(`${channelRequest(ONSITE, 1)}; ${channelRequest(OFFSITE, 5)}`);
      });
      await test.step('Assert NEG-002: Offsite Display is in the summary and Onsite Display is not', async () => {
        await expect(planningPage.summaryChannel(OFFSITE)).toBeVisible();
        await expect(planningPage.summaryChannel(ONSITE)).toHaveCount(0);
      });
    });
  }
);
