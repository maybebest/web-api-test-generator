// Spec-bound header: sha256 is the behavioral hash of the spec (computed via
// scripts/ai/lib/spec-parser.mjs specSha256). Re-stamp with `npm run ai:spec:drift`
// if the spec's behavioral sections change.
/* spec: specs/no-preconditions/media-planner-channel-deletion-dialog.md version:1.2.0 sha256:1eb2468715d547fd92573232b3f1f0872fc1fef7767bdfbacce43ebb7e4b08ff */
import { test, expect } from '../../fixtures/test';
import { PlanningPage } from '../../pages/PlanningPage';

// FLOW-MP-007 (suite mode): channel-deletion confirmation dialog. Group B cases only —
// DC-008/009/010 and the at-home/in-store variants are parked in the spec's Pending
// Automation section (staggered fixture / fault-injection HAR / brand-resolvable channels).
const plan = {
  advertiser: 'N360_Unilever_MS',
  brand: 'Unilever | Knorr | MS',
  objective: 'Customer retention',
  // Live-proven search term; the source case's SKU 2001227 is not brand-linked in dev.
  productSearch: 'knorr'
} as const;

// Live-resolvable, brand-available dev channels for the two covered groups (onsite, offsite),
// env-overridable per environment. 'Meta' is live-proven for this brand (2026-07-03 save run).
const ONSITE_CHANNEL = process.env.E2E_MP_DELETION_ONSITE_CHANNEL ?? 'Homepage Sponsored Product';
const OFFSITE_CHANNEL = process.env.E2E_MP_DELETION_OFFSITE_CHANNEL ?? 'Meta';

// The verbatim dialog copy (case-sensitive wording lock per NUP-15407 / TC-DEL-021).
const CONFIRMATION_WORDING = 'Are you sure you want to delete this channel?';

// Campaign window computed at runtime: start >= today+20 clears every covered channel's
// booking deadline (live 2026-07-04: Meta enforces >= 14 days — "does not meet the booking
// deadline"), and runtime dates never rot into the past (past-dated requests are rejected).
const formatDdMmYyyy = (date: Date): string =>
  `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
const addDays = (days: number): Date => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
};
const DATES = `${formatDdMmYyyy(addDays(20))} - ${formatDdMmYyyy(addDays(50))}`;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function channelSpecificDeleteName(channelName: string): RegExp {
  return new RegExp(`(?=.*(?:delete|remove))(?=.*${escapeRegExp(channelName)})`, 'i');
}

const onsiteRequest = `Onsite, ${ONSITE_CHANNEL}, £50000, ${DATES}, Self-Serve`;
const offsiteRequest = `Offsite, ${OFFSITE_CHANNEL}, £40000, ${DATES}, Self-Serve`;

// Assistant/summary round-trips stream for 30-60s+; poll the slow assertions accordingly.
const POLL = { timeout: 75_000 } as const;

type ChannelSetup = 'one-onsite' | 'onsite-and-offsite';

const cancellationCases = [
  { caseId: 'DC-004', trace: 'TC-DEL-004 TC-DEL-023', action: 'cancel' },
  { caseId: 'DC-005', trace: 'TC-DEL-005', action: 'escape' }
] as const;

// Build a fresh plan through the live guided flow up to the channel stage, then add the
// requested channels (resolved names pin the fuzzy disambiguation deterministically).
async function buildPlanWithChannels(planningPage: PlanningPage, channels: ChannelSetup): Promise<void> {
  await planningPage.goto();
  await planningPage.startNectarAiPlanner();
  await planningPage.chooseBuildByObjectiveAndBudget();
  await planningPage.selectAdvertiser(plan.advertiser);
  await planningPage.selectBrand(plan.brand);
  await planningPage.confirmAdvertiserAndBrand();
  await planningPage.enterObjective(plan.objective);
  await planningPage.searchProducts(plan.productSearch);
  await planningPage.selectFirstProduct();
  await planningPage.confirmProducts();
  await planningPage.enterChannelRequest(onsiteRequest, ONSITE_CHANNEL);
  if (channels === 'onsite-and-offsite') {
    await planningPage.enterChannelRequest(offsiteRequest, OFFSITE_CHANNEL);
  }
}

async function cancelOrDismiss(planningPage: PlanningPage, action: 'cancel' | 'escape'): Promise<void> {
  if (action === 'cancel') {
    await planningPage.modalDeleteCancelButton().click();
    return;
  }
  await planningPage.dismissDialogWithEscape();
}

// Spec Stability Requirements declare Parallel Safe = no, so the suite runs serially.
test.describe.serial(
  'Media Planner channel deletion confirmation dialog',
  { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@no-preconditions'] },
  () => {
    test('DC-001 TC-DEL-001 the onsite delete control is active', async ({ page }) => {
      test.slow();
      test.setTimeout(360_000);
      const planningPage = new PlanningPage(page);

      await test.step('Build a fresh plan with one onsite channel', async () => {
        await buildPlanWithChannels(planningPage, 'one-onsite');
      });

      await test.step('Assert AC-001: the channel row exposes an enabled accessibly named delete control', async () => {
        await expect(planningPage.summaryChannel(ONSITE_CHANNEL)).toBeVisible(POLL);
        await expect(planningPage.channelDeleteControlFor(ONSITE_CHANNEL)).toBeEnabled(POLL);
        await expect(planningPage.channelDeleteControlFor(ONSITE_CHANNEL)).toHaveAccessibleName(
          channelSpecificDeleteName(ONSITE_CHANNEL)
        );
      });
    });

    test('DC-002 TC-DEL-002 TC-DEL-021 the confirmation dialog shows the verbatim wording', async ({ page }) => {
      test.slow();
      test.setTimeout(360_000);
      const planningPage = new PlanningPage(page);

      await test.step('Build a fresh plan and open its channel deletion dialog', async () => {
        await buildPlanWithChannels(planningPage, 'one-onsite');
        await planningPage.openDeleteChannelDialogWithKeyboard(ONSITE_CHANNEL);
      });

      await test.step('Assert AC-002: the named modal owns focus and shows the exact confirmation question', async () => {
        await expect(planningPage.deleteChannelDialog()).toHaveAccessibleName(/.+/);
        await expect(planningPage.deleteDialogFocusedElement()).toHaveCount(1);
        await expect(planningPage.deleteChannelDialog()).toContainText(CONFIRMATION_WORDING);
      });
    });

    test('DC-003 TC-DEL-003 confirming deletes onsite while offsite remains', async ({ page }) => {
      test.slow();
      test.setTimeout(480_000);
      const planningPage = new PlanningPage(page);
      let capturedTotalBudget = '';

      await test.step('Build a fresh two-channel plan and confirm onsite deletion', async () => {
        await buildPlanWithChannels(planningPage, 'onsite-and-offsite');
        capturedTotalBudget = (await planningPage.summaryTotalBudget().textContent()) ?? '';
        await planningPage.openDeleteChannelDialog(ONSITE_CHANNEL);
        await planningPage.modalDeleteConfirmButton().click();
      });

      await test.step('Assert AC-003: the target is removed and Total Budget recomputes to the survivor', async () => {
        await expect.poll(() => capturedTotalBudget).toContain('£90,000');
        await expect(planningPage.summaryChannel(ONSITE_CHANNEL)).toHaveCount(0, POLL);
        await expect(planningPage.summaryChannel(OFFSITE_CHANNEL)).toBeVisible(POLL);
        await expect(planningPage.summaryTotalBudget()).toContainText('£40,000', POLL);
      });
    });

    for (const dataCase of cancellationCases) {
      test(`${dataCase.caseId} ${dataCase.trace} cancelling or dismissing preserves the plan`, async ({ page }) => {
        test.slow();
        test.setTimeout(480_000);
        const planningPage = new PlanningPage(page);
        let capturedTotalBudget = '';
        let capturedDates = '';

        await test.step('Build a fresh two-channel plan, capture its summary, and abandon deletion', async () => {
          await buildPlanWithChannels(planningPage, 'onsite-and-offsite');
          capturedTotalBudget = (await planningPage.summaryTotalBudget().textContent()) ?? '';
          capturedDates = (await planningPage.summaryDates().textContent()) ?? '';
          await planningPage.openDeleteChannelDialog(ONSITE_CHANNEL);
          await cancelOrDismiss(planningPage, dataCase.action);
        });

        await test.step('Assert AC-004: rows, budget, dates and invoking-control focus remain unchanged', async () => {
          await expect(planningPage.deleteChannelDialog()).toBeHidden(POLL);
          await expect(planningPage.summaryChannel(ONSITE_CHANNEL)).toBeVisible(POLL);
          await expect(planningPage.summaryChannel(OFFSITE_CHANNEL)).toBeVisible(POLL);
          await expect(planningPage.summaryTotalBudget()).toHaveText(capturedTotalBudget);
          await expect(planningPage.summaryDates()).toHaveText(capturedDates);
          await expect(planningPage.channelDeleteControlFor(ONSITE_CHANNEL)).toBeFocused();
        });
      });
    }

    test('DC-006 TC-DEL-006 NUP-19104 labelled Delete deletes and labelled Cancel keeps', async ({ page }) => {
      test.slow();
      test.setTimeout(480_000);
      const planningPage = new PlanningPage(page);

      await test.step('Use the labelled Delete for onsite and the labelled Cancel for offsite', async () => {
        await buildPlanWithChannels(planningPage, 'onsite-and-offsite');
        await planningPage.openDeleteChannelDialog(ONSITE_CHANNEL);
        await planningPage.modalDeleteConfirmButton().click();
        await planningPage.openDeleteChannelDialog(OFFSITE_CHANNEL);
        await planningPage.modalDeleteCancelButton().click();
      });

      await test.step('Assert NEG-001: the exact action labels are not swapped or non-functional', async () => {
        await expect(planningPage.deleteChannelDialog()).toBeHidden(POLL);
        await expect(planningPage.summaryChannel(ONSITE_CHANNEL)).toHaveCount(0, POLL);
        await expect(planningPage.summaryChannel(OFFSITE_CHANNEL)).toBeVisible(POLL);
      });
    });

    test('DC-007 TC-DEL-007 deleting the only channel empties the media section', async ({ page }) => {
      test.slow();
      test.setTimeout(360_000);
      const planningPage = new PlanningPage(page);

      await test.step('Build a fresh one-channel plan and confirm deletion', async () => {
        await buildPlanWithChannels(planningPage, 'one-onsite');
        await planningPage.deleteChannel(ONSITE_CHANNEL);
      });

      await test.step('Assert AC-005: the media summary returns to its empty state', async () => {
        await expect(planningPage.channelDeleteButton()).toHaveCount(0, POLL);
        await expect(planningPage.summaryTotalBudget()).toContainText('£--', POLL);
        await expect(planningPage.summaryDates()).not.toContainText(/\d{4}/);
      });
    });
  }
);
