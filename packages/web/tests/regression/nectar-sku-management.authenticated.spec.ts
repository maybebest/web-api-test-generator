// Automated from specs/test-cases.yaml — Global Measurement / Hero SKU management (GHM).
// Structural / DOM-state assertions only (verified live against dev 2026-06-23); these
// map manual cases to the PlanningPage SKU-management methods. Tolerant where the live
// wording differs from the ticket wording.
import { test, expect } from '../../fixtures/test';
import { PlanningPage } from '../../pages/PlanningPage';

const data = {
  advertiser: 'N360_Unilever_MS',
  brand: 'Unilever | Knorr | MS',
  objective: 'Customer retention',
  productSearch: 'knorr'
} as const;

async function buildToObjective(p: PlanningPage): Promise<void> {
  await p.goto();
  await p.startNectarAiPlanner();
  await p.chooseBuildByObjectiveAndBudget();
  await p.selectAdvertiser(data.advertiser);
  await p.selectBrand(data.brand);
  await p.confirmAdvertiserAndBrand();
  await p.enterObjective(data.objective);
}

async function buildToMeasurementSearch(p: PlanningPage): Promise<void> {
  await buildToObjective(p);
  await p.searchProducts(data.productSearch);
}

async function buildToHeroStep(p: PlanningPage): Promise<void> {
  await buildToMeasurementSearch(p);
  await p.selectFirstProduct();
  await p.confirmMeasurementSkus();
}

async function buildToSkusConfirmed(p: PlanningPage): Promise<void> {
  await buildToHeroStep(p);
  await p.promoteFirstHeroSku();
  await p.confirmHeroSkus();
}

test.describe.serial(
  'Nectar AI — Global Measurement / Hero SKU management',
  { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@nectar-sku'] },
  () => {
    test('TC-GHM-011 the summary SKU edit controls are absent before any SKU stage is confirmed', async ({ page }) => {
      test.setTimeout(240_000);
      const planningPage = new PlanningPage(page);
      await test.step('Reach the measurement-search stage (no confirm yet)', async () => {
        await buildToMeasurementSearch(planningPage);
      });
      await test.step('Assert TC-GHM-011: neither the Measurement nor Hero summary edit control is present', async () => {
        await expect(planningPage.summaryEditMeasurementButton()).toHaveCount(0);
        await expect(planningPage.summaryEditHeroButton()).toHaveCount(0);
      });
    });

    test('TC-GHM-002 the Measurement Confirm is gated until at least one SKU is selected', async ({ page }) => {
      test.setTimeout(240_000);
      const planningPage = new PlanningPage(page);
      await test.step('Reach the measurement-search stage with nothing selected', async () => {
        await buildToMeasurementSearch(planningPage);
      });
      await test.step('Assert TC-GHM-002: no Confirm at 0 selected, enabled Confirm after selecting one', async () => {
        await expect(planningPage.panelConfirmButton()).toHaveCount(0);
        await planningPage.selectFirstProduct();
        await expect(planningPage.panelConfirmButton()).toBeEnabled();
      });
    });

    test('TC-GHM-009 the Hero Confirm is disabled until at least one Hero SKU is added', async ({ page }) => {
      test.setTimeout(240_000);
      const planningPage = new PlanningPage(page);
      await test.step('Reach the hero-selection step with no hero SKU added', async () => {
        await buildToHeroStep(planningPage);
      });
      await test.step('Assert TC-GHM-009: Hero Confirm disabled at 0, enabled after adding one', async () => {
        await expect(planningPage.panelConfirmButton()).toBeDisabled();
        await planningPage.promoteFirstHeroSku();
        await expect(planningPage.panelConfirmButton()).toBeEnabled();
      });
    });

    test('TC-GHM-012 the Measurement summary edit appears after measurement confirm while Hero edit stays absent', async ({ page }) => {
      test.setTimeout(240_000);
      const planningPage = new PlanningPage(page);
      await test.step('Confirm measurement SKUs only', async () => {
        await buildToHeroStep(planningPage);
      });
      await test.step('Assert TC-GHM-012: Measurement edit present+enabled, Hero edit still absent', async () => {
        await expect(planningPage.summaryEditMeasurementButton()).toBeEnabled();
        await expect(planningPage.summaryEditHeroButton()).toHaveCount(0);
      });
    });

    test('TC-GHM-013 the Hero summary edit appears only after the Hero SKUs are confirmed', async ({ page }) => {
      test.setTimeout(240_000);
      const planningPage = new PlanningPage(page);
      await test.step('Confirm both measurement and hero SKUs', async () => {
        await buildToSkusConfirmed(planningPage);
      });
      await test.step('Assert TC-GHM-013: Hero summary edit is present and enabled', async () => {
        await expect(planningPage.summaryEditHeroButton()).toBeEnabled();
      });
    });

    test('TC-GHM-010 the summary reports the Measurement and Hero SKU counts', async ({ page }) => {
      test.setTimeout(240_000);
      const planningPage = new PlanningPage(page);
      await test.step('Complete the SKU stage with one measurement and one hero SKU', async () => {
        await buildToSkusConfirmed(planningPage);
      });
      await test.step('Assert TC-GHM-010: summary shows 1 Measurement SKU and 1 Hero SKU', async () => {
        await expect(planningPage.summaryMeasurementCount()).toContainText('1 SKU');
        await expect(planningPage.summaryHeroCount()).toContainText('1 SKU');
      });
    });

    test('TC-GHM-014 the Measurement edit modal opens and lists the selected SKU rows', async ({ page }) => {
      test.setTimeout(240_000);
      const planningPage = new PlanningPage(page);
      await test.step('Complete the SKU stage and open the Measurement edit modal', async () => {
        await buildToSkusConfirmed(planningPage);
        await planningPage.openMeasurementEditModal();
      });
      await test.step('Assert TC-GHM-014: the modal is the Measurement editor and lists at least one SKU row', async () => {
        await expect(planningPage.editSkuModal()).toContainText('Edit Measurement SKUs');
        await expect(planningPage.editSkuModal().getByTestId(/^selectedSku-/)).not.toHaveCount(0);
      });
    });

    test('TC-GHM-018 the Hero edit modal exposes a per-row remove control', async ({ page }) => {
      test.setTimeout(240_000);
      const planningPage = new PlanningPage(page);
      await test.step('Complete the SKU stage and open the Hero edit modal', async () => {
        await buildToSkusConfirmed(planningPage);
        await planningPage.openHeroEditModal();
      });
      await test.step('Assert TC-GHM-018: the Hero modal exposes at least one remove control', async () => {
        await expect(planningPage.editSkuModal().getByTestId(/^remove-selectedSku-/)).not.toHaveCount(0);
      });
    });

    test('TC-GHM-025 the Hero-selection step is not shown before Measurement SKUs are confirmed', async ({ page }) => {
      test.setTimeout(240_000);
      const planningPage = new PlanningPage(page);
      await test.step('Reach the measurement-search stage (no measurement confirm yet)', async () => {
        await buildToMeasurementSearch(planningPage);
      });
      await test.step('Assert TC-GHM-025: no "Add hero SKU" control and no Hero summary edit yet', async () => {
        await expect(planningPage.addHeroSkuButton()).toHaveCount(0);
        await expect(planningPage.summaryEditHeroButton()).toHaveCount(0);
      });
    });

    test('TC-GHM-003 a gated Measurement Confirm cannot advance the flow to the Hero step', async ({ page }) => {
      test.setTimeout(240_000);
      const planningPage = new PlanningPage(page);
      await test.step('Reach the measurement-search stage with nothing selected', async () => {
        await buildToMeasurementSearch(planningPage);
      });
      await test.step('Assert TC-GHM-003: with 0 selected there is no Confirm and the Hero step is not reached', async () => {
        await expect(planningPage.panelConfirmButton()).toHaveCount(0);
        await expect(planningPage.addHeroSkuButton()).toHaveCount(0);
      });
    });

    test('TC-GHM-021 the minimum path (one Measurement + one Hero SKU) completes to the channel prompt', async ({ page }) => {
      test.setTimeout(240_000);
      const planningPage = new PlanningPage(page);
      await test.step('Complete the SKU stage with exactly one measurement and one hero SKU', async () => {
        await buildToSkusConfirmed(planningPage);
      });
      await test.step('Assert TC-GHM-021: the assistant advances to request a channel', async () => {
        await expect(planningPage.summaryHeroCount()).toContainText('1 SKU');
        await expect(planningPage.assistantChatPanel()).toContainText('channel');
      });
    });
  }
);
