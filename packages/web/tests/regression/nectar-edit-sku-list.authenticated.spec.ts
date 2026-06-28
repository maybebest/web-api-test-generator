// Automated from specs/test-cases.yaml — "Edit SKU list" buttons (ESL).
// Structural assertions via the verified summary-panel edit-modal entry points; cancel
// behaviour and modal identity are checked without depending on ticket wording.
import { test, expect } from '../../fixtures/test';
import { PlanningPage } from '../../pages/PlanningPage';
import { buildToMeasurementSearch, buildToHeroStep, buildToSkusConfirmed } from '../../pages/NectarFlow';

test.describe.serial(
  'Nectar AI — Edit SKU list (ESL)',
  { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@nectar-sku'] },
  () => {
    test('TC-ESL-018 the Measurement SKU edit control is absent before any SKUs are mapped', async ({ page }) => {
      test.setTimeout(240_000);
      const planningPage = new PlanningPage(page);
      await test.step('Reach the measurement-search stage with nothing confirmed', async () => {
        await buildToMeasurementSearch(planningPage);
      });
      await test.step('Assert TC-ESL-018: no Measurement edit control yet', async () => {
        await expect(planningPage.summaryEditMeasurementButton()).toHaveCount(0);
      });
    });

    test('TC-ESL-019 the Hero SKU edit control is absent before Measurement SKUs are confirmed', async ({ page }) => {
      test.setTimeout(240_000);
      const planningPage = new PlanningPage(page);
      await test.step('Reach the measurement-search stage', async () => {
        await buildToMeasurementSearch(planningPage);
      });
      await test.step('Assert TC-ESL-019: no Hero edit control before measurement confirm', async () => {
        await expect(planningPage.summaryEditHeroButton()).toHaveCount(0);
      });
    });

    test('TC-ESL-002 clicking the Measurement edit control opens the Measurement edit modal', async ({ page }) => {
      test.setTimeout(240_000);
      const planningPage = new PlanningPage(page);
      await test.step('Complete the SKU stage and open the Measurement edit modal', async () => {
        await buildToSkusConfirmed(planningPage);
        await planningPage.openMeasurementEditModal();
      });
      await test.step('Assert TC-ESL-002: the Measurement edit modal is shown', async () => {
        await expect(planningPage.editSkuModal()).toBeVisible();
        await expect(planningPage.editSkuModal()).toContainText('Edit Measurement SKUs');
      });
    });

    test('TC-ESL-007 clicking the Hero edit control opens the Hero edit modal', async ({ page }) => {
      test.setTimeout(240_000);
      const planningPage = new PlanningPage(page);
      await test.step('Complete the SKU stage and open the Hero edit modal', async () => {
        await buildToSkusConfirmed(planningPage);
        await planningPage.openHeroEditModal();
      });
      await test.step('Assert TC-ESL-007: the Hero edit modal is shown', async () => {
        await expect(planningPage.editSkuModal()).toBeVisible();
        await expect(planningPage.editSkuModal()).toContainText('Hero');
      });
    });

    test('TC-ESL-020 the Measurement and Hero edit controls open different (correct) modals', async ({ page }) => {
      test.setTimeout(240_000);
      const planningPage = new PlanningPage(page);
      await test.step('Complete the SKU stage', async () => {
        await buildToSkusConfirmed(planningPage);
      });
      await test.step('Assert TC-ESL-020: measurement opens the Measurement editor', async () => {
        await planningPage.openMeasurementEditModal();
        await expect(planningPage.editSkuModal()).toContainText('Edit Measurement SKUs');
        await planningPage.editModalCancel().click();
        await expect(planningPage.editSkuModal()).toBeHidden();
      });
      await test.step('Assert TC-ESL-020: hero opens the Hero editor (a different modal)', async () => {
        await planningPage.openHeroEditModal();
        await expect(planningPage.editSkuModal()).toContainText('Hero');
        await expect(planningPage.editSkuModal()).not.toContainText('Edit Measurement SKUs');
      });
    });

    test('TC-ESL-005 cancelling the Measurement edit modal closes it without confirming', async ({ page }) => {
      test.setTimeout(240_000);
      const planningPage = new PlanningPage(page);
      await test.step('Open the Measurement edit modal', async () => {
        await buildToSkusConfirmed(planningPage);
        await planningPage.openMeasurementEditModal();
      });
      await test.step('Assert TC-ESL-005: Cancel dismisses the modal and the summary count is unchanged', async () => {
        await expect(planningPage.editSkuModal()).toBeVisible();
        await planningPage.editModalCancel().click();
        await expect(planningPage.editSkuModal()).toBeHidden();
        await expect(planningPage.summaryMeasurementCount()).toContainText('1 SKU');
      });
    });

    test('TC-ESL-011 cancelling the Hero edit modal closes it without confirming', async ({ page }) => {
      test.setTimeout(240_000);
      const planningPage = new PlanningPage(page);
      await test.step('Open the Hero edit modal', async () => {
        await buildToSkusConfirmed(planningPage);
        await planningPage.openHeroEditModal();
      });
      await test.step('Assert TC-ESL-011: Cancel dismisses the Hero modal and the Hero count is unchanged', async () => {
        await expect(planningPage.editSkuModal()).toBeVisible();
        await planningPage.editModalCancel().click();
        await expect(planningPage.editSkuModal()).toBeHidden();
        await expect(planningPage.summaryHeroCount()).toContainText('1 SKU');
      });
    });

    test('TC-ESL-004 the Measurement edit modal exposes a per-row remove control', async ({ page }) => {
      test.setTimeout(240_000);
      const planningPage = new PlanningPage(page);
      await test.step('Open the Measurement edit modal', async () => {
        await buildToSkusConfirmed(planningPage);
        await planningPage.openMeasurementEditModal();
      });
      await test.step('Assert TC-ESL-004: at least one removable SKU row is present', async () => {
        await expect(planningPage.editSkuModal().getByTestId(/^selectedSku-/)).not.toHaveCount(0);
        await expect(planningPage.editSkuModal().getByTestId(/^remove-selectedSku-/)).not.toHaveCount(0);
      });
    });
  }
);
