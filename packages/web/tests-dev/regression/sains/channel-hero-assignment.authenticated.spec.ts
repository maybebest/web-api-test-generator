// Spec-bound header: sha256 is the behavioral hash of the spec (computed via
// scripts/ai/lib/spec-parser.mjs specSha256). Re-stamp with `npm run ai:spec:drift`
// if the spec's behavioral sections change.
/* spec: specs/sains/channel-hero-assignment.md version:1.0.0 sha256:16a8d288dbb741edb5942ab580932dc4c264915d75e664b68907c383a887da62 */
import { test, expect } from '../../../fixtures/test';
import { getSkusBySkuId } from '../../../fixtures/nectar-api';
import { buildToObjective } from '../../../pages/NectarFlow';
import { ChannelHeroAssignmentComponent } from '../../../pages/ChannelHeroAssignmentComponent';
import { PlanningPage } from '../../../pages/PlanningPage';

// Real brand SKU numbers, live-verified read-only against the dev planning API on
// 2026-07-11 (planning_getSkusBySkuId): 2023755 "Knorr 8 Vegetable Stock Cubes 80g",
// 2023779 "Knorr 8 Beef Stock Cubes 80g", 2023786 "Knorr 8 Chicken Stock Cubes 80g".
// The journeys confirm heroA+heroB as the global Heroes, so followUp stays a
// brand-linked NON-measurement SKU (the A-N1 role of the catalogue cases).
const knorr = {
  heroA: 2023755,
  heroB: 2023779,
  followUp: 2023786
} as const;

// Foreign-brand probe: a Persil-pool SKU (specs/skus/.sku-pools.json, live-probed)
// that must never surface in a Knorr-brand channel Hero modal.
const persilForeignSku = 7096764;

// A search term matching several Knorr stock-cube products, so one search maps both
// global-hero SKU numbers ("<product name> - <SKU>" checkbox rows) in a single turn.
const multiProductSearch = 'Knorr 8';

const channelNames = {
  offsite: 'Meta',
  onsite: 'Homepage Sponsored Product',
  onsiteDemo: 'SmartShop Handset Home Page (DEMO)'
} as const;

// The chat request phrasing omits the catalogue's ' (DEMO)' suffix (proven by the
// channel-deletion-recompute suite for the same channel).
const onsiteDemoRequestName = channelNames.onsiteDemo.replace(/\s*\(DEMO\)\s*$/, '');

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

// Offsite request phrasing proven live for Meta (FLOW-MP-020/022/023).
const metaRequest = (): string => {
  const { start, end } = campaignWindow();
  return `Offsite, Meta, ${formatDdMmYyyy(start)} till ${formatDdMmYyyy(end)}, the budget is 7k, Self-Serve`;
};

// Explicit per-channel SKU clause (documented syntax from the per-channel definition
// stories: a trailing "skus <id>" fragment). INFERRED phrasing on this proven request
// — heal the clause wording on the first live run if the parser wants another shape.
const metaRequestWithSoleHero = (): string => `${metaRequest()}, skus ${knorr.heroA}`;

// Onsite request phrasing proven live by the channel-deletion-recompute suite.
const onsiteDates = (): string => {
  const { start, end } = campaignWindow();
  return `${formatDdMmYyyy(start)} - ${formatDdMmYyyy(end)}`;
};

const onsiteRequest = (): string =>
  `Onsite, ${channelNames.onsite}, £7000, ${onsiteDates()}, Self-Serve`;

const onsiteRequestWithSoleHero = (): string => `${onsiteRequest()}, skus ${knorr.heroA}`;

// One batch message defining three channels with mixed clauses (E2E-CHS-003 shape:
// explicit on the first and third, defaulted on the second).
const batchThreeChannelRequest = (): string =>
  `${metaRequest()}, skus ${knorr.heroA}; ` +
  `Onsite, ${channelNames.onsite}, £7000, ${onsiteDates()}, Self-Serve; ` +
  `Onsite, ${onsiteDemoRequestName}, £7000, ${onsiteDates()}, Self-Serve, skus ${knorr.heroB}`;

type ChannelSetup = {
  readonly request: () => string;
  readonly resolvedName: string;
};

const metaChannel: ChannelSetup = { request: metaRequest, resolvedName: channelNames.offsite };
const metaSoleHeroChannel: ChannelSetup = { request: metaRequestWithSoleHero, resolvedName: channelNames.offsite };
const onsiteChannel: ChannelSetup = { request: onsiteRequest, resolvedName: channelNames.onsite };
const onsiteSoleHeroChannel: ChannelSetup = { request: onsiteRequestWithSoleHero, resolvedName: channelNames.onsite };

// Live DOM contract (observed 2026-07-03): the summary counter rows concatenate their
// children WITHOUT whitespace, so a digit lookbehind keeps "12 SKUs" from satisfying
// "2 SKUs"; never assert the counters with an exact-text match.
const countPattern = (count: number): RegExp => new RegExp(`(?<!\\d)${count} SKUs?`);

// Resolve catalogue product names at runtime through the existing fixture read
// (planning_getSkusBySkuId) so modal candidate searches use the real, current names
// and the suite fails loudly — instead of passing vacuously — if the pool drifts.
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

// Drive the guided flow to a confirmed global SKU stage: measurements {heroA, heroB},
// both promoted to Hero — so the campaign counters read 2 and 2 and followUp stays a
// brand-linked non-measurement SKU.
const buildToHeroesConfirmed = async (
  planningPage: PlanningPage,
  channelComponent: ChannelHeroAssignmentComponent
): Promise<void> => {
  await buildToObjective(planningPage);
  await planningPage.searchProducts(multiProductSearch);
  await channelComponent.measurementOptionBySku(String(knorr.heroA)).check();
  await channelComponent.measurementOptionBySku(String(knorr.heroB)).check();
  await planningPage.confirmMeasurementSkus();
  await channelComponent.heroPromoteControlFor(String(knorr.heroA)).click();
  await channelComponent.heroPromoteControlFor(String(knorr.heroB)).click();
  await planningPage.confirmHeroSkus();
};

const addChannels = async (planningPage: PlanningPage, channels: readonly ChannelSetup[]): Promise<void> => {
  for (const channel of channels) {
    await planningPage.enterChannelRequest(channel.request(), channel.resolvedName);
  }
};

// DC-001/DC-002/DC-003 rows (E2E-CHS-001/-002/-004): one journey shape — add the case
// channels via chat, open the case channel's Hero modal, and read the assignment the
// documented defaulting/override rule produced.
const assignmentCases = [
  {
    caseId: 'DC-001',
    catalogueId: 'E2E-CHS-001',
    channels: [metaChannel],
    openModalFor: channelNames.offsite,
    expected: { modalSkus: [knorr.heroA, knorr.heroB], modalRowCount: 2, campaignHeroCount: 2 }
  },
  {
    caseId: 'DC-002',
    catalogueId: 'E2E-CHS-002',
    channels: [metaSoleHeroChannel],
    openModalFor: channelNames.offsite,
    expected: { modalSkus: [knorr.heroA], modalRowCount: 1, campaignHeroCount: 2 }
  },
  {
    caseId: 'DC-003',
    catalogueId: 'E2E-CHS-004',
    channels: [metaChannel, onsiteChannel],
    openModalFor: channelNames.onsite,
    expected: { modalSkus: [knorr.heroA, knorr.heroB], modalRowCount: 2, campaignHeroCount: 2 }
  }
] as const;

// DC-008..DC-011 rows (E2E-CHS-008..-011): one journey shape — per-channel Hero add
// and remove operations on the followUp SKU, then read the campaign counters and the
// per-channel modal membership the documented set semantics produced.
const setOperationCases = [
  {
    caseId: 'DC-008',
    catalogueId: 'E2E-CHS-008',
    channels: [metaChannel],
    addHeroTo: [channelNames.offsite],
    removeHeroFrom: [],
    expected: {
      campaignHeroCount: 3,
      measurementCount: 3,
      channelsListing: [channelNames.offsite],
      channelsNotListing: []
    }
  },
  {
    caseId: 'DC-009',
    catalogueId: 'E2E-CHS-009',
    channels: [metaChannel, onsiteChannel],
    addHeroTo: [channelNames.offsite, channelNames.onsite],
    removeHeroFrom: [],
    expected: {
      campaignHeroCount: 3,
      measurementCount: 3,
      channelsListing: [channelNames.offsite, channelNames.onsite],
      channelsNotListing: []
    }
  },
  {
    caseId: 'DC-010',
    catalogueId: 'E2E-CHS-010',
    channels: [metaChannel, onsiteChannel],
    addHeroTo: [channelNames.offsite, channelNames.onsite],
    removeHeroFrom: [channelNames.offsite],
    expected: {
      campaignHeroCount: 3,
      measurementCount: 3,
      channelsListing: [channelNames.onsite],
      channelsNotListing: [channelNames.offsite]
    }
  },
  {
    caseId: 'DC-011',
    catalogueId: 'E2E-CHS-011',
    channels: [metaChannel],
    addHeroTo: [channelNames.offsite],
    removeHeroFrom: [channelNames.offsite],
    expected: {
      campaignHeroCount: 2,
      measurementCount: 3,
      channelsListing: [],
      channelsNotListing: [channelNames.offsite]
    }
  }
] as const;

// Spec Stability Requirements declare Parallel Safe = no: every case builds a fresh
// live plan through the guided chat journey, so the suite runs serially.
test.describe.serial('Per-channel Hero SKU assignment via chat and channel modal', () => {
  for (const dataCase of assignmentCases) {
    test(
      `${dataCase.caseId} (${dataCase.catalogueId}) the channel Hero modal reflects the documented assignment rule`,
      { tag: ['@generated', '@regression', '@media-planner', '@authenticated'] },
      async ({ page }) => {
        // Full guided journey plus one or two channel adds on a slow dev environment.
        test.setTimeout(480_000);
        const planningPage = new PlanningPage(page);
        const channelComponent = new ChannelHeroAssignmentComponent(page);

        await test.step('Arrange: confirm two global Heroes, add the case channels via chat, open the case modal', async () => {
          await buildToHeroesConfirmed(planningPage, channelComponent);
          await addChannels(planningPage, dataCase.channels);
          await channelComponent.openChannelHeroModal(dataCase.openModalFor);
        });

        await test.step('Assert AC-001: the modal holds the documented per-case set and the campaign counter is unchanged', async () => {
          await expect(channelComponent.modalSelectedRows()).toHaveCount(dataCase.expected.modalRowCount);
          for (const sku of dataCase.expected.modalSkus) {
            await expect(planningPage.modalSkuRow(String(sku))).toHaveCount(1);
          }
          await channelComponent.cancelOpenModal();
          await expect(planningPage.summaryHeroCount()).toContainText(
            countPattern(dataCase.expected.campaignHeroCount)
          );
        });
      }
    );
  }

  test(
    'DC-004 (E2E-CHS-003) three channels in one batch message keep independent explicit and defaulted sets',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated'] },
    async ({ page }) => {
      // Three sequential channel resolvers from one message — the longest arrange.
      test.setTimeout(480_000);
      const planningPage = new PlanningPage(page);
      const channelComponent = new ChannelHeroAssignmentComponent(page);

      await test.step('Arrange: confirm two global Heroes and define three channels in one batch message', async () => {
        await buildToHeroesConfirmed(planningPage, channelComponent);
        await channelComponent.addChannelsInOneRequest(batchThreeChannelRequest(), [
          channelNames.offsite,
          channelNames.onsite,
          channelNames.onsiteDemo
        ]);
      });

      await test.step('Assert AC-002: each channel modal holds its own set and assignments do not bleed', async () => {
        await channelComponent.openChannelHeroModal(channelNames.offsite);
        await expect(channelComponent.modalSelectedRows()).toHaveCount(1);
        await expect(planningPage.modalSkuRow(String(knorr.heroA))).toHaveCount(1);
        await channelComponent.cancelOpenModal();
        await channelComponent.openChannelHeroModal(channelNames.onsite);
        await expect(channelComponent.modalSelectedRows()).toHaveCount(2);
        await expect(planningPage.modalSkuRow(String(knorr.heroA))).toHaveCount(1);
        await expect(planningPage.modalSkuRow(String(knorr.heroB))).toHaveCount(1);
        await channelComponent.cancelOpenModal();
        await channelComponent.openChannelHeroModal(channelNames.onsiteDemo);
        await expect(channelComponent.modalSelectedRows()).toHaveCount(1);
        await expect(planningPage.modalSkuRow(String(knorr.heroB))).toHaveCount(1);
      });
    }
  );

  test(
    'DC-005 (E2E-CHS-005) the channel Hero modal offers a brand-linked non-measurement SKU as a candidate',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated'] },
    async ({ page }) => {
      test.setTimeout(480_000);
      const planningPage = new PlanningPage(page);
      const channelComponent = new ChannelHeroAssignmentComponent(page);
      const catalogueName = await resolveCatalogueNames([knorr.followUp]);

      await test.step('Arrange: build the plan, add the channel and open its Hero modal', async () => {
        await buildToHeroesConfirmed(planningPage, channelComponent);
        await addChannels(planningPage, [metaChannel]);
        await channelComponent.openChannelHeroModal(channelNames.offsite);
      });

      await test.step('Assert AC-003: the non-measurement brand SKU is offered as an assignable candidate', async () => {
        await channelComponent.searchModalCandidates(catalogueName(knorr.followUp));
        await expect(channelComponent.modalCandidateOption(String(knorr.followUp))).toBeVisible({
          timeout: 30_000
        });
      });
    }
  );

  test(
    'DC-006 (E2E-CHS-006) a channel-only non-measurement Hero is auto-added to the global Measurements once',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated'] },
    async ({ page }) => {
      test.setTimeout(480_000);
      const planningPage = new PlanningPage(page);
      const channelComponent = new ChannelHeroAssignmentComponent(page);
      const catalogueName = await resolveCatalogueNames([knorr.followUp]);

      await test.step('Arrange: add two channels and assign the non-measurement SKU as Hero to the first only', async () => {
        await buildToHeroesConfirmed(planningPage, channelComponent);
        await addChannels(planningPage, [metaChannel, onsiteChannel]);
        await channelComponent.addHeroToChannel(
          channelNames.offsite,
          String(knorr.followUp),
          catalogueName(knorr.followUp)
        );
      });

      await test.step('Assert AC-004: the Measurement counter grows once and no sibling channel gains the SKU', async () => {
        await expect(planningPage.summaryMeasurementCount()).toContainText(countPattern(3), { timeout: 60_000 });
        await planningPage.openMeasurementEditModal();
        await expect(planningPage.modalSkuRow(String(knorr.followUp))).toHaveCount(1);
        await channelComponent.cancelOpenModal();
        await channelComponent.openChannelHeroModal(channelNames.onsite);
        await expect(planningPage.modalSkuRow(String(knorr.followUp))).toHaveCount(0);
        await channelComponent.cancelOpenModal();
        await channelComponent.openChannelHeroModal(channelNames.offsite);
        await expect(planningPage.modalSkuRow(String(knorr.followUp))).toHaveCount(1);
      });
    }
  );

  test(
    'DC-007 (E2E-CHS-007) editing one channel does not change the sibling channel',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated'] },
    async ({ page }) => {
      test.setTimeout(480_000);
      const planningPage = new PlanningPage(page);
      const channelComponent = new ChannelHeroAssignmentComponent(page);
      const catalogueName = await resolveCatalogueNames([knorr.followUp]);

      await test.step('Arrange: add two identically defaulted channels and edit only the first', async () => {
        await buildToHeroesConfirmed(planningPage, channelComponent);
        await addChannels(planningPage, [metaChannel, onsiteChannel]);
        await channelComponent.openChannelHeroModal(channelNames.offsite);
        await planningPage.modalRemoveSku(String(knorr.heroB)).click();
        await channelComponent.searchModalCandidates(catalogueName(knorr.followUp));
        await channelComponent.modalCandidateOption(String(knorr.followUp)).check();
        await channelComponent.confirmOpenModal();
      });

      await test.step('Assert AC-005: only the edited channel changed; the sibling keeps its original set', async () => {
        await channelComponent.openChannelHeroModal(channelNames.offsite);
        await expect(channelComponent.modalSelectedRows()).toHaveCount(2);
        await expect(planningPage.modalSkuRow(String(knorr.heroA))).toHaveCount(1);
        await expect(planningPage.modalSkuRow(String(knorr.followUp))).toHaveCount(1);
        await expect(planningPage.modalSkuRow(String(knorr.heroB))).toHaveCount(0);
        await channelComponent.cancelOpenModal();
        await channelComponent.openChannelHeroModal(channelNames.onsite);
        await expect(channelComponent.modalSelectedRows()).toHaveCount(2);
        await expect(planningPage.modalSkuRow(String(knorr.heroA))).toHaveCount(1);
        await expect(planningPage.modalSkuRow(String(knorr.heroB))).toHaveCount(1);
        await expect(planningPage.modalSkuRow(String(knorr.followUp))).toHaveCount(0);
      });
    }
  );

  for (const dataCase of setOperationCases) {
    test(
      `${dataCase.caseId} (${dataCase.catalogueId}) the campaign Hero counter follows the per-channel set operations`,
      { tag: ['@generated', '@regression', '@media-planner', '@authenticated'] },
      async ({ page }) => {
        test.setTimeout(480_000);
        const planningPage = new PlanningPage(page);
        const channelComponent = new ChannelHeroAssignmentComponent(page);
        const catalogueName = await resolveCatalogueNames([knorr.followUp]);

        await test.step('Arrange: add the case channels and apply the per-channel add and remove operations', async () => {
          await buildToHeroesConfirmed(planningPage, channelComponent);
          await addChannels(planningPage, dataCase.channels);
          for (const channelName of dataCase.addHeroTo) {
            await channelComponent.addHeroToChannel(
              channelName,
              String(knorr.followUp),
              catalogueName(knorr.followUp)
            );
          }
          for (const channelName of dataCase.removeHeroFrom) {
            await channelComponent.removeHeroFromChannel(channelName, String(knorr.followUp));
          }
        });

        await test.step('Assert AC-006: the campaign counters and the channel memberships match the documented set semantics', async () => {
          for (const channelName of dataCase.expected.channelsListing) {
            await channelComponent.openChannelHeroModal(channelName);
            await expect(planningPage.modalSkuRow(String(knorr.followUp))).toHaveCount(1);
            await channelComponent.cancelOpenModal();
          }
          for (const channelName of dataCase.expected.channelsNotListing) {
            await channelComponent.openChannelHeroModal(channelName);
            await expect(planningPage.modalSkuRow(String(knorr.followUp))).toHaveCount(0);
            await channelComponent.cancelOpenModal();
          }
          await expect(planningPage.summaryHeroCount()).toContainText(
            countPattern(dataCase.expected.campaignHeroCount),
            { timeout: 60_000 }
          );
          await expect(planningPage.summaryMeasurementCount()).toContainText(
            countPattern(dataCase.expected.measurementCount),
            { timeout: 60_000 }
          );
        });
      }
    );
  }

  test(
    'DC-012 (E2E-CHS-012) deleting a channel recomputes the campaign Hero union from the remaining channels',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated'] },
    async ({ page }) => {
      test.setTimeout(480_000);
      const planningPage = new PlanningPage(page);
      const channelComponent = new ChannelHeroAssignmentComponent(page);
      const catalogueName = await resolveCatalogueNames([knorr.followUp]);

      await test.step('Arrange: give the first channel a unique Hero, keep the sibling defaulted, then delete the first', async () => {
        await buildToHeroesConfirmed(planningPage, channelComponent);
        await addChannels(planningPage, [metaChannel, onsiteChannel]);
        await channelComponent.openChannelHeroModal(channelNames.offsite);
        await planningPage.modalRemoveSku(String(knorr.heroB)).click();
        await channelComponent.searchModalCandidates(catalogueName(knorr.followUp));
        await channelComponent.modalCandidateOption(String(knorr.followUp)).check();
        await channelComponent.confirmOpenModal();
        await planningPage.deleteChannel(channelNames.offsite);
      });

      await test.step('Assert AC-007: the union recomputes to the survivor and no stale Hero row remains', async () => {
        await expect(planningPage.summaryChannel(channelNames.offsite)).toHaveCount(0);
        await expect(planningPage.summaryHeroCount()).toContainText(countPattern(2), { timeout: 60_000 });
        await channelComponent.openChannelHeroModal(channelNames.onsite);
        await expect(channelComponent.modalSelectedRows()).toHaveCount(2);
        await expect(planningPage.modalSkuRow(String(knorr.heroA))).toHaveCount(1);
        await expect(planningPage.modalSkuRow(String(knorr.heroB))).toHaveCount(1);
        await expect(planningPage.modalSkuRow(String(knorr.followUp))).toHaveCount(0);
      });
    }
  );

  test(
    'DC-013 (E2E-CHS-013) a confirmed Hero change renders on the edited channel row only, without a reload',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated'] },
    async ({ page }) => {
      test.setTimeout(480_000);
      const planningPage = new PlanningPage(page);
      const channelComponent = new ChannelHeroAssignmentComponent(page);
      const catalogueName = await resolveCatalogueNames([knorr.followUp]);

      await test.step('Arrange: add two defaulted channels and confirm a Hero addition on the first only', async () => {
        await buildToHeroesConfirmed(planningPage, channelComponent);
        await addChannels(planningPage, [metaChannel, onsiteChannel]);
        // The whole case happens in ONE page session — no page.reload, no navigation
        // (NUP-18943 AC Scenario 4 real-time contract).
        await channelComponent.addHeroToChannel(
          channelNames.offsite,
          String(knorr.followUp),
          catalogueName(knorr.followUp)
        );
      });

      await test.step('Assert AC-008: the edited row shows the updated count and the sibling row is unchanged', async () => {
        await expect(channelComponent.channelHeroCountCell(channelNames.offsite, '3')).toBeVisible({
          timeout: 60_000
        });
        await expect(channelComponent.channelHeroCountCell(channelNames.onsite, '2')).toBeVisible();
      });
    }
  );

  test(
    'DC-014 (E2E-CHS-014) the media summary carries a Hero SKUs column with per-channel counts and no Details column',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated'] },
    async ({ page }) => {
      test.setTimeout(480_000);
      const planningPage = new PlanningPage(page);
      const channelComponent = new ChannelHeroAssignmentComponent(page);
      const catalogueName = await resolveCatalogueNames([knorr.followUp]);

      await test.step('Arrange: build one three-Hero channel and one explicit single-Hero channel', async () => {
        await buildToHeroesConfirmed(planningPage, channelComponent);
        await addChannels(planningPage, [metaChannel, onsiteSoleHeroChannel]);
        await channelComponent.addHeroToChannel(
          channelNames.offsite,
          String(knorr.followUp),
          catalogueName(knorr.followUp)
        );
      });

      await test.step('Assert AC-009: the Hero SKUs column replaces Details and each row shows its own count', async () => {
        await expect(channelComponent.heroSkusColumnHeader()).toBeVisible({ timeout: 60_000 });
        await expect(channelComponent.detailsColumnHeader()).toHaveCount(0);
        await expect(channelComponent.channelHeroCountCell(channelNames.offsite, '3')).toBeVisible();
        await expect(channelComponent.channelHeroCountCell(channelNames.onsite, '1')).toBeVisible();
      });
    }
  );

  test(
    'DC-015 (E2E-CHS-015) a channel with zero Heroes displays a dash, never a zero',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated'] },
    async ({ page }) => {
      test.setTimeout(480_000);
      const planningPage = new PlanningPage(page);
      const channelComponent = new ChannelHeroAssignmentComponent(page);

      await test.step('Arrange: add a single-Hero channel and empty its Hero selection via the modal', async () => {
        await buildToHeroesConfirmed(planningPage, channelComponent);
        await addChannels(planningPage, [metaSoleHeroChannel]);
        await channelComponent.clearChannelHeroes(channelNames.offsite, [String(knorr.heroA)]);
      });

      await test.step('Assert AC-010: the Hero SKUs summary cell renders a dash and no zero', async () => {
        await expect(channelComponent.channelHeroCountCell(channelNames.offsite, '-')).toBeVisible({
          timeout: 60_000
        });
        await expect(channelComponent.channelHeroCountCell(channelNames.offsite, '0')).toHaveCount(0);
      });
    }
  );

  test(
    'DC-016 (E2E-CHS-016) the per-channel Hero count updates dynamically without a reload',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated'] },
    async ({ page }) => {
      test.setTimeout(480_000);
      const planningPage = new PlanningPage(page);
      const channelComponent = new ChannelHeroAssignmentComponent(page);
      const catalogueName = await resolveCatalogueNames([knorr.followUp]);

      await test.step('Arrange: add a channel holding exactly one explicit Hero', async () => {
        await buildToHeroesConfirmed(planningPage, channelComponent);
        await addChannels(planningPage, [metaSoleHeroChannel]);
      });

      await test.step('Assert AC-011: the summary count transitions one to two and back to one with no stale value', async () => {
        // The whole toggle cycle happens in ONE page session — no page.reload, no
        // navigation: channel modal open/confirm only (NUP-20813 AC Scenario 3).
        await expect(channelComponent.channelHeroCountCell(channelNames.offsite, '1')).toBeVisible({
          timeout: 60_000
        });
        await channelComponent.addHeroToChannel(
          channelNames.offsite,
          String(knorr.followUp),
          catalogueName(knorr.followUp)
        );
        await expect(channelComponent.channelHeroCountCell(channelNames.offsite, '2')).toBeVisible({
          timeout: 60_000
        });
        await channelComponent.removeHeroFromChannel(channelNames.offsite, String(knorr.followUp));
        await expect(channelComponent.channelHeroCountCell(channelNames.offsite, '1')).toBeVisible({
          timeout: 60_000
        });
        await expect(channelComponent.channelHeroCountCell(channelNames.offsite, '2')).toHaveCount(0);
      });
    }
  );

  test(
    'NEG-001 (E2E-CHS-005) a foreign-brand SKU is not offered as a channel Hero candidate',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated'] },
    async ({ page }) => {
      test.setTimeout(480_000);
      const planningPage = new PlanningPage(page);
      const channelComponent = new ChannelHeroAssignmentComponent(page);
      const catalogueName = await resolveCatalogueNames([persilForeignSku]);

      await test.step('Arrange: build the plan, add the channel, open its Hero modal and search the foreign product', async () => {
        await buildToHeroesConfirmed(planningPage, channelComponent);
        await addChannels(planningPage, [metaChannel]);
        await channelComponent.openChannelHeroModal(channelNames.offsite);
        await channelComponent.searchModalCandidates(catalogueName(persilForeignSku));
      });

      await test.step('Assert NEG-001: the foreign-brand SKU is absent from the channel Hero candidates', async () => {
        await expect(channelComponent.modalCandidateOption(String(persilForeignSku))).toHaveCount(0);
      });
    }
  );
});
