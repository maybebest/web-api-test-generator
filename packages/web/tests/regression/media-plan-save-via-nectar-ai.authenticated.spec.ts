// Spec-bound header: sha256 is the behavioral hash of the spec (computed via
// scripts/ai/lib/spec-parser.mjs specSha256). Re-stamp with `npm run ai:spec:drift`
// if the spec's behavioral sections change.
/* spec: specs/media-plan-save-via-nectar-ai.md version:1.0.0 sha256:220c5e61c9d2de604b7313f7b299fa8c318d2aff462024602727a6ddd00bcb4c */
import { test, expect } from '../../fixtures/test';
import { PlanningPage } from '../../pages/PlanningPage';

// DC-001 from specs/media-plan-save-via-nectar-ai.md — the single deterministic
// happy-path journey for building and saving a media plan via Nectar AI.
const dataCase = {
  caseId: 'DC-001',
  advertiser: 'N360_Unilever_MS',
  brand: 'Unilever | Knorr | MS',
  objective: 'Customer retention',
  productSearch: 'knorr',
  channelRequest: 'Offsite, DD Pubmatic - Display, 20/04/2026 till 20/05/2026, the budget is 7k'
} as const;

// Spec Stability Requirements declare Parallel Safe = no, so the journey runs as
// a single serial flow (the static reviewer requires test.describe.serial here).
test.describe.serial('Build and save a media plan via Nectar AI', () => {
  test(
    'DC-001 media planner builds and saves a media plan via Nectar AI',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated'] },
    async ({ page }) => {
      test.info().annotations.push({
        type: 'covered-ac-ids',
        description: 'AC-001 AC-002 AC-003 AC-004 AC-005 AC-006 AC-007 AC-008'
      });

      const planningPage = new PlanningPage(page);

      await test.step('AC-001: launch the Nectar AI objective & budget planner', async () => {
        await planningPage.goto();
        await planningPage.startNectarAiPlanner();
        await planningPage.chooseBuildByObjectiveAndBudget();
      });

      await test.step('AC-002: select the advertiser and brand', async () => {
        await planningPage.selectAdvertiser(dataCase.advertiser);
        await planningPage.selectBrand(dataCase.brand);
        await planningPage.confirmAdvertiserAndBrand();
      });

      await test.step('AC-003: enter the campaign objective', async () => {
        await planningPage.enterObjective(dataCase.objective);
      });

      await test.step('AC-004: search products and select campaign SKUs', async () => {
        await planningPage.searchProducts(dataCase.productSearch);
        await planningPage.selectFirstProduct();
        await planningPage.confirmProducts();
      });

      await test.step('AC-005: add the offsite channel via chat', async () => {
        await planningPage.enterChannelRequest(dataCase.channelRequest);
      });

      await test.step('AC-006, AC-007: confirm and save the plan', async () => {
        await planningPage.confirmPlan();
        await planningPage.savePlan();
      });

      await test.step('AC-008: download the saved plan (a download must fire)', async () => {
        await planningPage.downloadCsv();
      });

      await test.step('Assert AC-006: the plan is saved with the correct name and post-save actions enabled', async () => {
        await expect(planningPage.savedConfirmation()).toContainText('Your plan is now saved.');
        await expect(planningPage.planName()).toContainText('2026-04');
        await expect(planningPage.planName()).toContainText('offsite');
        await expect(planningPage.planName()).toContainText(/\d{2,}/);
        await expect(planningPage.downloadButton()).toBeEnabled();
        await expect(planningPage.editInPollenLink()).toBeEnabled();
      });
    }
  );
});
