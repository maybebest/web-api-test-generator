// Spec-bound header: sha256 is the behavioral hash of the spec (computed via
// scripts/ai/lib/spec-parser.mjs specSha256). Re-stamp with `npm run ai:spec:drift`
// if the spec's behavioral sections change.
/* spec: specs/media-plan-save-via-nectar-ai.md version:1.2.0 sha256:6ddfe6465e685f98075fb12d18dd651088ff6a317436be82eb4c4e8097e17b83 */
import { test, expect } from '../../fixtures/test';
import { inspectCsvDownload, type CsvDownloadInspection } from '../../fixtures/csv-export';
import { PlanningPage } from '../../pages/PlanningPage';

// The campaign window is computed at runtime (start ~45 days out, 30-day duration) so the request
// can never rot into past dates — the assistant rejects past-dated channels outright
// ("The dates provided ... are in the past", observed live 2026-07-03).
const formatDdMmYyyy = (date: Date): string =>
  `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;

const campaignWindow = (): { start: Date; end: Date } => {
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

const currentPlanNamePrefix = (): RegExp => {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return new RegExp(`${year}_${month}_Unilever\\|Knorr\\|MS_`);
};

// DC-001 from specs/media-plan-save-via-nectar-ai.md — the single deterministic
// happy-path journey for building and saving a media plan via Nectar AI.
const dataCase = {
  caseId: 'DC-001',
  advertiser: 'N360_Unilever_MS',
  brand: 'Unilever | Knorr | MS',
  objective: 'Customer retention',
  productSearch: 'knorr',
  // Passing the resolved name pins the (non-deterministic) fuzzy disambiguation click AND switches
  // the landing signal to this channel's own summary row instead of loose chat text.
  resolvedChannelName: 'Meta'
} as const;

const expectedCsvChecks = {
  downloadSucceeded: true,
  csvFilename: true,
  utf8Readable: true,
  parsedRfc4180: true,
  nonEmptyRows: true,
  rectangularRows: true,
  tokens: {
    advertiser: true,
    brand: true,
    objective: true,
    channel: true,
    budget: true,
    skuCount: true
  }
} as const;

// Spec Stability Requirements declare Parallel Safe = no, so the journey runs as
// a single serial flow (the static reviewer requires test.describe.serial here).
test.describe.serial('Build and save a media plan via Nectar AI', () => {
  test(
    'DC-001 media planner builds and saves a media plan via Nectar AI',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated'] },
    async ({ page }) => {
      test.setTimeout(480_000);
      test.info().annotations.push({
        type: 'covered-ac-ids',
        description: 'AC-001 AC-002 AC-003 AC-004 AC-005 AC-006 AC-007 AC-008'
      });

      const planningPage = new PlanningPage(page);
      let csvInspection: CsvDownloadInspection | undefined;

      await test.step('AC-001: launch the Nectar AI objective & budget planner', async () => {
        await planningPage.goto();
        await planningPage.startNectarAiPlanner();
        await planningPage.chooseBuildByObjectiveAndBudget();
      });

      await test.step('AC-002: select the advertiser and brand', async () => {
        await planningPage.selectAdvertiser(dataCase.advertiser);
        await planningPage.selectBrand(dataCase.brand);
        await planningPage.confirmAdvertiserAndBrand();
      });

      await test.step('AC-003: enter the campaign objective', async () => {
        await planningPage.enterObjective(dataCase.objective);
      });

      await test.step('AC-004: search products and select campaign SKUs', async () => {
        await planningPage.searchProducts(dataCase.productSearch);
        await planningPage.selectFirstProduct();
        await planningPage.confirmProducts();
      });

      await test.step('AC-005: add the offsite channel via chat', async () => {
        await planningPage.enterChannelRequest(channelRequest(), dataCase.resolvedChannelName);
      });

      await test.step('AC-006, AC-007: confirm and save the plan', async () => {
        await planningPage.confirmPlan();
        await planningPage.savePlan();
      });

      await test.step('AC-008: download the saved plan (a download must fire)', async () => {
        // Capture the browser download and inspect only a bounded in-memory copy. The
        // inspection returns booleans/metrics, not exported plan content, so failure
        // artifacts do not echo potentially sensitive CSV values.
        const download = await planningPage.downloadCsv();
        csvInspection = await inspectCsvDownload(download, {
          advertiser: dataCase.advertiser,
          brand: dataCase.brand,
          objective: dataCase.objective,
          channel: dataCase.resolvedChannelName,
          budget: [/\b7k\b/i, /(?<!\d)(?:£\s*)?7(?:[,\s]?000)(?:\.0{1,2})?(?!\d)/i],
          skuCount: 1
        });
      });

      await test.step('Assert AC-008: valid UTF-8 .csv and YYYY_MM_Unilever|Knorr|MS_ plan name', async () => {
        await expect(planningPage.savedConfirmation()).toContainText('Your plan has been saved as a draft.');
        // RULE-002 live-observed name structure (2026-07-03): the visible plan name is
        // "<YYYY_MM of creation>_<Advertiser|Brand chain>_" and the unique objective+number
        // suffix renders in an editable INPUT (input values are not textContent, so only the
        // static visible part is assertable via toContainText).
        await expect(planningPage.planName()).toContainText(currentPlanNamePrefix());
        await expect(planningPage.planNameSuffixInput()).toHaveValue(/Retention_\d+$/i);
        // Live counter contract: whole-row concatenated text, digit-lookbehind guard; the journey
        // selects exactly one measurement SKU (hero promotion is not part of this flow).
        await expect(planningPage.summaryMeasurementCount()).toContainText(new RegExp('(?<!\\d)1 SKUs?'));
        await expect(planningPage.downloadButton()).toBeEnabled();
        await expect(planningPage.editInPollenLink()).toBeEnabled();
        await expect.poll(() => csvInspection?.checks, { timeout: 1_000 }).toEqual(expectedCsvChecks);
      });
    }
  );

  test(
    'NEG-001 save is not offered before a channel has been added',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated'] },
    async ({ page }) => {
      test.setTimeout(240_000);
      const planningPage = new PlanningPage(page);

      await test.step('Arrange NEG-001: reach the channel-request stage without adding a channel', async () => {
        await planningPage.goto();
        await planningPage.startNectarAiPlanner();
        await planningPage.chooseBuildByObjectiveAndBudget();
        await planningPage.selectAdvertiser(dataCase.advertiser);
        await planningPage.selectBrand(dataCase.brand);
        await planningPage.confirmAdvertiserAndBrand();
        await planningPage.enterObjective(dataCase.objective);
        await planningPage.searchProducts(dataCase.productSearch);
        await planningPage.selectFirstProduct();
        await planningPage.confirmProducts();
      });

      await test.step('Assert NEG-001: the save action is absent until a channel exists', async () => {
        await expect(planningPage.saveButton()).toBeHidden();
      });
    }
  );
});
