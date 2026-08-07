// Spec-bound header: sha256 is the behavioral hash of the spec (computed via
// scripts/ai/lib/spec-parser.mjs specSha256). Re-stamp with `npm run ai:spec:drift`
// if the spec's behavioral sections change.
/* spec: specs/nectar-summary-reflection.md version:1.1.0 sha256:5acc6df096635ab5b3d991f8a5025c12f7d326782d1244dd08afbec5aaf01a77 */
import { test, expect } from '../../fixtures/test';
import { PlanningPage } from '../../pages/PlanningPage';
import { nectarData } from '../../pages/NectarFlow';

// FLOW-MP-021 (single mode): the summary panel must reflect each confirmed selection
// (advertiser, brand, objective, Measurement SKU count). No test previously asserted this —
// the summary testids were only ever exercised as setup. The guided build is several streamed
// assistant turns (30-60s+ each), so the test carries the same live-build budget as the sibling
// nectar suites.
test.describe.serial(
  'Nectar AI summary panel reflects the guided selections',
  { tag: ['@generated', '@regression', '@media-planner', '@authenticated'] },
  () => {
    test('DC-001 the summary panel reflects the advertiser, brand, objective and Measurement SKUs', async ({ page }) => {
      test.setTimeout(360_000);
      test.info().annotations.push({ type: 'covered-ac-ids', description: 'AC-001 AC-002 AC-003' });
      const planningPage = new PlanningPage(page);

      await test.step('Arrange AC-001: launch the planner and select advertiser and brand', async () => {
        await planningPage.goto();
        await planningPage.startNectarAiPlanner();
        await planningPage.chooseBuildByObjectiveAndBudget();
        await planningPage.selectAdvertiser(nectarData.advertiser);
        await planningPage.selectBrand(nectarData.brand);
        await planningPage.confirmAdvertiserAndBrand();
      });

      await test.step('Arrange AC-002: enter the campaign objective', async () => {
        await planningPage.enterObjective(nectarData.objective);
      });

      await test.step('Arrange AC-003: search products and confirm one Measurement SKU', async () => {
        await planningPage.searchProducts(nectarData.productSearch);
        await planningPage.selectFirstProduct();
        await planningPage.confirmMeasurementSkus();
      });

      await test.step('Assert AC-003: the summary reflects the advertiser, brand, objective and Measurement SKU count', async () => {
        await expect(planningPage.summaryAdvertiser()).toContainText(nectarData.advertiser);
        await expect(planningPage.summaryBrands()).toContainText(nectarData.brand);
        await expect(planningPage.summaryObjective()).toContainText(nectarData.objective);
        // The counter row concatenates children without whitespace; digit-lookbehind guards '11 SKUs'.
        await expect(planningPage.summaryMeasurementCount()).toContainText(new RegExp('(?<!\\d)1 SKUs?'));
      });
    });

    test('NEG-001 the summary shows no confirmed advertiser before selection', async ({ page }) => {
      test.setTimeout(360_000);
      const planningPage = new PlanningPage(page);

      await test.step('Arrange NEG-001: reach the advertiser/brand step without confirming a selection', async () => {
        await planningPage.goto();
        await planningPage.startNectarAiPlanner();
        await planningPage.chooseBuildByObjectiveAndBudget();
      });

      await test.step('Assert NEG-001: the fresh summary contains no fixture values or confirmed Measurement count', async () => {
        await expect(planningPage.summaryPanel()).not.toContainText(nectarData.advertiser);
        await expect(planningPage.summaryPanel()).not.toContainText(nectarData.brand);
        await expect(planningPage.summaryPanel()).not.toContainText(nectarData.objective);
        await expect(planningPage.summaryPanel()).not.toContainText(/(?<!\d)1\s*SKUs?/i);
      });
    });
  }
);
