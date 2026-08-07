// Spec-bound header: sha256 is the behavioral hash of the spec (computed via
// scripts/ai/lib/spec-parser.mjs specSha256). Re-stamp with `npm run ai:spec:drift`
// if the spec's behavioral sections change.
/* spec: specs/special-preconditions/media-planner-booking-deadline.md version:1.1.0 sha256:0fd60a4fc613e35bc8841658498c22e932a7e3761af6c4156d81ffa9273000d5 */
import { test, expect } from '../../fixtures/test';
import { getEveryMedia, getMedia } from '../../fixtures/nectar-api';
import { PlanningPage } from '../../pages/PlanningPage';

// Spec FLOW-MP-005 (suite mode): one focused test per acceptance criterion plus a
// dedicated test per negative case. The guided-setup data uses the spec contract
// values; the advertiser/brand/SKU selection and the channel-add behaviour are
// INFERRED past the read-only DOM recon boundary and must be confirmed against the
// live app before the execution gate is run.
const plan = {
  advertiser: 'N360_Unilever_MS',
  brand: 'Unilever | Knorr | MS',
  objective: 'Customer retention',
  // Search term for the measurement/hero SKU step. A product NAME is used (not a bare
  // SKU) so the live search reliably returns rows for this advertiser/brand.
  productSearch: 'knorr'
} as const;

const ONSITE = process.env.E2E_MP_ONSITE_CHANNEL?.trim() || 'Onsite Display';
const OFFSITE = process.env.E2E_MP_OFFSITE_CHANNEL?.trim() || 'Offsite Display';

function parseDeadline(raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error('E2E_MP_ONSITE_DISPLAY_BOOKING_DEADLINE_DAYS must be an integer greater than or equal to 1');
  }
  return value;
}

const DEADLINE_DAYS = parseDeadline(
  process.env.E2E_MP_ONSITE_DISPLAY_BOOKING_DEADLINE_DAYS?.trim() || '2'
);

type Timeline = { bookingDeadlineDays?: number | null };
type MediaWithChannels = Record<string, { timeline?: Timeline } | null | undefined>;
const CHANNEL_KEYS = ['onSite', 'offSite', 'atHome', 'inStore'] as const;
let bookingFixturePreflight: Promise<void> | undefined;

function configuredBookingDeadline(media: MediaWithChannels): number | null | undefined {
  for (const key of CHANNEL_KEYS) {
    const timeline = media[key]?.timeline;
    if (timeline && Object.hasOwn(timeline, 'bookingDeadlineDays')) {
      return timeline.bookingDeadlineDays;
    }
  }
  return undefined;
}

async function readExactMedia(name: string): Promise<MediaWithChannels> {
  const matches = (await getEveryMedia()).filter((media) => media.name === name);
  if (matches.length !== 1) {
    throw new Error(`booking-deadline preflight: expected exactly one channel named "${name}", found ${matches.length}`);
  }
  return (await getMedia(matches[0].id)) as MediaWithChannels;
}

async function requireBookingFixture(): Promise<void> {
  bookingFixturePreflight ??= (async () => {
    const onsite = configuredBookingDeadline(await readExactMedia(ONSITE));
    const offsite = configuredBookingDeadline(await readExactMedia(OFFSITE));
    if (onsite !== DEADLINE_DAYS) {
      throw new Error(
        `booking-deadline preflight: ${ONSITE}.bookingDeadlineDays expected ${DEADLINE_DAYS}, received ${String(onsite)}`
      );
    }
    if (offsite !== null) {
      throw new Error(
        `booking-deadline preflight: ${OFFSITE}.bookingDeadlineDays expected null, received ${String(offsite)}`
      );
    }
  })();
  return bookingFixturePreflight;
}

// Dates are derived from relative offsets to the current date (never hardcoded),
// per the spec. End date is always start + 30 days so the separate
// minimum-campaign-duration rule cannot mask booking-deadline validation.
function offsetDate(anchor: Date, days: number): string {
  const date = new Date(anchor);
  date.setDate(date.getDate() + days);
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${date.getFullYear()}`;
}

function channelRequest(channelName: string, anchor: Date, startOffsetDays: number): string {
  return `${channelName}, ${offsetDate(anchor, startOffsetDays)} till ${offsetDate(anchor, startOffsetDays + 30)}, the budget is 7k`;
}

function calendarKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function buildPlanToChannelStage(planningPage: PlanningPage): Promise<void> {
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
}

// Stability Requirements declare Parallel Safe = no, so the suite runs serially.
test.describe.serial(
  'Media Planner booking deadline validation',
  { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@special-preconditions'] },
  () => {
    test('AC-001 planning page exposes the Nectar AI Assistant entry point', async ({ page }) => {
      const planningPage = new PlanningPage(page);

      await test.step('Open the planning page', async () => {
        await planningPage.goto();
      });

      await test.step('Assert AC-001: the Nectar AI Assistant entry point is visible', async () => {
        await expect(planningPage.nectarAssistantHeading()).toBeVisible();
        await expect(planningPage.startAssistantButton()).toBeVisible();
      });
    });

    test('AC-002 the objective and budget guided flow can be started', async ({ page }) => {
      const planningPage = new PlanningPage(page);

      await test.step('Open the Nectar AI assistant', async () => {
        await planningPage.goto();
        await planningPage.startNectarAiPlanner();
      });

      await test.step('Assert AC-002: the objective & budget flow choice is available', async () => {
        await expect(planningPage.buildByObjectiveButton()).toBeVisible();
      });
    });

    test('DC-006 AC-003 plan setup prompts for a channel, budget and timeline', async ({ page }) => {
      const planningPage = new PlanningPage(page);

      await test.step('Complete the guided plan setup (advertiser, brand, objective, SKU)', async () => {
        await buildPlanToChannelStage(planningPage);
      });

      await test.step('Assert AC-003: the assistant requests a channel, a budget and a timeline', async () => {
        await expect(planningPage.assistantChatPanel()).toContainText('channel');
        await expect(planningPage.assistantChatPanel()).toContainText('budget');
        await expect(planningPage.assistantChatPanel()).toContainText('timeline');
      });
    });

    test('DC-001 AC-004 Onsite Display below deadline is blocked with at least the configured days from today', async ({ page }) => {
      const planningPage = new PlanningPage(page);
      const calendarAnchor = new Date();

      await test.step('Set up the plan and send Onsite Display one day below the earliest allowed start', async () => {
        await requireBookingFixture();
        await buildPlanToChannelStage(planningPage);
        await planningPage.enterChannelRequest(channelRequest(ONSITE, calendarAnchor, DEADLINE_DAYS - 1));
      });

      await test.step('Assert AC-004: rejection says at least the configured days from today', async () => {
        await expect(planningPage.assistantChatPanel()).toContainText(
          new RegExp(`${escapeRegExp(ONSITE)}.*at least\\s+${DEADLINE_DAYS}\\s+days from today`, 'is')
        );
        await expect(planningPage.summaryChannel(ONSITE)).toHaveCount(0);
        await expect.poll(() => calendarKey(new Date())).toBe(calendarKey(calendarAnchor));
      });
    });

    // DC-002 (at-minimum) and DC-003 (above-minimum) are enumerated by looping
    // over the case rows, per the data-driven contract for multi-case specs.
    for (const dataCase of [
      { caseId: 'DC-002', startOffsetDays: DEADLINE_DAYS },
      { caseId: 'DC-003', startOffsetDays: DEADLINE_DAYS + 1 }
    ]) {
      test(`${dataCase.caseId} AC-005 Onsite Display at or above the earliest allowed start is allowed`, async ({ page }) => {
        const planningPage = new PlanningPage(page);
        const calendarAnchor = new Date();

        await test.step('Set up the plan and send the Onsite Display channel', async () => {
          await requireBookingFixture();
          await buildPlanToChannelStage(planningPage);
          await planningPage.enterChannelRequest(channelRequest(ONSITE, calendarAnchor, dataCase.startOffsetDays));
        });

        await test.step('Assert AC-005: Onsite Display is added to the summary channel list', async () => {
          await expect(planningPage.summaryChannel(ONSITE)).toBeVisible();
          await expect(planningPage.assistantText(new RegExp(`at least\\s+${DEADLINE_DAYS}\\s+days from today`, 'i'))).toHaveCount(0);
          await expect.poll(() => calendarKey(new Date())).toBe(calendarKey(calendarAnchor));
        });
      });
    }

    test('DC-004 AC-006 a no-deadline Offsite Display channel accepts a today start', async ({ page }) => {
      const planningPage = new PlanningPage(page);
      const calendarAnchor = new Date();

      await test.step('Set up the plan and send Offsite Display with a today start', async () => {
        await requireBookingFixture();
        await buildPlanToChannelStage(planningPage);
        await planningPage.enterChannelRequest(channelRequest(OFFSITE, calendarAnchor, 0));
      });

      await test.step('Assert AC-006: Offsite Display is added despite the early start', async () => {
        await expect(planningPage.summaryChannel(OFFSITE)).toBeVisible();
        await expect(planningPage.assistantText(/booking deadline/i)).toHaveCount(0);
        await expect.poll(() => calendarKey(new Date())).toBe(calendarKey(calendarAnchor));
      });
    });

    test('DC-005 AC-007 booking-deadline enforcement is per channel in a mixed batch', async ({ page }) => {
      const planningPage = new PlanningPage(page);
      const calendarAnchor = new Date();

      await test.step('Set up the plan and send a mixed batch (violating Onsite + compliant Offsite)', async () => {
        await requireBookingFixture();
        await buildPlanToChannelStage(planningPage);
        await planningPage.enterChannelRequest(
          `${channelRequest(ONSITE, calendarAnchor, DEADLINE_DAYS - 1)}; ${channelRequest(OFFSITE, calendarAnchor, DEADLINE_DAYS + 3)}`
        );
      });

      await test.step('Assert AC-007: only Offsite Display is added while Onsite Display is rejected', async () => {
        await expect(planningPage.summaryChannel(OFFSITE)).toBeVisible();
        await expect(planningPage.summaryChannel(ONSITE)).toHaveCount(0);
        await expect(planningPage.assistantChatPanel()).toContainText(ONSITE);
        await expect.poll(() => calendarKey(new Date())).toBe(calendarKey(calendarAnchor));
      });
    });

    test('DC-001 NEG-001 below-deadline Onsite Display is blocked with a named error', async ({ page }) => {
      const planningPage = new PlanningPage(page);
      const calendarAnchor = new Date();

      await test.step('Arrange NEG-001: send Onsite Display one day below the earliest allowed start', async () => {
        await requireBookingFixture();
        await buildPlanToChannelStage(planningPage);
        await planningPage.enterChannelRequest(channelRequest(ONSITE, calendarAnchor, DEADLINE_DAYS - 1));
      });

      await test.step('Assert NEG-001: Onsite Display is rejected naming the channel and lead time', async () => {
        await expect(planningPage.assistantChatPanel()).toContainText(
          new RegExp(`${escapeRegExp(ONSITE)}.*at least\\s+${DEADLINE_DAYS}\\s+days from today`, 'is')
        );
        await expect(planningPage.summaryChannel(ONSITE)).toHaveCount(0);
        await expect.poll(() => calendarKey(new Date())).toBe(calendarKey(calendarAnchor));
      });
    });

    test('DC-005 NEG-002 the violating channel is absent from the summary while the compliant channel is added', async ({ page }) => {
      const planningPage = new PlanningPage(page);
      const calendarAnchor = new Date();

      await test.step('Arrange NEG-002: send a mixed batch (violating Onsite + compliant Offsite)', async () => {
        await requireBookingFixture();
        await buildPlanToChannelStage(planningPage);
        await planningPage.enterChannelRequest(
          `${channelRequest(ONSITE, calendarAnchor, DEADLINE_DAYS - 1)}; ${channelRequest(OFFSITE, calendarAnchor, DEADLINE_DAYS + 3)}`
        );
      });

      await test.step('Assert NEG-002: Offsite Display is in the summary and Onsite Display is not', async () => {
        await expect(planningPage.summaryChannel(OFFSITE)).toBeVisible();
        await expect(planningPage.summaryChannel(ONSITE)).toHaveCount(0);
        await expect.poll(() => calendarKey(new Date())).toBe(calendarKey(calendarAnchor));
      });
    });
  }
);
