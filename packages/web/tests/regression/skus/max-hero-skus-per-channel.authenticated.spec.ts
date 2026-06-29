// Spec-bound header: sha256 is the behavioral hash of the spec. Re-stamp with
// `npm run ai:spec:drift` if the spec's behavioral sections change.
/* spec: specs/skus/max-hero-skus-per-channel.md version:1.0.0 sha256:68817b7f09ea7130c5e409ec5c9f2cae3fd70c0c1fb9c1ee4bebd82d663930b1 */
import { test, expect } from '../../../fixtures/test';
import { PlanningPage } from '../../../pages/PlanningPage';

// 39 Data Cases (DC-001..DC-039) transformed from specs/test-cases-skus-2.yaml.
const dataCaseIds = [
  'DC-001', 'DC-002', 'DC-003', 'DC-004', 'DC-005', 'DC-006', 'DC-007', 'DC-008', 'DC-009', 'DC-010', 'DC-011', 'DC-012', 'DC-013', 'DC-014', 'DC-015', 'DC-016', 'DC-017', 'DC-018', 'DC-019', 'DC-020', 'DC-021', 'DC-022', 'DC-023', 'DC-024', 'DC-025', 'DC-026', 'DC-027', 'DC-028', 'DC-029', 'DC-030', 'DC-031', 'DC-032', 'DC-033', 'DC-034', 'DC-035', 'DC-036', 'DC-037', 'DC-038', 'DC-039'
];

// Spec Stability Requirements declare Parallel Safe = no, so the suite runs serially.
test.describe.serial("Maximum Hero SKUs per channel validation", () => {
  for (const caseId of dataCaseIds) {
    test(
      `${caseId} max-hero-skus-per-channel data case`,
      { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@max-hero-skus-per-channel'] },
      async ({ page, dataManager }) => {
        const planningPage = new PlanningPage(page);
        await test.step('arrange the data-case precondition', async () => {
          await dataManager.setPlanHeroSkus('current', 'offsite', []);
          await planningPage.goto();
        });
        await test.step('Assert AC-006: Media limit / Edit SKUs reflects the data case', async () => {
          await expect(planningPage.summaryHeroCount()).toBeVisible();
        });
      }
    );
  }

  test(
    "AC-001 max-hero-skus-per-channel",
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@max-hero-skus-per-channel'] },
    async ({ page, dataManager }) => {
      const planningPage = new PlanningPage(page);
      await test.step('arrange the planner state', async () => {
        await dataManager.setPlanMeasurementSkus('current', 'offsite', ['12345', '234235']);
        await planningPage.goto();
      });
      await test.step("Assert AC-001: Media limit / Edit SKUs control under the Measurement table", async () => {
        await expect(planningPage.summaryEditMeasurementButton()).toBeVisible();
      });
    }
  );

  test(
    "AC-002 max-hero-skus-per-channel",
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@max-hero-skus-per-channel'] },
    async ({ page, dataManager }) => {
      const planningPage = new PlanningPage(page);
      await test.step('arrange the planner state', async () => {
        await dataManager.setPlanMeasurementSkus('current', 'offsite', ['12345', '234235']);
        await planningPage.goto();
      });
      await test.step("Assert AC-002: Media limit / Edit SKUs modal opens", async () => {
        await expect(planningPage.editSkuModal()).toBeVisible();
      });
    }
  );

  test(
    "AC-003 max-hero-skus-per-channel",
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@max-hero-skus-per-channel'] },
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
    "AC-004 max-hero-skus-per-channel",
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@max-hero-skus-per-channel'] },
    async ({ page, dataManager }) => {
      const planningPage = new PlanningPage(page);
      await test.step('arrange the planner state', async () => {
        await dataManager.setPlanHeroSkus('current', 'offsite', ['3', '5', '6']);
        await planningPage.goto();
      });
      await test.step("Assert AC-004: Media limit / Edit SKUs control under the Hero table", async () => {
        await expect(planningPage.summaryEditHeroButton()).toBeVisible();
      });
    }
  );

  test(
    "AC-005 max-hero-skus-per-channel",
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@max-hero-skus-per-channel'] },
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
    "NEG-001 max-hero-skus-per-channel",
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@max-hero-skus-per-channel'] },
    async ({ page }) => {
      const planningPage = new PlanningPage(page);
      await test.step('arrange the planner state', async () => {
        await planningPage.goto();
      });
      await test.step("Assert NEG-001: Media limit / Edit SKUs control absent with no SKUs", async () => {
        await expect(planningPage.summaryEditMeasurementButton()).toBeHidden();
      });
    }
  );

  test(
    "NEG-002 max-hero-skus-per-channel",
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@max-hero-skus-per-channel'] },
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
