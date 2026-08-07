export interface SupportFileHosts {
  primaryHost: string;
  knownHosts: string[];
  secretHeaderNames?: string[];
}

export function buildPlaywrightSupportFile(
  hosts: SupportFileHosts = { primaryHost: "", knownHosts: [] },
): string {
  return `import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { Ajv } from 'ajv/dist/ajv.js';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ajv = new Ajv({ allErrors: true, strict: false });

// Hosts observed in the source capture, injected at generation time.
const KNOWN_HOSTS: string[] = ${JSON.stringify(hosts.knownHosts)};
const PRIMARY_HOST = ${JSON.stringify(hosts.primaryHost)};
const GENERATED_SECRET_HEADER_NAMES = new Set(${JSON.stringify(
    (hosts.secretHeaderNames ?? [])
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean)
      .sort(),
  )});
const DERIVED_AUTH_ENV_NAMES = new Set(['USER_ID', 'API_TOKEN', 'API_AUTHORIZATION', 'API_COOKIE', 'CSRF_TOKEN']);
const GENERATED_AUTH_FILE_MARKER = '# har-api-tests generated auth snapshot v1';

// Pending inferred tests are machine-calibrated: normal runs quarantine them, while calibration
// runs execute them and record the observed status without requiring a human approval step.
export const calibrationTest = process.env.CALIBRATION_MODE === 'true' ? test : (test.skip as unknown as typeof test);

export type ExpectedStatus =
  | { kind: 'exact'; status: number }
  | { kind: 'family'; family: '2xx' | '3xx' | '4xx' | '5xx' };

export interface SendApiRequestOptions {
  request: APIRequestContext;
  defaultBaseUrl: string;
  path: string;
  method: string;
  headers?: Record<string, string>;
  payload?: unknown;
  // When true, the caller supplies its own isolated context (own cookie jar): do NOT attach the
  // shared session cookie or bearer — the context authenticates itself (e.g. a login step).
  isolatedSession?: boolean;
  // Security negatives intentionally remove/poison credentials. Never restore them implicitly.
  suppressGeneratedAuth?: boolean;
}

export interface TimedApiResponse {
  response: APIResponse;
  elapsedMs: number;
  url: string;
}

export function resolveBaseUrl(defaultBaseUrl: string): string {
  const host = hostnameFromUrl(defaultBaseUrl);

  // A per-host override (BASE_URL_<HOST>) always wins, so multi-host captures can be routed
  // independently instead of being collapsed onto one origin.
  const perHostOverride = host ? process.env['BASE_URL_' + envHostSlug(host)] : undefined;
  if (perHostOverride) {
    return perHostOverride.replace(/\\/$/, '');
  }

  // A single global BASE_URL only applies when the capture is single-host, or to the primary
  // host. Foreign hosts keep their captured origin so cross-host tests do not pass vacuously.
  const globalBaseUrl = process.env.BASE_URL;
  if (globalBaseUrl && (KNOWN_HOSTS.length <= 1 || host === PRIMARY_HOST || !host)) {
    return globalBaseUrl.replace(/\\/$/, '');
  }

  return defaultBaseUrl.replace(/\\/$/, '');
}

export function assertAllowedTarget(urlValue: string, purpose = 'API request'): void {
  let target: URL;
  try {
    target = new URL(urlValue);
  } catch {
    throw new Error('Refusing ' + purpose + ' because the target is not a valid absolute URL.');
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new Error('Refusing ' + purpose + ' because only HTTP(S) targets are allowed.');
  }
  if (target.username || target.password) {
    throw new Error('Refusing ' + purpose + ' because target URLs must not contain credentials.');
  }

  if (process.env.HAR_API_REPLAY_MODE === 'true') {
    const configuredReplayOrigin = process.env.HAR_API_REPLAY_ORIGIN;
    if (!configuredReplayOrigin) {
      throw new Error('HAR_API_REPLAY_ORIGIN is required when HAR_API_REPLAY_MODE=true.');
    }
    const replayOrigin = normalizeOrigin(configuredReplayOrigin, 'HAR_API_REPLAY_ORIGIN');
    if (!isLoopbackHostname(target.hostname) || target.origin !== replayOrigin) {
      throw new Error('Refusing ' + purpose + ' outside the exact loopback replay origin: ' + target.origin);
    }
    return;
  }

  const trusted = configuredOrigins('TRUSTED_API_ORIGINS');
  if (trusted.length === 0 || !trusted.includes(target.origin)) {
    throw new Error(
      'Refusing ' + purpose + ' for untrusted origin ' + target.origin +
        '. Add the exact origin to TRUSTED_API_ORIGINS.'
    );
  }
}

function configuredOrigins(envName: string): string[] {
  const raw = process.env[envName] ?? '';
  return uniqueStrings(
    raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => normalizeOrigin(value, envName))
  );
}

function normalizeOrigin(value: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(label + ' contains an invalid origin.');
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) {
    throw new Error(label + ' must contain HTTP(S) origins without credentials.');
  }
  if ((parsed.pathname !== '/' && parsed.pathname !== '') || parsed.search || parsed.hash) {
    throw new Error(label + ' must contain origins only, without paths, query strings, or fragments.');
  }
  return parsed.origin;
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]' || hostname === 'localhost';
}

function envHostSlug(host: string): string {
  return host.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toUpperCase();
}

export function resolveHeaders(headers: Record<string, string>): Record<string, string> {
  const resolved: Record<string, string> = {};

  for (const [name, value] of Object.entries(headers)) {
    const nextValue = resolvePlaceholder(value);
    if (nextValue !== '') {
      resolved[name] = nextValue;
    }
  }

  return resolved;
}

export function resolveEndpointPath(pathTemplate: string): string {
  return resolvePlaceholder(pathTemplate, { required: true });
}

export function resolvePayload<T>(payload: T): T {
  if (Array.isArray(payload)) {
    return payload.map((item) => resolvePayload(item)) as T;
  }

  if (payload && typeof payload === 'object') {
    return Object.fromEntries(
      Object.entries(payload).map(([key, value]) => [key, resolvePayload(value)])
    ) as T;
  }

  if (typeof payload === 'string') {
    return resolvePlaceholder(payload, { required: true }) as T;
  }

  return payload;
}

export function resolveGeneratedEnvValue(envName: string): string {
  return resolveEnvironmentValue(envName, { required: true });
}

export function updateGeneratedEnvValue(envName: string, value: string): void {
  if (!value) {
    throw new Error('Refusing to write an empty value for generated test environment variable ' + envName);
  }

  replaceGeneratedEnvValues({ ...readGeneratedAuthFileValues(), [envName]: value });
}

export function clearGeneratedEnvValues(): void {
  for (const envName of DERIVED_AUTH_ENV_NAMES) {
    delete process.env[envName];
  }
  clearGeneratedAuthSnapshot();
}

export function clearGeneratedAuthSnapshot(): void {
  const envFilePath = writableEnvFilePath();
  assertWritableEnvTarget(envFilePath);
  fs.rmSync(envFilePath, { force: true });
  cachedGeneratedAuthFileValues = undefined;
  cachedGeneratedAuthFilePath = undefined;
}

export function replaceGeneratedEnvValues(values: Record<string, string>): void {
  const entries = Object.entries(values).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) {
    throw new Error('Refusing to write an empty generated authentication snapshot.');
  }
  for (const [envName, value] of entries) {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(envName) || !value || /[\\r\\n]/.test(value)) {
      throw new Error('Refusing to write an invalid generated authentication value for ' + envName);
    }
  }

  const envFilePath = writableEnvFilePath();
  const envDirectory = path.dirname(envFilePath);
  const createdDirectory = fs.mkdirSync(envDirectory, { recursive: true, mode: 0o700 });
  if (createdDirectory !== undefined) {
    fs.chmodSync(envDirectory, 0o700);
  }
  assertWritableEnvTarget(envFilePath);
  const temporaryPath = envFilePath + '.' + process.pid + '-' + randomUUID() + '.tmp';
  const content =
    GENERATED_AUTH_FILE_MARKER + '\\n' +
    entries.map(([envName, value]) => envName + '=' + formatEnvValue(value)).join('\\n') +
    '\\n';
  try {
    fs.writeFileSync(temporaryPath, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.renameSync(temporaryPath, envFilePath);
    fs.chmodSync(envFilePath, 0o600);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }

  for (const envName of DERIVED_AUTH_ENV_NAMES) {
    delete process.env[envName];
  }
  for (const [envName, value] of entries) {
    process.env[envName] = value;
  }
  cachedGeneratedAuthFileValues = Object.fromEntries(entries);
  cachedGeneratedAuthFilePath = envFilePath;
}

function assertWritableEnvTarget(envFilePath: string): void {
  if (!fs.existsSync(envFilePath)) {
    return;
  }
  const fileStat = fs.lstatSync(envFilePath);
  if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
    throw new Error('Refusing to use generated auth state through a symlink or non-file path: ' + envFilePath);
  }
  const firstLine = fs.readFileSync(envFilePath, 'utf8').split(/\\r?\\n/, 1)[0];
  if (firstLine !== GENERATED_AUTH_FILE_MARKER) {
    throw new Error(
      'Refusing to read, replace, or delete an unowned authentication file without the har-api-tests marker: ' + envFilePath
    );
  }
}

export async function sendApiRequest(options: SendApiRequestOptions): Promise<TimedApiResponse> {
  const baseUrl = resolveBaseUrl(options.defaultBaseUrl);
  const endpointPath = resolveEndpointPath(options.path);
  const url = \`\${baseUrl}\${endpointPath}\`;
  // Reject the destination before resolving headers or reading any credential snapshot.
  assertAllowedTarget(url, 'generated API request');
  const fetchOptions: Parameters<APIRequestContext['fetch']>[1] = {
    method: options.method,
    // Validate only the exact trusted destination. Following a redirect could forward a request
    // (and possibly credentials) to an origin that never passed assertAllowedTarget.
    maxRedirects: 0
  };
  const headers = options.headers ? resolveHeaders(options.headers) : {};

  if (process.env.HAR_API_REPLAY_MODE === 'true') {
    const capturedHost = hostnameFromUrl(options.defaultBaseUrl);
    if (capturedHost) {
      headers['x-har-replay-host'] = capturedHost;
    }
  }

  if (!options.suppressGeneratedAuth) {
    removeDisallowedGeneratedCredentialHeaders(headers, baseUrl);
  }

  // Isolated sessions manage their own cookies (via the context's jar) and auth, so skip the
  // shared session cookie and bearer injection entirely.
  if (!options.isolatedSession && !options.suppressGeneratedAuth) {
    const defaultCookieHeader = resolveDefaultCookieHeader(baseUrl);
    if (defaultCookieHeader && !hasHeader(headers, 'cookie')) {
      headers.cookie = defaultCookieHeader;
    }

    // Bearer injection is opt-in for exact origins; captured hosts never authorize credentials.
    if (!hasHeader(headers, 'authorization') && shouldAttachBearer(baseUrl)) {
      const bearer = bearerAuthorizationValue();
      if (bearer) {
        headers.authorization = bearer;
      }
    }
  }

  if (Object.keys(headers).length > 0) {
    fetchOptions.headers = headers;
  }

  if (options.payload !== undefined) {
    fetchOptions.data = options.payload;
  }

  const startedAt = Date.now();
  const response = await options.request.fetch(url, fetchOptions);
  const elapsedMs = Date.now() - startedAt;

  return {
    response,
    elapsedMs,
    url
  };
}

function resolveDefaultCookieHeader(baseUrl: string): string {
  if (!shouldAttachGeneratedCookie(baseUrl)) {
    return '';
  }
  return resolveEnvironmentValue('API_COOKIE', {});
}

function shouldAttachGeneratedCookie(baseUrl: string): boolean {
  const requestOrigin = originFromUrl(baseUrl);
  if (!requestOrigin) {
    return false;
  }
  return configuredOrigins('AUTH_COOKIE_ORIGINS').includes(requestOrigin);
}

function shouldAttachBearer(baseUrl: string): boolean {
  const requestOrigin = originFromUrl(baseUrl);
  if (!requestOrigin) {
    return false;
  }
  return configuredOrigins('AUTH_BEARER_ORIGINS').includes(requestOrigin);
}

function removeDisallowedGeneratedCredentialHeaders(headers: Record<string, string>, baseUrl: string): void {
  const requestOrigin = originFromUrl(baseUrl);
  for (const headerName of Object.keys(headers)) {
    const normalizedName = headerName.toLowerCase();
    if (!GENERATED_SECRET_HEADER_NAMES.has(normalizedName)) {
      continue;
    }
    if (normalizedName === 'set-cookie') {
      delete headers[headerName];
      continue;
    }
    const allowlistName = credentialOriginAllowlistName(normalizedName);
    if (!requestOrigin || !configuredOrigins(allowlistName).includes(requestOrigin)) {
      delete headers[headerName];
    }
  }
}

function credentialOriginAllowlistName(headerName: string): string {
  if (headerName === 'authorization') {
    return 'AUTH_BEARER_ORIGINS';
  }
  if (headerName === 'cookie' || headerName.includes('csrf') || headerName.includes('xsrf')) {
    return 'AUTH_COOKIE_ORIGINS';
  }
  if (headerName.includes('api-key') || headerName === 'apikey') {
    return 'AUTH_API_KEY_ORIGINS';
  }
  return 'AUTH_SECRET_HEADER_ORIGINS';
}

function bearerAuthorizationValue(): string {
  const authorization = resolveEnvironmentValue('API_AUTHORIZATION', {});
  if (authorization) {
    return /^bearer\\s/i.test(authorization) ? authorization : 'Bearer ' + authorization;
  }

  const token = resolveEnvironmentValue('API_TOKEN', {});
  return token ? 'Bearer ' + token : '';
}

function hasHeader(headers: Record<string, string>, headerName: string): boolean {
  return Object.keys(headers).some((name) => name.toLowerCase() === headerName.toLowerCase());
}

function hostnameFromUrl(value: string): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return new URL(value).hostname;
  } catch {
    return undefined;
  }
}

function originFromUrl(value: string): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

export function loadJsonFromTestFile<T>(testFile: string, relativePath: string): T {
  const filePath = path.resolve(path.dirname(testFile), relativePath);
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

export async function readJsonResponse(response: APIResponse, label: string): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new Error(\`\${label} did not return parseable JSON: \${String(error)}\`);
  }
}

export function validateSchema(data: unknown, schema: object, label: string): void {
  const validate = ajv.compile(schema);
  if (!validate(data)) {
    throw new Error(\`\${label} schema validation failed: \${ajv.errorsText(validate.errors, { separator: '\\n' })}\`);
  }
}

export function assertStatusCode(actual: number, expected: ExpectedStatus, label: string, host?: string): void {
  if (process.env.CALIBRATION_MODE === 'true') {
    recordCalibrationResult(actual, expected, label, host);
    return;
  }

  if (expected.kind === 'exact') {
    expect(actual, label).toBe(expected.status);
    return;
  }

  const lowerBound = Number(expected.family[0]) * 100;
  expect(actual, label).toBeGreaterThanOrEqual(lowerBound);
  expect(actual, label).toBeLessThan(lowerBound + 100);
}

function recordCalibrationResult(actual: number, expected: ExpectedStatus, label: string, host?: string): void {
  const outputFile = calibrationOutputFilePath();
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  // Calibration runs use a single worker, so appendFileSync on the shared file is safe. The host
  // disambiguates same-titled tests across hosts in multi-host captures.
  fs.appendFileSync(outputFile, JSON.stringify({ label, host, expected, actual }) + '\\n', 'utf8');
  console.log('[calibration] ' + label + ': expected ' + formatExpectedStatus(expected) + ' got ' + actual);
}

function calibrationOutputFilePath(): string {
  return path.resolve(process.env.CALIBRATION_OUTPUT_FILE || 'test-results/calibration-results.jsonl');
}

function formatExpectedStatus(expected: ExpectedStatus): string {
  return expected.kind === 'exact' ? String(expected.status) : expected.family;
}

export function assertResponseTime(actualMs: number, budgetMs: number): void {
  // Latency is a soft signal by default to avoid flaky failures from network jitter against
  // live/staging services. Set ASSERT_RESPONSE_TIME=true to make it a hard assertion.
  if (process.env.ASSERT_RESPONSE_TIME === 'true') {
    expect(actualMs, 'response time ' + actualMs + 'ms exceeded budget ' + budgetMs + 'ms').toBeLessThanOrEqual(budgetMs);
    return;
  }

  if (actualMs > budgetMs) {
    console.warn('[response-time] ' + actualMs + 'ms exceeded budget ' + budgetMs + 'ms (set ASSERT_RESPONSE_TIME=true to fail)');
  }
}

export async function assertNoSensitiveFieldsInJsonResponse(response: APIResponse, label: string): Promise<void> {
  const contentType = response.headers()['content-type'] ?? '';
  if (!contentType.includes('application/json')) {
    return;
  }

  const responseBody = await readJsonResponse(response, label);
  assertNoSensitiveFields(responseBody, label);
}

function assertNoSensitiveFields(value: unknown, label: string, path = '$'): void {
  if (typeof value === 'string') {
    assertNoCredentialValue(value, label, path);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitiveFields(item, label, \`\${path}[\${index}]\`));
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  for (const [key, childValue] of Object.entries(value)) {
    expect(key, \`\${label} exposed sensitive field at \${path}.\${key}\`).not.toMatch(/password|secret|token|authorization|cookie|csrf|xsrf/i);
    assertNoSensitiveFields(childValue, label, \`\${path}.\${key}\`);
  }
}

// Strict 3-segment JWTs only: 2-segment eyJ strings are pagination cursors (base64 JSON), and
// emails are deliberately not flagged (own-profile responses legitimately contain them).
const JWT_VALUE_PATTERN = /eyJ[A-Za-z0-9_-]{6,}\\.[A-Za-z0-9_-]{6,}\\.[A-Za-z0-9_-]{6,}/;
const BEARER_VALUE_PATTERN = /Bearer\\s+[A-Za-z0-9._~+/=-]{20,}/;

function assertNoCredentialValue(value: string, label: string, path: string): void {
  // Errors reference the JSON path only — never echo the matched secret into test output.
  if (JWT_VALUE_PATTERN.test(value)) {
    throw new Error(\`\${label} exposed a JWT credential value at \${path}\`);
  }

  if (BEARER_VALUE_PATTERN.test(value)) {
    throw new Error(\`\${label} exposed a bearer credential value at \${path}\`);
  }
}

interface PlaceholderResolutionOptions {
  required?: boolean;
}

let cachedEnvFileValues: Record<string, string> | undefined;
let cachedGeneratedAuthFileValues: Record<string, string> | undefined;
let cachedGeneratedAuthFilePath: string | undefined;

function resolvePlaceholder(value: string, options: PlaceholderResolutionOptions = {}): string {
  const exactMatch = /^\\$\\{([A-Z0-9_]+)\\}$/.exec(value);
  if (exactMatch) {
    return resolveEnvironmentValue(exactMatch[1], options);
  }

  return value.replace(/\\$\\{([A-Z0-9_]+)\\}/g, (_match, envName: string) =>
    resolveEnvironmentValue(envName, options)
  );
}

function resolveEnvironmentValue(envName: string, options: PlaceholderResolutionOptions): string {
  const baselineValue = readEnvFileValues()[envName];
  const authStrategy = (process.env.AUTH_STRATEGY ?? baselineValueFor('AUTH_STRATEGY') ?? 'none').toLowerCase();
  const useGeneratedSnapshot = authStrategy === 'http-login';
  const generatedValue = useGeneratedSnapshot ? readGeneratedAuthFileValues()[envName] : undefined;
  const value =
    DERIVED_AUTH_ENV_NAMES.has(envName) && useGeneratedSnapshot
      ? generatedValue ?? defaultPlaceholderValue(envName)
      : process.env[envName] ?? baselineValue ?? defaultPlaceholderValue(envName);

  // Blank values (e.g. an untouched "NAME=" line copied from .env.generated.example, or an unset
  // CI secret expanding to '') never satisfy a required placeholder — fail fast in preflight
  // instead of sending malformed live requests.
  if (options.required && (value === undefined || value.trim() === '')) {
    throw new Error('Missing required environment variable ' + envName + ' for generated test placeholder \${' + envName + '}');
  }

  return value ?? '';
}

function baselineValueFor(envName: string): string | undefined {
  const value = readEnvFileValues()[envName];
  return value === '' ? undefined : value;
}

function optionalEnvironmentValue(envName: string): string | undefined {
  const value = resolveEnvironmentValue(envName, {});
  return value === '' ? undefined : value;
}

function readEnvFileValues(): Record<string, string> {
  if (cachedEnvFileValues) {
    return cachedEnvFileValues;
  }

  cachedEnvFileValues = {};
  for (const envFilePath of readableEnvFilePaths()) {
    if (!fs.existsSync(envFilePath)) {
      continue;
    }

    Object.assign(cachedEnvFileValues, parseEnvFile(fs.readFileSync(envFilePath, 'utf8')));
  }

  return cachedEnvFileValues;
}

function readGeneratedAuthFileValues(): Record<string, string> {
  const envFilePath = writableEnvFilePath();
  if (cachedGeneratedAuthFileValues && cachedGeneratedAuthFilePath === envFilePath) {
    return cachedGeneratedAuthFileValues;
  }
  cachedGeneratedAuthFilePath = envFilePath;
  if (!fs.existsSync(envFilePath)) {
    cachedGeneratedAuthFileValues = {};
    return cachedGeneratedAuthFileValues;
  }
  assertWritableEnvTarget(envFilePath);
  cachedGeneratedAuthFileValues = parseEnvFile(fs.readFileSync(envFilePath, 'utf8'));
  return cachedGeneratedAuthFileValues;
}

function readableEnvFilePaths(): string[] {
  // Lowest-to-highest baseline precedence. The dedicated generated auth snapshot is read
  // separately so derived values can prefer it when global auth setup is enabled.
  return uniquePaths([
    path.resolve(process.cwd(), '.env'),
    process.env.DOTENV_CONFIG_PATH
  ]);
}

function writableEnvFilePath(): string {
  // Derived auth state (CSRF token, cookie, user id) is written to a dedicated gitignored file,
  // never the developer's project .env.
  return path.resolve(process.env.GENERATED_ENV_FILE || defaultGeneratedEnvFilePath());
}

function defaultGeneratedEnvFilePath(): string {
  return path.resolve(process.cwd(), '.auth', 'generated-auth.env');
}

function uniquePaths(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)).map((value) => path.resolve(value)))];
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function parseEnvFile(content: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const line of content.split(/\\r?\\n/)) {
    const match = /^\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*=\\s*(.*)\\s*$/.exec(line);
    if (!match) {
      continue;
    }

    values[match[1]] = unquoteEnvValue(match[2].trim());
  }

  return values;
}

function unquoteEnvValue(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}

function formatEnvValue(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) {
    return value;
  }

  return JSON.stringify(value);
}

function defaultPlaceholderValue(envName: string): string | undefined {
  if (envName === 'CACHE_BUSTER') {
    return String(Date.now());
  }

  return undefined;
}
`;
}

export function buildPlaywrightAuthSetupFile(): string {
  return String.raw`import { request, type APIRequestContext, type APIResponse } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertAllowedTarget,
  clearGeneratedAuthSnapshot,
  clearGeneratedEnvValues,
  replaceGeneratedEnvValues,
  resolveGeneratedEnvValue
} from './apiTestUtils.js';

type LoginData = string | Record<string, unknown>;

interface LoginConfig {
  url: string;
  method: string;
  contentType: string;
  headers: Record<string, string>;
  data?: LoginData;
  csrfHeaderName: string;
  csrfJsonPath?: string;
  csrfSourcePath?: string;
}

export default async function globalSetup(): Promise<void> {
  // Stale results from a previous calibration run would skew the recorded statuses, so each
  // calibration run starts from an empty file. Runs before the auth early-return on purpose.
  if (process.env.CALIBRATION_MODE === 'true') {
    fs.rmSync(path.resolve(process.env.CALIBRATION_OUTPUT_FILE || 'test-results/calibration-results.jsonl'), { force: true });
  }

  // A non-login strategy must not leave a previous user or environment's snapshot available to
  // workers. AUTH_STRATEGY is the single source of truth; no separate enable/approval flag exists.
  clearGeneratedAuthSnapshot();
  const authStrategy = envValue('AUTH_STRATEGY', 'none').toLowerCase();
  if (authStrategy === 'none' || authStrategy === 'static-env') {
    return;
  }
  if (authStrategy !== 'http-login') {
    throw new Error('Unsupported AUTH_STRATEGY: ' + authStrategy + '. Expected none, static-env, or http-login.');
  }

  // Never let a failed or partial login leave a previous user/environment's derived credentials
  // available to test workers.
  clearGeneratedEnvValues();
  const config = buildLoginConfig();
  assertAllowedTarget(config.url, 'authentication login');
  const context = await request.newContext({
    ignoreHTTPSErrors: envValue('AUTH_IGNORE_HTTPS_ERRORS', 'false').toLowerCase() === 'true'
  });

  try {
    const response = await context.fetch(config.url, {
      method: config.method,
      headers: config.headers,
      data: config.data,
      maxRedirects: 0
    });

    if (!response.ok()) {
      throw new Error(
        'Auth setup login failed: ' + config.method + ' returned HTTP ' + response.status() + '.'
      );
    }

    const loginBody = await readJsonResponse(response);
    const userId = userIdFromLoginBody(loginBody);
    const authToken = tokenFromLoginBody(loginBody);
    const csrfToken = await extractCsrfToken(response, config, context, loginBody);
    if (!csrfToken && envValue('AUTH_REQUIRE_CSRF', 'false').toLowerCase() === 'true') {
      throw new Error(
        'Auth setup login did not return a CSRF token. Set AUTH_CSRF_HEADER or AUTH_CSRF_JSON_PATH if the login response uses a custom token location.'
      );
    }

    const cookieHeader = cookieHeaderFromResponse(response);
    if (!authToken && !cookieHeader) {
      throw new Error('Auth setup login returned neither a bearer token nor a session cookie.');
    }
    const generatedValues: Record<string, string> = {};
    if (csrfToken) {
      generatedValues.CSRF_TOKEN = csrfToken;
    }
    if (userId) {
      generatedValues.USER_ID = userId;
    }
    if (authToken) {
      generatedValues.API_TOKEN = authToken;
      generatedValues.API_AUTHORIZATION = 'Bearer ' + authToken;
    }
    if (cookieHeader) {
      generatedValues.API_COOKIE = cookieHeader;
    }
    // Publish one complete snapshot only after login and CSRF extraction have both succeeded.
    replaceGeneratedEnvValues(generatedValues);
  } finally {
    await context.dispose();
  }
}

function buildLoginConfig(): LoginConfig {
  const contentType = envValue('AUTH_LOGIN_CONTENT_TYPE', 'application/json');
  const bodyTemplate = requiredEnvValue('AUTH_LOGIN_BODY');

  return {
    url: loginUrl(),
    method: envValue('AUTH_LOGIN_METHOD', 'POST').toUpperCase(),
    contentType,
    headers: {
      accept: 'application/json, text/plain, */*',
      'content-type': contentType,
      ...parseHeaderOverrides(envValue('AUTH_LOGIN_HEADERS', '{}'))
    },
    data: loginDataFromBody(bodyTemplate, contentType),
    csrfHeaderName: envValue('AUTH_CSRF_HEADER', 'x-csrf-token'),
    csrfJsonPath: optionalEnvValue('AUTH_CSRF_JSON_PATH'),
    csrfSourcePath: optionalEnvValue('AUTH_CSRF_SOURCE_PATH')
  };
}

function loginUrl(): string {
  const explicitUrl = optionalEnvValue('AUTH_LOGIN_URL');
  if (explicitUrl) {
    return explicitUrl;
  }
  throw new Error('AUTH_LOGIN_URL is required when AUTH_STRATEGY=http-login.');
}

function loginDataFromBody(bodyTemplate: string, contentType: string): LoginData {
  const resolvedBody = resolveEnvPlaceholders(bodyTemplate);
  if (!isJsonContentType(contentType)) {
    return resolvedBody;
  }

  const parsed = JSON.parse(resolvedBody) as unknown;
  if (!isRecord(parsed)) {
    throw new Error('AUTH_LOGIN_BODY must be a JSON object when AUTH_LOGIN_CONTENT_TYPE is JSON.');
  }

  return parsed;
}

async function extractCsrfToken(
  response: APIResponse,
  config: LoginConfig,
  context: APIRequestContext,
  responseBody: unknown
): Promise<string | undefined> {
  const fromHeaders = csrfFromHeaders(response, config.csrfHeaderName);
  if (fromHeaders) {
    return fromHeaders;
  }

  if (config.csrfJsonPath) {
    const pathValue = valueAtJsonPath(responseBody, config.csrfJsonPath);
    if (typeof pathValue === 'string' && pathValue !== '') {
      return pathValue;
    }
  }

  const fromJson = csrfFromJson(responseBody);
  if (fromJson) {
    return fromJson;
  }

  const fromSource = await csrfFromSource(context, config);
  if (fromSource) {
    return fromSource;
  }

  return csrfFromCookies(response);
}

async function csrfFromSource(context: APIRequestContext, config: LoginConfig): Promise<string | undefined> {
  if (!config.csrfSourcePath) {
    return undefined;
  }
  const sourceUrl = resolveUrl(config.url, config.csrfSourcePath);
  assertAllowedTarget(sourceUrl, 'authentication CSRF source');
  const response = await context
    .fetch(sourceUrl, {
      method: 'GET',
      headers: {
        accept: 'application/json, text/plain, */*',
        'x-requested-with': 'XMLHttpRequest'
      },
      maxRedirects: 0
    })
    .catch(() => undefined);

  if (!response?.ok()) {
    return undefined;
  }

  const fromHeaders = csrfFromHeaders(response, config.csrfHeaderName);
  if (fromHeaders) {
    return fromHeaders;
  }

  const contentType = response.headers()['content-type'] ?? '';
  if (isJsonContentType(contentType)) {
    const sourceBody = await readJsonResponse(response);
    if (config.csrfJsonPath) {
      const pathValue = valueAtJsonPath(sourceBody, config.csrfJsonPath);
      if (typeof pathValue === 'string' && pathValue !== '') {
        return pathValue;
      }
    }

    return csrfFromJson(sourceBody);
  }

  const sourceText = await response.text().catch(() => '');
  return csrfFromHtml(sourceText);
}

function csrfFromHeaders(response: APIResponse, configuredHeaderName: string): string | undefined {
  const headers = response.headers();
  const headerNames = uniqueStrings([
    configuredHeaderName,
    'x-csrf-token',
    'csrf-token',
    'x-xsrf-token',
    'x-csrftoken'
  ]);

  for (const headerName of headerNames) {
    const value = headers[headerName.toLowerCase()];
    if (value) {
      return value;
    }
  }

  return undefined;
}

function csrfFromCookies(response: APIResponse): string | undefined {
  for (const setCookie of setCookieHeaders(response)) {
    const cookiePair = setCookie.split(';')[0] ?? '';
    const separatorIndex = cookiePair.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const cookieName = cookiePair.slice(0, separatorIndex).trim().toLowerCase();
    if (!['csrf-token', 'xsrf-token', 'x-csrf-token', 'x-xsrf-token', 'csrftoken', 'xsrftoken'].includes(cookieName)) {
      continue;
    }

    return decodeURIComponent(cookiePair.slice(separatorIndex + 1).trim());
  }

  return undefined;
}

function csrfFromHtml(value: string): string | undefined {
  return (
    /name=["']_csrf["'][^>]+value=["']([^"']+)["']/i.exec(value)?.[1] ??
    /value=["']([^"']+)["'][^>]+name=["']_csrf["']/i.exec(value)?.[1] ??
    /name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i.exec(value)?.[1] ??
    /content=["']([^"']+)["'][^>]+name=["']csrf-token["']/i.exec(value)?.[1]
  );
}

async function readJsonResponse(response: APIResponse): Promise<unknown> {
  if (!isJsonContentType(response.headers()['content-type'] ?? '')) {
    return undefined;
  }

  return (await response.json().catch(() => undefined)) as unknown;
}

function userIdFromLoginBody(value: unknown): string | undefined {
  const explicitUserId =
    stringAtJsonPath(value, 'response.data.id') ??
    stringAtJsonPath(value, 'response.data.user.id') ??
    stringAtJsonPath(value, 'data.id') ??
    stringAtJsonPath(value, 'user.id') ??
    stringAtJsonPath(value, 'id');
  if (explicitUserId) {
    return explicitUserId;
  }

  const token = tokenFromLoginBody(value);
  return token ? userIdFromJwt(token) : undefined;
}

function tokenFromLoginBody(value: unknown): string | undefined {
  return (
    stringAtJsonPath(value, 'response.data.token') ??
    stringAtJsonPath(value, 'response.data.accessToken') ??
    stringAtJsonPath(value, 'response.token') ??
    stringAtJsonPath(value, 'data.token') ??
    stringAtJsonPath(value, 'data.accessToken') ??
    stringAtJsonPath(value, 'accessToken') ??
    stringAtJsonPath(value, 'token')
  );
}

function stringAtJsonPath(value: unknown, jsonPath: string): string | undefined {
  const pathValue = valueAtJsonPath(value, jsonPath);
  return typeof pathValue === 'string' && pathValue !== '' ? pathValue : undefined;
}

function userIdFromJwt(token: string): string | undefined {
  const payload = token.split('.')[1];
  if (!payload) {
    return undefined;
  }

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown;
    return stringAtJsonPath(decoded, 'id') ?? stringAtJsonPath(decoded, 'uid') ?? stringAtJsonPath(decoded, 'sub');
  } catch {
    return undefined;
  }
}

function resolveUrl(baseUrl: string, pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }

  const origin = new URL(baseUrl).origin;
  return origin + (pathOrUrl.startsWith('/') ? pathOrUrl : '/' + pathOrUrl);
}

function cookieHeaderFromResponse(response: APIResponse): string {
  return setCookieHeaders(response)
    .map((setCookie) => setCookie.split(';')[0]?.trim() ?? '')
    .filter(Boolean)
    .join('; ');
}

function setCookieHeaders(response: APIResponse): string[] {
  return response
    .headersArray()
    .filter((header) => header.name.toLowerCase() === 'set-cookie')
    .map((header) => header.value);
}

function csrfFromJson(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const token = csrfFromJson(item);
      if (token) {
        return token;
      }
    }
    return undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  for (const [key, childValue] of Object.entries(value)) {
    const normalizedKey = key.replace(/[_-]/g, '').toLowerCase();
    if ((normalizedKey.includes('csrf') || normalizedKey.includes('xsrf')) && typeof childValue === 'string' && childValue) {
      return childValue;
    }
  }

  for (const childValue of Object.values(value)) {
    const token = csrfFromJson(childValue);
    if (token) {
      return token;
    }
  }

  return undefined;
}

function valueAtJsonPath(value: unknown, jsonPath: string): unknown {
  let current = value;
  for (const segment of jsonPath.split('.').filter(Boolean)) {
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      current = current[Number(segment)];
      continue;
    }

    if (!isRecord(current)) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

function parseHeaderOverrides(value: string): Record<string, string> {
  const resolved = resolveEnvPlaceholders(value);
  const parsed = JSON.parse(resolved) as unknown;
  if (!isRecord(parsed)) {
    throw new Error('AUTH_LOGIN_HEADERS must be a JSON object.');
  }

  return Object.fromEntries(Object.entries(parsed).map(([name, headerValue]) => [name, String(headerValue)]));
}

function resolveEnvPlaceholders(value: string): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, envName: string) => resolveGeneratedEnvValue(envName));
}

function envValue(envName: string, fallback: string): string {
  return optionalEnvValue(envName) ?? fallback;
}

function requiredEnvValue(envName: string): string {
  const value = optionalEnvValue(envName);
  if (!value) {
    throw new Error(envName + ' is required when AUTH_STRATEGY=http-login.');
  }
  return value;
}

function optionalEnvValue(envName: string): string | undefined {
  const processValue = process.env[envName];
  if (processValue && processValue.trim() !== '') {
    return processValue;
  }

  try {
    const fileValue = resolveGeneratedEnvValue(envName);
    return fileValue.trim() === '' ? undefined : fileValue;
  } catch {
    return undefined;
  }
}

function isJsonContentType(contentType: string): boolean {
  return contentType.toLowerCase().includes('json');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
`;
}
