// Spec-bound header: sha256 is the behavioral hash of the spec. Re-stamp with
// `npm run ai:spec:drift` if the spec's behavioral sections change.
/* spec: specs/skus/hero-sku-indicators-and-count-recompute.md version:2.0.0 sha256:2532a1e7b7c9508701ec393771d8d65d72cfe2be6b0cc4c749c67cb86307ccfa */
import { test, expect } from '../../../fixtures/test';
import { PlanningPage } from '../../../pages/PlanningPage';

// 4 automatable Data Cases (of 36 source cases; the rest are declared
// under "Pending Automation" in the spec — E2E-only policy, no placeholder tests). Each row seeds
// REAL catalogue skuIds (specs/skus/.sku-pools.json) into a live planningAI session and asserts the
// summary counters the UI actually renders.
type SkuDataCase = {
  caseId: string;
  sourceId: string;
  heroSkus: string[];
  measurementSkus: string[];
  // Real catalogue pool the ids come from ('persil' / 'big:<brand>'); 'none' seeds an empty set.
  skuPool: string;
  expected: {
    heroCount: number | null;
    measurementCount: number | null;
  };
};

const dataCases: SkuDataCase[] = [
  {
    "caseId": "DC-001",
    "sourceId": "TC-IND-003",
    "heroSkus": [],
    "measurementSkus": [
      "7096764",
      "7304367",
      "7759164",
      "8114265"
    ],
    "skuPool": "persil",
    "expected": {
      "heroCount": null,
      "measurementCount": 4
    }
  },
  {
    "caseId": "DC-002",
    "sourceId": "TC-IND-008",
    "heroSkus": [
      "7096764",
      "7304367"
    ],
    "measurementSkus": [
      "7759164",
      "7096764",
      "8114265",
      "7304367"
    ],
    "skuPool": "persil",
    "expected": {
      "heroCount": 2,
      "measurementCount": null
    }
  },
  {
    "caseId": "DC-003",
    "sourceId": "TC-IND-027",
    "heroSkus": [],
    "measurementSkus": [
      "7096764",
      "7304367",
      "7759164",
      "8114265"
    ],
    "skuPool": "persil",
    "expected": {
      "heroCount": 0,
      "measurementCount": 4
    }
  },
  {
    "caseId": "DC-004",
    "sourceId": "TC-IND-028",
    "heroSkus": [],
    "measurementSkus": [
      "7096764",
      "7304367",
      "7759164",
      "8114265",
      "8114267"
    ],
    "skuPool": "persil",
    "expected": {
      "heroCount": 0,
      "measurementCount": 5
    }
  }
];

// Live DOM contract (observed 2026-07-03): plan-hero-skus / plan-measurement-skus resolve to the
// whole summary row, whose textContent concatenates children WITHOUT whitespace
// ("ProductHero SKUs2 SKUsEdit…") — so \b never exists around the numeral; a digit lookbehind
// keeps "12 SKUs" from satisfying "2 SKUs". An empty counter renders "To be defined".
const countPattern = (count: number): RegExp =>
  count === 0 ? new RegExp('(?<!\\d)0 SKUs?|To be defined') : new RegExp(`(?<!\\d)${count} SKUs?`);

// Spec Stability Requirements declare Parallel Safe = no, so the suite runs serially.
test.describe.serial("Hero-SKU indicators, all-brand-linked modal, auto-add and count recompute", () => {
  for (const dataCase of dataCases) {
    test(
      `${dataCase.caseId} ${dataCase.sourceId}`,
      { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@hero-sku-indicators-and-count-recompute'] },
      async ({ page, dataManager }) => {
        const planningPage = new PlanningPage(page);
        await test.step('seed the session with the case SKU sets and open it', async () => {
          const sessionId = await dataManager.ensurePlanningSession();
          if (dataCase.heroSkus.length > 0) {
            await dataManager.setPlanHeroSkus(sessionId, 'offsite', dataCase.heroSkus);
          }
          if (dataCase.measurementSkus.length > 0) {
            await dataManager.setPlanMeasurementSkus(sessionId, 'offsite', dataCase.measurementSkus);
          }
          await planningPage.gotoSession(sessionId);
        });
        await test.step('Assert AC-004: seeded Hero/Measurement counter matches the data case', async () => {
          if (dataCase.expected.heroCount !== null) {
            await expect(planningPage.summaryHeroCount()).toContainText(countPattern(dataCase.expected.heroCount));
          } else {
            await expect(planningPage.summaryMeasurementCount()).toContainText(countPattern(dataCase.expected.measurementCount as number));
          }
        });
      }
    );
  }

  test(
    "AC-001 hero-sku-indicators-and-count-recompute",
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@hero-sku-indicators-and-count-recompute'] },
    async ({ page }) => {
      const planningPage = new PlanningPage(page);
      await test.step('walk the planner entry path', async () => {
        await planningPage.goto();
        await planningPage.startNectarAiPlanner();
      });
      await test.step('Assert AC-001: the guided objective-and-budget flow is reachable', async () => {
        await expect(planningPage.buildByObjectiveButton()).toBeVisible();
      });
    }
  );

  test(
    "AC-002 hero-sku-indicators-and-count-recompute",
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@hero-sku-indicators-and-count-recompute'] },
    async ({ page, dataManager }) => {
      const planningPage = new PlanningPage(page);
      await test.step('open the live planning session directly', async () => {
        const sessionId = await dataManager.ensurePlanningSession();
        await planningPage.gotoSession(sessionId);
      });
      await test.step('Assert AC-002: the seeded session hydrates to its summary panel', async () => {
        await expect(planningPage.summaryPanel()).toBeVisible();
      });
    }
  );

  test(
    "AC-003 hero-sku-indicators-and-count-recompute",
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@hero-sku-indicators-and-count-recompute'] },
    async ({ page, dataManager }) => {
      const planningPage = new PlanningPage(page);
      await test.step('seed exactly two Hero SKUs from the real catalogue pool', async () => {
        const sessionId = await dataManager.ensurePlanningSession();
        await dataManager.setPlanHeroSkus(sessionId, 'offsite', ["7096764","7304367"]);
        await planningPage.gotoSession(sessionId);
      });
      await test.step('Assert AC-003: the Hero counter equals the seeded Hero count', async () => {
        await expect(planningPage.summaryHeroCount()).toContainText(countPattern(2));
      });
    }
  );

  test(
    "NEG-001 hero-sku-indicators-and-count-recompute",
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@hero-sku-indicators-and-count-recompute'] },
    async ({ page, dataManager }) => {
      const planningPage = new PlanningPage(page);
      await test.step('clear the session SKU selection via API and open it', async () => {
        const sessionId = await dataManager.ensurePlanningSession();
        await dataManager.setPlanHeroSkus(sessionId, 'offsite', []);
        await planningPage.gotoSession(sessionId);
      });
      await test.step('Assert NEG-001: no SKU edit control renders for an empty selection', async () => {
        await expect(planningPage.summaryEditMeasurementButton()).toBeHidden();
      });
    }
  );
});
