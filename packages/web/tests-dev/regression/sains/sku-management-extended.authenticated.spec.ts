// Spec-bound header: sha256 is the behavioral hash of the spec (computed via
// scripts/ai/lib/spec-parser.mjs specSha256). Re-stamp with `npm run ai:spec:drift`
// if the spec's behavioral sections change.
/* spec: specs/sains/sku-management-extended.md version:1.0.0 sha256:76249c5470d74b4500ec6dcf969a6c844c0db6b777bd9006c2274448ec931079 */
import { test, expect } from '../../../fixtures/test';
import { getPlanningSession, getSkusBySkuId, setPlanningSkus, type SkuSelection } from '../../../fixtures/nectar-api';
import type { TestDataManager } from '../../../fixtures/test-data-manager';
import { buildToObjective } from '../../../pages/NectarFlow';
import { PlanningPage } from '../../../pages/PlanningPage';
import { SkuManagementExtendedComponent } from '../../../pages/SkuManagementExtendedComponent';

// Real brand SKU numbers, live-verified read-only against the dev planning API on
// 2026-07-11 (planning_getSkusBySkuId): 2023755 "Knorr 8 Vegetable Stock Cubes 80g",
// 2023779 "Knorr 8 Beef Stock Cubes 80g", 2023786 "Knorr 8 Chicken Stock Cubes 80g".
const knorr = {
  hero: { skuId: 2023755 },
  second: { skuId: 2023779 },
  followUp: { skuId: 2023786 }
} as const;

// Seeded pinned-session pool (specs/skus/.sku-pools.json — the live-probed Persil
// catalogue already used by the live-green skus suites).
const persil = {
  seedHero: 7096764,
  seedMeasurement: 7304367,
  candidateA: 7759164,
  candidateB: 8114265,
  deepA: 8119540,
  deepB: 7495079
} as const;

const seedSelection = {
  heroSkus: [String(persil.seedHero)],
  measurementSkus: [String(persil.seedHero), String(persil.seedMeasurement)]
} as const;

// A search term matching several Knorr stock-cube products, so one search maps both
// known SKU numbers ("<product name> - <SKU>" checkbox rows) in a single turn.
const multiProductSearch = 'Knorr 8';

// Single-prompt combined Hero+Measurement definition and the follow-up that adds one
// NEW SKU (2023786) while repeating an EXISTING one (2023779) — the dedupe probe.
const combinedPrompt = '2023755, 2023779 and hero skus 2023755';
const followUpRequest = 'add 2023786, 2023779';

const resolvedChannelName = 'Meta';

// The campaign window is computed at runtime (start ~45 days out, 30-day duration) so
// the request can never rot into past dates — the assistant rejects past-dated channels.
const formatDdMmYyyy = (date: Date): string =>
  `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;

const campaignWindow = (): { start: Date; end: Date } => {
  // Advance calendar dates from one midday anchor. Adding fixed 24-hour durations can
  // produce the previous/next local date across daylight-saving transitions.
  const anchor = new Date();
  anchor.setHours(12, 0, 0, 0);
  const atOffset = (days: number): Date => {
    const date = new Date(anchor);
    date.setDate(date.getDate() + days);
    return date;
  };
  return { start: atOffset(45), end: atOffset(75) };
};

const channelRequest = (): string => {
  const { start, end } = campaignWindow();
  return `Offsite, Meta, ${formatDdMmYyyy(start)} till ${formatDdMmYyyy(end)}, the budget is 7k, Self-Serve`;
};

// Live DOM contract (observed 2026-07-03): the summary counter rows concatenate their
// children WITHOUT whitespace, so a digit lookbehind keeps "12 SKUs" from satisfying
// "2 SKUs"; never assert the counters with an exact-text match.
const countPattern = (count: number): RegExp => new RegExp(`(?<!\\d)${count} SKUs?`);

// Resolve catalogue product names at runtime through the existing fixture read
// (planning_getSkusBySkuId) so editor searches use the real, current names and the
// suite fails loudly — instead of passing vacuously — if the fixture pool drifts.
const resolveCatalogueNames = async (skuIds: readonly number[]): Promise<(skuId: number) => string> => {
  const rows = await getSkusBySkuId([...skuIds]);
  const names = new Map(rows.map((row) => [row.skuId, row.skuName]));
  return (skuId: number): string => {
    const name = names.get(skuId);
    if (!name) {
      throw new Error(`The live catalogue did not resolve skuId ${skuId}; the fixture SKU pool has drifted.`);
    }
    return name;
  };
};

// Seed (and later restore) the pinned session's baseline through the dataManager so
// its teardown bookkeeping stays owner-consistent: hero {7096764}, measurement
// {7096764, 7304367} — the TD-SKU-A shape (one hero+measurement, one measurement-only).
const applySeededSelection = async (dataManager: TestDataManager, sessionId: string): Promise<void> => {
  await dataManager.setPlanHeroSkus(sessionId, 'offsite', [...seedSelection.heroSkus]);
  await dataManager.setPlanMeasurementSkus(sessionId, 'offsite', [...seedSelection.measurementSkus]);
};

// Cases that confirm an editor mutation must put the session back to the manager's
// last write before finishing, or the dataManager teardown would (safely) refuse to
// restore a diverged shared session.
const restoreSeededSelection = async (dataManager: TestDataManager, sessionId: string): Promise<void> => {
  if (!sessionId) {
    return;
  }
  await applySeededSelection(dataManager, sessionId);
};

type CampaignSku = { skuId: number; isHero: boolean };
type CrossBrandAttemptOutcome = { persisted: boolean };

const readCampaignSkus = async (sessionId: string): Promise<CampaignSku[]> => {
  const state = (await getPlanningSession(sessionId))?.state as { campaignSkus?: CampaignSku[] } | undefined;
  return (state?.campaignSkus ?? []).map(({ skuId, isHero }) => ({ skuId, isHero }));
};

// NEG-001: the documented state-update shortcut. The write is EXPECTED to be rejected
// (NUP-20956 locks the confirmed global set once a channel exists); the caller asserts
// on the persisted state, so an accepted removal surfaces red either way.
const attemptGlobalSkuRemoval = async (sessionId: string, removeSkuId: number): Promise<void> => {
  const current = await readCampaignSkus(sessionId);
  const reduced: SkuSelection[] = current.filter((sku) => sku.skuId !== removeSkuId);
  if (reduced.length === current.length) {
    throw new Error(`Session ${sessionId} does not contain skuId ${removeSkuId}; cannot attempt the removal.`);
  }
  try {
    await setPlanningSkus(sessionId, reduced);
  } catch {
    // Expected: the backend rejects the post-channel removal.
  }
};

// NEG-002: craft a cross-brand SET_SKUS payload against the seeded session. The
// persisted flag is captured BEFORE any cleanup so a backend that accepts the foreign
// SKU is reported red; the cleanup write only prevents the shared pinned session from
// staying polluted after the defect is surfaced.
const attemptCrossBrandAssignment = async (
  sessionId: string,
  foreignSkuId: number
): Promise<CrossBrandAttemptOutcome> => {
  const original = await readCampaignSkus(sessionId);
  try {
    await setPlanningSkus(sessionId, [...original, { skuId: foreignSkuId, isHero: false }]);
  } catch {
    // Expected: the backend rejects a cross-brand SKU assignment.
  }
  const after = await readCampaignSkus(sessionId);
  const persisted = after.some((sku) => sku.skuId === foreignSkuId);
  if (persisted) {
    await setPlanningSkus(sessionId, original);
  }
  return { persisted };
};

// Reach the in-chat combined summary from one Hero+Measurement prompt (NUP-19273).
const buildToCombinedSummary = async (planningPage: PlanningPage): Promise<void> => {
  await buildToObjective(planningPage);
  await planningPage.sendChatMessage(combinedPrompt);
  await planningPage.waitForAssistantIdle();
};

// DC-010/DC-011 journey: the only difference between the two rows is whether the
// initial combined summary is confirmed before the follow-up message is sent.
const driveChatAugmentationJourney = async (
  planningPage: PlanningPage,
  confirmInitialSummaryFirst: boolean
): Promise<void> => {
  await buildToCombinedSummary(planningPage);
  if (confirmInitialSummaryFirst) {
    await planningPage.confirmHeroSkus();
  }
  await planningPage.sendChatMessage(followUpRequest);
  await planningPage.waitForAssistantIdle();
  await planningPage.confirmHeroSkus();
};

// DC-004/DC-005 rows (E2E-SKU-015 / E2E-SKU-017): promote brand SKUs in ONE Hero edit
// from the seeded baseline (hero 1, measurement 2) and expect the auto-add invariant
// to grow the measurement set by exactly the missing SKUs.
const heroAutoAddCases = [
  {
    caseId: 'DC-004',
    catalogueId: 'E2E-SKU-015',
    promoteSkuIds: [persil.candidateB],
    expected: { heroCount: 2, measurementCount: 3 }
  },
  {
    caseId: 'DC-005',
    catalogueId: 'E2E-SKU-017',
    promoteSkuIds: [persil.seedMeasurement, persil.candidateA, persil.candidateB],
    expected: { heroCount: 4, measurementCount: 4 }
  }
] as const;

// DC-010/DC-011 rows (E2E-SKU-036 / E2E-SKU-037): one new SKU + one repeated SKU by
// chat, before vs after the initial combined-summary confirmation. Expected totals are
// the deduplicated unique counts (2023755, 2023779, 2023786 => 3; hero stays 1).
const chatAugmentationCases = [
  {
    caseId: 'DC-010',
    catalogueId: 'E2E-SKU-036',
    confirmInitialSummaryFirst: false,
    expected: { measurementCount: 3, heroCount: 1 }
  },
  {
    caseId: 'DC-011',
    catalogueId: 'E2E-SKU-037',
    confirmInitialSummaryFirst: true,
    expected: { measurementCount: 3, heroCount: 1 }
  }
] as const;

// Spec Stability Requirements declare Parallel Safe = no: the guided journeys build
// fresh live conversations and the editor cases share one pinned QA session.
test.describe.serial('Extended SKU management across conversation, editors and combined summary', () => {
  test(
    'DC-001 (E2E-SKU-002) a measurement search by SKU number maps exactly one catalogue product',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@sku-management-extended'] },
    async ({ page }) => {
      // Short pre-channel journey (objective stage + one search turn).
      test.setTimeout(240_000);
      const planningPage = new PlanningPage(page);
      const skuComponent = new SkuManagementExtendedComponent(page);
      const catalogueName = await resolveCatalogueNames([knorr.hero.skuId]);

      await test.step('Arrange: drive the guided flow and search measurements by SKU number', async () => {
        await buildToObjective(planningPage);
        await planningPage.searchProducts(String(knorr.hero.skuId));
      });

      await test.step('Assert AC-001: exactly one product row maps with the catalogue name and SKU number', async () => {
        await expect(planningPage.productCheckboxes()).toHaveCount(1);
        await expect(skuComponent.measurementOptionBySku(String(knorr.hero.skuId))).toBeVisible();
        await expect(skuComponent.measurementOptionByName(catalogueName(knorr.hero.skuId))).toBeVisible();
      });
    }
  );

  test(
    'DC-002 (E2E-SKU-009) a hero unassigned in the conversation is removed immediately and stays a measurement',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@sku-management-extended'] },
    async ({ page }) => {
      test.setTimeout(480_000);
      const planningPage = new PlanningPage(page);
      const skuComponent = new SkuManagementExtendedComponent(page);

      await test.step('Arrange: confirm two measurements, promote both to hero, then unassign one in the conversation', async () => {
        await buildToObjective(planningPage);
        await planningPage.searchProducts(multiProductSearch);
        await skuComponent.measurementOptionBySku(String(knorr.hero.skuId)).check();
        await skuComponent.measurementOptionBySku(String(knorr.second.skuId)).check();
        await planningPage.confirmMeasurementSkus();
        await skuComponent.heroPromoteControlFor(String(knorr.hero.skuId)).click();
        await skuComponent.heroPromoteControlFor(String(knorr.second.skuId)).click();
        await skuComponent.latestChatRemoveSkuButton(String(knorr.second.skuId)).click();
      });

      await test.step('Assert AC-002: the unassign is immediate, dialog-free, and the row stays a measurement row', async () => {
        await expect(skuComponent.anyDialog()).toHaveCount(0);
        // Exactly one of the two rows is promotable again => the hero count
        // decremented exactly once, with no confirmation step in between.
        await expect(planningPage.addHeroSkuButton()).toHaveCount(1);
        await expect(skuComponent.latestChatSkuRow(String(knorr.second.skuId))).toBeVisible();
      });
    }
  );

  test(
    'DC-003 (E2E-SKU-014) the Hero editor offers brand SKUs beyond the measurement set and no foreign brand',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@sku-management-extended'] },
    async ({ page, dataManager }) => {
      // Seeded-session case: hydration (up to 150s) + editor interactions.
      test.setTimeout(300_000);
      const planningPage = new PlanningPage(page);
      const skuComponent = new SkuManagementExtendedComponent(page);
      const catalogueName = await resolveCatalogueNames([persil.candidateA, persil.candidateB, knorr.hero.skuId]);

      await test.step('Arrange: seed the pinned session with the baseline selection and open the Hero editor', async () => {
        const sessionId = await dataManager.ensurePlanningSession();
        await applySeededSelection(dataManager, sessionId);
        await planningPage.gotoSession(sessionId);
        await planningPage.openHeroEditModal();
      });

      await test.step('Assert AC-003: brand SKUs outside the measurement set are candidates and the foreign brand is absent', async () => {
        await skuComponent.searchCandidates(catalogueName(persil.candidateA));
        await expect(skuComponent.candidateOption(String(persil.candidateA))).toBeVisible({ timeout: 30_000 });
        await skuComponent.searchCandidates(catalogueName(persil.candidateB));
        await expect(skuComponent.candidateOption(String(persil.candidateB))).toBeVisible({ timeout: 30_000 });
        await skuComponent.searchCandidates(catalogueName(knorr.hero.skuId));
        await expect(skuComponent.candidateOption(String(knorr.hero.skuId))).toHaveCount(0);
      });
    }
  );

  for (const dataCase of heroAutoAddCases) {
    test(
      `${dataCase.caseId} (${dataCase.catalogueId}) hero promotion auto-adds only the missing measurements`,
      { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@sku-management-extended'] },
      async ({ page, dataManager }) => {
        test.setTimeout(300_000);
        const planningPage = new PlanningPage(page);
        const skuComponent = new SkuManagementExtendedComponent(page);
        const catalogueName = await resolveCatalogueNames(dataCase.promoteSkuIds);
        let sessionId = '';

        try {
          await test.step('Arrange: seed the pinned session and promote the case SKUs in one Hero edit', async () => {
            sessionId = await dataManager.ensurePlanningSession();
            await applySeededSelection(dataManager, sessionId);
            await planningPage.gotoSession(sessionId);
            await planningPage.openHeroEditModal();
            for (const skuId of dataCase.promoteSkuIds) {
              await skuComponent.searchCandidates(catalogueName(skuId));
              await skuComponent.candidateOption(String(skuId)).check();
            }
            await planningPage.editModalConfirm().click();
            await skuComponent.editSkuDialog().waitFor({ state: 'hidden', timeout: 30_000 });
          });

          await test.step('Assert AC-004: the counters recompute to unique totals and each promoted SKU has one measurement row', async () => {
            await expect(planningPage.summaryHeroCount()).toContainText(countPattern(dataCase.expected.heroCount), {
              timeout: 60_000
            });
            await expect(planningPage.summaryMeasurementCount()).toContainText(
              countPattern(dataCase.expected.measurementCount),
              { timeout: 60_000 }
            );
            await planningPage.openMeasurementEditModal();
            for (const skuId of dataCase.promoteSkuIds) {
              await expect(planningPage.modalSkuRow(String(skuId))).toHaveCount(1);
            }
          });
        } finally {
          await restoreSeededSelection(dataManager, sessionId);
        }
      }
    );
  }

  test(
    'DC-006 (E2E-SKU-018) the Measurement editor marks exactly the current hero rows',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@sku-management-extended'] },
    async ({ page, dataManager }) => {
      test.setTimeout(300_000);
      const planningPage = new PlanningPage(page);
      const skuComponent = new SkuManagementExtendedComponent(page);

      await test.step('Arrange: seed the pinned session with the baseline selection and open the Measurement editor', async () => {
        const sessionId = await dataManager.ensurePlanningSession();
        await applySeededSelection(dataManager, sessionId);
        await planningPage.gotoSession(sessionId);
        await planningPage.openMeasurementEditModal();
      });

      await test.step('Assert AC-005: the Hero SKU indicator marks the hero row only, without extra rows', async () => {
        await expect(skuComponent.heroIndicator(String(persil.seedHero))).toBeVisible({ timeout: 30_000 });
        await expect(skuComponent.heroIndicator(String(persil.seedMeasurement))).toHaveCount(0);
        await expect(planningPage.modalSkuRow(String(persil.seedHero))).toHaveCount(1);
        await expect(planningPage.modalSkuRow(String(persil.seedMeasurement))).toHaveCount(1);
        await expect(planningPage.modalSelectedCount()).toContainText(/(?<!\d)2 selected/);
      });
    }
  );

  test(
    'DC-007 (E2E-SKU-019) the hero indicator follows assignment changes without a page reload',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@sku-management-extended'] },
    async ({ page, dataManager }) => {
      test.setTimeout(300_000);
      const planningPage = new PlanningPage(page);
      const skuComponent = new SkuManagementExtendedComponent(page);
      const catalogueName = await resolveCatalogueNames([persil.seedMeasurement]);
      let sessionId = '';

      try {
        await test.step('Arrange: seed the pinned session and assign the measurement-only SKU as hero', async () => {
          sessionId = await dataManager.ensurePlanningSession();
          await applySeededSelection(dataManager, sessionId);
          await planningPage.gotoSession(sessionId);
          await planningPage.openHeroEditModal();
          await skuComponent.searchCandidates(catalogueName(persil.seedMeasurement));
          await skuComponent.candidateOption(String(persil.seedMeasurement)).check();
          await planningPage.editModalConfirm().click();
          await skuComponent.editSkuDialog().waitFor({ state: 'hidden', timeout: 30_000 });
        });

        await test.step('Assert AC-005: the Hero SKU indicator appears and disappears with the toggle, no reload', async () => {
          // The whole toggle cycle happens in ONE page session — no page.reload,
          // no navigation: modal open/close only (NUP-21968 real-time contract).
          await planningPage.openMeasurementEditModal();
          await expect(skuComponent.heroIndicator(String(persil.seedMeasurement))).toBeVisible({ timeout: 30_000 });
          await planningPage.editModalCancel().click();
          await skuComponent.editSkuDialog().waitFor({ state: 'hidden', timeout: 30_000 });
          await planningPage.openHeroEditModal();
          await skuComponent.searchCandidates(catalogueName(persil.seedMeasurement));
          await skuComponent.candidateOption(String(persil.seedMeasurement)).uncheck();
          await planningPage.editModalConfirm().click();
          await skuComponent.editSkuDialog().waitFor({ state: 'hidden', timeout: 30_000 });
          await planningPage.openMeasurementEditModal();
          await expect(skuComponent.heroIndicator(String(persil.seedMeasurement))).toHaveCount(0);
          await expect(skuComponent.heroIndicator(String(persil.seedHero))).toBeVisible();
          await planningPage.editModalCancel().click();
          await skuComponent.editSkuDialog().waitFor({ state: 'hidden', timeout: 30_000 });
          await expect(planningPage.summaryHeroCount()).toContainText(countPattern(1), { timeout: 60_000 });
          await expect(planningPage.summaryMeasurementCount()).toContainText(countPattern(2), { timeout: 60_000 });
        });
      } finally {
        await restoreSeededSelection(dataManager, sessionId);
      }
    }
  );

  test(
    'DC-008 (E2E-SKU-028) large-catalogue search retains selections across searches and saves the exact set',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@sku-management-extended'] },
    async ({ page, dataManager }) => {
      test.setTimeout(300_000);
      const planningPage = new PlanningPage(page);
      const skuComponent = new SkuManagementExtendedComponent(page);
      const catalogueName = await resolveCatalogueNames([persil.deepA, persil.deepB]);
      let sessionId = '';

      try {
        await test.step('Arrange: seed the pinned 102-SKU-pool session and select two deep-catalogue SKUs across searches', async () => {
          sessionId = await dataManager.ensurePlanningSession();
          await applySeededSelection(dataManager, sessionId);
          await planningPage.gotoSession(sessionId);
          await planningPage.openHeroEditModal();
          await skuComponent.searchCandidates(catalogueName(persil.deepA));
          await skuComponent.candidateOption(String(persil.deepA)).check();
          await skuComponent.searchCandidates(catalogueName(persil.deepB));
          await skuComponent.candidateOption(String(persil.deepB)).check();
          // Return to the FIRST search so the retained selection is observable.
          await skuComponent.searchCandidates(catalogueName(persil.deepA));
        });

        await test.step('Assert AC-006: the earlier selection is still checked and saving commits the exact unique set', async () => {
          await expect(skuComponent.candidateOption(String(persil.deepA))).toBeChecked({ timeout: 30_000 });
          await planningPage.editModalConfirm().click();
          await skuComponent.editSkuDialog().waitFor({ state: 'hidden', timeout: 30_000 });
          await expect(planningPage.summaryHeroCount()).toContainText(countPattern(3), { timeout: 60_000 });
        });
      } finally {
        await restoreSeededSelection(dataManager, sessionId);
      }
    }
  );

  test(
    'DC-009 (E2E-SKU-035) confirming the combined summary enables both summary edit controls',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@sku-management-extended'] },
    async ({ page }) => {
      test.setTimeout(480_000);
      const planningPage = new PlanningPage(page);

      await test.step('Arrange: reach the combined summary from one Hero+Measurement prompt', async () => {
        await buildToCombinedSummary(planningPage);
      });

      await test.step('Assert AC-007: the edit controls are absent before confirmation and enabled after', async () => {
        await expect(planningPage.summaryEditMeasurementButton()).toHaveCount(0);
        await expect(planningPage.summaryEditHeroButton()).toHaveCount(0);
        await planningPage.confirmHeroSkus();
        await expect(planningPage.summaryEditMeasurementButton()).toBeEnabled({ timeout: 60_000 });
        await expect(planningPage.summaryEditHeroButton()).toBeEnabled({ timeout: 60_000 });
      });
    }
  );

  for (const dataCase of chatAugmentationCases) {
    test(
      `${dataCase.caseId} (${dataCase.catalogueId}) a chat follow-up adds one new SKU once and dedupes the repeated SKU`,
      { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@sku-management-extended'] },
      async ({ page }) => {
        test.setTimeout(480_000);
        const planningPage = new PlanningPage(page);
        const skuComponent = new SkuManagementExtendedComponent(page);

        await test.step('Arrange: reach the combined summary and send the follow-up with one new and one repeated SKU', async () => {
          await driveChatAugmentationJourney(planningPage, dataCase.confirmInitialSummaryFirst);
        });

        await test.step('Assert AC-008: the new SKU lands once and the confirmed counters equal the deduplicated totals', async () => {
          await expect(skuComponent.latestChatSkuRow(String(knorr.followUp.skuId))).toBeVisible({ timeout: 60_000 });
          await expect(planningPage.summaryMeasurementCount()).toContainText(
            countPattern(dataCase.expected.measurementCount),
            { timeout: 120_000 }
          );
          await expect(planningPage.summaryHeroCount()).toContainText(countPattern(dataCase.expected.heroCount), {
            timeout: 120_000
          });
        });
      }
    );
  }

  test(
    'DC-012 (E2E-SKU-040) the combined-summary Edit SKU list action opens the Hero editor and reflects the promotion',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@sku-management-extended'] },
    async ({ page }) => {
      test.setTimeout(480_000);
      const planningPage = new PlanningPage(page);
      const skuComponent = new SkuManagementExtendedComponent(page);
      const catalogueName = await resolveCatalogueNames([knorr.followUp.skuId]);

      await test.step('Arrange: reach the combined summary from one Hero+Measurement prompt', async () => {
        await buildToCombinedSummary(planningPage);
      });

      await test.step('Assert AC-009: the Hero editor (not the Measurement editor) opens and the promotion persists', async () => {
        await skuComponent.editSkuListButton().click();
        await expect(skuComponent.heroEditDialog()).toBeVisible({ timeout: 30_000 });
        await expect(skuComponent.measurementEditDialog()).toHaveCount(0);
        await skuComponent.searchCandidates(catalogueName(knorr.followUp.skuId));
        await skuComponent.candidateOption(String(knorr.followUp.skuId)).check();
        await planningPage.editModalConfirm().click();
        await skuComponent.editSkuDialog().waitFor({ state: 'hidden', timeout: 30_000 });
        await expect(skuComponent.latestChatSkuRow(String(knorr.followUp.skuId))).toBeVisible({ timeout: 60_000 });
        // Reopen the same entry point: the promoted SKU is now a selected row.
        await skuComponent.editSkuListButton().click();
        await expect(planningPage.modalSkuRow(String(knorr.followUp.skuId))).toBeVisible({ timeout: 30_000 });
      });
    }
  );

  test(
    'NEG-001 (E2E-SKU-021) global SKU removal is blocked after a channel is provided',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@sku-management-extended'] },
    async ({ page }) => {
      test.setTimeout(480_000);
      const planningPage = new PlanningPage(page);
      const skuComponent = new SkuManagementExtendedComponent(page);
      let sessionId = '';

      await test.step('Arrange: confirm global SKUs, provide a channel, then attempt a direct removal', async () => {
        await buildToObjective(planningPage);
        await planningPage.searchProducts(multiProductSearch);
        await skuComponent.measurementOptionBySku(String(knorr.hero.skuId)).check();
        await skuComponent.measurementOptionBySku(String(knorr.second.skuId)).check();
        await planningPage.confirmMeasurementSkus();
        await skuComponent.heroPromoteControlFor(String(knorr.hero.skuId)).click();
        await planningPage.confirmHeroSkus();
        await planningPage.enterChannelRequest(channelRequest(), resolvedChannelName);
        sessionId = skuComponent.sessionIdFromUrl();
        await attemptGlobalSkuRemoval(sessionId, knorr.second.skuId);
      });

      await test.step('Assert NEG-001: the persisted selection and the summary counter are unchanged', async () => {
        await expect
          .poll(async () => (await readCampaignSkus(sessionId)).length, { timeout: 30_000 })
          .toBe(2);
        await expect
          .poll(async () => (await readCampaignSkus(sessionId)).some((sku) => sku.skuId === knorr.second.skuId), {
            timeout: 30_000
          })
          .toBe(true);
        await expect(planningPage.summaryMeasurementCount()).toContainText(countPattern(2));
      });
    }
  );

  test(
    'NEG-002 (E2E-SKU-025) a wrong-brand SKU is absent from candidates and rejected by direct mutation',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@sku-management-extended'] },
    async ({ page, dataManager }) => {
      test.setTimeout(300_000);
      const planningPage = new PlanningPage(page);
      const skuComponent = new SkuManagementExtendedComponent(page);
      const catalogueName = await resolveCatalogueNames([knorr.hero.skuId]);
      let crossBrandOutcome: CrossBrandAttemptOutcome | undefined;

      await test.step('Arrange: seed the pinned session, search the foreign product, and attempt the cross-brand write', async () => {
        const sessionId = await dataManager.ensurePlanningSession();
        await applySeededSelection(dataManager, sessionId);
        await planningPage.gotoSession(sessionId);
        await planningPage.openHeroEditModal();
        await skuComponent.searchCandidates(catalogueName(knorr.hero.skuId));
        crossBrandOutcome = await attemptCrossBrandAssignment(sessionId, knorr.hero.skuId);
      });

      await test.step('Assert NEG-002: the foreign-brand SKU is neither offered as a candidate nor persisted', async () => {
        await expect(skuComponent.candidateOption(String(knorr.hero.skuId))).toHaveCount(0);
        await expect.poll(() => crossBrandOutcome?.persisted, { timeout: 15_000 }).toBe(false);
      });
    }
  );
});
