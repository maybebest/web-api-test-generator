// Builder pattern for channel (`admin_MediaInput`) payloads.
//
// Why a builder: the payload is large and deeply nested, and tests want to start from a valid
// channel and change just one or two fields. The builder offers BOTH:
//   - typed fluent setters for the common top-level fields, and
//   - a generic `.set(path, value)` / `.merge(partial)` that can change ANY field, however deep.
//
// `ChannelBuilder.from(existingChannel)` seeds the draft from a read result (projecting the wider
// read model down to the writable input), which is the basis for "read → change a field → update".

import {
  deepClone,
  deepGet,
  deepMerge,
  deepSet,
  deepUnset,
  isPlainObject,
  type PathInput
} from './deepObject.js';
import type {
  AtHomeActivation,
  BaseAssetType,
  BusinessGroup,
  Channel,
  DeepPartial,
  InStoreActivation,
  MediaInput,
  OffSiteActivation,
  OnSiteActivation
} from './types.js';

type ActivationKey = 'inStore' | 'onSite' | 'offSite' | 'atHome';
const ACTIVATION_KEYS: ActivationKey[] = ['inStore', 'onSite', 'offSite', 'atHome'];

// Server-managed top-level fields that exist on the read model but are not part of admin_MediaInput.
const TOP_LEVEL_OUTPUT_ONLY = ['id', 'channelType', 'createdAt', 'updatedAt'];

// Nested fields the read selection returns but the write input rejects. Best-effort denylist for the
// read→write roundtrip; extend it if the server reports "unknown field" on an inferred update.
const NESTED_OUTPUT_ONLY = [
  'citrusAdPlacement',
  'citrusAdPlacementLabel',
  'isAudienceTargetingAvailable',
  'isMediaPartOfEMP',
  'tierBasedOnVolumeImpressions',
  'tierBasedCategories',
  'matchRate'
];

export class ChannelBuilder {
  private draft: DeepPartial<MediaInput>;

  private constructor(seed: DeepPartial<MediaInput>) {
    this.draft = deepClone(seed);
  }

  /** Start from an empty draft. */
  static create(): ChannelBuilder {
    return new ChannelBuilder({});
  }

  /** Seed from an existing channel/input, projecting a read model down to the writable input. */
  static from(source: Channel | MediaInput | DeepPartial<MediaInput>): ChannelBuilder {
    return new ChannelBuilder(ChannelBuilder.toInput(source));
  }

  /**
   * Project a (possibly read-model) channel onto the writable `admin_MediaInput` shape by removing
   * server-managed top-level fields and known output-only nested fields.
   */
  static toInput(source: Channel | MediaInput | DeepPartial<MediaInput>): DeepPartial<MediaInput> {
    const clone = deepClone(source) as Record<string, unknown>;
    for (const key of TOP_LEVEL_OUTPUT_ONLY) {
      delete clone[key];
    }
    pruneNested(clone, new Set(NESTED_OUTPUT_ONLY));
    return clone as DeepPartial<MediaInput>;
  }

  // --- typed fluent setters for common top-level fields ------------------------------------------

  name(value: string): this {
    this.draft.name = value;
    return this;
  }

  description(value: string): this {
    this.draft.description = value;
    return this;
  }

  secondaryDescription(value: string): this {
    this.draft.secondaryDescription = value;
    return this;
  }

  businessGroup(value: BusinessGroup): this {
    this.draft.businessGroup = value;
    return this;
  }

  baseAssetType(id: number, name: string): this {
    this.draft.baseAssetType = { id, name } satisfies BaseAssetType;
    return this;
  }

  visible(value = true): this {
    this.draft.isVisible = value;
    return this;
  }

  visibleArgos(value = true): this {
    this.draft.isVisibleArgos = value;
    return this;
  }

  internalOnly(value = true): this {
    this.draft.isVisibleToInternalOnly = value;
    return this;
  }

  selfServe(value = true): this {
    this.draft.isSelfServe = value;
    return this;
  }

  managedService(value = true): this {
    this.draft.isManagedService = value;
    return this;
  }

  incrementalFunding(value: boolean | null): this {
    this.draft.isIncrementalFundingAvailable = value;
    return this;
  }

  // --- activation surfaces (mutually exclusive) --------------------------------------------------

  inStore(block: DeepPartial<InStoreActivation>): this {
    return this.setActivation('inStore', block);
  }

  onSite(block: DeepPartial<OnSiteActivation>): this {
    return this.setActivation('onSite', block);
  }

  offSite(block: DeepPartial<OffSiteActivation>): this {
    return this.setActivation('offSite', block);
  }

  atHome(block: DeepPartial<AtHomeActivation>): this {
    return this.setActivation('atHome', block);
  }

  private setActivation(kind: ActivationKey, block: DeepPartial<unknown>): this {
    for (const key of ACTIVATION_KEYS) {
      this.draft[key] = key === kind ? (deepClone(block) as never) : null;
    }
    return this;
  }

  // --- generic "change ANY field" API ------------------------------------------------------------

  /** Set any field by path: `.set('inStore.cost.managedService.minimumSpend', 250)`. */
  set(path: PathInput, value: unknown): this {
    deepSet(this.draft, path, value);
    return this;
  }

  /** Read the current draft value at a path (useful for assertions/derivations). */
  get(path: PathInput): unknown {
    return deepGet(this.draft, path);
  }

  /** Remove a field by path. */
  unset(path: PathInput): this {
    deepUnset(this.draft, path);
    return this;
  }

  /** Deep-merge a partial channel into the draft (arrays/scalars replace; objects merge). */
  merge(patch: DeepPartial<MediaInput>): this {
    this.draft = deepMerge(this.draft, patch);
    return this;
  }

  /** Escape hatch for arbitrary mutation of the raw draft. */
  apply(mutator: (draft: DeepPartial<MediaInput>) => void): this {
    mutator(this.draft);
    return this;
  }

  /** A defensive copy of the current draft (not validated). */
  toJSON(): DeepPartial<MediaInput> {
    return deepClone(this.draft);
  }

  /**
   * Validate the minimum required fields and return a complete `MediaInput`. Throws a clear error if
   * a required field is missing or if zero/multiple activation surfaces are populated.
   */
  build(): MediaInput {
    const missing = (['name', 'businessGroup', 'baseAssetType'] as const).filter(
      (field) => this.draft[field] == null
    );
    if (missing.length > 0) {
      throw new Error(
        `ChannelBuilder.build(): missing required field(s) ${missing.join(', ')}. ` +
          'Seed from ChannelFactory or set them before build().'
      );
    }

    const activations = ACTIVATION_KEYS.filter((key) => this.draft[key] != null);
    if (activations.length !== 1) {
      throw new Error(
        `ChannelBuilder.build(): exactly one activation surface must be set, found ${
          activations.length === 0 ? 'none' : activations.join(' + ')
        } (inStore | onSite | offSite | atHome).`
      );
    }

    return deepClone(this.draft) as MediaInput;
  }
}

function pruneNested(target: unknown, denied: Set<string>): void {
  if (Array.isArray(target)) {
    target.forEach((item) => pruneNested(item, denied));
    return;
  }
  if (!isPlainObject(target)) {
    return;
  }
  for (const key of Object.keys(target)) {
    if (denied.has(key)) {
      delete target[key];
      continue;
    }
    pruneNested(target[key], denied);
  }
}
