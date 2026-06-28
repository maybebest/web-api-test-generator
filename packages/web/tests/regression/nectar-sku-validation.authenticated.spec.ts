// Automated from specs/test-cases.yaml — min/max SKU validation (VAL), confirm-gating
// subset. Pure structural button-state assertions at the selection boundaries.
import { test, expect } from '../../fixtures/test';
import { PlanningPage } from '../../pages/PlanningPage';
import { buildToMeasurementSearch, buildToHeroStep } from '../../pages/NectarFlow';

test.describe.serial(
  'Nectar AI — SKU min/max validation (VAL)',
  { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@nectar-sku'] },
  () => {
    test('TC-VAL-008 a below-minimum Measurement selection (0) blocks Confirm; at least one is required', async ({ page }) => {
      test.setTimeout(240_000);
      const planningPage = new PlanningPage(page);
      await test.step('Reach the measurement-search stage with nothing selected', async () => {
        await buildToMeasurementSearch(planningPage);
      });
      await test.step('Assert TC-VAL-008: Confirm is not available at 0, becomes enabled at 1', async () => {
        await expect(planningPage.panelConfirmButton()).toHaveCount(0);
        await planningPage.selectFirstProduct();
        await expect(planningPage.panelConfirmButton()).toBeEnabled();
      });
    });

    test('TC-VAL-006 below-minimum Hero SKUs: Confirm is disabled with zero selected', async ({ page }) => {
      test.setTimeout(240_000);
      const planningPage = new PlanningPage(page);
      await test.step('Reach the hero-selection step with no hero SKU added', async () => {
        await buildToHeroStep(planningPage);
      });
      await test.step('Assert TC-VAL-006: Hero Confirm is disabled at 0 selected', async () => {
        await expect(planningPage.panelConfirmButton()).toBeDisabled();
      });
    });

    test('TC-VAL-007 at-minimum Hero SKUs: selecting exactly one enables Confirm', async ({ page }) => {
      test.setTimeout(240_000);
      const planningPage = new PlanningPage(page);
      await test.step('Reach the hero-selection step and add one hero SKU', async () => {
        await buildToHeroStep(planningPage);
        await planningPage.promoteFirstHeroSku();
      });
      await test.step('Assert TC-VAL-007: Hero Confirm is enabled at exactly one selected', async () => {
        await expect(planningPage.panelConfirmButton()).toBeEnabled();
      });
    });
  }
);
