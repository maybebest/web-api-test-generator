// Factory pattern for channel payloads.
//
// The factory decides WHICH starting configuration to use (the realistic observed in-store channel,
// or a minimal skeleton of a given activation type) and hands back a pre-seeded ChannelBuilder.
// Callers then tweak any fields and call build(). Factory chooses the recipe; Builder customizes it.

import { ChannelBuilder } from './channelBuilder.js';
import { OBSERVED_TROLLEY_CHANNEL } from './fixtures.js';
import type { DeepPartial, MediaInput } from './types.js';

export type ChannelKind = 'inStoreTrolley' | 'inStore' | 'onSite' | 'offSite' | 'atHome' | 'minimal';

const EMPTY_TIMELINE = {
  minCampaignDurationDays: null,
  bookingDeadlineDays: null,
  targetingDeadlineDays: null,
  creativeDeadlineDays: null,
  lateBookingDeadlineDays: null
};

const EMPTY_SETUP = {
  maxHeroSKUs: null,
  minHeroSKUs: null,
  totalSKUs: null,
  ABTestingOptions: [],
  maxFileSize: { value: null, unit: null }
};

const EMPTY_CREATIVE = {
  channelSpecsLink: '',
  contentHubLink: '',
  exampleImage: null
};

const EMPTY_COST = { selfServe: null, managedService: null };

/** Common top-level scalars shared by the skeleton builders. */
function baseSkeleton(name: string): ChannelBuilder {
  return ChannelBuilder.create()
    .name(name)
    .description('')
    .secondaryDescription('')
    .businessGroup('sainsburys')
    .baseAssetType(0, 'Unassigned')
    .managedService(true)
    .selfServe(false)
    .visible(true)
    .visibleArgos(false)
    .internalOnly(false)
    .incrementalFunding(null);
}

export class ChannelFactory {
  /** Factory method: return a pre-seeded builder for the requested kind. */
  static builder(kind: ChannelKind, name?: string): ChannelBuilder {
    switch (kind) {
      case 'inStoreTrolley':
        return ChannelFactory.inStoreTrolley(name);
      case 'inStore':
        return ChannelFactory.inStore(name ?? 'QA In-Store Channel');
      case 'onSite':
        return ChannelFactory.onSite(name ?? 'QA On-Site Channel');
      case 'offSite':
        return ChannelFactory.offSite(name ?? 'QA Off-Site Channel');
      case 'atHome':
        return ChannelFactory.atHome(name ?? 'QA At-Home Channel');
      case 'minimal':
      default:
        return ChannelFactory.inStore(name ?? 'QA Channel');
    }
  }

  /** Factory method: build a ready-to-send `MediaInput`, optionally deep-merging overrides. */
  static create(kind: ChannelKind, overrides?: DeepPartial<MediaInput>): MediaInput {
    const builder = ChannelFactory.builder(kind);
    if (overrides) {
      builder.merge(overrides);
    }
    return builder.build();
  }

  /** Realistic, fully-populated in-store channel cloned from the observed "DD Trolleys" capture. */
  static inStoreTrolley(name?: string): ChannelBuilder {
    const builder = ChannelBuilder.from(OBSERVED_TROLLEY_CHANNEL);
    if (name) {
      builder.name(name);
    }
    return builder;
  }

  /** Minimal valid in-store channel skeleton. */
  static inStore(name: string): ChannelBuilder {
    return baseSkeleton(name).inStore({
      type: 'TROLLEY',
      storeType: 'MAIN_ESTATE',
      subType: 'MAIN',
      isTargetedChannel: false,
      isCmsBroadsignMedia: null,
      audienceAndTargeting: {
        minAudienceVolume: null,
        maxAudienceVolume: null,
        minStoreVolume: null,
        maxStoreVolume: null,
        hasHFSSRestrictions: false,
        restrictedCategories: [],
        shouldApplyToEverywhereRanged: false,
        hasSetStoreList: false,
        whoCanBuildTargeting: 'ALL_USERS',
        isPollenTargetingRequired: false,
        canClientSetPreferentialStoreList: false
      },
      cost: EMPTY_COST,
      timeline: EMPTY_TIMELINE,
      setup: EMPTY_SETUP,
      creative: EMPTY_CREATIVE,
      planningQuestions: {},
      piggyBackAssets: null
    });
  }

  /** Minimal on-site channel skeleton (input shape not exercised by the capture — adjust as needed). */
  static onSite(name: string): ChannelBuilder {
    return baseSkeleton(name).onSite({
      type: 'BANNER',
      isTargetedChannel: false,
      audienceAndTargeting: {},
      cost: EMPTY_COST,
      timeline: EMPTY_TIMELINE,
      setup: EMPTY_SETUP,
      creative: EMPTY_CREATIVE,
      planningQuestions: {}
    });
  }

  /** Minimal off-site channel skeleton (input shape not exercised by the capture — adjust as needed). */
  static offSite(name: string): ChannelBuilder {
    return baseSkeleton(name).offSite({
      type: 'PROGRAMMATIC',
      provider: '',
      audienceAndTargeting: {},
      cost: EMPTY_COST,
      timeline: EMPTY_TIMELINE,
      setup: EMPTY_SETUP,
      creative: EMPTY_CREATIVE,
      planningQuestions: {}
    });
  }

  /** Minimal at-home channel skeleton (input shape not exercised by the capture — adjust as needed). */
  static atHome(name: string): ChannelBuilder {
    return baseSkeleton(name).atHome({
      type: 'EMAIL',
      subType: 'MAIN',
      isTargetedChannel: false,
      audienceAndTargeting: {},
      cost: EMPTY_COST,
      timeline: EMPTY_TIMELINE,
      setup: EMPTY_SETUP,
      creative: EMPTY_CREATIVE,
      planningQuestions: {}
    });
  }

  /** Deterministic-ish unique name for create tests (Date.now keeps generated names distinct). */
  static uniqueName(prefix = 'QA Channel'): string {
    return `${prefix} ${new Date().toISOString()}`;
  }
}
