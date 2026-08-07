import type { JsonValue } from "./json.js";
import type { SupportedHttpMethod } from "./har.js";

export type GenerationMode = "smoke" | "extended";
export type InferenceLevel = "conservative" | "balanced" | "aggressive";
export type InferredRunMode = "mixed" | "all-active" | "replay-only";
export type NegativeStatusPolicy = "family" | "strict" | "config";
export type MutationPolicy = "guarded" | "all-skipped" | "all-active";

export type TestOrigin = "observed" | "inferred";
export type TestCategory =
  | "smoke"
  | "negative"
  | "security"
  | "crud"
  | "scenario";
export type TestConfidence = "high" | "medium" | "low";
// Execution is decided entirely by framework policy. `calibrate` is a machine-operated quarantine:
// the case is skipped in normal runs and executed only when CALIBRATION_MODE=true records evidence.
// There is deliberately no human-approval/review state.
export type TestExecution = "active" | "calibrate" | "skip";
export type MutationRisk = "none" | "guarded" | "unsafe";
export type ScenarioCorrelation = "not-required" | "static" | "missing";

// Result of replaying an inferred negative/security test against the live API (recorded by the
// calibrate loop) and fed back into planning to confirm or refute the bad-input=>4xx expectation.
export interface CalibrationOverride {
  title: string;
  // Optional host scope: titles repeat across hosts in multi-host captures, so a result observed
  // on one host must not graduate the same-titled test on another. Absent in older override files.
  hostname?: string;
  observedStatus: number;
}

export type ExpectedStatus =
  | {
      kind: "exact";
      status: number;
    }
  | {
      kind: "family";
      family: "2xx" | "3xx" | "4xx" | "5xx";
    };

export interface GeneratedTestStep {
  id: string;
  label: string;
  method: SupportedHttpMethod;
  defaultBaseUrl: string;
  pathWithQuery: string;
  requestHeaders: Record<string, string>;
  requestBody?: JsonValue | string;
  requestMimeType?: string;
  fixtureName?: string;
  expectedStatus: ExpectedStatus;
  responseContentType?: string;
  responseTimeBudgetMs: number;
  // Security negatives must not have the generated runtime silently restore the credential that
  // the planner deliberately removed or invalidated.
  suppressGeneratedAuth?: boolean;
}

export interface GeneratedEndpointTestCase extends GeneratedTestStep {
  title: string;
  hostname: string;
  pathPattern: string;
  sourceEntryId: string;
  origin: TestOrigin;
  category: Exclude<TestCategory, "scenario" | "crud">;
  confidence: TestConfidence;
  execution: TestExecution;
  mutationRisk: MutationRisk;
  responseBody?: JsonValue;
  // Every distinct observed response for the selected status contributes to the generated
  // contract. Keeping these samples on the smoke case avoids losing evidence when repeated HAR
  // captures are collapsed to one executable test per endpoint.
  responseSamples?: JsonValue[];
  schemaName?: string;
  assertSchema: boolean;
  assertContentType: boolean;
  assertNoSensitiveFields: boolean;
  // "pending": the framework still needs an automated calibration observation. "confirmed": a
  // 4xx observation activates the exact status. "lenient": a 2xx observation automatically
  // quarantines the invalid expectation.
  calibration?: "pending" | "confirmed" | "lenient";
}

export interface GeneratedScenarioTestCase {
  id: string;
  title: string;
  fileName: string;
  origin: "inferred";
  category: "crud" | "scenario";
  confidence: TestConfidence;
  execution: TestExecution;
  mutationRisk: MutationRisk;
  correlation: ScenarioCorrelation;
  // When true, the scenario runs in its own isolated APIRequestContext (own cookie jar): it logs
  // in itself and tears down its own session, so steps like logout don't affect the shared session.
  isolated: boolean;
  steps: GeneratedTestStep[];
}

export interface GeneratedTestPlan {
  endpointCases: GeneratedEndpointTestCase[];
  scenarioCases: GeneratedScenarioTestCase[];
}
