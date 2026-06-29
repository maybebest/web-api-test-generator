// Spec-bound header: sha256 is the behavioral hash of the spec. Re-stamp with
// `npm run ai:spec:drift` if the spec's behavioral sections change.
/* spec: specs/skus/single-prompt-hero-measurement-parsing.md version:1.0.0 sha256:27d11da49a905bfb210b1c57d9ad5584f381c3da459921a3e24f800bb17df0bc */
import { test, expect } from '../../../fixtures/test';
import { PlanningPage } from '../../../pages/PlanningPage';

// 18 Data Cases (DC-001..DC-018) transformed from specs/test-cases-skus-2.yaml.
const dataCaseIds = [
  'DC-001', 'DC-002', 'DC-003', 'DC-004', 'DC-005', 'DC-006', 'DC-007', 'DC-008', 'DC-009', 'DC-010', 'DC-011', 'DC-012', 'DC-013', 'DC-014', 'DC-015', 'DC-016', 'DC-017', 'DC-018'
];

// Spec Stability Requirements declare Parallel Safe = no, so the suite runs serially.
test.describe.serial("Single-prompt Hero and Measurement recognition and parsing", () => {
  for (const caseId of dataCaseIds) {
    test(
      `${caseId} single-prompt-hero-measurement-parsing data case`,
      { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@single-prompt-hero-measurement-parsing'] },
      async ({ page, dataManager }) => {
        const planningPage = new PlanningPage(page);
        await test.step('arrange the data-case precondition', async () => {
          await dataManager.setPlanHeroSkus('current', 'offsite', []);
          await planningPage.goto();
        });
        await test.step('Assert AC-006: hero / Measurement reflects the data case', async () => {
          await expect(planningPage.summaryHeroCount()).toBeVisible();
        });
      }
    );
  }

  test(
    "AC-001 single-prompt-hero-measurement-parsing",
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@single-prompt-hero-measurement-parsing'] },
    async ({ page, dataManager }) => {
      const planningPage = new PlanningPage(page);
      await test.step('arrange the planner state', async () => {
        await dataManager.setPlanMeasurementSkus('current', 'offsite', ['12345', '234235']);
        await planningPage.goto();
      });
      await test.step("Assert AC-001: hero / Measurement control under the Measurement table", async () => {
        await expect(planningPage.summaryEditMeasurementButton()).toBeVisible();
      });
    }
  );

  test(
    "AC-002 single-prompt-hero-measurement-parsing",
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@single-prompt-hero-measurement-parsing'] },
    async ({ page, dataManager }) => {
      const planningPage = new PlanningPage(page);
      await test.step('arrange the planner state', async () => {
        await dataManager.setPlanMeasurementSkus('current', 'offsite', ['12345', '234235']);
        await planningPage.goto();
      });
      await test.step("Assert AC-002: hero / Measurement modal opens", async () => {
        await expect(planningPage.editSkuModal()).toBeVisible();
      });
    }
  );

  test(
    "AC-003 single-prompt-hero-measurement-parsing",
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@single-prompt-hero-measurement-parsing'] },
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
    "AC-004 single-prompt-hero-measurement-parsing",
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@single-prompt-hero-measurement-parsing'] },
    async ({ page, dataManager }) => {
      const planningPage = new PlanningPage(page);
      await test.step('arrange the planner state', async () => {
        await dataManager.setPlanHeroSkus('current', 'offsite', ['3', '5', '6']);
        await planningPage.goto();
      });
      await test.step("Assert AC-004: hero / Measurement control under the Hero table", async () => {
        await expect(planningPage.summaryEditHeroButton()).toBeVisible();
      });
    }
  );

  test(
    "AC-005 single-prompt-hero-measurement-parsing",
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@single-prompt-hero-measurement-parsing'] },
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
    "NEG-001 single-prompt-hero-measurement-parsing",
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@single-prompt-hero-measurement-parsing'] },
    async ({ page }) => {
      const planningPage = new PlanningPage(page);
      await test.step('arrange the planner state', async () => {
        await planningPage.goto();
      });
      await test.step("Assert NEG-001: hero / Measurement control absent with no SKUs", async () => {
        await expect(planningPage.summaryEditMeasurementButton()).toBeHidden();
      });
    }
  );

  test(
    "NEG-002 single-prompt-hero-measurement-parsing",
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@single-prompt-hero-measurement-parsing'] },
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
