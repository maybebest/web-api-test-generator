import type { HarApiTestConfig, NegativeExpectedStatusKey, SecurityExpectedStatusKey } from '../types/config.js';
import type { NormalizedHarEntry, SupportedHttpMethod } from '../types/har.js';
import type { JsonObject, JsonValue } from '../types/json.js';
import { isJsonObject } from '../types/json.js';
import type {
  CalibrationOverride,
  ExpectedStatus,
  GeneratedEndpointTestCase,
  GeneratedScenarioTestCase,
  GeneratedTestPlan,
  GeneratedTestStep,
  InferenceLevel,
  MutationPolicy,
  TestCategory,
  TestConfidence,
  TestExecution,
  MutationRisk
} from '../types/testCase.js';
import { shortHash, slugify } from '../utils/url.js';
import { compareStrings } from '../utils/compare.js';

interface PlannerOptions {
  modes: string[];
  inferenceLevel: InferenceLevel;
  inferredRunMode: string;
  negativeStatusPolicy: HarApiTestConfig['generation']['negativeStatusPolicy'];
  mutationPolicy: MutationPolicy;
  expectedStatuses: HarApiTestConfig['generation']['expectedStatuses'];
  destructivePathPatterns: string[];
  calibrationOverrides: CalibrationOverride[];
}

interface BodyVariant {
  fieldName: string;
  body: JsonValue | string;
}

const CRUD_ORDER: Array<'create' | 'read' | 'update' | 'delete'> = ['create', 'read', 'update', 'delete'];

export function planGeneratedTests(
  entries: NormalizedHarEntry[],
  config: HarApiTestConfig,
  options?: Partial<PlannerOptions>
): GeneratedTestPlan {
  const plannerOptions: PlannerOptions = {
    modes: options?.modes ?? config.generation.modes,
    inferenceLevel: options?.inferenceLevel ?? config.generation.inferenceLevel,
    inferredRunMode: options?.inferredRunMode ?? config.generation.inferredRunMode,
    negativeStatusPolicy: options?.negativeStatusPolicy ?? config.generation.negativeStatusPolicy,
    mutationPolicy: options?.mutationPolicy ?? config.generation.mutationPolicy,
    expectedStatuses: options?.expectedStatuses ?? config.generation.expectedStatuses,
    destructivePathPatterns: options?.destructivePathPatterns ?? config.generation.destructivePathPatterns ?? [],
    calibrationOverrides: options?.calibrationOverrides ?? []
  };
  const normalizedEntries = dedupeEntries(entries);
  const endpointCases: GeneratedEndpointTestCase[] = [];
  const scenarioCases: GeneratedScenarioTestCase[] = [];

  if (plannerOptions.modes.includes('smoke')) {
    endpointCases.push(...buildSmokeCases(normalizedEntries, config, plannerOptions));
  }

  if (plannerOptions.modes.includes('extended')) {
    // Infer from ONE representative per (host, method, pathPattern), consistent with the smoke
    // tier: re-captures of the same endpoint (e.g. differing only by multipart boundary) survive
    // dedupeEntries and would otherwise emit every negative/security case twice.
    for (const entry of chooseEndpointRepresentatives(normalizedEntries)) {
      endpointCases.push(...inferNegativeCases(entry, config, plannerOptions));
      endpointCases.push(...inferSecurityCases(entry, config, plannerOptions));
      endpointCases.push(...inferPathParameterCases(entry, config, plannerOptions));
    }
    scenarioCases.push(...inferCrudScenarios(normalizedEntries, config, plannerOptions));
    scenarioCases.push(...inferFlowScenarios(normalizedEntries, config, plannerOptions));
  }

  return {
    endpointCases: applyCalibrationOverrides(ensureUniqueTitles(endpointCases), plannerOptions.calibrationOverrides).sort(
      compareEndpointCases
    ),
    scenarioCases: ensureUniqueScenarioTitles(scenarioCases).sort((left, right) => compareStrings(left.fileName, right.fileName))
  };
}

/**
 * Smoke tier: exactly one repeatable test per (host, method, pathPattern), for every method
 * including mutating ones. Picks the most informative observed sample (successful + with a body).
 */
function buildSmokeCases(
  entries: NormalizedHarEntry[],
  config: HarApiTestConfig,
  options: PlannerOptions
): GeneratedEndpointTestCase[] {
  return chooseEndpointRepresentatives(entries).map((entry) => buildSmokeCase(entry, config, options));
}

function chooseEndpointRepresentatives(entries: NormalizedHarEntry[]): NormalizedHarEntry[] {
  const byEndpoint = new Map<string, NormalizedHarEntry[]>();
  for (const entry of entries) {
    const key = `${entry.hostname} ${entry.method} ${entry.pathPattern}`;
    byEndpoint.set(key, [...(byEndpoint.get(key) ?? []), entry]);
  }

  return [...byEndpoint.values()].map(chooseSmokeRepresentative);
}

function chooseSmokeRepresentative(group: NormalizedHarEntry[]): NormalizedHarEntry {
  return [...group].sort((left, right) => {
    const successDelta = Number(isSuccessStatus(right.responseStatus)) - Number(isSuccessStatus(left.responseStatus));
    if (successDelta !== 0) {
      return successDelta;
    }

    const bodyDelta = Number(right.responseBody !== undefined) - Number(left.responseBody !== undefined);
    if (bodyDelta !== 0) {
      return bodyDelta;
    }

    // The representative also seeds missing-field inference, which needs the request body shape.
    const requestBodyDelta = Number(right.requestBody !== undefined) - Number(left.requestBody !== undefined);
    if (requestBodyDelta !== 0) {
      return requestBodyDelta;
    }

    return left.entryIndex - right.entryIndex;
  })[0];
}

function buildSmokeCase(
  entry: NormalizedHarEntry,
  config: HarApiTestConfig,
  options: PlannerOptions
): GeneratedEndpointTestCase {
  const method = entry.method as SupportedHttpMethod;
  const destructive = isDestructiveSmoke(method, entry.pathPattern, options.destructivePathPatterns);

  return {
    ...baseStep(entry, 'smoke', entry.requestBody, entry.fixtureName),
    title: `smoke: ${entry.method} ${entry.pathPattern} returns ${entry.responseStatus}`,
    hostname: entry.hostname,
    pathPattern: entry.pathPattern,
    sourceEntryId: entry.id,
    origin: 'observed',
    category: 'smoke',
    confidence: 'high',
    // Destructive mutating smokes (logout, password change, deletes, ...) are generated as
    // test.fixme so a full smoke run can't change state / lock the account out unattended.
    execution: destructive ? 'fixme' : 'active',
    mutationRisk: !isMutatingMethod(method) ? 'none' : destructive ? 'unsafe' : 'guarded',
    responseBody: entry.responseBody,
    schemaName: entry.schemaName,
    assertSchema: entry.responseBody !== undefined,
    assertContentType: Boolean(entry.responseContentType),
    // Response key-name scanning is false-positive-prone (endpoints like /user/session legitimately
    // return token/csrf fields); leave it to the dedicated security tests.
    assertNoSensitiveFields: false,
    responseTimeBudgetMs: Math.max(config.responseTimeBudgetMs, entry.responseTimeMs)
  };
}

function inferNegativeCases(
  entry: NormalizedHarEntry,
  config: HarApiTestConfig,
  options: PlannerOptions
): GeneratedEndpointTestCase[] {
  // Only infer negatives where the request succeeded and carried a body — that is the only place
  // a "missing required field" expectation is well-founded.
  if (entry.requestBody === undefined || !isSuccessStatus(entry.responseStatus)) {
    return [];
  }

  return missingFieldVariants(entry.requestBody, entry.requestMimeType, options.inferenceLevel).map((variant) =>
    buildInferredCase(entry, config, options, {
      category: 'negative',
      confidence: 'high',
      mutationRisk: 'guarded',
      title: `negative: ${entry.method} ${entry.pathPattern} rejects missing ${variant.fieldName}`,
      requestBody: variant.body,
      fixtureSuffix: `missing-${slugify(variant.fieldName)}`,
      headers: entry.requestHeaders,
      expectedStatus: negativeExpectedStatus('missing-field', options),
      assertNoSensitiveFields: true
    })
  );
}

function inferSecurityCases(
  entry: NormalizedHarEntry,
  config: HarApiTestConfig,
  options: PlannerOptions
): GeneratedEndpointTestCase[] {
  if (!isSuccessStatus(entry.responseStatus)) {
    return [];
  }

  const secretHeaders = Object.entries(entry.requestHeaders).filter(([name]) => isSecretHeader(name));
  const cases: GeneratedEndpointTestCase[] = [];

  for (const [headerName] of secretHeaders) {
    const missingHeaders = { ...entry.requestHeaders };
    delete missingHeaders[headerName];
    cases.push(
      buildInferredCase(entry, config, options, {
        category: 'security',
        confidence: 'high',
        mutationRisk: 'guarded',
        title: `security: ${entry.method} ${entry.pathPattern} rejects missing ${headerName}`,
        requestBody: entry.requestBody,
        fixtureSuffix: `missing-${slugify(headerName)}`,
        headers: missingHeaders,
        expectedStatus: securityExpectedStatus(headerName, 'missing', options),
        assertNoSensitiveFields: true
      })
    );

    cases.push(
      buildInferredCase(entry, config, options, {
        category: 'security',
        confidence: 'high',
        mutationRisk: 'guarded',
        title: `security: ${entry.method} ${entry.pathPattern} rejects invalid ${headerName}`,
        requestBody: entry.requestBody,
        fixtureSuffix: `invalid-${slugify(headerName)}`,
        headers: {
          ...entry.requestHeaders,
          [headerName]: invalidHeaderValue(headerName)
        },
        expectedStatus: securityExpectedStatus(headerName, 'invalid', options),
        assertNoSensitiveFields: true
      })
    );
  }

  return cases;
}

function inferPathParameterCases(
  entry: NormalizedHarEntry,
  config: HarApiTestConfig,
  options: PlannerOptions
): GeneratedEndpointTestCase[] {
  // Only PATH placeholders count: the normalizer also injects ${...} placeholders into query
  // values (cache busters, dynamic ids), which are not path parameters.
  const [pathOnly, queryString] = splitPathAndQuery(entry.pathWithQuery);
  if (!/\$\{[A-Z0-9_]+\}/.test(pathOnly) || !isSuccessStatus(entry.responseStatus)) {
    return [];
  }

  const invalidPath = pathOnly.replace(/\$\{[A-Z0-9_]+\}/g, 'invalid-id');

  return [
    buildInferredCase(entry, config, options, {
      category: 'negative',
      confidence: entry.method === 'GET' ? 'high' : 'medium',
      mutationRisk: entry.method === 'GET' ? 'none' : 'guarded',
      title: `negative: ${entry.method} ${entry.pathPattern} rejects invalid path parameter`,
      requestBody: entry.requestBody,
      fixtureSuffix: 'invalid-path-param',
      headers: entry.requestHeaders,
      pathWithQuery: queryString === undefined ? invalidPath : `${invalidPath}?${queryString}`,
      expectedStatus: negativeExpectedStatus('invalid-path-param', options),
      assertNoSensitiveFields: true
    })
  ];
}

function splitPathAndQuery(pathWithQuery: string): [string, string | undefined] {
  const separatorIndex = pathWithQuery.indexOf('?');
  if (separatorIndex === -1) {
    return [pathWithQuery, undefined];
  }

  return [pathWithQuery.slice(0, separatorIndex), pathWithQuery.slice(separatorIndex + 1)];
}

function buildInferredCase(
  entry: NormalizedHarEntry,
  config: HarApiTestConfig,
  options: PlannerOptions,
  input: {
    category: Exclude<TestCategory, 'smoke' | 'scenario' | 'crud'>;
    confidence: TestConfidence;
    mutationRisk: MutationRisk;
    title: string;
    requestBody?: JsonValue | string;
    fixtureSuffix: string;
    headers: Record<string, string>;
    pathWithQuery?: string;
    expectedStatus: ExpectedStatus;
    assertNoSensitiveFields: boolean;
  }
): GeneratedEndpointTestCase {
  const fixtureName =
    input.requestBody === undefined ? undefined : `${entry.id}.${slugify(input.fixtureSuffix)}.request.json`;

  return {
    id: `${entry.id}-${slugify(input.fixtureSuffix)}-${shortHash(JSON.stringify(input.requestBody ?? input.headers), 6)}`,
    label: input.title,
    title: input.title,
    hostname: entry.hostname,
    pathPattern: entry.pathPattern,
    sourceEntryId: entry.id,
    origin: 'inferred',
    category: input.category,
    confidence: input.confidence,
    execution: resolveExecution(input.category, input.confidence, input.mutationRisk, entry.method as SupportedHttpMethod, options),
    mutationRisk: input.mutationRisk,
    method: entry.method as SupportedHttpMethod,
    defaultBaseUrl: entry.defaultBaseUrl,
    pathWithQuery: input.pathWithQuery ?? entry.pathWithQuery,
    requestHeaders: input.headers,
    requestBody: input.requestBody,
    requestMimeType: entry.requestMimeType,
    fixtureName,
    expectedStatus: input.expectedStatus,
    responseContentType: undefined,
    responseTimeBudgetMs: Math.max(config.responseTimeBudgetMs, entry.responseTimeMs),
    assertSchema: false,
    assertContentType: false,
    assertNoSensitiveFields: input.assertNoSensitiveFields
  };
}

function baseStep(
  entry: NormalizedHarEntry,
  idSuffix: string,
  requestBody: JsonValue | string | undefined,
  fixtureName: string | undefined
): GeneratedTestStep {
  return {
    id: `${entry.id}-${idSuffix}`,
    label: entry.testName,
    method: entry.method as SupportedHttpMethod,
    defaultBaseUrl: entry.defaultBaseUrl,
    pathWithQuery: entry.pathWithQuery,
    requestHeaders: entry.requestHeaders,
    requestBody,
    requestMimeType: entry.requestMimeType,
    fixtureName,
    expectedStatus: {
      kind: 'exact',
      status: entry.responseStatus
    },
    responseContentType: entry.responseContentType,
    responseTimeBudgetMs: entry.responseTimeMs
  };
}

function missingFieldVariants(
  requestBody: JsonValue | string,
  mimeType: string | undefined,
  inferenceLevel: InferenceLevel
): BodyVariant[] {
  if (isJsonObject(requestBody)) {
    return selectFields(Object.keys(requestBody), inferenceLevel).map((field) => {
      const body = cloneJsonObject(requestBody);
      delete body[field];
      return { fieldName: field, body };
    });
  }

  if (typeof requestBody === 'string' && mimeType?.includes('multipart/form-data')) {
    return selectFields(extractMultipartFields(requestBody), inferenceLevel).map((field) => ({
      fieldName: field,
      body: removeMultipartField(requestBody, field)
    }));
  }

  return [];
}

/**
 * Extended CRUD tier: group endpoints by resource (collection path) and synthesize ordered
 * create -> read -> update -> delete flows from observed requests. When both create and delete
 * exist the delete runs last, so the flow cleans up after itself.
 */
function inferCrudScenarios(
  entries: NormalizedHarEntry[],
  config: HarApiTestConfig,
  options: PlannerOptions
): GeneratedScenarioTestCase[] {
  const byResource = new Map<string, NormalizedHarEntry[]>();
  for (const entry of [...entries].sort(compareEntryChronology)) {
    const key = `${entry.hostname}::${collectionPattern(entry.pathPattern)}`;
    byResource.set(key, [...(byResource.get(key) ?? []), entry]);
  }

  const scenarios: GeneratedScenarioTestCase[] = [];
  for (const [, resourceEntries] of byResource) {
    // Auth/session endpoints (login/logout/token/csrf/session) are credential exchanges, not REST
    // resources — a POST+GET on the same /auth/main/login path is a sign-in + precondition fetch,
    // never create->read. Skip them so CRUD inference does not fabricate a bogus flow.
    if (isAuthResource(resourceEntries[0].pathPattern)) {
      continue;
    }

    const steps = crudStepsForResource(resourceEntries);
    // A GET that shares the create's exact collection path is a precondition/list fetch, not a read
    // of the just-created item; do not let it manufacture a create->read flow.
    if (
      steps.create &&
      steps.read &&
      steps.create.pathPattern === steps.read.pathPattern &&
      !steps.create.pathPattern.includes('{param}')
    ) {
      steps.read = undefined;
    }

    const verbs = CRUD_ORDER.filter((verb) => steps[verb]);
    const orderedEntries = verbs.map((verb) => steps[verb]).filter((entry): entry is NormalizedHarEntry => Boolean(entry));

    // Need a real flow (>=2 verbs) with at least one mutation; single-verb resources are covered by smoke.
    if (verbs.length < 2 || !verbs.some((verb) => verb !== 'read')) {
      continue;
    }

    const hostname = resourceEntries[0].hostname;
    const resourceLabel = collectionPattern(resourceEntries[0].pathPattern).replace(/^\//, '') || 'root';
    const hasCreateAndDelete = Boolean(steps.create) && Boolean(steps.delete);
    const mutationRisk: MutationRisk = hasCreateAndDelete ? 'guarded' : 'unsafe';

    scenarios.push(
      buildScenario(
        `${hostname} ${resourceLabel} ${verbs.join('-')} flow`,
        `crud-${verbs.join('-')}`,
        'crud',
        hasCreateAndDelete ? 'high' : 'medium',
        mutationRisk,
        false,
        orderedEntries,
        config,
        options
      )
    );
  }

  return scenarios;
}

function crudStepsForResource(
  entries: NormalizedHarEntry[]
): Record<'create' | 'read' | 'update' | 'delete', NormalizedHarEntry | undefined> {
  const result: Record<'create' | 'read' | 'update' | 'delete', NormalizedHarEntry | undefined> = {
    create: undefined,
    read: undefined,
    update: undefined,
    delete: undefined
  };

  for (const entry of entries) {
    const isItemPath = hasTrailingDynamicSegment(entry);
    // POST to an item path mutates an existing resource (e.g. POST /user/password/{param}) — an
    // update, not a create; only collection POSTs create.
    if (entry.method === 'POST' && isItemPath && !result.update) {
      result.update = entry;
    } else if (entry.method === 'POST' && !isItemPath && !result.create) {
      result.create = entry;
    } else if (entry.method === 'GET' && !result.read) {
      result.read = entry;
    } else if ((entry.method === 'PUT' || entry.method === 'PATCH') && !result.update) {
      result.update = entry;
    } else if (entry.method === 'DELETE' && !result.delete) {
      result.delete = entry;
    }
  }

  return result;
}

// Auth/session endpoints are credential exchanges, not REST resources, so they must not be grouped
// into CRUD flows (a POST+GET on /auth/main/login is sign-in + a precondition fetch, not create+read).
function isAuthResource(pathPattern: string): boolean {
  return /(^|\/)(login|logout|sign-?in|sign-?out|signin|signout|auth|authenticate|token|refresh|csrf|session)(\/|$)/i.test(
    pathPattern
  );
}

// Mirrors collectionPattern: only a TRAILING dynamic segment marks an item path. A {param} in the
// middle (e.g. /users/{param}/roles) is a nested collection, and query placeholders (cache
// busters, dynamic query ids) are not path parameters at all.
function hasTrailingDynamicSegment(entry: NormalizedHarEntry): boolean {
  const [pathOnly] = splitPathAndQuery(entry.pathWithQuery);
  const lastSegment = pathOnly.split('/').pop() ?? '';
  const lastPatternSegment = entry.pathPattern.split('/').pop() ?? '';
  return /^\$\{[A-Z0-9_]+\}$/.test(lastSegment) || lastPatternSegment === '{param}';
}

function collectionPattern(pathPattern: string): string {
  // Drop a trailing dynamic segment so /users/user/{param} and /users/user share a resource key.
  // A trailing slash is normalized away first so /x/ and /x/{param} share a resource key too.
  const segments = pathPattern.split('/');
  while (segments.length > 1 && segments[segments.length - 1] === '') {
    segments.pop();
  }
  if (segments.length > 1 && /^\{param\}$/.test(segments[segments.length - 1])) {
    segments.pop();
  }
  return segments.join('/') || '/';
}

function inferFlowScenarios(
  entries: NormalizedHarEntry[],
  config: HarApiTestConfig,
  options: PlannerOptions
): GeneratedScenarioTestCase[] {
  const byHost = new Map<string, NormalizedHarEntry[]>();
  const scenarios: GeneratedScenarioTestCase[] = [];

  for (const entry of [...entries].sort(compareEntryChronology)) {
    byHost.set(entry.hostname, [...(byHost.get(entry.hostname) ?? []), entry]);
  }

  for (const [hostname, hostEntries] of byHost) {
    const login = hostEntries.find((entry) => entry.method === 'POST' && /login/i.test(entry.pathPattern));
    const logout = hostEntries.find((entry) => entry.method === 'POST' && /logout/i.test(entry.pathPattern));
    if (login && logout) {
      const middleSteps = hostEntries
        .filter((entry) => entry.entryIndex > login.entryIndex && entry.entryIndex < logout.entryIndex)
        .filter((entry) => /\/(me\/account|user\/session)/i.test(entry.pathPattern))
        .slice(0, 3);
      scenarios.push(
        buildScenario(
          `${hostname} login account logout flow`,
          'login-account-logout',
          'scenario',
          'high',
          'guarded',
          // Isolated: the flow logs in inside its own request context, so logout only ends its own
          // session — safe to run as an active test without affecting the shared session.
          true,
          [login, ...middleSteps, logout],
          config,
          options
        )
      );
    }

    const profileEntries = hostEntries
      .filter((entry) => entry.method === 'GET')
      .filter((entry) => /\/(me\/account|users\/user|user\/preferences|user\/security|me\/account\/settings)/i.test(entry.pathPattern))
      .slice(0, 5);
    if (profileEntries.length >= 2) {
      scenarios.push(
        buildScenario(`${hostname} profile read flow`, 'profile-read-flow', 'scenario', 'medium', 'none', false, profileEntries, config, options)
      );
    }
  }

  return scenarios;
}

function buildScenario(
  title: string,
  suffix: string,
  category: 'crud' | 'scenario',
  confidence: TestConfidence,
  mutationRisk: MutationRisk,
  isolated: boolean,
  entries: NormalizedHarEntry[],
  config: HarApiTestConfig,
  options: PlannerOptions
): GeneratedScenarioTestCase {
  const id = `${slugify(title)}-${shortHash(entries.map((entry) => entry.id).join('|'), 6)}`;

  warnPossibleMissingCorrelation(`${category}: ${title}`, entries);

  // A scenario is only "mutating" for the execution policy if at least one step is a mutating method.
  // A read-only (all-GET) flow must not be treated as POST — that wrongly downgrades it under
  // mutationPolicy=all-skipped even though mutationRisk is already 'none'.
  const scenarioMethod: SupportedHttpMethod = entries.every((entry) => entry.method === 'GET') ? 'GET' : 'POST';

  return {
    id,
    title: `${category}: ${title}`,
    fileName: `${slugify(title)}.spec.ts`,
    origin: 'inferred',
    category,
    confidence,
    execution: resolveExecution(category, confidence, mutationRisk, scenarioMethod, options),
    mutationRisk,
    isolated,
    steps: entries.map((entry, index) => ({
      ...baseStep(
        entry,
        `${suffix}-step-${index + 1}`,
        entry.requestBody,
        entry.requestBody === undefined ? undefined : `${entry.id}.${suffix}-step-${index + 1}.request.json`
      ),
      responseTimeBudgetMs: Math.max(config.responseTimeBudgetMs, entry.responseTimeMs)
    }))
  };
}

// Generation-time advisory (stderr only — emits NO test output, so committed specs are unchanged).
// Generated scenarios replay each observed step verbatim and resolve ${PLACEHOLDER} values from the
// environment; they do NOT chain data from one step's response into the next. The suspect pattern is
// a read-then-modify on the SAME resource keyed by a STATIC id: when one ${PLACEHOLDER} appears in
// the PATH of two or more steps (e.g. GET then POST /user/password/${USER_ID}), the flow exercises a
// fixed env id rather than one derived from a prior step's response. Keying off path-reuse (rather
// than a create/login "producer") covers read-update flows AND avoids false positives on isolated
// login/account/logout flows whose steps target different paths.
// Exported for unit testing (tests/unit/testPlanner.test.ts): a false negative/positive here is the
// A4 correlation-warning inversion regression, so its input->warn mapping is asserted directly.
export function warnPossibleMissingCorrelation(title: string, entries: NormalizedHarEntry[]): void {
  if (entries.length < 2) {
    return;
  }

  const stepsPerPlaceholder = new Map<string, number>();
  for (const entry of entries) {
    const names = new Set<string>();
    // Scan only the PATH (not the query string) — the warning is about placeholders reused in the
    // path of two or more steps; a shared query placeholder is not a path-correlation signal.
    const pathOnly = entry.pathWithQuery.split('?', 1)[0];
    for (const match of pathOnly.matchAll(/\$\{([A-Z0-9_]+)\}/g)) {
      names.add(match[1]);
    }
    for (const name of names) {
      stepsPerPlaceholder.set(name, (stepsPerPlaceholder.get(name) ?? 0) + 1);
    }
  }

  const reused = [...stepsPerPlaceholder.entries()].filter(([, count]) => count >= 2).map(([name]) => name);
  if (reused.length === 0) {
    return;
  }

  console.warn(
    `[har-api-tests] scenario "${title}" reuses ${reused.sort().join(', ')} in the path of multiple steps ` +
      `as a static environment value, not one derived from a prior step's response. Generated scenarios ` +
      `do not chain response data — verify the flow exercises correlated values (or wire the correlation ` +
      `manually).`
  );
}

function dedupeEntries(entries: NormalizedHarEntry[]): NormalizedHarEntry[] {
  const seen = new Set<string>();
  const deduped: NormalizedHarEntry[] = [];

  for (const entry of [...entries].sort(compareEntryChronology)) {
    const signature = JSON.stringify({
      method: entry.method,
      hostname: entry.hostname,
      pathWithQuery: entry.pathWithQuery,
      headers: entry.requestHeaders,
      body: entry.requestBody,
      status: entry.responseStatus
    });

    if (seen.has(signature)) {
      continue;
    }

    seen.add(signature);
    deduped.push(entry);
  }

  return deduped;
}

function negativeExpectedStatus(kind: NegativeExpectedStatusKey, options: PlannerOptions): ExpectedStatus {
  if (options.negativeStatusPolicy === 'config') {
    return options.expectedStatuses.negative[kind] ?? { kind: 'family', family: '4xx' };
  }

  if (options.negativeStatusPolicy !== 'strict') {
    return {
      kind: 'family',
      family: '4xx'
    };
  }

  return {
    kind: 'exact',
    status: kind === 'missing-field' ? 400 : 422
  };
}

function securityExpectedStatus(headerName: string, variant: 'missing' | 'invalid', options: PlannerOptions): ExpectedStatus {
  if (options.negativeStatusPolicy === 'config') {
    return options.expectedStatuses.security[securityExpectedStatusKey(headerName, variant)] ?? {
      kind: 'family',
      family: '4xx'
    };
  }

  if (options.negativeStatusPolicy !== 'strict') {
    return {
      kind: 'family',
      family: '4xx'
    };
  }

  return {
    kind: 'exact',
    status: /csrf|xsrf/i.test(headerName) ? 403 : 401
  };
}

function securityExpectedStatusKey(headerName: string, variant: 'missing' | 'invalid'): SecurityExpectedStatusKey {
  const prefix = variant === 'missing' ? 'missing' : 'invalid';
  if (/csrf|xsrf/i.test(headerName)) {
    return `${prefix}-csrf`;
  }

  if (/\b(auth|authorization|cookie|api-key|token)\b/i.test(headerName)) {
    return `${prefix}-auth`;
  }

  return `${prefix}-header`;
}

function resolveExecution(
  category: TestCategory,
  confidence: TestConfidence,
  mutationRisk: MutationRisk,
  method: SupportedHttpMethod,
  options: PlannerOptions
): TestExecution {
  if (category === 'smoke') {
    return 'active';
  }

  if (options.inferredRunMode === 'replay-only') {
    return 'skip';
  }

  if (options.mutationPolicy === 'all-skipped' && isMutatingMethod(method)) {
    return 'skip';
  }

  if (options.inferredRunMode === 'all-active' || options.mutationPolicy === 'all-active') {
    return 'active';
  }

  // Inferred validation encodes an UNVERIFIED "bad input => 4xx" expectation. Real APIs are often
  // lenient (return 2xx), so emit these as triage candidates (fixme) rather than active assertions.
  // Opt back in with --inferred-run-mode all-active.
  if (category === 'negative' || category === 'security') {
    return 'fixme';
  }

  if (mutationRisk === 'unsafe' || confidence === 'low') {
    return 'fixme';
  }

  return 'active';
}

function isDestructiveSmoke(method: SupportedHttpMethod, pathPattern: string, patterns: string[]): boolean {
  if (!isMutatingMethod(method)) {
    return false;
  }

  // PUT/PATCH/DELETE replays overwrite or remove resources — never safe to run blindly.
  if (method !== 'POST') {
    return true;
  }

  return patterns.some((pattern) => matchesPathPattern(pathPattern, pattern));
}

function matchesPathPattern(value: string, pattern: string): boolean {
  try {
    return new RegExp(pattern, 'i').test(value);
  } catch {
    return value.toLowerCase().includes(pattern.toLowerCase());
  }
}

function isMutatingMethod(method: SupportedHttpMethod): boolean {
  return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
}

function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

function selectFields(fields: string[], inferenceLevel: InferenceLevel): string[] {
  const sorted = [...new Set(fields)].sort();
  if (inferenceLevel === 'conservative') {
    return sorted.filter((field) => /email|password|token|csrf|name/i.test(field)).slice(0, 3);
  }

  if (inferenceLevel === 'balanced') {
    return sorted.slice(0, 5);
  }

  return sorted.slice(0, 10);
}

function isSecretHeader(name: string): boolean {
  return /\b(auth|authorization|cookie|csrf|xsrf|api-key|token)\b/i.test(name);
}

function invalidHeaderValue(name: string): string {
  if (/csrf|xsrf/i.test(name)) {
    return 'invalid-csrf-token';
  }

  if (/cookie/i.test(name)) {
    return 'invalid-session-cookie';
  }

  return 'Bearer invalid-token';
}

function cloneJsonObject(value: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function extractMultipartFields(body: string): string[] {
  return [...body.matchAll(/Content-Disposition:\s*form-data;\s*name="([^"]+)"/g)].map((match) => match[1]);
}

function removeMultipartField(body: string, fieldName: string): string {
  const escapedName = escapeRegExp(fieldName);
  return body.replace(
    new RegExp(`--([^\\r\\n]+)\\r\\nContent-Disposition:\\s*form-data;\\s*name="${escapedName}"(?:;[^\\r\\n]*)?\\r\\n\\r\\n[\\s\\S]*?(?=\\r\\n--\\1)\\r\\n`, 'g'),
    ''
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Calibration: a recorded replay of an inferred negative/security case against the live API.
 * A 4xx confirms the expectation (run active with the exact status); a 2xx means the API is
 * lenient and the negative expectation is wrong (stay fixme). Other statuses are inconclusive.
 */
function applyCalibrationOverrides(
  cases: GeneratedEndpointTestCase[],
  overrides: CalibrationOverride[]
): GeneratedEndpointTestCase[] {
  if (overrides.length === 0) {
    return cases;
  }

  // Titles are unique per host but can repeat across hosts, so host-scoped overrides match on
  // hostname+title; overrides without a hostname (older files) fall back to bare-title matching.
  const byHostAndTitle = new Map<string, CalibrationOverride>();
  const byTitle = new Map<string, CalibrationOverride>();
  for (const override of overrides) {
    if (override.hostname) {
      byHostAndTitle.set(`${override.hostname} ${override.title}`, override);
    } else {
      byTitle.set(override.title, override);
    }
  }

  return cases.map((testCase) => {
    const override = byHostAndTitle.get(`${testCase.hostname} ${testCase.title}`) ?? byTitle.get(testCase.title);
    if (
      !override ||
      testCase.origin !== 'inferred' ||
      (testCase.category !== 'negative' && testCase.category !== 'security')
    ) {
      return testCase;
    }

    if (override.observedStatus >= 400 && override.observedStatus <= 499) {
      return {
        ...testCase,
        expectedStatus: { kind: 'exact', status: override.observedStatus },
        // Confirmed overrides graduate fixme triage candidates, but never resurrect cases the
        // explicit run policy skipped (--inferred-run-mode replay-only / --mutation-policy all-skipped).
        execution: testCase.execution === 'skip' ? 'skip' : 'active',
        calibration: 'confirmed'
      };
    }

    if (override.observedStatus >= 200 && override.observedStatus <= 299) {
      return {
        ...testCase,
        calibration: 'lenient'
      };
    }

    return testCase;
  });
}

function ensureUniqueTitles(cases: GeneratedEndpointTestCase[]): GeneratedEndpointTestCase[] {
  const counts = new Map<string, number>();
  return cases.map((testCase) => {
    const key = `${testCase.hostname}:${testCase.pathPattern}:${testCase.title}`;
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    return count === 1
      ? testCase
      : {
          ...testCase,
          title: `${testCase.title} [${count}]`
        };
  });
}

function ensureUniqueScenarioTitles(cases: GeneratedScenarioTestCase[]): GeneratedScenarioTestCase[] {
  const counts = new Map<string, number>();
  return cases.map((testCase) => {
    const count = (counts.get(testCase.title) ?? 0) + 1;
    counts.set(testCase.title, count);
    return count === 1
      ? testCase
      : {
          ...testCase,
          title: `${testCase.title} [${count}]`,
          fileName: `${slugify(testCase.title)}-${count}.spec.ts`
        };
  });
}

function compareEntryChronology(left: NormalizedHarEntry, right: NormalizedHarEntry): number {
  const sourceCompare = compareStrings(left.sourceFile, right.sourceFile);
  if (sourceCompare !== 0) {
    return sourceCompare;
  }

  return left.entryIndex - right.entryIndex;
}

function compareEndpointCases(left: GeneratedEndpointTestCase, right: GeneratedEndpointTestCase): number {
  return compareStrings(
    `${left.hostname} ${left.pathPattern} ${left.category} ${left.title}`,
    `${right.hostname} ${right.pathPattern} ${right.category} ${right.title}`
  );
}
