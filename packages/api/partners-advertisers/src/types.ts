// Domain types for Pollen Partners/Advertisers management, derived from the Partners-advertisers HAR.
//
// The capture exercised READ (admin_getAdvertisers / admin_getAdvertiser) and the partner-assignment
// mutation. The WRITE model (admin_AdvertiserInput) was NOT captured — it is inferred from the read
// selection, so `AdvertiserInput` is a best-effort shape; verify it against the schema.

/** Keeps editor autocomplete for known values while still accepting any string. */
export type BusinessGroup = 'sainsburys' | 'argos' | 'nectar' | (string & {});

export interface FileRef {
  actualFilename: string;
  internalFilename: string;
}

/** Brand as returned by the read selection. */
export interface Brand {
  id: string;
  displayName: string;
  customName?: string | null;
  /** Read-only: channels available to this brand (admin_getAdvertiser only). */
  availableChannels?: string[] | null;
}

/** Brand as accepted by the (inferred) write input. */
export interface BrandInput {
  id?: string;
  displayName: string;
  customName?: string | null;
}

/** Base company lookup (base_getCompanies). */
export interface Company {
  id: string;
  name: string;
}

/** Read-only mapping of an advertiser to a partner's agency-base id. */
export interface AgencyBaseAdvertiserMapper {
  partnerId: string;
  partnerName: string;
  baseId: string;
}

/** The editable advertiser fields shared by read and write. */
export interface AdvertiserCoreFields {
  displayName: string;
  customName?: string | null;
  businessGroup?: BusinessGroup | null;
  websiteUrl?: string | null;
  baseCompanyId?: string | null;
  level2ReportingEnabled?: boolean | null;
  newBusinessClient?: boolean | null;
  strategicClient?: boolean | null;
  goldClient?: boolean | null;
  planningPriorityClient?: boolean | null;
  sipAccess?: boolean | null;
  sainsburysGSA?: boolean | null;
  futureBrand?: boolean | null;
  clientAgreement?: string | null;
  clientAgreementDocument?: FileRef | null;
}

/**
 * `admin_AdvertiserInput` — the advertiser WRITE model accepted by the (inferred) admin_createAdvertiser
 * and admin_editAdvertiser. Shape inferred from the read selection — verify against the schema.
 */
export interface AdvertiserInput extends AdvertiserCoreFields {
  brands?: BrandInput[];
}

/**
 * Advertiser READ model returned by admin_getAdvertiser / admin_getAdvertisers: the editable fields
 * plus server-managed fields (id, createdAt, activeChannels, agencyBaseAdvertiserMapper). The read
 * type is WIDER than the write input, so a read→write roundtrip is projected via
 * `AdvertiserBuilder.toInput` first.
 */
export interface Advertiser extends AdvertiserCoreFields {
  id: string;
  createdAt?: string | null;
  /** Read-only: number of active channels for this advertiser. */
  activeChannels?: number | null;
  brands?: Brand[];
  agencyBaseAdvertiserMapper?: AgencyBaseAdvertiserMapper[] | null;
}

export type DeepPartial<T> = T extends (infer U)[]
  ? DeepPartial<U>[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;
