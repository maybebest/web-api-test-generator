import type { SupportedHttpMethod } from "./har.js";
import type {
  ExpectedStatus,
  GenerationMode,
  InferenceLevel,
  InferredRunMode,
  MutationPolicy,
  NegativeStatusPolicy,
} from "./testCase.js";

export type NegativeExpectedStatusKey =
  | "missing-field"
  | "invalid-type"
  | "invalid-path-param"
  | "boundary";
export type SecurityExpectedStatusKey =
  | "missing-header"
  | "invalid-header"
  | "missing-auth"
  | "invalid-auth"
  | "missing-csrf"
  | "invalid-csrf";

export interface ExpectedStatusOverrides {
  negative: Partial<Record<NegativeExpectedStatusKey, ExpectedStatus>>;
  security: Partial<Record<SecurityExpectedStatusKey, ExpectedStatus>>;
}

export interface HarApiTestConfig {
  staticAssetExtensions: string[];
  trackingDomains: string[];
  beaconPaths: string[];
  ignoredHeaderNames: string[];
  secretHeaderNames: string[];
  secretFieldNames: string[];
  responseTimeBudgetMs: number;
  grouping: "domain-and-first-segment";
  output: {
    supportDir: string;
    fixturesDir: string;
    schemasDir: string;
  };
  filters: {
    ignoredDomains: string[];
    firstPartyDomains: string[];
    methods: SupportedHttpMethod[];
    statuses: number[];
    include: string[];
    exclude: string[];
  };
  generation: {
    modes: GenerationMode[];
    inferenceLevel: InferenceLevel;
    inferredRunMode: InferredRunMode;
    negativeStatusPolicy: NegativeStatusPolicy;
    mutationPolicy: MutationPolicy;
    expectedStatuses: ExpectedStatusOverrides;
    // Path patterns (regex, matched case-insensitively against pathPattern) that mark a mutating
    // smoke as destructive. The guarded policy skips these automatically; all-active enables them.
    destructivePathPatterns?: string[];
    // When true, the generated request path preserves repeated query parameters (?id=1&id=2) in
    // their original order instead of collapsing them to the last value. Enabled by default so
    // captures such as ?id=1&id=2 retain their request semantics.
    preserveDuplicateQueryParams?: boolean;
  };
}

export interface CliGenerateOptions {
  harInputs: string[];
  outDir: string;
  baseUrl?: string;
  include: string[];
  exclude: string[];
  ignoredDomains: string[];
  firstPartyDomains: string[];
  methods: SupportedHttpMethod[];
  statuses: number[];
  // Undefined means the CLI did not override the corresponding config value.
  generationModes?: GenerationMode[];
  inferenceLevel?: InferenceLevel;
  inferredRunMode?: InferredRunMode;
  negativeStatusPolicy?: NegativeStatusPolicy;
  mutationPolicy?: MutationPolicy;
  ai: boolean;
  dryRun: boolean;
  // Tri-state CLI override for generation.preserveDuplicateQueryParams: true/false when the flag is
  // given (--preserve-duplicate-query-params[=true|false]), undefined when absent so the config /
  // built-in default still wins.
  preserveDuplicateQueryParams?: boolean;
  configPath?: string;
  calibrationOverridesPath?: string;
}

export type GenerationPublication = "dry-run" | "unchanged" | "published";

export interface GenerationInputProvenance {
  path: string;
  sizeBytes: number;
  sha256: string;
}

export interface GenerationProvenance {
  formatVersion: 1;
  inputs: {
    sha256: string;
    files: GenerationInputProvenance[];
  };
  effectiveConfigSha256: string;
  effectiveOptionsSha256: string;
  calibration: {
    present: boolean;
    contentSha256?: string;
    semanticSha256: string;
    entryCount: number;
  };
  generator: {
    buildId: string;
    sha256: string;
  };
  fingerprintSha256: string;
}

export interface GenerationTimings {
  parseMs: number;
  filterMs: number;
  normalizeMs: number;
  calibrationMs: number;
  provenanceMs: number;
  planMs: number;
  outputVerificationMs: number;
  writeMs: number;
  markerMs: number;
  publishMs: number;
  totalMs: number;
}

export interface GenerationLlmUsage {
  mode: "not-used";
  requests: number;
  successfulRequests: number;
  failedRequests: number;
  retries: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  retryTokens: number;
  totalTokens: number;
}

export interface GenerationSummary {
  parsedEntries: number;
  filteredEntries: number;
  generatedTests: number;
  generatedFiles: string[];
  dryRun: boolean;
  publication: GenerationPublication;
  timings: GenerationTimings;
  llmUsage: GenerationLlmUsage;
  provenance: GenerationProvenance;
}
