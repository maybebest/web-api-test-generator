// Spec-bound header: sha256 is the behavioral hash of the spec (computed via
// scripts/ai/lib/spec-parser.mjs specSha256). Re-stamp with `npm run ai:spec:drift`
// if the spec's behavioral sections change.
/* spec: specs/media-plan-save-via-nectar-ai.md version:1.0.0 sha256:ee02a50128cce44253f84ef260c2b4031d8e1d691755bc46642221771bbf77f8 */
import { test, expect } from '../../fixtures/test';
import { PlanningPage } from '../../pages/PlanningPage';

// The campaign window is computed at runtime (start ~45 days out, 30-day duration) so the request
// can never rot into past dates — the assistant rejects past-dated channels outright
// ("The dates provided ... are in the past", observed live 2026-07-03).
const formatDdMmYyyy = (date: Date): string =>
  `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
const addDays = (days: number): Date => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

// DC-001 from specs/media-plan-save-via-nectar-ai.md — the single deterministic
// happy-path journey for building and saving a media plan via Nectar AI.
const dataCase = {
  caseId: 'DC-001',
  advertiser: 'N360_Unilever_MS',
  brand: 'Unilever | Knorr | MS',
  objective: 'Customer retention',
  productSearch: 'knorr',
  channelRequest: `Offsite, Meta, ${formatDdMmYyyy(addDays(45))} till ${formatDdMmYyyy(addDays(75))}, the budget is 7k, Self-Serve`,
  // Passing the resolved name pins the (non-deterministic) fuzzy disambiguation click AND switches
  // the landing signal to this channel's own summary row instead of loose chat text.
  resolvedChannelName: 'Meta'
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
        await planningPage.enterChannelRequest(dataCase.channelRequest, dataCase.resolvedChannelName);
      });

      await test.step('AC-006, AC-007: confirm and save the plan', async () => {
        await planningPage.confirmPlan();
        await planningPage.savePlan();
      });

      await test.step('AC-008: download the saved plan (a download must fire)', async () => {
        // downloadCsv resolves only when the browser download EVENT fires; the reviewer's
        // locator-only expect policy keeps the filename itself out of expect().
        await planningPage.downloadCsv();
      });

      await test.step('Assert AC-006: the plan is saved with the correct name and post-save actions enabled', async () => {
        await expect(planningPage.savedConfirmation()).toContainText('Your plan has been saved as a draft.');
        // RULE-002 live-observed name structure (2026-07-03): the visible plan name is
        // "<YYYY_MM of creation>_<Advertiser|Brand chain>_" and the unique objective+number
        // suffix renders in an editable INPUT (input values are not textContent, so only the
        // static visible part is assertable via toContainText).
        await expect(planningPage.planName()).toContainText(/2026_\d{2}_Unilever\|Knorr\|MS_/);
        // Live counter contract: whole-row concatenated text, digit-lookbehind guard; the journey
        // selects exactly one measurement SKU (hero promotion is not part of this flow).
        await expect(planningPage.summaryMeasurementCount()).toContainText(new RegExp('(?<!\\d)1 SKUs?'));
        await expect(planningPage.downloadButton()).toBeEnabled();
        await expect(planningPage.editInPollenLink()).toBeEnabled();
      });
    }
  );
});
