import type { SupportedHttpMethod } from './har.js';
import type {
  ExpectedStatus,
  GenerationMode,
  InferenceLevel,
  InferredRunMode,
  MutationPolicy,
  NegativeStatusPolicy
} from './testCase.js';

export type NegativeExpectedStatusKey = 'missing-field' | 'invalid-type' | 'invalid-path-param' | 'boundary';
export type SecurityExpectedStatusKey =
  | 'missing-header'
  | 'invalid-header'
  | 'missing-auth'
  | 'invalid-auth'
  | 'missing-csrf'
  | 'invalid-csrf';

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
  grouping: 'domain-and-first-segment';
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
    // smoke as destructive -> generated as test.fixme so it can't run unattended.
    destructivePathPatterns?: string[];
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
  generationModes: GenerationMode[];
  inferenceLevel: InferenceLevel;
  inferredRunMode: InferredRunMode;
  negativeStatusPolicy: NegativeStatusPolicy;
  mutationPolicy: MutationPolicy;
  ai: boolean;
  dryRun: boolean;
  configPath?: string;
  calibrationOverridesPath?: string;
}

export interface GenerationSummary {
  parsedEntries: number;
  filteredEntries: number;
  generatedTests: number;
  generatedFiles: string[];
  dryRun: boolean;
}
