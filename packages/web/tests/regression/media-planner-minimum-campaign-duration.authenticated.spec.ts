// Spec-bound header: sha256 is the behavioral hash of the spec. Re-stamp with
// `npm run ai:spec:stamp` if the spec's behavioral sections change.
/* spec: specs/special-preconditions/media-planner-minimum-campaign-duration.md version:1.1.1 sha256:d65c9e596ac798c12286b2b20d69b3bfed456af1f180143fb7e817415132b64f */
import { test, expect } from '../../fixtures/test';
import { PlanningPage } from '../../pages/PlanningPage';
import { mediaPlannerData, offsetDate } from '../../data/media-planner';

// Spec FLOW-MP-004 (single mode): one primary journey covering the below/at/above
// minimum-campaign-duration boundary for the read-only pre-configured channel
// "DD Competition page", plus a focused NEG test for the below-minimum block.
//
// The configured minimum duration is read-only; its day count is the source of
// truth via E2E_MP_DD_COMPETITION_PAGE_MIN_DURATION_DAYS (dev default 21). Start is
// kept at today+75 to stay clear of the separate booking-deadline rule. Locators for
// the gate error copy and the channel/summary rows are INFERRED past the read-only
// recon boundary (marked in the Page Object) and must be healed before execution.

const CHANNEL = 'DD Competition page';
const MIN_DURATION = Number(process.env.E2E_MP_DD_COMPETITION_PAGE_MIN_DURATION_DAYS ?? '21');
const START_OFFSET = 75; // beyond the read-only 5-day booking deadline

// campaignDurationDays is inclusive (start through end), so end = start + duration - 1.
function channelLine(durationDays: number): string {
  const endOffset = START_OFFSET + durationDays - 1;
  return `${CHANNEL}, the budget is 7k, ${offsetDate(START_OFFSET)} till ${offsetDate(endOffset)}`;
}

async function setupPlan(planningPage: PlanningPage): Promise<void> {
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

// Parallel Safe = no → serial.
test.describe.serial(
  'Media Planner minimum campaign duration validation',
  { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@special-preconditions'] },
  () => {
    // DC-001 (below) / DC-002 (at) / DC-003 (above) are one boundary journey. The
    // data-driven contract requires a loop; the single primary test walks all three.
    for (const journey of [{ caseIds: 'DC-001 DC-002 DC-003' }]) {
      test(
        `${journey.caseIds} minimum campaign duration boundary validation for DD Competition page`,
        { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@special-preconditions'] },
        async ({ page }) => {
          test.slow();
          test.info().annotations.push({
            type: 'covered-ac-ids',
            description: 'AC-001 AC-002 AC-003 AC-004 AC-005'
          });
          const planningPage = new PlanningPage(page);

          await test.step('AC-001 AC-002: launch the Nectar AI objective & budget planner', async () => {
            await planningPage.goto();
            await planningPage.startNectarAiPlanner();
            await planningPage.chooseBuildByObjectiveAndBudget();
          });

          await test.step('AC-003: complete advertiser, brand, objective and SKU setup', async () => {
            await planningPage.selectAdvertiser(mediaPlannerData.advertiser);
            await planningPage.selectBrand(mediaPlannerData.brand);
            await planningPage.confirmAdvertiserAndBrand();
            await planningPage.enterObjective(mediaPlannerData.objective);
            await planningPage.searchProducts(mediaPlannerData.productSearch);
            await planningPage.selectFirstProduct();
            await planningPage.confirmProducts();
          });

          await test.step('AC-004: enter DD Competition page at below-, at- and above-minimum durations', async () => {
            await planningPage.enterChannelRequest(channelLine(MIN_DURATION - 1)); // DC-001 below-minimum
            await planningPage.waitForAssistantIdle();
            await planningPage.enterChannelRequest(channelLine(MIN_DURATION)); // DC-002 at-minimum
            await planningPage.waitForAssistantIdle();
            await planningPage.enterChannelRequest(channelLine(MIN_DURATION + 1)); // DC-003 above-minimum
            await planningPage.waitForAssistantIdle();
          });

          await test.step('Assert AC-005: below-minimum is blocked with the duration error while at/above are allowed', async () => {
            await expect(planningPage.assistantChatPanel()).toContainText(CHANNEL);
            await expect(planningPage.assistantChatPanel()).toContainText('must be at least');
            await expect(planningPage.assistantChatPanel()).toContainText('days');
            await expect(planningPage.summaryChannel(CHANNEL)).toBeVisible();
          });
        }
      );
    }

    test(
      'DC-001 NEG-001 DD Competition page below the minimum campaign duration is blocked',
      { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@special-preconditions'] },
      async ({ page }) => {
        const planningPage = new PlanningPage(page);

        await test.step('Arrange NEG-001: set up the plan and send a below-minimum duration', async () => {
          await setupPlan(planningPage);
          await sendChannel(planningPage, channelLine(MIN_DURATION - 1));
        });

        await test.step('Assert NEG-001: the channel is blocked with the minimum campaign duration error', async () => {
          await expect(planningPage.assistantChatPanel()).toContainText(CHANNEL);
          await expect(planningPage.assistantChatPanel()).toContainText('must be at least');
          await expect(planningPage.assistantChatPanel()).toContainText('days');
        });
      }
    );
  }
);
