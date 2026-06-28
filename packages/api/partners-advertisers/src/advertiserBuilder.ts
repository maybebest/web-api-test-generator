// Builder pattern for advertiser (`admin_AdvertiserInput`) payloads.
//
// Typed fluent setters for common fields PLUS a generic `.set(path, value)` / `.merge(partial)` that
// can change ANY field, however deep. `AdvertiserBuilder.from(existingAdvertiser)` seeds the draft
// from a read result (projecting the wider read model down to the writable input), which is the basis
// for "read → change a field → update".

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
  Advertiser,
  AdvertiserInput,
  BrandInput,
  BusinessGroup,
  DeepPartial,
  FileRef
} from './types.js';

// Server-managed top-level fields present on the read model but not part of admin_AdvertiserInput.
const TOP_LEVEL_OUTPUT_ONLY = ['id', 'createdAt', 'activeChannels', 'agencyBaseAdvertiserMapper'];

// Nested fields the read selection returns but the write input rejects (best-effort denylist).
const NESTED_OUTPUT_ONLY = ['availableChannels'];

export class AdvertiserBuilder {
  private draft: DeepPartial<AdvertiserInput>;

  private constructor(seed: DeepPartial<AdvertiserInput>) {
    this.draft = deepClone(seed);
  }

  /** Start from an empty draft. */
  static create(): AdvertiserBuilder {
    return new AdvertiserBuilder({});
  }

  /** Seed from an existing advertiser/input, projecting a read model down to the writable input. */
  static from(source: Advertiser | AdvertiserInput | DeepPartial<AdvertiserInput>): AdvertiserBuilder {
    return new AdvertiserBuilder(AdvertiserBuilder.toInput(source));
  }

  /** Project a (possibly read-model) advertiser onto the writable `admin_AdvertiserInput` shape. */
  static toInput(source: Advertiser | AdvertiserInput | DeepPartial<AdvertiserInput>): DeepPartial<AdvertiserInput> {
    const clone = deepClone(source) as Record<string, unknown>;
    for (const key of TOP_LEVEL_OUTPUT_ONLY) {
      delete clone[key];
    }
    pruneNested(clone, new Set(NESTED_OUTPUT_ONLY));
    return clone as DeepPartial<AdvertiserInput>;
  }

  // --- typed fluent setters ----------------------------------------------------------------------

  displayName(value: string): this {
    this.draft.displayName = value;
    return this;
  }

  customName(value: string | null): this {
    this.draft.customName = value;
    return this;
  }

  businessGroup(value: BusinessGroup | null): this {
    this.draft.businessGroup = value;
    return this;
  }

  websiteUrl(value: string | null): this {
    this.draft.websiteUrl = value;
    return this;
  }

  baseCompanyId(value: string | null): this {
    this.draft.baseCompanyId = value;
    return this;
  }

  level2Reporting(value = true): this {
    this.draft.level2ReportingEnabled = value;
    return this;
  }

  newBusinessClient(value = true): this {
    this.draft.newBusinessClient = value;
    return this;
  }

  strategicClient(value = true): this {
    this.draft.strategicClient = value;
    return this;
  }

  goldClient(value = true): this {
    this.draft.goldClient = value;
    return this;
  }

  planningPriorityClient(value = true): this {
    this.draft.planningPriorityClient = value;
    return this;
  }

  sipAccess(value = true): this {
    this.draft.sipAccess = value;
    return this;
  }

  sainsburysGSA(value = true): this {
    this.draft.sainsburysGSA = value;
    return this;
  }

  futureBrand(value = true): this {
    this.draft.futureBrand = value;
    return this;
  }

  clientAgreement(value: string | null): this {
    this.draft.clientAgreement = value;
    return this;
  }

  clientAgreementDocument(value: FileRef | null): this {
    this.draft.clientAgreementDocument = value;
    return this;
  }

  /** Replace the whole brands array. */
  brands(value: BrandInput[]): this {
    this.draft.brands = deepClone(value);
    return this;
  }

  /** Append a single brand. */
  addBrand(brand: BrandInput): this {
    const list = (this.draft.brands as BrandInput[] | undefined) ?? [];
    list.push(deepClone(brand));
    this.draft.brands = list;
    return this;
  }

  // --- generic "change ANY field" API ------------------------------------------------------------

  /** Set any field by path: `.set('brands[0].displayName', 'New')` or `.set('goldClient', true)`. */
  set(path: PathInput, value: unknown): this {
    deepSet(this.draft, path, value);
    return this;
  }

  /** Read the current draft value at a path. */
  get(path: PathInput): unknown {
    return deepGet(this.draft, path);
  }

  /** Remove a field by path. */
  unset(path: PathInput): this {
    deepUnset(this.draft, path);
    return this;
  }

  /** Deep-merge a partial advertiser into the draft. */
  merge(patch: DeepPartial<AdvertiserInput>): this {
    this.draft = deepMerge(this.draft, patch);
    return this;
  }

  /** Escape hatch for arbitrary mutation of the raw draft. */
  apply(mutator: (draft: DeepPartial<AdvertiserInput>) => void): this {
    mutator(this.draft);
    return this;
  }

  /** A defensive copy of the current draft (not validated). */
  toJSON(): DeepPartial<AdvertiserInput> {
    return deepClone(this.draft);
  }

  /** Validate the minimum required field (displayName) and return a complete `AdvertiserInput`. */
  build(): AdvertiserInput {
    if (this.draft.displayName == null || this.draft.displayName === '') {
      throw new Error(
        'AdvertiserBuilder.build(): missing required field "displayName". ' +
          'Seed from AdvertiserFactory or set it before build().'
      );
    }
    return deepClone(this.draft) as AdvertiserInput;
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
