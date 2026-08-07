// Spec-bound header: sha256 is the behavioral hash of the spec (computed via
// scripts/ai/lib/spec-parser.mjs specSha256). Re-stamp with `npm run ai:spec:drift`
// if the spec's behavioral sections change.
/* spec: specs/sains/media-plan-discard-flow.md version:1.0.0 sha256:d0b3980581a15e5d091f687c3e486e4cbbf83f2ebd6677fbbbae6f41e898de75 */
import { test, expect } from '../../../fixtures/test';
import { PlanningPage } from '../../../pages/PlanningPage';

// The campaign window is computed at runtime (start ~45 days out, 30-day duration) so the
// request can never rot into past dates — the assistant rejects past-dated channels outright.
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

const journey = {
  advertiser: 'N360_Unilever_MS',
  brand: 'Unilever | Knorr | MS',
  objective: 'Customer retention',
  productSearch: 'knorr',
  resolvedChannelName: 'Meta'
} as const;

const channelRequest = (): string => {
  const { start, end } = campaignWindow();
  return `Offsite, Meta, ${formatDdMmYyyy(start)} till ${formatDdMmYyyy(end)}, the budget is 7k, Self-Serve`;
};

// DC-003/DC-004 from specs/sains/media-plan-discard-flow.md — the two-row
// discard-confirmation choice table (NUP-20082 Scenarios 2-3): the same prompt
// resolves to opposite outcomes depending on the hot button pressed.
const discardChoiceCases = [
  {
    caseId: 'DC-003',
    choice: 'No, continue with my plan',
    expected: {
      result: 'kept-and-saved',
      message: 'Your plan has been saved as a draft.'
    }
  },
  {
    caseId: 'DC-004',
    choice: 'Yes, discard draft plan',
    expected: {
      result: 'discarded',
      message: 'plan has been discarded'
    }
  }
] as const;

// Build a fresh plan up to the objective stage (advertiser + brand confirmed,
// objective entered) — the stage NEG-001 inspects, before any channel exists.
const buildToObjective = async (planningPage: PlanningPage): Promise<void> => {
  await planningPage.goto();
  await planningPage.startNectarAiPlanner();
  await planningPage.chooseBuildByObjectiveAndBudget();
  await planningPage.selectAdvertiser(journey.advertiser);
  await planningPage.selectBrand(journey.brand);
  await planningPage.confirmAdvertiserAndBrand();
  await planningPage.enterObjective(journey.objective);
};

// Continue the same journey to final channel confirmation — the stage NUP-20082
// gates the save/discard actions on (Constraint 1).
const buildToPlanConfirmed = async (planningPage: PlanningPage): Promise<void> => {
  await buildToObjective(planningPage);
  await planningPage.searchProducts(journey.productSearch);
  await planningPage.selectFirstProduct();
  await planningPage.confirmProducts();
  await planningPage.enterChannelRequest(channelRequest(), journey.resolvedChannelName);
  await planningPage.confirmPlan();
  // The post-confirmation action turn streams in like any assistant reply; the save
  // CTA is the landing signal (verified live 2026-07-03 on FLOW-MP-020).
  await planningPage.saveButton().waitFor({ state: 'visible', timeout: 180_000 });
};

// Spec Stability Requirements declare Parallel Safe = no, so each journey builds a
// fresh live plan and the suite runs serially.
test.describe.serial('Discard or keep a draft media plan via Nectar AI', () => {
  test(
    'DC-001 both post-confirmation actions are offered with the updated labels',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated'] },
    async ({ page }) => {
      // Full guided journey + the streamed post-confirmation turn (up to 3 min on a
      // slow day); same live-journey budget as the channel-deletion dialog suite.
      test.setTimeout(480_000);
      const planningPage = new PlanningPage(page);

      await test.step('Arrange: build a plan to final channel confirmation', async () => {
        await buildToPlanConfirmed(planningPage);
      });

      await test.step('Assert AC-001: "Save plan as draft" and "Discard draft plan" are both offered', async () => {
        await expect(planningPage.saveButton()).toBeEnabled();
        await expect(planningPage.discardButton()).toBeEnabled();
      });
    }
  );

  test(
    'DC-002 discard opens the confirmation question with both hot buttons',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated'] },
    async ({ page }) => {
      test.setTimeout(480_000);
      const planningPage = new PlanningPage(page);

      await test.step('Arrange: build a plan to final channel confirmation and click the discard action', async () => {
        await buildToPlanConfirmed(planningPage);
        await planningPage.openDiscardPrompt();
      });

      await test.step('Assert AC-002: the confirmation question and both hot buttons are shown', async () => {
        await expect(planningPage.discardPrompt()).toContainText(
          'Are you sure you want to discard your draft plan?'
        );
        await expect(planningPage.discardYesButton()).toBeEnabled();
        await expect(planningPage.discardNoButton()).toBeEnabled();
      });
    }
  );

  for (const dataCase of discardChoiceCases) {
    test(
      `${dataCase.caseId} answering "${dataCase.choice}" resolves the draft (${dataCase.expected.result})`,
      { tag: ['@generated', '@regression', '@media-planner', '@authenticated'] },
      async ({ page }) => {
        test.setTimeout(480_000);
        const planningPage = new PlanningPage(page);

        await test.step('Arrange: open the discard confirmation and answer it with the case choice', async () => {
          await buildToPlanConfirmed(planningPage);
          await planningPage.openDiscardPrompt();
          await planningPage.answerDiscardPrompt(dataCase.choice);
        });

        await test.step('Assert AC-003: the draft is resolved according to the documented choice', async () => {
          // Both outcomes arrive as assistant replies, so the chat panel carries the
          // case's documented message ("saved as a draft" vs "has been discarded").
          await expect(planningPage.assistantChatPanel()).toContainText(dataCase.expected.message);
        });
      }
    );
  }

  test(
    'NEG-001 the discard action is absent before final channel confirmation',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated'] },
    async ({ page }) => {
      // Shorter journey (stops at the objective stage) but still several assistant turns.
      test.setTimeout(240_000);
      const planningPage = new PlanningPage(page);

      await test.step('Arrange: build a plan only to the objective stage (no channel yet)', async () => {
        await buildToObjective(planningPage);
      });

      await test.step('Assert NEG-001: "Discard draft plan" is not offered before channels are confirmed', async () => {
        await expect(planningPage.discardButton()).toBeHidden();
      });
    }
  );
});
