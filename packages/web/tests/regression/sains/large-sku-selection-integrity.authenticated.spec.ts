// Spec-bound header: sha256 is the behavioral hash of the spec.
/* spec: specs/sains/large-sku-selection-integrity.md version:1.0.0 sha256:73ae04a2ebe1551dac262ad5ac8661a01a6c739e8c228a933a059c76e33cc01d */
import { test, expect } from '../../../fixtures/test';
import { mediaPlannerData } from '../../../data/media-planner';
import { LargeSkuSelectionComponent } from '../../../pages/LargeSkuSelectionComponent';
import { PlanningPage } from '../../../pages/PlanningPage';

const MINIMUM_PRODUCT_ROWS = 29;

test.describe.serial('Large SKU result selection integrity', () => {
  test(
    'DC-001 large Measurement result preserves every selection through the Hero transition',
    { tag: ['@generated', '@regression', '@sku', '@authenticated', '@large-result'] },
    async ({ page }) => {
      test.setTimeout(180_000);
      test.info().annotations.push({
        type: 'covered-ac-ids',
        description: 'AC-001 AC-002 AC-003'
      });

      const planningPage = new PlanningPage(page);
      const largeSkuComponent = new LargeSkuSelectionComponent(page);
      let discoveredProductRows = 0;
      let actionableSelectAllGroups = 0;
      let checkedProductRows = 0;

      await test.step('Arrange AC-001: open a fresh guided plan and render the documented large SKU result', async () => {
        await planningPage.goto();
        await planningPage.startNectarAiPlanner();
        await planningPage.chooseBuildByObjectiveAndBudget();
        await planningPage.selectAdvertiser(mediaPlannerData.advertiser);
        await planningPage.selectBrand(mediaPlannerData.brand);
        await planningPage.confirmAdvertiserAndBrand();
        await planningPage.enterObjective(mediaPlannerData.objective);
        await planningPage.searchProducts(mediaPlannerData.productSearch);
        discoveredProductRows = await largeSkuComponent.productRows().count();
      });

      await test.step('Act AC-002: select every rendered product through the group Select All controls', async () => {
        actionableSelectAllGroups = await largeSkuComponent.selectEveryVisibleGroup();
        checkedProductRows = await largeSkuComponent.checkedProductRowCount();
        await largeSkuComponent.confirmMeasurementSelection();
      });

      await test.step('Assert AC-003: the large selection cardinality survives and the Hero step is usable', async () => {
        await expect.poll(() => discoveredProductRows).toBeGreaterThanOrEqual(MINIMUM_PRODUCT_ROWS);
        await expect.poll(() => actionableSelectAllGroups).toBeGreaterThanOrEqual(1);
        await expect.poll(() => checkedProductRows).toBe(discoveredProductRows);
        await expect(largeSkuComponent.measurementSummaryCount()).toContainText(`${discoveredProductRows} SKUs`);
        await expect(largeSkuComponent.firstHeroSelectionControl()).toBeVisible();
      });
    }
  );
});
