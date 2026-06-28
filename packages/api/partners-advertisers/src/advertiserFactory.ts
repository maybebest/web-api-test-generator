// Factory pattern for advertiser payloads.
//
// The factory decides WHICH starting configuration to use (a realistic sample, or a minimal
// skeleton) and hands back a pre-seeded AdvertiserBuilder. Factory chooses the recipe; Builder
// customizes any field.

import { AdvertiserBuilder } from './advertiserBuilder.js';
import { SAMPLE_ADVERTISER } from './fixtures.js';
import type { DeepPartial, AdvertiserInput } from './types.js';

export type AdvertiserKind = 'sample' | 'minimal';

export class AdvertiserFactory {
  /** Factory method: return a pre-seeded builder for the requested kind. */
  static builder(kind: AdvertiserKind, displayName?: string): AdvertiserBuilder {
    switch (kind) {
      case 'sample':
        return AdvertiserFactory.sample(displayName);
      case 'minimal':
      default:
        return AdvertiserFactory.minimal(displayName ?? 'QA Advertiser');
    }
  }

  /** Factory method: build a ready-to-send `AdvertiserInput`, optionally deep-merging overrides. */
  static create(kind: AdvertiserKind, overrides?: DeepPartial<AdvertiserInput>): AdvertiserInput {
    const builder = AdvertiserFactory.builder(kind);
    if (overrides) {
      builder.merge(overrides);
    }
    return builder.build();
  }

  /** A realistic, fully-populated advertiser seeded from the reference sample. */
  static sample(displayName?: string): AdvertiserBuilder {
    const builder = AdvertiserBuilder.from(SAMPLE_ADVERTISER);
    if (displayName) {
      builder.displayName(displayName);
    }
    return builder;
  }

  /** Minimal valid advertiser skeleton (just the required displayName + safe defaults). */
  static minimal(displayName: string): AdvertiserBuilder {
    return AdvertiserBuilder.create()
      .displayName(displayName)
      .businessGroup('sainsburys')
      .level2Reporting(false)
      .newBusinessClient(false)
      .strategicClient(false)
      .goldClient(false)
      .planningPriorityClient(false)
      .sipAccess(false)
      .sainsburysGSA(false)
      .futureBrand(false)
      .brands([]);
  }

  /** Deterministic-ish unique name for create tests. */
  static uniqueName(prefix = 'QA Advertiser'): string {
    return `${prefix} ${new Date().toISOString()}`;
  }
}
