// Spec-bound header: sha256 is the behavioral hash of the spec (computed via
// scripts/ai/lib/spec-parser.mjs specSha256). Re-stamp with `npm run ai:spec:drift`
// if the spec's behavioral sections change.
/* spec: specs/skus/max-hero-skus-per-channel.md version:2.0.0 sha256:6dea8edaa92ec6f4f9691df106effe43ecd7c72862420144616321143402a904 */
import type { Page } from '@playwright/test';

import { test, expect } from '../../../fixtures/test';
import {
  findMediaId,
  getMedia,
  getMediaChannelSetup,
  getPlanningSession,
  setMediaChannelSkuConfig,
  setPlanningSkus,
  type MediaChannel,
  type SkuSelection
} from '../../../fixtures/nectar-api';
import { PlanningPage } from '../../../pages/PlanningPage';
import {
  MaxHeroSkusPerChannelComponent,
  type MaxHeroSignalScope
} from '../../../pages/MaxHeroSkusPerChannelComponent';

// FLOW-SKU-MAX (suite mode): one journey test per Data Case. Every case seeds its
// channel maxHeroSKUs/minHeroSKUs precondition through the captured admin media
// GraphQL contract (fixtures/nectar-api.ts admin_getMedia -> admin_editMedia,
// snapshot-first and restored in a finally block), builds the live guided
// journey with the case's Hero SKU selection, adds the case channels, applies
// the case edits/save attempt, and asserts the case's documented
// warning/booking signals uniformly from its `expected` row.
//
// The fictional channel names in the source tickets ('Sponsored Search',
// 'Affiliate', 'Display', 'Sampling') do not exist in the dev catalogue; each
// case keeps its documented max/min/count semantics and runs against the
// brand's real channels (offsite 'Meta', onsite 'Homepage Sponsored Product' /
// 'SmartShop Handset Home Page (DEMO)') exactly like the sibling live suites.

// --- Runtime campaign window (copied from the discard-flow suite) -----------
const formatDdMmYyyy = (date: Date): string =>
  `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;

type CampaignWindow = { start: Date; end: Date };

const campaignWindow = (): CampaignWindow => {
  // Advance calendar dates from one midday anchor. Adding fixed 24-hour durations
  // can produce the previous/next local date across daylight-saving transitions.
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
  productSearch: 'knorr'
} as const;

// --- Channels under test (live-proven names from the sibling suites) --------
type ChannelKey = 'meta' | 'hsp' | 'smart';

type ChannelCatalogEntry = {
  resolvedName: string;
  mediaName: string;
  combinedPhrase: string;
  request: (window: CampaignWindow) => string;
};

const ONSITE_CHANNEL = 'Homepage Sponsored Product';
const ONSITE_CHANNEL_B = 'SmartShop Handset Home Page (DEMO)';
// The chat request phrasing omits the catalogue's ' (DEMO)' suffix (proven in
// the channel-deletion recompute suite).
const ONSITE_CHANNEL_B_REQUEST_NAME = ONSITE_CHANNEL_B.replace(/\s*\(DEMO\)\s*$/, '');

const channelCatalog: Record<ChannelKey, ChannelCatalogEntry> = {
  meta: {
    resolvedName: 'Meta',
    mediaName: 'Meta',
    combinedPhrase: 'Offsite Meta with a 7k budget',
    request: (window) =>
      `Offsite, Meta, ${formatDdMmYyyy(window.start)} till ${formatDdMmYyyy(window.end)}, the budget is 7k, Self-Serve`
  },
  hsp: {
    resolvedName: ONSITE_CHANNEL,
    mediaName: ONSITE_CHANNEL,
    combinedPhrase: `Onsite ${ONSITE_CHANNEL} with a £10,000 budget`,
    request: (window) =>
      `Onsite, ${ONSITE_CHANNEL}, £10000, ${formatDdMmYyyy(window.start)} - ${formatDdMmYyyy(window.end)}, Self-Serve`
  },
  smart: {
    resolvedName: ONSITE_CHANNEL_B,
    mediaName: ONSITE_CHANNEL_B,
    combinedPhrase: `Onsite ${ONSITE_CHANNEL_B_REQUEST_NAME} with a £10,000 budget`,
    request: (window) =>
      `Onsite, ${ONSITE_CHANNEL_B_REQUEST_NAME}, £10000, ${formatDdMmYyyy(window.start)} - ${formatDdMmYyyy(window.end)}, Self-Serve`
  }
};

// --- Channel limit seeding via the captured admin media contract ------------
// The dataManager's max-hero write helper is intentionally not referenced here
// (its arrange path is review-blocked); the suite talks to the same captured
// admin_getMedia -> admin_editMedia contract through fixtures/nectar-api.ts,
// snapshotting the channel's setup first and restoring it in a finally block.
type LimitSnapshot = {
  mediaId: string;
  mode: MediaChannel;
  maxHeroSKUs: number | null;
  minHeroSKUs: number | null;
};

const DELIVERY_MODES: MediaChannel[] = ['offSite', 'onSite', 'inStore', 'atHome'];

async function resolveMediaTarget(mediaName: string): Promise<{ mediaId: string; mode: MediaChannel }> {
  const mediaId = await findMediaId(mediaName);
  if (!mediaId) {
    throw new Error(`max-hero suite: no media named "${mediaName}" in admin_getEveryMedia`);
  }
  const media = await getMedia(mediaId);
  const mode = DELIVERY_MODES.find((candidate) => {
    const channelObject: unknown = media[candidate];
    return Boolean(channelObject) && typeof channelObject === 'object';
  });
  if (!mode) {
    throw new Error(`max-hero suite: media "${mediaName}" has no non-null delivery channel to configure`);
  }
  return { mediaId, mode };
}

type RowChannelSeed = {
  key: ChannelKey;
  maxHeroSkus: number | null;
  minHeroSkus: number | null;
  expectBlockedAdd: boolean;
};

async function seedChannelLimits(channels: RowChannelSeed[], restoreStack: LimitSnapshot[]): Promise<void> {
  for (const channel of channels) {
    const target = await resolveMediaTarget(channelCatalog[channel.key].mediaName);
    const setup = await getMediaChannelSetup(target.mediaId, target.mode);
    restoreStack.push({
      mediaId: target.mediaId,
      mode: target.mode,
      maxHeroSKUs: typeof setup?.maxHeroSKUs === 'number' ? setup.maxHeroSKUs : null,
      minHeroSKUs: typeof setup?.minHeroSKUs === 'number' ? setup.minHeroSKUs : null
    });
    await setMediaChannelSkuConfig(target.mediaId, target.mode, {
      maxHeroSKUs: channel.maxHeroSkus,
      minHeroSKUs: channel.minHeroSkus
    });
  }
}

async function restoreChannelLimits(restoreStack: LimitSnapshot[]): Promise<void> {
  const failures: Error[] = [];
  while (restoreStack.length > 0) {
    const snapshot = restoreStack.pop();
    if (!snapshot) {
      break;
    }
    try {
      await setMediaChannelSkuConfig(snapshot.mediaId, snapshot.mode, {
        maxHeroSKUs: snapshot.maxHeroSKUs,
        minHeroSKUs: snapshot.minHeroSKUs
      });
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error(String(error)));
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'max-hero suite: channel limit restore failed');
  }
}

async function readMaxHeroSkus(mediaName: string): Promise<number | null> {
  const target = await resolveMediaTarget(mediaName);
  const setup = await getMediaChannelSetup(target.mediaId, target.mode);
  return typeof setup?.maxHeroSKUs === 'number' ? setup.maxHeroSKUs : null;
}

// --- Data cases --------------------------------------------------------------
type MaxHeroSignal = { scope: MaxHeroSignalScope; text: string | RegExp };

type RowEdit =
  | { kind: 'none' }
  | { kind: 'remove-via-warning-modal'; removeCount: number }
  | { kind: 'remove-via-hero-modal'; removeCount: number }
  | { kind: 'open-warning-modal' }
  | { kind: 'promote-via-api'; promoteCount: number };

type MaxHeroDataCase = {
  caseId: string;
  sourceId: string;
  title: string;
  channels: RowChannelSeed[];
  addMode: 'sequential' | 'combined';
  productCount: number;
  heroCount: number;
  preChannelHeroRemovals: number;
  edit: RowEdit;
  save: 'none' | 'expect-saved' | 'expect-blocked';
  expected: {
    visibleSignals: MaxHeroSignal[];
    hiddenSignals: MaxHeroSignal[];
  };
};

// Verbatim per-channel warning copy — the numeral is interpolated from the
// channel's configured maxHeroSkus (RULE-002: a numeral hardcoded to 3 is a defect).
const MEDIA_LIMIT_1 = 'Media limit: 1 Hero SKUs. Edit SKUs';
const MEDIA_LIMIT_2 = 'Media limit: 2 Hero SKUs. Edit SKUs';
const MEDIA_LIMIT_3 = 'Media limit: 3 Hero SKUs. Edit SKUs';
const MEDIA_LIMIT_4 = 'Media limit: 4 Hero SKUs. Edit SKUs';
const MEDIA_LIMIT_5 = 'Media limit: 5 Hero SKUs. Edit SKUs';
const MEDIA_LIMIT_PREFIX = 'Media limit';
// Save-gate copy (NUP-20003 Scenario 7) and the live-proven saved-draft copy.
const SAVE_BLOCKED_COPY = 'You cannot save your plan until all warnings for channels in the summary panel are resolved.';
const SAVED_DRAFT_COPY = 'Your plan has been saved as a draft.';

// Exact summary channel rows (summary getByText is substring-based, so anchors
// keep 'Meta' from matching budget labels such as 'Budget for Meta').
const META_ROW = /^Meta$/;
const HSP_ROW = /^Homepage Sponsored Product$/;
const SMART_ROW = /^SmartShop Handset Home Page \(DEMO\)$/;

const dataCases: MaxHeroDataCase[] = [
  {
    caseId: 'DC-001',
    sourceId: 'TC-MAX-001',
    title: 'max+1 boundary warning numeral equals the configured max of 2, not a literal 3',
    channels: [{ key: 'meta', maxHeroSkus: 2, minHeroSkus: null, expectBlockedAdd: false }],
    addMode: 'sequential',
    productCount: 3,
    heroCount: 3,
    preChannelHeroRemovals: 0,
    edit: { kind: 'none' },
    save: 'none',
    expected: {
      visibleSignals: [
        { scope: 'summary', text: META_ROW },
        { scope: 'summary', text: MEDIA_LIMIT_2 }
      ],
      hiddenSignals: [{ scope: 'summary', text: MEDIA_LIMIT_3 }]
    }
  },
  {
    caseId: 'DC-002',
    sourceId: 'TC-MAX-002',
    title: 'Hero count below max (2 of 3) adds the channel with no warning',
    channels: [{ key: 'meta', maxHeroSkus: 3, minHeroSkus: 0, expectBlockedAdd: false }],
    addMode: 'sequential',
    productCount: 2,
    heroCount: 2,
    preChannelHeroRemovals: 0,
    edit: { kind: 'none' },
    save: 'none',
    expected: {
      visibleSignals: [
        { scope: 'summary', text: META_ROW },
        { scope: 'hero-count', text: /(?<!\d)2 SKUs?/ }
      ],
      hiddenSignals: [{ scope: 'summary', text: MEDIA_LIMIT_PREFIX }]
    }
  },
  {
    caseId: 'DC-003',
    sourceId: 'TC-MAX-003',
    title: 'Hero count equal to max (3 of 3) adds the channel with no warning',
    channels: [{ key: 'meta', maxHeroSkus: 3, minHeroSkus: null, expectBlockedAdd: false }],
    addMode: 'sequential',
    productCount: 3,
    heroCount: 3,
    preChannelHeroRemovals: 0,
    edit: { kind: 'none' },
    save: 'none',
    expected: {
      visibleSignals: [
        { scope: 'summary', text: META_ROW },
        { scope: 'hero-count', text: /(?<!\d)3 SKUs?/ }
      ],
      hiddenSignals: [{ scope: 'summary', text: MEDIA_LIMIT_PREFIX }]
    }
  },
  {
    caseId: 'DC-004',
    sourceId: 'TC-MAX-004',
    title: 'Hero count of max+1 (4 of 3) keeps all SKUs and shows the exact warning',
    channels: [{ key: 'meta', maxHeroSkus: 3, minHeroSkus: null, expectBlockedAdd: false }],
    addMode: 'sequential',
    productCount: 4,
    heroCount: 4,
    preChannelHeroRemovals: 0,
    edit: { kind: 'none' },
    save: 'none',
    expected: {
      visibleSignals: [
        { scope: 'summary', text: META_ROW },
        { scope: 'hero-count', text: /(?<!\d)4 SKUs?/ },
        { scope: 'summary', text: MEDIA_LIMIT_3 }
      ],
      hiddenSignals: []
    }
  },
  {
    caseId: 'DC-005',
    sourceId: 'TC-MAX-005',
    title: 'Hero count far above max (8 of 3) keeps all SKUs and shows the exact warning',
    channels: [{ key: 'meta', maxHeroSkus: 3, minHeroSkus: null, expectBlockedAdd: false }],
    addMode: 'sequential',
    productCount: 8,
    heroCount: 8,
    preChannelHeroRemovals: 0,
    edit: { kind: 'none' },
    save: 'none',
    expected: {
      visibleSignals: [
        { scope: 'hero-count', text: /(?<!\d)8 SKUs?/ },
        { scope: 'summary', text: MEDIA_LIMIT_3 }
      ],
      hiddenSignals: []
    }
  },
  {
    caseId: 'DC-006',
    sourceId: 'TC-MAX-006',
    title: 'zero Hero SKUs with min 0 adds the channel with no maximum warning',
    channels: [{ key: 'meta', maxHeroSkus: 3, minHeroSkus: 0, expectBlockedAdd: false }],
    addMode: 'sequential',
    productCount: 1,
    heroCount: 1,
    preChannelHeroRemovals: 1,
    edit: { kind: 'none' },
    save: 'none',
    expected: {
      visibleSignals: [
        { scope: 'summary', text: META_ROW },
        { scope: 'hero-count', text: /(?<!\d)0 SKUs?|To be defined/ }
      ],
      hiddenSignals: [{ scope: 'summary', text: MEDIA_LIMIT_PREFIX }]
    }
  },
  {
    caseId: 'DC-007',
    sourceId: 'TC-MAX-007',
    title: 'singleton max (1) with exactly 1 Hero SKU is allowed with no warning',
    channels: [{ key: 'meta', maxHeroSkus: 1, minHeroSkus: null, expectBlockedAdd: false }],
    addMode: 'sequential',
    productCount: 1,
    heroCount: 1,
    preChannelHeroRemovals: 0,
    edit: { kind: 'none' },
    save: 'none',
    expected: {
      visibleSignals: [
        { scope: 'summary', text: META_ROW },
        { scope: 'hero-count', text: /(?<!\d)1 SKUs?/ }
      ],
      hiddenSignals: [{ scope: 'summary', text: MEDIA_LIMIT_PREFIX }]
    }
  },
  {
    caseId: 'DC-008',
    sourceId: 'TC-MAX-008',
    title: 'singleton max (1) with 2 Hero SKUs warns with the numeral 1',
    channels: [{ key: 'meta', maxHeroSkus: 1, minHeroSkus: null, expectBlockedAdd: false }],
    addMode: 'sequential',
    productCount: 2,
    heroCount: 2,
    preChannelHeroRemovals: 0,
    edit: { kind: 'none' },
    save: 'none',
    expected: {
      visibleSignals: [
        { scope: 'hero-count', text: /(?<!\d)2 SKUs?/ },
        { scope: 'summary', text: MEDIA_LIMIT_1 }
      ],
      hiddenSignals: []
    }
  },
  {
    caseId: 'DC-009',
    sourceId: 'TC-MAX-009',
    title: 'warning numeral tracks a different configured max (5) verbatim',
    channels: [{ key: 'hsp', maxHeroSkus: 5, minHeroSkus: null, expectBlockedAdd: false }],
    addMode: 'sequential',
    productCount: 6,
    heroCount: 6,
    preChannelHeroRemovals: 0,
    edit: { kind: 'none' },
    save: 'none',
    expected: {
      visibleSignals: [
        { scope: 'summary', text: HSP_ROW },
        { scope: 'summary', text: MEDIA_LIMIT_5 }
      ],
      hiddenSignals: []
    }
  },
  {
    caseId: 'DC-010',
    sourceId: 'TC-MAX-010',
    title: 'no maximum configured (null) allows a large Hero count and saving proceeds',
    channels: [{ key: 'hsp', maxHeroSkus: null, minHeroSkus: null, expectBlockedAdd: false }],
    addMode: 'sequential',
    productCount: 10,
    heroCount: 10,
    preChannelHeroRemovals: 0,
    edit: { kind: 'none' },
    save: 'expect-saved',
    expected: {
      visibleSignals: [
        { scope: 'summary', text: HSP_ROW },
        { scope: 'hero-count', text: /(?<!\d)10 SKUs?/ },
        { scope: 'page', text: SAVED_DRAFT_COPY }
      ],
      hiddenSignals: [{ scope: 'summary', text: MEDIA_LIMIT_PREFIX }]
    }
  },
  {
    caseId: 'DC-011',
    sourceId: 'TC-MAX-011',
    title: 'no maximum configured does not apply a coincidental default of 3',
    channels: [{ key: 'hsp', maxHeroSkus: null, minHeroSkus: null, expectBlockedAdd: false }],
    addMode: 'sequential',
    productCount: 3,
    heroCount: 3,
    preChannelHeroRemovals: 0,
    edit: { kind: 'none' },
    save: 'none',
    expected: {
      visibleSignals: [
        { scope: 'summary', text: HSP_ROW },
        { scope: 'hero-count', text: /(?<!\d)3 SKUs?/ }
      ],
      hiddenSignals: [{ scope: 'summary', text: MEDIA_LIMIT_PREFIX }]
    }
  },
  {
    caseId: 'DC-012',
    sourceId: 'TC-MAX-012',
    title: 'deselecting the excess (5 to 3) via the warning modal clears the warning and saving proceeds',
    channels: [{ key: 'meta', maxHeroSkus: 3, minHeroSkus: null, expectBlockedAdd: false }],
    addMode: 'sequential',
    productCount: 5,
    heroCount: 5,
    preChannelHeroRemovals: 0,
    edit: { kind: 'remove-via-warning-modal', removeCount: 2 },
    save: 'expect-saved',
    expected: {
      visibleSignals: [
        { scope: 'hero-count', text: /(?<!\d)3 SKUs?/ },
        { scope: 'page', text: SAVED_DRAFT_COPY }
      ],
      hiddenSignals: [{ scope: 'summary', text: MEDIA_LIMIT_PREFIX }]
    }
  },
  {
    caseId: 'DC-013',
    sourceId: 'TC-MAX-013',
    title: 'deselecting to a still-over count (5 to 4) keeps the warning',
    channels: [{ key: 'meta', maxHeroSkus: 3, minHeroSkus: null, expectBlockedAdd: false }],
    addMode: 'sequential',
    productCount: 5,
    heroCount: 5,
    preChannelHeroRemovals: 0,
    edit: { kind: 'remove-via-warning-modal', removeCount: 1 },
    save: 'none',
    expected: {
      visibleSignals: [
        { scope: 'hero-count', text: /(?<!\d)4 SKUs?/ },
        { scope: 'summary', text: MEDIA_LIMIT_3 }
      ],
      hiddenSignals: []
    }
  },
  {
    caseId: 'DC-014',
    sourceId: 'TC-MAX-014',
    title: 'deselecting exactly to max (4 to 3) clears the warning and saving proceeds',
    channels: [{ key: 'meta', maxHeroSkus: 3, minHeroSkus: null, expectBlockedAdd: false }],
    addMode: 'sequential',
    productCount: 4,
    heroCount: 4,
    preChannelHeroRemovals: 0,
    edit: { kind: 'remove-via-warning-modal', removeCount: 1 },
    save: 'expect-saved',
    expected: {
      visibleSignals: [
        { scope: 'hero-count', text: /(?<!\d)3 SKUs?/ },
        { scope: 'page', text: SAVED_DRAFT_COPY }
      ],
      hiddenSignals: [{ scope: 'summary', text: MEDIA_LIMIT_PREFIX }]
    }
  },
  {
    caseId: 'DC-015',
    sourceId: 'TC-MAX-015',
    title: 'global Hero list of 5 then a max-3 channel: channel added with all 5 and warned',
    channels: [{ key: 'meta', maxHeroSkus: 3, minHeroSkus: null, expectBlockedAdd: false }],
    addMode: 'sequential',
    productCount: 5,
    heroCount: 5,
    preChannelHeroRemovals: 0,
    edit: { kind: 'none' },
    save: 'none',
    expected: {
      visibleSignals: [
        { scope: 'summary', text: META_ROW },
        { scope: 'hero-count', text: /(?<!\d)5 SKUs?/ },
        { scope: 'summary', text: MEDIA_LIMIT_3 }
      ],
      hiddenSignals: []
    }
  },
  {
    caseId: 'DC-016',
    sourceId: 'TC-MAX-016',
    title: 'global Hero list exceeds two channels: each channel warns with its own max',
    channels: [
      { key: 'meta', maxHeroSkus: 3, minHeroSkus: null, expectBlockedAdd: false },
      { key: 'hsp', maxHeroSkus: 1, minHeroSkus: null, expectBlockedAdd: false }
    ],
    addMode: 'sequential',
    productCount: 5,
    heroCount: 5,
    preChannelHeroRemovals: 0,
    edit: { kind: 'none' },
    save: 'none',
    expected: {
      visibleSignals: [
        { scope: 'summary', text: META_ROW },
        { scope: 'summary', text: HSP_ROW },
        { scope: 'summary', text: MEDIA_LIMIT_3 },
        { scope: 'summary', text: MEDIA_LIMIT_1 }
      ],
      hiddenSignals: []
    }
  },
  {
    caseId: 'DC-017',
    sourceId: 'TC-MAX-017',
    title: 'global Hero list within one channel but over another: only the over-limit channel warns',
    channels: [
      { key: 'meta', maxHeroSkus: 3, minHeroSkus: null, expectBlockedAdd: false },
      { key: 'hsp', maxHeroSkus: 1, minHeroSkus: null, expectBlockedAdd: false }
    ],
    addMode: 'sequential',
    productCount: 3,
    heroCount: 3,
    preChannelHeroRemovals: 0,
    edit: { kind: 'none' },
    save: 'none',
    expected: {
      visibleSignals: [
        { scope: 'summary', text: META_ROW },
        { scope: 'summary', text: HSP_ROW },
        { scope: 'summary', text: MEDIA_LIMIT_1 }
      ],
      hiddenSignals: [{ scope: 'summary', text: MEDIA_LIMIT_3 }]
    }
  },
  {
    caseId: 'DC-018',
    sourceId: 'TC-MAX-018',
    title: 'one over-limit channel blocks saving the whole mixed-max plan',
    channels: [
      { key: 'hsp', maxHeroSkus: 5, minHeroSkus: null, expectBlockedAdd: false },
      { key: 'meta', maxHeroSkus: 3, minHeroSkus: null, expectBlockedAdd: false }
    ],
    addMode: 'sequential',
    productCount: 4,
    heroCount: 4,
    preChannelHeroRemovals: 0,
    edit: { kind: 'none' },
    save: 'expect-blocked',
    expected: {
      visibleSignals: [
        { scope: 'summary', text: MEDIA_LIMIT_3 },
        { scope: 'page', text: SAVE_BLOCKED_COPY }
      ],
      hiddenSignals: [{ scope: 'summary', text: MEDIA_LIMIT_5 }]
    }
  },
  {
    caseId: 'DC-019',
    sourceId: 'TC-MAX-019',
    title: 'backend blocks a single typed channel that exceeds its max and informs the user',
    channels: [{ key: 'meta', maxHeroSkus: 3, minHeroSkus: null, expectBlockedAdd: true }],
    addMode: 'sequential',
    productCount: 4,
    heroCount: 4,
    preChannelHeroRemovals: 0,
    edit: { kind: 'none' },
    save: 'none',
    expected: {
      visibleSignals: [{ scope: 'chat', text: /limit/i }],
      hiddenSignals: [{ scope: 'summary', text: META_ROW }]
    }
  },
  {
    caseId: 'DC-020',
    sourceId: 'TC-MAX-020',
    title: 'with two typed channels, only the over-max channel is blocked and the other is added',
    channels: [
      { key: 'meta', maxHeroSkus: 3, minHeroSkus: null, expectBlockedAdd: true },
      { key: 'hsp', maxHeroSkus: 5, minHeroSkus: null, expectBlockedAdd: false }
    ],
    addMode: 'combined',
    productCount: 4,
    heroCount: 4,
    preChannelHeroRemovals: 0,
    edit: { kind: 'none' },
    save: 'none',
    expected: {
      visibleSignals: [
        { scope: 'summary', text: HSP_ROW },
        { scope: 'chat', text: /limit/i }
      ],
      hiddenSignals: [{ scope: 'summary', text: META_ROW }]
    }
  },
  {
    caseId: 'DC-021',
    sourceId: 'TC-MAX-021',
    title: 'backend blocks a single typed channel below its minimum and informs the user',
    channels: [{ key: 'meta', maxHeroSkus: 3, minHeroSkus: 2, expectBlockedAdd: true }],
    addMode: 'sequential',
    productCount: 1,
    heroCount: 1,
    preChannelHeroRemovals: 0,
    edit: { kind: 'none' },
    save: 'none',
    expected: {
      visibleSignals: [{ scope: 'chat', text: /at least|minimum/i }],
      hiddenSignals: [{ scope: 'summary', text: META_ROW }]
    }
  },
  {
    caseId: 'DC-022',
    sourceId: 'TC-MAX-022',
    title: 'two typed channels both within their min/max are both added with no limit message',
    channels: [
      { key: 'meta', maxHeroSkus: 3, minHeroSkus: 1, expectBlockedAdd: false },
      { key: 'hsp', maxHeroSkus: 5, minHeroSkus: 1, expectBlockedAdd: false }
    ],
    addMode: 'combined',
    productCount: 3,
    heroCount: 3,
    preChannelHeroRemovals: 0,
    edit: { kind: 'none' },
    save: 'none',
    expected: {
      visibleSignals: [
        { scope: 'summary', text: META_ROW },
        { scope: 'summary', text: HSP_ROW }
      ],
      hiddenSignals: [{ scope: 'summary', text: MEDIA_LIMIT_PREFIX }]
    }
  },
  {
    caseId: 'DC-023',
    sourceId: 'TC-MAX-023',
    title: 'a channel with no max configured is added regardless of a 12-Hero selection',
    channels: [{ key: 'smart', maxHeroSkus: null, minHeroSkus: null, expectBlockedAdd: false }],
    addMode: 'sequential',
    productCount: 12,
    heroCount: 12,
    preChannelHeroRemovals: 0,
    edit: { kind: 'none' },
    save: 'none',
    expected: {
      visibleSignals: [{ scope: 'summary', text: SMART_ROW }],
      hiddenSignals: [{ scope: 'summary', text: MEDIA_LIMIT_PREFIX }]
    }
  },
  {
    caseId: 'DC-024',
    sourceId: 'TC-MAX-024',
    title: 're-exceeding after a valid state (3 to 4) re-triggers the warning',
    channels: [{ key: 'meta', maxHeroSkus: 3, minHeroSkus: null, expectBlockedAdd: false }],
    addMode: 'sequential',
    productCount: 4,
    heroCount: 3,
    preChannelHeroRemovals: 0,
    edit: { kind: 'promote-via-api', promoteCount: 1 },
    save: 'none',
    expected: {
      visibleSignals: [
        { scope: 'hero-count', text: /(?<!\d)4 SKUs?/ },
        { scope: 'summary', text: MEDIA_LIMIT_3 }
      ],
      hiddenSignals: []
    }
  },
  {
    caseId: 'DC-025',
    sourceId: 'TC-MAX-025',
    title: 'assigning a 2nd Hero SKU reaches the minimum of 2 and clears the block',
    channels: [{ key: 'meta', maxHeroSkus: 3, minHeroSkus: 2, expectBlockedAdd: false }],
    addMode: 'sequential',
    productCount: 2,
    heroCount: 1,
    preChannelHeroRemovals: 0,
    edit: { kind: 'promote-via-api', promoteCount: 1 },
    save: 'none',
    expected: {
      visibleSignals: [{ scope: 'hero-count', text: /(?<!\d)2 SKUs?/ }],
      hiddenSignals: [
        { scope: 'summary', text: /at least\s*2/i },
        { scope: 'summary', text: MEDIA_LIMIT_PREFIX }
      ]
    }
  },
  {
    caseId: 'DC-026',
    sourceId: 'TC-MAX-026',
    title: "the warning's Edit SKUs affordance opens the SKU modal listing the 4 assigned Hero SKUs",
    channels: [{ key: 'meta', maxHeroSkus: 3, minHeroSkus: null, expectBlockedAdd: false }],
    addMode: 'sequential',
    productCount: 4,
    heroCount: 4,
    preChannelHeroRemovals: 0,
    edit: { kind: 'open-warning-modal' },
    save: 'none',
    expected: {
      visibleSignals: [
        { scope: 'modal', text: /Hero SKUs?/i },
        { scope: 'modal-count', text: /(?<!\d)4/ }
      ],
      hiddenSignals: []
    }
  },
  {
    caseId: 'DC-027',
    sourceId: 'TC-MAX-027',
    title: 'an explicit save attempt while over limit is blocked and the warning remains',
    channels: [{ key: 'meta', maxHeroSkus: 3, minHeroSkus: null, expectBlockedAdd: false }],
    addMode: 'sequential',
    productCount: 4,
    heroCount: 4,
    preChannelHeroRemovals: 0,
    edit: { kind: 'none' },
    save: 'expect-blocked',
    expected: {
      visibleSignals: [
        { scope: 'summary', text: MEDIA_LIMIT_3 },
        { scope: 'page', text: SAVE_BLOCKED_COPY }
      ],
      hiddenSignals: [{ scope: 'page', text: SAVED_DRAFT_COPY }]
    }
  },
  {
    caseId: 'DC-028',
    sourceId: 'TC-MAX-028',
    title: 'offsite Meta at exactly max (3 of 3) is accepted with no warning',
    channels: [{ key: 'meta', maxHeroSkus: 3, minHeroSkus: null, expectBlockedAdd: false }],
    addMode: 'sequential',
    productCount: 3,
    heroCount: 3,
    preChannelHeroRemovals: 0,
    edit: { kind: 'none' },
    save: 'none',
    expected: {
      visibleSignals: [
        { scope: 'summary', text: META_ROW },
        { scope: 'hero-count', text: /(?<!\d)3 SKUs?/ }
      ],
      hiddenSignals: [{ scope: 'summary', text: MEDIA_LIMIT_PREFIX }]
    }
  },
  {
    caseId: 'DC-029',
    sourceId: 'TC-MAX-029',
    title: 'offsite Meta at max-1 (2 of 3) is accepted with no warning',
    channels: [{ key: 'meta', maxHeroSkus: 3, minHeroSkus: null, expectBlockedAdd: false }],
    addMode: 'sequential',
    productCount: 2,
    heroCount: 2,
    preChannelHeroRemovals: 0,
    edit: { kind: 'none' },
    save: 'none',
    expected: {
      visibleSignals: [
        { scope: 'summary', text: META_ROW },
        { scope: 'hero-count', text: /(?<!\d)2 SKUs?/ }
      ],
      hiddenSignals: [{ scope: 'summary', text: MEDIA_LIMIT_PREFIX }]
    }
  },
  {
    caseId: 'DC-030',
    sourceId: 'TC-MAX-030',
    title: 'offsite Meta at max+1 (4 of 3) keeps all SKUs, warns verbatim and blocks saving',
    channels: [{ key: 'meta', maxHeroSkus: 3, minHeroSkus: null, expectBlockedAdd: false }],
    addMode: 'sequential',
    productCount: 4,
    heroCount: 4,
    preChannelHeroRemovals: 0,
    edit: { kind: 'none' },
    save: 'expect-blocked',
    expected: {
      visibleSignals: [
        { scope: 'summary', text: META_ROW },
        { scope: 'hero-count', text: /(?<!\d)4 SKUs?/ },
        { scope: 'summary', text: MEDIA_LIMIT_3 },
        { scope: 'page', text: SAVE_BLOCKED_COPY }
      ],
      hiddenSignals: []
    }
  },
  {
    caseId: 'DC-031',
    sourceId: 'TC-MAX-031',
    title: 'an onsite channel with no max configured imposes no restriction on 6 Hero SKUs',
    channels: [{ key: 'hsp', maxHeroSkus: null, minHeroSkus: null, expectBlockedAdd: false }],
    addMode: 'sequential',
    productCount: 6,
    heroCount: 6,
    preChannelHeroRemovals: 0,
    edit: { kind: 'none' },
    save: 'none',
    expected: {
      visibleSignals: [
        { scope: 'summary', text: HSP_ROW },
        { scope: 'hero-count', text: /(?<!\d)6 SKUs?/ }
      ],
      hiddenSignals: [{ scope: 'summary', text: MEDIA_LIMIT_PREFIX }]
    }
  },
  {
    caseId: 'DC-032',
    sourceId: 'TC-MAX-032',
    title: 'singleton max: adding a 2nd Hero SKU re-warns with the numeral 1 interpolated',
    channels: [{ key: 'meta', maxHeroSkus: 1, minHeroSkus: null, expectBlockedAdd: false }],
    addMode: 'sequential',
    productCount: 2,
    heroCount: 1,
    preChannelHeroRemovals: 0,
    edit: { kind: 'promote-via-api', promoteCount: 1 },
    save: 'none',
    expected: {
      visibleSignals: [
        { scope: 'hero-count', text: /(?<!\d)2 SKUs?/ },
        { scope: 'summary', text: MEDIA_LIMIT_1 }
      ],
      hiddenSignals: []
    }
  },
  {
    caseId: 'DC-033',
    sourceId: 'TC-MAX-033',
    title: 'mixed-max plan: the over-max channel warns while the within-max channel stays clean',
    channels: [
      { key: 'meta', maxHeroSkus: 3, minHeroSkus: null, expectBlockedAdd: false },
      { key: 'hsp', maxHeroSkus: 5, minHeroSkus: null, expectBlockedAdd: false }
    ],
    addMode: 'sequential',
    productCount: 4,
    heroCount: 4,
    preChannelHeroRemovals: 0,
    edit: { kind: 'none' },
    save: 'none',
    expected: {
      visibleSignals: [
        { scope: 'summary', text: META_ROW },
        { scope: 'summary', text: HSP_ROW },
        { scope: 'summary', text: MEDIA_LIMIT_3 }
      ],
      hiddenSignals: [{ scope: 'summary', text: MEDIA_LIMIT_5 }]
    }
  },
  {
    caseId: 'DC-034',
    sourceId: 'TC-MAX-034',
    title: 'global 4 Heroes: max-3 channel warns, max-4 channel at its own limit stays clean',
    channels: [
      { key: 'meta', maxHeroSkus: 3, minHeroSkus: null, expectBlockedAdd: false },
      { key: 'hsp', maxHeroSkus: 4, minHeroSkus: null, expectBlockedAdd: false }
    ],
    addMode: 'sequential',
    productCount: 4,
    heroCount: 4,
    preChannelHeroRemovals: 0,
    edit: { kind: 'none' },
    save: 'none',
    expected: {
      visibleSignals: [
        { scope: 'summary', text: META_ROW },
        { scope: 'summary', text: HSP_ROW },
        { scope: 'summary', text: MEDIA_LIMIT_3 }
      ],
      hiddenSignals: [{ scope: 'summary', text: MEDIA_LIMIT_4 }]
    }
  },
  {
    caseId: 'DC-035',
    sourceId: 'TC-MAX-035',
    title: 'deselecting the excess SKU down to max clears the warning on recompute',
    channels: [{ key: 'meta', maxHeroSkus: 3, minHeroSkus: null, expectBlockedAdd: false }],
    addMode: 'sequential',
    productCount: 4,
    heroCount: 4,
    preChannelHeroRemovals: 0,
    edit: { kind: 'remove-via-warning-modal', removeCount: 1 },
    save: 'none',
    expected: {
      visibleSignals: [{ scope: 'hero-count', text: /(?<!\d)3 SKUs?/ }],
      hiddenSignals: [{ scope: 'summary', text: MEDIA_LIMIT_PREFIX }]
    }
  },
  {
    caseId: 'DC-036',
    sourceId: 'TC-MAX-036',
    title: 'reducing an over-max channel to max-1 also clears the warning',
    channels: [{ key: 'meta', maxHeroSkus: 3, minHeroSkus: null, expectBlockedAdd: false }],
    addMode: 'sequential',
    productCount: 4,
    heroCount: 4,
    preChannelHeroRemovals: 0,
    edit: { kind: 'remove-via-warning-modal', removeCount: 2 },
    save: 'none',
    expected: {
      visibleSignals: [{ scope: 'hero-count', text: /(?<!\d)2 SKUs?/ }],
      hiddenSignals: [{ scope: 'summary', text: MEDIA_LIMIT_PREFIX }]
    }
  },
  {
    caseId: 'DC-037',
    sourceId: 'TC-MAX-037',
    title: 'NUP-20507: a single typed over-max channel is blocked from being added on activation',
    channels: [{ key: 'meta', maxHeroSkus: 3, minHeroSkus: null, expectBlockedAdd: true }],
    addMode: 'sequential',
    productCount: 4,
    heroCount: 4,
    preChannelHeroRemovals: 0,
    edit: { kind: 'none' },
    save: 'none',
    expected: {
      visibleSignals: [{ scope: 'chat', text: /limit/i }],
      hiddenSignals: [{ scope: 'summary', text: META_ROW }]
    }
  },
  {
    caseId: 'DC-038',
    sourceId: 'TC-MAX-038',
    title: 'NUP-20507: with several typed channels only the over-max one is blocked; the other is added',
    channels: [
      { key: 'meta', maxHeroSkus: 3, minHeroSkus: null, expectBlockedAdd: true },
      { key: 'hsp', maxHeroSkus: 5, minHeroSkus: null, expectBlockedAdd: false }
    ],
    addMode: 'combined',
    productCount: 4,
    heroCount: 4,
    preChannelHeroRemovals: 0,
    edit: { kind: 'none' },
    save: 'none',
    expected: {
      visibleSignals: [{ scope: 'summary', text: HSP_ROW }],
      hiddenSignals: [{ scope: 'summary', text: META_ROW }]
    }
  },
  {
    caseId: 'DC-039',
    sourceId: 'TC-MAX-039',
    title: 'NUP-20507: a channel activated below its minimum is blocked and the user informed',
    channels: [{ key: 'meta', maxHeroSkus: 3, minHeroSkus: 1, expectBlockedAdd: true }],
    addMode: 'sequential',
    productCount: 1,
    heroCount: 1,
    preChannelHeroRemovals: 1,
    edit: { kind: 'none' },
    save: 'none',
    expected: {
      visibleSignals: [{ scope: 'chat', text: /at least|minimum/i }],
      hiddenSignals: [{ scope: 'summary', text: META_ROW }]
    }
  }
];

// --- Journey drivers ----------------------------------------------------------
const buildGuidedJourney = async (
  planningPage: PlanningPage,
  maxHeroComponent: MaxHeroSkusPerChannelComponent,
  productCount: number,
  heroCount: number
): Promise<void> => {
  await planningPage.goto();
  await planningPage.startNectarAiPlanner();
  await planningPage.chooseBuildByObjectiveAndBudget();
  await planningPage.selectAdvertiser(journey.advertiser);
  await planningPage.selectBrand(journey.brand);
  await planningPage.confirmAdvertiserAndBrand();
  await planningPage.enterObjective(journey.objective);
  await planningPage.searchProducts(journey.productSearch);
  await maxHeroComponent.selectProducts(productCount);
  await planningPage.confirmMeasurementSkus();
  await maxHeroComponent.promoteHeroes(heroCount);
  await planningPage.confirmHeroSkus();
};

const buildJourneyToHeroStage = async (
  planningPage: PlanningPage,
  maxHeroComponent: MaxHeroSkusPerChannelComponent,
  dataCase: MaxHeroDataCase
): Promise<void> => {
  await buildGuidedJourney(planningPage, maxHeroComponent, dataCase.productCount, dataCase.heroCount);
  if (dataCase.preChannelHeroRemovals > 0) {
    await maxHeroComponent.openHeroEditModal();
    await maxHeroComponent.removeSelectedSkusInModal(dataCase.preChannelHeroRemovals);
    await maxHeroComponent.confirmEditModal();
  }
};

const addRowChannels = async (
  planningPage: PlanningPage,
  maxHeroComponent: MaxHeroSkusPerChannelComponent,
  dataCase: MaxHeroDataCase
): Promise<void> => {
  const window = campaignWindow();
  if (dataCase.addMode === 'combined') {
    const phrases = dataCase.channels.map((channel) => channelCatalog[channel.key].combinedPhrase);
    const request = `Please add these channels to my plan: ${phrases.join(' and ')}, running ${formatDdMmYyyy(
      window.start
    )} till ${formatDdMmYyyy(window.end)}, Self-Serve`;
    const addedNames = dataCase.channels
      .filter((channel) => !channel.expectBlockedAdd)
      .map((channel) => channelCatalog[channel.key].resolvedName);
    await maxHeroComponent.addCombinedChannels(request, addedNames);
    return;
  }
  for (const channel of dataCase.channels) {
    const catalogEntry = channelCatalog[channel.key];
    if (channel.expectBlockedAdd) {
      await maxHeroComponent.requestChannelExpectingBlock(catalogEntry.request(window));
      continue;
    }
    await planningPage.enterChannelRequest(catalogEntry.request(window), catalogEntry.resolvedName);
  }
};

// Promote `count` measurement-only SKUs of the LIVE journey session to Hero via
// the captured planningAI SET_SKUS contract (the whole selection is replaced,
// and an identical payload is rejected by the backend — so the current state is
// read first and the promotion always changes it), then re-hydrate the session
// so the summary reflects the recomputed validation state.
const promoteMeasurementsToHero = async (page: Page, planningPage: PlanningPage, count: number): Promise<void> => {
  const match = /\/planning\/nectar-ai\/([^/?#]+)/.exec(page.url());
  if (!match) {
    throw new Error(`max-hero suite: cannot extract the planningAI session id from ${page.url()}`);
  }
  const sessionId = match[1];
  const state = (await getPlanningSession(sessionId))?.state as
    | { campaignSkus?: Array<{ skuId: number; isHero: boolean }> }
    | undefined;
  const current = Array.isArray(state?.campaignSkus) ? state.campaignSkus : [];
  const next: SkuSelection[] = current.map((sku) => ({ skuId: sku.skuId, isHero: sku.isHero }));
  let remaining = count;
  for (const sku of next) {
    if (remaining > 0 && !sku.isHero) {
      sku.isHero = true;
      remaining -= 1;
    }
  }
  if (remaining > 0) {
    throw new Error(`max-hero suite: session ${sessionId} has too few measurement-only SKUs to promote ${count}`);
  }
  await setPlanningSkus(sessionId, next);
  await planningPage.gotoSession(sessionId);
};

const applyRowEdit = async (
  planningPage: PlanningPage,
  maxHeroComponent: MaxHeroSkusPerChannelComponent,
  page: Page,
  dataCase: MaxHeroDataCase
): Promise<void> => {
  const edit = dataCase.edit;
  if (edit.kind === 'none') {
    return;
  }
  if (edit.kind === 'remove-via-warning-modal') {
    await maxHeroComponent.openEditModalFromWarning();
    await maxHeroComponent.removeSelectedSkusInModal(edit.removeCount);
    await maxHeroComponent.confirmEditModal();
    return;
  }
  if (edit.kind === 'remove-via-hero-modal') {
    await maxHeroComponent.openHeroEditModal();
    await maxHeroComponent.removeSelectedSkusInModal(edit.removeCount);
    await maxHeroComponent.confirmEditModal();
    return;
  }
  if (edit.kind === 'open-warning-modal') {
    await maxHeroComponent.openEditModalFromWarning();
    return;
  }
  await promoteMeasurementsToHero(page, planningPage, edit.promoteCount);
};

const driveSaveAttempt = async (
  planningPage: PlanningPage,
  maxHeroComponent: MaxHeroSkusPerChannelComponent,
  save: MaxHeroDataCase['save']
): Promise<void> => {
  if (save === 'none') {
    return;
  }
  await planningPage.confirmPlan();
  await planningPage.saveButton().waitFor({ state: 'visible', timeout: 180_000 });
  await planningPage.saveButton().click();
  if (save === 'expect-saved') {
    await planningPage.savedConfirmation().waitFor({ state: 'visible', timeout: 60_000 });
    return;
  }
  await maxHeroComponent.signal('page', SAVE_BLOCKED_COPY).waitFor({ state: 'visible', timeout: 60_000 });
};

// Spec Stability Requirements declare Parallel Safe = no, so the suite runs
// serially — every test writes the shared channel setup config and restores it.
test.describe.serial('Maximum Hero SKUs per channel validation', () => {
  for (const dataCase of dataCases) {
    test(
      `${dataCase.caseId} ${dataCase.sourceId} ${dataCase.title}`,
      { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@max-hero-skus-per-channel'] },
      async ({ page }) => {
        // Full guided journey + channel add(s) + streamed validation turns.
        test.setTimeout(480_000);
        const planningPage = new PlanningPage(page);
        const maxHeroComponent = new MaxHeroSkusPerChannelComponent(page);
        const restoreStack: LimitSnapshot[] = [];
        try {
          await test.step('seed the per-channel Hero SKU limits via the captured admin media API', async () => {
            await seedChannelLimits(dataCase.channels, restoreStack);
          });

          await test.step('build the guided journey to the case Hero SKU selection', async () => {
            await buildJourneyToHeroStage(planningPage, maxHeroComponent, dataCase);
          });

          await test.step('add the case channels and apply the case edits and save attempt', async () => {
            await addRowChannels(planningPage, maxHeroComponent, dataCase);
            await applyRowEdit(planningPage, maxHeroComponent, page, dataCase);
            await driveSaveAttempt(planningPage, maxHeroComponent, dataCase.save);
          });

          await test.step('Assert AC-006: the documented per-channel warning and booking state holds for this data case', async () => {
            for (const outcome of dataCase.expected.visibleSignals) {
              await expect(maxHeroComponent.signal(outcome.scope, outcome.text)).toBeVisible();
            }
            for (const outcome of dataCase.expected.hiddenSignals) {
              await expect(maxHeroComponent.signal(outcome.scope, outcome.text)).toBeHidden();
            }
          });
        } finally {
          await restoreChannelLimits(restoreStack);
        }
      }
    );
  }

  test(
    'AC-001 the guided objective-and-budget planner entry is reachable',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@max-hero-skus-per-channel'] },
    async ({ page }) => {
      test.setTimeout(240_000);
      const planningPage = new PlanningPage(page);

      await test.step('walk the planner entry path', async () => {
        await planningPage.goto();
        await planningPage.startNectarAiPlanner();
      });

      await test.step('Assert AC-001: the guided objective-and-budget flow is active', async () => {
        await expect(planningPage.buildByObjectiveButton()).toBeVisible();
      });
    }
  );

  test(
    'AC-002 the channel under test carries the case-specified maxHeroSkus after seeding',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@max-hero-skus-per-channel'] },
    async () => {
      test.setTimeout(240_000);
      const restoreStack: LimitSnapshot[] = [];
      try {
        await test.step('seed maxHeroSkus=3 on the offsite channel via the captured admin media API', async () => {
          await seedChannelLimits(
            [{ key: 'meta', maxHeroSkus: 3, minHeroSkus: null, expectBlockedAdd: false }],
            restoreStack
          );
        });

        await test.step('Assert AC-002: the channel setup reads back the case-specified maxHeroSkus', async () => {
          await expect.poll(() => readMaxHeroSkus(channelCatalog.meta.mediaName), { timeout: 60_000 }).toBe(3);
        });
      } finally {
        await restoreChannelLimits(restoreStack);
      }
    }
  );

  test(
    'AC-003 advertiser and brand are shown on the summary panel',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@max-hero-skus-per-channel'] },
    async ({ page }) => {
      test.setTimeout(240_000);
      const planningPage = new PlanningPage(page);

      await test.step('confirm the advertiser and brand in the guided flow', async () => {
        await planningPage.goto();
        await planningPage.startNectarAiPlanner();
        await planningPage.chooseBuildByObjectiveAndBudget();
        await planningPage.selectAdvertiser(journey.advertiser);
        await planningPage.selectBrand(journey.brand);
        await planningPage.confirmAdvertiserAndBrand();
      });

      await test.step('Assert AC-003: the summary panel shows the selected advertiser and brand', async () => {
        await expect(planningPage.summaryAdvertiser()).toContainText('N360_Unilever_MS');
        await expect(planningPage.summaryBrands()).toContainText('Knorr');
      });
    }
  );

  test(
    'AC-004 the Hero SKU selection step is reached after confirming measurement SKUs',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@max-hero-skus-per-channel'] },
    async ({ page }) => {
      test.setTimeout(240_000);
      const planningPage = new PlanningPage(page);
      const maxHeroComponent = new MaxHeroSkusPerChannelComponent(page);

      await test.step('build the guided flow through the measurement SKU confirmation', async () => {
        await planningPage.goto();
        await planningPage.startNectarAiPlanner();
        await planningPage.chooseBuildByObjectiveAndBudget();
        await planningPage.selectAdvertiser(journey.advertiser);
        await planningPage.selectBrand(journey.brand);
        await planningPage.confirmAdvertiserAndBrand();
        await planningPage.enterObjective(journey.objective);
        await planningPage.searchProducts(journey.productSearch);
        await maxHeroComponent.selectProducts(2);
        await planningPage.confirmMeasurementSkus();
      });

      await test.step('Assert AC-004: the Hero SKU promotion controls are visible', async () => {
        // locator-policy:exception the first remaining "Add hero SKU" control marks the Hero step
        await expect(planningPage.addHeroSkuButton().first()).toBeVisible();
      });
    }
  );

  test(
    'AC-005 the requested channel is added with the selected Hero SKUs',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@max-hero-skus-per-channel'] },
    async ({ page }) => {
      test.setTimeout(480_000);
      const planningPage = new PlanningPage(page);
      const maxHeroComponent = new MaxHeroSkusPerChannelComponent(page);
      const restoreStack: LimitSnapshot[] = [];
      try {
        await test.step('seed an unrestricted channel and build the journey with 2 Hero SKUs', async () => {
          await seedChannelLimits(
            [{ key: 'meta', maxHeroSkus: null, minHeroSkus: null, expectBlockedAdd: false }],
            restoreStack
          );
          await buildGuidedJourney(planningPage, maxHeroComponent, 2, 2);
          await planningPage.enterChannelRequest(
            channelCatalog.meta.request(campaignWindow()),
            channelCatalog.meta.resolvedName
          );
        });

        await test.step('Assert AC-005: the channel row and the selected Hero SKU count render on the summary', async () => {
          await expect(maxHeroComponent.signal('summary', META_ROW)).toBeVisible();
          await expect(maxHeroComponent.signal('hero-count', /(?<!\d)2 SKUs?/)).toBeVisible();
        });
      } finally {
        await restoreChannelLimits(restoreStack);
      }
    }
  );

  test(
    'DC-025 below-minimum state: the added channel warns that at least 2 Hero SKUs are required',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@max-hero-skus-per-channel'] },
    async ({ page }) => {
      test.setTimeout(480_000);
      const planningPage = new PlanningPage(page);
      const maxHeroComponent = new MaxHeroSkusPerChannelComponent(page);
      const restoreStack: LimitSnapshot[] = [];
      try {
        await test.step('seed minHeroSkus=2/maxHeroSkus=3 and add the channel with a single Hero SKU', async () => {
          await seedChannelLimits(
            [{ key: 'meta', maxHeroSkus: 3, minHeroSkus: 2, expectBlockedAdd: false }],
            restoreStack
          );
          await buildGuidedJourney(planningPage, maxHeroComponent, 1, 1);
          await planningPage.enterChannelRequest(
            channelCatalog.meta.request(campaignWindow()),
            channelCatalog.meta.resolvedName
          );
        });

        await test.step('Assert AC-006: DC-025 the below-minimum warning is shown for the added channel', async () => {
          await expect(maxHeroComponent.signal('summary', META_ROW)).toBeVisible();
          await expect(maxHeroComponent.signal('page', /at least\s*2/i)).toBeVisible();
        });
      } finally {
        await restoreChannelLimits(restoreStack);
      }
    }
  );

  test(
    'NEG-001 the over-limit warning numeral equals the configured max of 2, not the spec-example 3',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@max-hero-skus-per-channel'] },
    async ({ page }) => {
      test.setTimeout(480_000);
      const planningPage = new PlanningPage(page);
      const maxHeroComponent = new MaxHeroSkusPerChannelComponent(page);
      const restoreStack: LimitSnapshot[] = [];
      try {
        await test.step('arrange NEG-001: seed maxHeroSkus=2 and add the channel with 3 Hero SKUs', async () => {
          await seedChannelLimits(
            [{ key: 'meta', maxHeroSkus: 2, minHeroSkus: null, expectBlockedAdd: false }],
            restoreStack
          );
          await buildGuidedJourney(planningPage, maxHeroComponent, 3, 3);
          await planningPage.enterChannelRequest(
            channelCatalog.meta.request(campaignWindow()),
            channelCatalog.meta.resolvedName
          );
        });

        await test.step('Assert NEG-001: the warning numeral is the configured 2 and never a hardcoded 3', async () => {
          await expect(maxHeroComponent.signal('summary', MEDIA_LIMIT_2)).toBeVisible();
          await expect(maxHeroComponent.signal('summary', MEDIA_LIMIT_3)).toBeHidden();
        });
      } finally {
        await restoreChannelLimits(restoreStack);
      }
    }
  );

  test(
    'NEG-002 a channel with maxHeroSkus unset surfaces a deterministic seeded state',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@max-hero-skus-per-channel'] },
    async ({ page }) => {
      test.setTimeout(480_000);
      const planningPage = new PlanningPage(page);
      const maxHeroComponent = new MaxHeroSkusPerChannelComponent(page);
      const restoreStack: LimitSnapshot[] = [];
      try {
        await test.step('arrange NEG-002: null the channel limits and add the channel with 3 Hero SKUs', async () => {
          await seedChannelLimits(
            [{ key: 'meta', maxHeroSkus: null, minHeroSkus: null, expectBlockedAdd: false }],
            restoreStack
          );
          await buildGuidedJourney(planningPage, maxHeroComponent, 3, 3);
          await planningPage.enterChannelRequest(
            channelCatalog.meta.request(campaignWindow()),
            channelCatalog.meta.resolvedName
          );
        });

        await test.step('Assert NEG-002: the channel renders the exact seeded Hero count with no fabricated Media limit', async () => {
          await expect(maxHeroComponent.signal('summary', META_ROW)).toBeVisible();
          await expect(maxHeroComponent.signal('hero-count', /(?<!\d)3 SKUs?/)).toBeVisible();
          await expect(maxHeroComponent.signal('summary', MEDIA_LIMIT_PREFIX)).toBeHidden();
        });
      } finally {
        await restoreChannelLimits(restoreStack);
      }
    }
  );
});
