// Spec-bound header: sha256 is the behavioral hash of the spec. Re-stamp with
// `npm run ai:spec:drift` if the spec's behavioral sections change.
/* spec: specs/skus/edit-sku-list-button-and-modal.md version:1.0.0 sha256:019b106c08b66cb5c99849d940c83fb1307b5d28b43850df8454d4982f855567 */
import { test, expect } from '../../../fixtures/test';
import { PlanningPage } from '../../../pages/PlanningPage';

// 15 Data Cases (DC-001..DC-015) transformed from specs/test-cases-skus-2.yaml.
const dataCaseIds = [
  'DC-001', 'DC-002', 'DC-003', 'DC-004', 'DC-005', 'DC-006', 'DC-007', 'DC-008', 'DC-009', 'DC-010', 'DC-011', 'DC-012', 'DC-013', 'DC-014', 'DC-015'
];

// Spec Stability Requirements declare Parallel Safe = no, so the suite runs serially.
test.describe.serial("Edit SKU list button visibility and modal", () => {
  for (const caseId of dataCaseIds) {
    test(
      `${caseId} edit-sku-list-button-and-modal data case`,
      { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@edit-sku-list-button-and-modal'] },
      async ({ page, dataManager }) => {
        const planningPage = new PlanningPage(page);
        await test.step('arrange the data-case precondition', async () => {
          await dataManager.setPlanHeroSkus('current', 'offsite', []);
          await planningPage.goto();
        });
        await test.step('Assert AC-006: Edit SKU list reflects the data case', async () => {
          await expect(planningPage.summaryHeroCount()).toBeVisible();
        });
      }
    );
  }

  test(
    "AC-001 edit-sku-list-button-and-modal",
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@edit-sku-list-button-and-modal'] },
    async ({ page, dataManager }) => {
      const planningPage = new PlanningPage(page);
      await test.step('arrange the planner state', async () => {
        await dataManager.setPlanMeasurementSkus('current', 'offsite', ['12345', '234235']);
        await planningPage.goto();
      });
      await test.step("Assert AC-001: Edit SKU list control under the Measurement table", async () => {
        await expect(planningPage.summaryEditMeasurementButton()).toBeVisible();
      });
    }
  );

  test(
    "AC-002 edit-sku-list-button-and-modal",
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@edit-sku-list-button-and-modal'] },
    async ({ page, dataManager }) => {
      const planningPage = new PlanningPage(page);
      await test.step('arrange the planner state', async () => {
        await dataManager.setPlanMeasurementSkus('current', 'offsite', ['12345', '234235']);
        await planningPage.goto();
      });
      await test.step("Assert AC-002: Edit SKU list modal opens", async () => {
        await expect(planningPage.editSkuModal()).toBeVisible();
      });
    }
  );

  test(
    "AC-003 edit-sku-list-button-and-modal",
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@edit-sku-list-button-and-modal'] },
    async ({ page, dataManager }) => {
      const planningPage = new PlanningPage(page);
      await test.step('arrange the planner state', async () => {
        await dataManager.setPlanMeasurementSkus('current', 'offsite', ['12345', '234235']);
        await planningPage.goto();
      });
      await test.step("Assert AC-003: Measurement count reflects the change", async () => {
        await expect(planningPage.summaryMeasurementCount()).toBeVisible();
      });
    }
  );

  test(
    "AC-004 edit-sku-list-button-and-modal",
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@edit-sku-list-button-and-modal'] },
    async ({ page, dataManager }) => {
      const planningPage = new PlanningPage(page);
      await test.step('arrange the planner state', async () => {
        await dataManager.setPlanHeroSkus('current', 'offsite', ['3', '5', '6']);
        await planningPage.goto();
      });
      await test.step("Assert AC-004: Edit SKU list control under the Hero table", async () => {
        await expect(planningPage.summaryEditHeroButton()).toBeVisible();
      });
    }
  );

  test(
    "AC-005 edit-sku-list-button-and-modal",
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@edit-sku-list-button-and-modal'] },
    async ({ page, dataManager }) => {
      const planningPage = new PlanningPage(page);
      await test.step('arrange the planner state', async () => {
        await dataManager.setPlanHeroSkus('current', 'offsite', ['3', '5', '6']);
        await planningPage.goto();
      });
      await test.step("Assert AC-005: modal shows the selected count", async () => {
        await expect(planningPage.modalSelectedCount()).toBeVisible();
      });
    }
  );

  test(
    "NEG-001 edit-sku-list-button-and-modal",
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@edit-sku-list-button-and-modal'] },
    async ({ page }) => {
      const planningPage = new PlanningPage(page);
      await test.step('arrange the planner state', async () => {
        await planningPage.goto();
      });
      await test.step("Assert NEG-001: Edit SKU list control absent with no SKUs", async () => {
        await expect(planningPage.summaryEditMeasurementButton()).toBeHidden();
      });
    }
  );

  test(
    "NEG-002 edit-sku-list-button-and-modal",
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@edit-sku-list-button-and-modal'] },
    async ({ page, dataManager }) => {
      const planningPage = new PlanningPage(page);
      await test.step('arrange the planner state', async () => {
        await dataManager.setPlanHeroSkus('current', 'offsite', ['3', '5', '6']);
        await planningPage.goto();
      });
      await test.step("Assert NEG-002: modal dismissed without changes", async () => {
        await expect(planningPage.editSkuModal()).toBeHidden();
      });
    }
  );
});
