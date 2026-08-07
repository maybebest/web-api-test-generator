// Spec-bound header: sha256 is the behavioral hash of the spec (computed via
// scripts/ai/lib/spec-parser.mjs specSha256). Re-stamp with `npm run ai:spec:drift`
// if the spec's behavioral sections change.
/* spec: specs/sains/entry-and-persistence.md version:1.0.0 sha256:7440b5d1680836bbca1f2efef79cd5e8bcb557c0b91d6edc2c61c115cd98b56f */
import { test, expect } from '../../../fixtures/test';
import { getEveryMedia, getMedia, getPlan, getPlanningSession } from '../../../fixtures/nectar-api';
import { EntryAndPersistencePage, type SummarySnapshot } from '../../../pages/EntryAndPersistencePage';
import { PlanningPage } from '../../../pages/PlanningPage';

// FLOW-MP-025 (suite mode): entry, persistence and idempotency of the Nectar AI media
// plan. Catalogue mapping: DC-001=E2E-ACC-004, DC-002=E2E-ACC-006, DC-003=E2E-NFR-016,
// DC-004=E2E-PLN-009, DC-005=E2E-CHN-008, DC-006=E2E-CHN-013, DC-007=E2E-CHN-035,
// DC-008=E2E-CHN-037, DC-009=E2E-NFR-009, NEG-001=E2E-ACC-002.
const journey = {
  advertiser: 'N360_Unilever_MS',
  brand: 'Unilever | Knorr | MS',
  objective: 'Customer retention',
  productSearch: 'knorr',
  resolvedChannelName: 'Meta'
} as const;

// Live-resolvable, brand-available dev channels for the two-channel cases
// (proven by the channel-deletion dialog suite), env-overridable per environment.
const ONSITE_CHANNEL = process.env.E2E_MP_DELETION_ONSITE_CHANNEL ?? 'Homepage Sponsored Product';
const OFFSITE_CHANNEL = process.env.E2E_MP_DELETION_OFFSITE_CHANNEL ?? 'Meta';
// No-floor channel for DC-005: bookingDeadlineDays proven null live (FLOW-MP-005);
// the read-only preflight below additionally requires no shortest-span floor.
const NO_FLOOR_CHANNEL = process.env.E2E_MP_OFFSITE_CHANNEL?.trim() || 'Offsite Display';

// Salient copy under assertion. The saved copy was live-verified 2026-07-03
// (FLOW-MP-020); the booking-deadline fragment was observed live 2026-07-04.
const SAVED_MESSAGE = 'Your plan has been saved as a draft.';
const DEADLINE_REJECTION = 'does not meet the booking deadline';
const FLOOR_REJECTION = 'must be at least';
// Base64-encoded '{"' — the prefix every JWT segment starts with. It must never
// render in visible UI copy.
const JWT_PREFIX = 'eyJ';
// Total budget after the £50000 onsite channel is deleted from the £90,000 pair.
const SURVIVOR_BUDGET = '£40,000';

// Assistant/summary round-trips stream for 30-60s+; poll the slow assertions accordingly.
const POLL = { timeout: 75_000 } as const;
// The save turn itself can stream past a minute on a slow day.
const LONG_POLL = { timeout: 120_000 } as const;

// The campaign window is computed at runtime (start ~45 days out, 30-day duration) so the
// request can never rot into past dates — the assistant rejects past-dated channels outright.
const formatDdMmYyyy = (date: Date): string =>
  `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;

// Advance calendar dates from one midday anchor. Adding fixed 24-hour durations can
// produce the previous/next local date across daylight-saving transitions.
const dateAtOffset = (days: number): Date => {
  const anchor = new Date();
  anchor.setHours(12, 0, 0, 0);
  anchor.setDate(anchor.getDate() + days);
  return anchor;
};

const metaRequest = (): string =>
  `Offsite, ${OFFSITE_CHANNEL}, ${formatDdMmYyyy(dateAtOffset(45))} till ${formatDdMmYyyy(dateAtOffset(75))}, the budget is 7k, Self-Serve`;

const onsiteRequest = (): string =>
  `Onsite, ${ONSITE_CHANNEL}, £50000, ${formatDdMmYyyy(dateAtOffset(45))} - ${formatDdMmYyyy(dateAtOffset(75))}, Self-Serve`;

const offsiteRequest = (): string =>
  `Offsite, ${OFFSITE_CHANNEL}, £40000, ${formatDdMmYyyy(dateAtOffset(45))} - ${formatDdMmYyyy(dateAtOffset(75))}, Self-Serve`;

// DC-005: a deliberately short 3-day span (+45d..+47d) on the preflighted no-floor channel.
const shortRangeRequest = (): string =>
  `${NO_FLOOR_CHANNEL}, the budget is 7k, ${formatDdMmYyyy(dateAtOffset(45))} till ${formatDdMmYyyy(dateAtOffset(47))}`;

// DC-006: a start well inside Meta's live booking-deadline lead time.
const invalidEditRequest = (): string =>
  `Please change the ${OFFSITE_CHANNEL} channel dates to ${formatDdMmYyyy(dateAtOffset(5))} till ${formatDdMmYyyy(dateAtOffset(35))}`;

// ---- API oracle helpers (read-only, fixtures/nectar-api.ts) --------------------------

// The session's plan references as an array: [] until the early draft exists, [planId]
// afterwards — an expect.poll-friendly shape for the "exactly one plan record" contract.
async function sessionPlanIds(sessionId: string): Promise<string[]> {
  const session = await getPlanningSession(sessionId);
  const planId = session?.planId;
  return typeof planId === 'string' && planId.length > 0 ? [planId] : [];
}

// The advertiser/brand identity names carried by the session's early draft plan
// (empty until the draft record exists, so expect.poll can wait for autosave).
async function earlyDraftIdentity(sessionId: string): Promise<string[]> {
  const planIds = await sessionPlanIds(sessionId);
  if (planIds.length === 0) {
    return [];
  }
  const plan = await getPlan(planIds[0]);
  const advertiser: Record<string, unknown> = plan?.advertiser ?? {};
  const brands: Array<Record<string, unknown>> = Array.isArray(plan?.brands) ? plan.brands : [];
  return [advertiser.displayName, advertiser.customName, ...brands.flatMap((brand) => [brand?.displayName, brand?.customName])].filter(
    (name): name is string => typeof name === 'string' && name.length > 0
  );
}

// Single authoritative read used before the double-save: at plan-confirmation time the
// early draft has existed since the advertiser/brand turn, so a missing planId is a
// genuine defect (or a broken oracle), never a timing matter to retry around.
async function requireEarlyDraftPlanId(sessionId: string): Promise<string> {
  const planIds = await sessionPlanIds(sessionId);
  if (planIds.length !== 1) {
    throw new Error(`Expected the confirmed plan session to reference exactly one draft planId, found ${planIds.length}.`);
  }
  return planIds[0];
}

// ---- DC-005 read-only config preflight ------------------------------------------------

type Timeline = { minCampaignDurationDays?: number | null; bookingDeadlineDays?: number | null };
type MediaWithChannels = Record<string, { timeline?: Timeline } | null | undefined>;
const CHANNEL_KEYS = ['onSite', 'offSite', 'atHome', 'inStore'] as const;
let noFloorPreflight: Promise<void> | undefined;

function configuredTimeline(media: MediaWithChannels): Timeline | undefined {
  for (const key of CHANNEL_KEYS) {
    const timeline = media[key]?.timeline;
    if (timeline) {
      return timeline;
    }
  }
  return undefined;
}

// Fails closed unless the DC-005 channel really carries NO shortest-span floor and NO
// booking deadline, so the short-range case can never fake a pass against a configured
// channel (mirrors the booking-deadline suite's read-only preflight pattern).
async function requireNoFloorChannelFixture(): Promise<void> {
  noFloorPreflight ??= (async () => {
    const matches = (await getEveryMedia()).filter((media) => media.name === NO_FLOOR_CHANNEL);
    if (matches.length !== 1) {
      throw new Error(`no-floor preflight: expected exactly one channel named "${NO_FLOOR_CHANNEL}", found ${matches.length}`);
    }
    const timeline = configuredTimeline((await getMedia(matches[0].id)) as MediaWithChannels);
    const floor = timeline?.minCampaignDurationDays;
    if (floor !== null && floor !== undefined) {
      throw new Error(`no-floor preflight: ${NO_FLOOR_CHANNEL}.minCampaignDurationDays expected null, received ${String(floor)}`);
    }
    const deadline = timeline?.bookingDeadlineDays;
    if (deadline !== null && deadline !== undefined) {
      throw new Error(`no-floor preflight: ${NO_FLOOR_CHANNEL}.bookingDeadlineDays expected null, received ${String(deadline)}`);
    }
  })();
  return noFloorPreflight;
}

// ---- Journey builders ------------------------------------------------------------------

// Fresh plan through the live guided flow up to the channel-request stage.
async function buildToChannelStage(planningPage: PlanningPage): Promise<void> {
  await planningPage.goto();
  await planningPage.startNectarAiPlanner();
  await planningPage.chooseBuildByObjectiveAndBudget();
  await planningPage.selectAdvertiser(journey.advertiser);
  await planningPage.selectBrand(journey.brand);
  await planningPage.confirmAdvertiserAndBrand();
  await planningPage.enterObjective(journey.objective);
  await planningPage.searchProducts(journey.productSearch);
  await planningPage.selectFirstProduct();
  await planningPage.confirmProducts();
}

// Continue to final channel confirmation with the live-proven single Meta channel; the
// streamed post-confirmation save CTA is the landing signal (verified live 2026-07-03).
async function buildToPlanConfirmed(planningPage: PlanningPage): Promise<void> {
  await buildToChannelStage(planningPage);
  await planningPage.enterChannelRequest(metaRequest(), journey.resolvedChannelName);
  await planningPage.confirmPlan();
  await planningPage.saveButton().waitFor({ state: 'visible', timeout: 180_000 });
}

// Two-channel plan (onsite + offsite) at the channel stage, for the deletion cases.
async function buildTwoChannelPlan(planningPage: PlanningPage): Promise<void> {
  await buildToChannelStage(planningPage);
  await planningPage.enterChannelRequest(onsiteRequest(), ONSITE_CHANNEL);
  await planningPage.enterChannelRequest(offsiteRequest(), OFFSITE_CHANNEL);
}

// DC-002/DC-003 from specs/sains/entry-and-persistence.md — the two-row restore table:
// the same snapshot-equality oracle covers the mid-journey reload (E2E-ACC-006) and the
// durable-data reconstruction of a saved plan (E2E-NFR-016).
const restoreCases = [
  {
    caseId: 'DC-002',
    mode: 'reload-mid-journey',
    title: 'reloading an in-progress plan restores the summary and position',
    expected: { channelRows: 1, summary: 'equals captured snapshot' }
  },
  {
    caseId: 'DC-003',
    mode: 'save-then-reopen',
    title: 'a saved plan is reconstructed from durable data on reopen',
    expected: { channelRows: 1, summary: 'equals pre-save snapshot' }
  }
] as const;

const emptySnapshot = (): SummarySnapshot => ({
  advertiser: '',
  brands: '',
  objective: '',
  dates: '',
  totalBudget: '',
  heroSkus: '',
  measurementSkus: ''
});

// Spec Stability Requirements declare Parallel Safe = no, so each journey builds a
// fresh live plan and the suite runs serially.
test.describe.serial('Media plan entry, persistence and idempotency via Nectar AI', () => {
  test(
    'DC-001 advertiser and brand confirmation creates the early draft exactly once',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated'] },
    async ({ page }) => {
      // Short pre-product journey, but the autosave + GraphQL oracle still needs headroom.
      test.setTimeout(240_000);
      const planningPage = new PlanningPage(page);
      const entryPage = new EntryAndPersistencePage(page);
      let sessionId = '';

      await test.step('Arrange: confirm advertiser and brand and capture the session id from the URL', async () => {
        await planningPage.goto();
        await planningPage.startNectarAiPlanner();
        await planningPage.chooseBuildByObjectiveAndBudget();
        await planningPage.selectAdvertiser(journey.advertiser);
        await planningPage.selectBrand(journey.brand);
        await planningPage.confirmAdvertiserAndBrand();
        sessionId = await entryPage.capturedSessionId();
      });

      await test.step('Assert AC-001: exactly one early draft exists for the confirmed advertiser and brand', async () => {
        await expect(planningPage.summaryAdvertiser()).toContainText(journey.advertiser, POLL);
        await expect.poll(() => earlyDraftIdentity(sessionId), { timeout: 120_000 }).toContain(journey.advertiser);
        await expect.poll(() => earlyDraftIdentity(sessionId), { timeout: 30_000 }).toContain(journey.brand);
        await expect.poll(() => sessionPlanIds(sessionId), { timeout: 30_000 }).toHaveLength(1);
      });
    }
  );

  for (const dataCase of restoreCases) {
    test(
      `${dataCase.caseId} ${dataCase.title}`,
      { tag: ['@generated', '@regression', '@media-planner', '@authenticated'] },
      async ({ page }) => {
        test.setTimeout(480_000);
        const planningPage = new PlanningPage(page);
        const entryPage = new EntryAndPersistencePage(page);
        let snapshot: SummarySnapshot = emptySnapshot();

        await test.step('Arrange: build a one-channel plan, snapshot the summary, then restore the session', async () => {
          await buildToPlanConfirmed(planningPage);
          const sessionId = await entryPage.capturedSessionId();
          snapshot = await entryPage.captureSummarySnapshot();
          await entryPage.restorePlanState(dataCase.mode, sessionId);
        });

        await test.step('Assert AC-002: the restored summary equals the snapshot without duplication', async () => {
          await expect(planningPage.summaryAdvertiser()).toHaveText(snapshot.advertiser, POLL);
          await expect(planningPage.summaryBrands()).toHaveText(snapshot.brands);
          await expect(planningPage.summaryObjective()).toHaveText(snapshot.objective);
          await expect(planningPage.summaryDates()).toHaveText(snapshot.dates, POLL);
          await expect(planningPage.summaryTotalBudget()).toHaveText(snapshot.totalBudget, POLL);
          await expect(planningPage.heroSkusCount()).toHaveText(snapshot.heroSkus);
          await expect(planningPage.campaignSkusCount()).toHaveText(snapshot.measurementSkus);
          await expect(planningPage.summaryChannel(journey.resolvedChannelName)).toHaveCount(dataCase.expected.channelRows);
          await expect(planningPage.chatInput()).toBeVisible(POLL);
        });
      }
    );
  }

  test(
    'DC-004 a repeated save neither duplicates nor loses the plan state',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated'] },
    async ({ page }) => {
      test.setTimeout(480_000);
      const planningPage = new PlanningPage(page);
      const entryPage = new EntryAndPersistencePage(page);
      let sessionId = '';
      let planIdBefore = '';
      let capturedBudget = '';

      await test.step('Arrange: confirm the plan, capture its draft planId, then double-activate the save action', async () => {
        await buildToPlanConfirmed(planningPage);
        sessionId = await entryPage.capturedSessionId();
        planIdBefore = await requireEarlyDraftPlanId(sessionId);
        capturedBudget = (await planningPage.summaryTotalBudget().textContent()) ?? '';
        await planningPage.saveButton().dblclick();
      });

      await test.step('Assert AC-003: the save is once-effective and the plan state is intact', async () => {
        await expect(planningPage.assistantChatPanel()).toContainText(SAVED_MESSAGE, LONG_POLL);
        await expect.poll(() => sessionPlanIds(sessionId), { timeout: 60_000 }).toEqual([planIdBefore]);
        await expect(planningPage.summaryChannel(journey.resolvedChannelName)).toHaveCount(1);
        await expect(planningPage.summaryTotalBudget()).toHaveText(capturedBudget);
      });
    }
  );

  test(
    'DC-005 a channel with no configured floor accepts a short valid date range',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated'] },
    async ({ page }) => {
      test.setTimeout(480_000);
      const planningPage = new PlanningPage(page);

      await test.step('Arrange: preflight the no-floor channel config and request a 3-day range', async () => {
        await requireNoFloorChannelFixture();
        await buildToChannelStage(planningPage);
        await planningPage.enterChannelRequest(shortRangeRequest(), NO_FLOOR_CHANNEL);
      });

      await test.step('Assert AC-004: the channel is added and no floor rejection is fabricated', async () => {
        await expect(planningPage.summaryChannel(NO_FLOOR_CHANNEL)).toBeVisible(POLL);
        await expect(planningPage.assistantText(FLOOR_REJECTION)).toHaveCount(0);
      });
    }
  );

  test(
    'DC-006 saved-plan date edits are revalidated against current channel rules',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated'] },
    async ({ page }) => {
      test.setTimeout(480_000);
      const planningPage = new PlanningPage(page);
      let capturedDates = '';

      await test.step('Arrange: save the plan, then request a date change inside the booking-deadline lead time', async () => {
        await buildToPlanConfirmed(planningPage);
        await planningPage.savePlan();
        capturedDates = (await planningPage.summaryDates().textContent()) ?? '';
        await planningPage.sendChatMessage(invalidEditRequest());
        await planningPage.waitForAssistantIdle();
      });

      await test.step('Assert AC-005: the invalid edit is rejected and the timeline stays unchanged', async () => {
        await expect(planningPage.assistantChatPanel()).toContainText(DEADLINE_REJECTION, LONG_POLL);
        await expect(planningPage.summaryDates()).toHaveText(capturedDates);
      });
    }
  );

  test(
    'DC-007 a deleted channel stays removed after saving and reopening the session',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated'] },
    async ({ page }) => {
      test.setTimeout(480_000);
      const planningPage = new PlanningPage(page);
      const entryPage = new EntryAndPersistencePage(page);

      await test.step('Arrange: delete one of two channels, confirm and save the plan, then reopen its session', async () => {
        await buildTwoChannelPlan(planningPage);
        await planningPage.deleteChannel(ONSITE_CHANNEL);
        await planningPage.summaryChannel(ONSITE_CHANNEL).waitFor({ state: 'hidden', timeout: 120_000 });
        await planningPage.confirmPlan();
        await planningPage.saveButton().waitFor({ state: 'visible', timeout: 180_000 });
        await planningPage.savePlan();
        const sessionId = await entryPage.capturedSessionId();
        await planningPage.gotoSession(sessionId);
      });

      await test.step('Assert AC-006: the deletion is durable and totals equal the survivor', async () => {
        await expect(planningPage.summaryChannel(OFFSITE_CHANNEL)).toBeVisible(POLL);
        await expect(planningPage.summaryChannel(ONSITE_CHANNEL)).toHaveCount(0);
        await expect(planningPage.summaryTotalBudget()).toContainText(SURVIVOR_BUDGET, POLL);
      });
    }
  );

  test(
    'DC-008 a double-activated delete confirmation removes exactly one channel',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated'] },
    async ({ page }) => {
      test.setTimeout(480_000);
      const planningPage = new PlanningPage(page);

      await test.step('Arrange: build a two-channel plan and double-activate the delete confirmation', async () => {
        await buildTwoChannelPlan(planningPage);
        await planningPage.openDeleteChannelDialog(ONSITE_CHANNEL);
        await planningPage.modalDeleteConfirmButton().dblclick();
      });

      await test.step('Assert AC-007: exactly one channel is removed and the survivor total is intact', async () => {
        await expect(planningPage.deleteChannelDialog()).toBeHidden(POLL);
        await expect(planningPage.summaryChannel(OFFSITE_CHANNEL)).toBeVisible(POLL);
        await expect(planningPage.summaryChannel(ONSITE_CHANNEL)).toHaveCount(0, POLL);
        await expect(planningPage.summaryTotalBudget()).toContainText(SURVIVOR_BUDGET, POLL);
      });
    }
  );

  test(
    'DC-009 auth token material never renders in the visible UI copy after the save journey',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated'] },
    async ({ page }) => {
      test.setTimeout(480_000);
      const planningPage = new PlanningPage(page);

      await test.step('Arrange: run the confirmed-plan save journey', async () => {
        await buildToPlanConfirmed(planningPage);
        await planningPage.savePlan();
      });

      await test.step('Assert AC-008: neither the conversation nor the summary exposes JWT material', async () => {
        await expect(planningPage.assistantChatPanel()).toContainText(SAVED_MESSAGE, POLL);
        await expect(planningPage.assistantChatPanel()).not.toContainText(JWT_PREFIX);
        await expect(planningPage.summaryPanel()).not.toContainText(JWT_PREFIX);
      });
    }
  );

  test.describe('unauthenticated entry', () => {
    // The chromium-auth project binds the authenticated storage state; this block
    // overrides it with an EMPTY in-memory state (never a file-path literal, so the
    // project routing stays intact) to drive the one unauthenticated case without
    // any Playwright config changes.
    test.use({ storageState: { cookies: [], origins: [] } });

    test(
      'NEG-001 an unauthenticated context is rejected from /planning without plan data',
      { tag: ['@generated', '@regression', '@media-planner', '@authenticated'] },
      async ({ page }) => {
        test.setTimeout(240_000);
        const planningPage = new PlanningPage(page);
        const entryPage = new EntryAndPersistencePage(page);

        await test.step('Arrange NEG-001: open the protected planning route with no stored authentication', async () => {
          await entryPage.gotoPlanningUnauthenticated();
        });

        await test.step('Assert NEG-001: the sign-in experience renders and no plan data is shown', async () => {
          await expect(entryPage.signInAffordance()).toBeVisible({ timeout: 90_000 });
          await expect(planningPage.startAssistantButton()).toHaveCount(0);
          await expect(planningPage.summaryPanel()).toHaveCount(0);
        });
      }
    );
  });
});
