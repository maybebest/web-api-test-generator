// Spec-bound header: sha256 is the behavioral hash of the spec.
/* spec: specs/special-preconditions/media-planner-minimum-campaign-duration.md version:1.3.0 sha256:b7e5ab5e09ec651c92293046b8fff7f2d44b5e175f4f72808918aa5836da1309 */
import { test, expect } from '../../fixtures/test';
import { PlanningPage } from '../../pages/PlanningPage';
import { mediaPlannerData } from '../../data/media-planner';
import { getEveryMedia, getMedia } from '../../fixtures/nectar-api';

const CHANNEL = 'DD Competition page';
const MINIMUM_ERROR_COPY = 'must be at least';
const DAYS_COPY = 'days';
const START_OFFSET = 75;

export function parseMinimumDuration(raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 2) {
    throw new Error('E2E_MP_DD_COMPETITION_PAGE_MIN_DURATION_DAYS must be an integer greater than or equal to 2');
  }
  return value;
}

const MIN_DURATION = parseMinimumDuration(
  process.env.E2E_MP_DD_COMPETITION_PAGE_MIN_DURATION_DAYS?.trim() ?? '21'
);

type Timeline = { minCampaignDurationDays?: number | null; bookingDeadlineDays?: number | null };
type MediaWithChannels = Record<string, { timeline?: Timeline } | null | undefined>;
const CHANNEL_KEYS = ['onSite', 'offSite', 'atHome', 'inStore'] as const;
let minimumFixturePreflight: Promise<void> | undefined;

function configuredTimeline(media: MediaWithChannels): Timeline | undefined {
  for (const key of CHANNEL_KEYS) {
    if (media[key]?.timeline) return media[key]?.timeline;
  }
  return undefined;
}

async function requireMinimumDurationFixture(): Promise<void> {
  minimumFixturePreflight ??= (async () => {
    const matches = (await getEveryMedia()).filter((media) => media.name === CHANNEL);
    if (matches.length !== 1) {
      throw new Error(`minimum-duration preflight: expected exactly one channel named "${CHANNEL}", found ${matches.length}`);
    }
    const timeline = configuredTimeline((await getMedia(matches[0].id)) as MediaWithChannels);
    if (timeline?.minCampaignDurationDays !== MIN_DURATION) {
      throw new Error(
        `minimum-duration preflight: ${CHANNEL}.minCampaignDurationDays expected ${MIN_DURATION}, received ${String(timeline?.minCampaignDurationDays)}`
      );
    }
    const bookingDeadlineDays = timeline?.bookingDeadlineDays;
    if (
      typeof bookingDeadlineDays === 'number' &&
      (!Number.isInteger(bookingDeadlineDays) || bookingDeadlineDays > START_OFFSET)
    ) {
      throw new Error(
        `minimum-duration preflight: ${CHANNEL}.bookingDeadlineDays must be an integer <= ${START_OFFSET}, received ${String(bookingDeadlineDays)}`
      );
    }
  })();
  return minimumFixturePreflight;
}

function dateFromAnchor(anchor: Date, offsetDays: number): string {
  const date = new Date(anchor);
  date.setDate(date.getDate() + offsetDays);
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}

function channelLine(anchor: Date, durationDays: number): string {
  const endOffset = START_OFFSET + durationDays - 1;
  return `${CHANNEL}, the budget is 7k, ${dateFromAnchor(anchor, START_OFFSET)} till ${dateFromAnchor(anchor, endOffset)}`;
}

function calendarKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

async function setupPlan(planningPage: PlanningPage): Promise<void> {
  await planningPage.goto();
  await planningPage.startNectarAiPlanner();
  await planningPage.chooseBuildByObjectiveAndBudget();
  await planningPage.selectAdvertiser(mediaPlannerData.advertiser);
  await planningPage.selectBrand(mediaPlannerData.brand);
  await planningPage.confirmAdvertiserAndBrand();
  await planningPage.enterObjective(mediaPlannerData.objective);
  await planningPage.searchProducts(mediaPlannerData.productSearch);
  await planningPage.selectFirstProduct();
  await planningPage.confirmProducts();
}

async function sendChannel(planningPage: PlanningPage, line: string): Promise<void> {
  await planningPage.enterChannelRequest(line);
  await planningPage.waitForAssistantIdle();
}

function invalidMinimumMessage(raw: string): string {
  try {
    parseMinimumDuration(raw);
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const belowCases = [{ caseId: 'DC-001', durationDays: MIN_DURATION - 1 }] as const;
const allowedCases = [
  { caseId: 'DC-002', durationDays: MIN_DURATION },
  { caseId: 'DC-003', durationDays: MIN_DURATION + 1 }
] as const;

test.describe.serial(
  'Media Planner minimum campaign duration validation',
  { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@special-preconditions'] },
  () => {
    for (const dataCase of belowCases) {
      test(`${dataCase.caseId} AC-001 below-minimum duration is rejected in a fresh plan`, async ({ page }) => {
        const planningPage = new PlanningPage(page);
        const calendarAnchor = new Date();

        await test.step('Create a fresh plan and send only the below-minimum request', async () => {
          await requireMinimumDurationFixture();
          await setupPlan(planningPage);
          await sendChannel(planningPage, channelLine(calendarAnchor, dataCase.durationDays));
        });

        await test.step('Assert AC-001: below-minimum is blocked by one contiguous configured-duration error', async () => {
          const errorPattern = new RegExp(
            `${CHANNEL}.*${MINIMUM_ERROR_COPY}\\s+${MIN_DURATION}\\s+${DAYS_COPY}`,
            'is'
          );
          await expect(planningPage.assistantChatPanel()).toContainText(errorPattern);
          await expect(planningPage.summaryChannel(CHANNEL)).toHaveCount(0);
          await expect.poll(() => calendarKey(new Date())).toBe(calendarKey(calendarAnchor));
        });
      });
    }

    for (const dataCase of allowedCases) {
      test(`${dataCase.caseId} AC-002 at-or-above-minimum duration is accepted in a fresh plan`, async ({ page }) => {
        const planningPage = new PlanningPage(page);
        const calendarAnchor = new Date();

        await test.step('Create a fresh plan and send only this accepted boundary request', async () => {
          await requireMinimumDurationFixture();
          await setupPlan(planningPage);
          await sendChannel(planningPage, channelLine(calendarAnchor, dataCase.durationDays));
        });

        await test.step('Assert AC-002: the accepted boundary has no duration rejection and the channel is present', async () => {
          await expect(planningPage.assistantChatPanel()).not.toContainText(/must be at least/i);
          await expect(planningPage.summaryChannel(CHANNEL)).toBeVisible();
          await expect.poll(() => calendarKey(new Date())).toBe(calendarKey(calendarAnchor));
        });
      });
    }

    test('NEG-001 invalid configured minimum fails before a live plan is created', async () => {
      await test.step('Evaluate an unsafe minimum that would make the below-boundary duration non-positive', async () => {
        void invalidMinimumMessage('1');
      });

      await test.step('Assert NEG-001: unsafe minimum configuration is rejected deterministically', async () => {
        await expect.poll(() => invalidMinimumMessage('1')).toContain('greater than or equal to 2');
      });
    });
  }
);
