export interface SupportFileHosts {
  primaryHost: string;
  knownHosts: string[];
}

export function buildPlaywrightSupportFile(hosts: SupportFileHosts = { primaryHost: '', knownHosts: [] }): string {
  return `import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { Ajv } from 'ajv/dist/ajv.js';
import fs from 'node:fs';
import path from 'node:path';

const ajv = new Ajv({ allErrors: true, strict: false });

// Hosts observed in the source capture, injected at generation time.
const KNOWN_HOSTS: string[] = ${JSON.stringify(hosts.knownHosts)};
const PRIMARY_HOST = ${JSON.stringify(hosts.primaryHost)};
// Non-primary first-party hosts default to bearer auth (the primary host uses the session cookie).
// Override with AUTH_BEARER_HOSTS.
const DEFAULT_BEARER_HOSTS: string[] = ${JSON.stringify(hosts.knownHosts.filter((host) => host !== hosts.primaryHost))};

// In calibration mode the inferred fixme tests run for real so their actual statuses can be recorded.
export const inferredTest = process.env.CALIBRATION_MODE === 'true' ? test : (test.fixme as unknown as typeof test);

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

  process.env[envName] = value;

  const envFilePath = writableEnvFilePath();
  fs.mkdirSync(path.dirname(envFilePath), { recursive: true });
  const existing = fs.existsSync(envFilePath) ? fs.readFileSync(envFilePath, 'utf8') : '';
  fs.writeFileSync(envFilePath, upsertEnvValue(existing, envName, value), 'utf8');
  cachedEnvFileValues = undefined;
}

export async function sendApiRequest(options: SendApiRequestOptions): Promise<TimedApiResponse> {
  const baseUrl = resolveBaseUrl(options.defaultBaseUrl);
  const endpointPath = resolveEndpointPath(options.path);
  const url = \`\${baseUrl}\${endpointPath}\`;
  const fetchOptions: Parameters<APIRequestContext['fetch']>[1] = {
    method: options.method
  };
  const headers = options.headers ? resolveHeaders(options.headers) : {};

  // Isolated sessions manage their own cookies (via the context's jar) and auth, so skip the
  // shared session cookie and bearer injection entirely.
  if (!options.isolatedSession) {
    const defaultCookieHeader = resolveDefaultCookieHeader(baseUrl);
    if (defaultCookieHeader && !hasHeader(headers, 'cookie')) {
      headers.cookie = defaultCookieHeader;
    }

    // Some services authenticate via Authorization: Bearer rather than the session cookie. For
    // hosts in AUTH_BEARER_HOSTS, attach the captured login token when no Authorization is present.
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
  const cookie = resolveEnvironmentValue('API_COOKIE', {});
  if (!cookie || !shouldAttachGeneratedCookie(baseUrl)) {
    return '';
  }

  return cookie;
}

function shouldAttachGeneratedCookie(baseUrl: string): boolean {
  const requestHost = hostnameFromUrl(baseUrl);
  if (!requestHost) {
    return false;
  }

  // Attach the captured session cookie to any first-party host observed in the capture, not just
  // the login host — multi-host suites share one session.
  if (cookieHosts().includes(requestHost) || KNOWN_HOSTS.includes(requestHost)) {
    return true;
  }

  // Optional shared cookie domain (e.g. AUTH_COOKIE_DOMAIN=.heartpace.dev) attaches the session to
  // every subdomain.
  const cookieDomain = optionalEnvironmentValue('AUTH_COOKIE_DOMAIN');
  if (cookieDomain) {
    const bare = cookieDomain.replace(/^\\./, '');
    if (requestHost === bare || requestHost.endsWith('.' + bare)) {
      return true;
    }
  }

  return false;
}

function cookieHosts(): string[] {
  return uniqueStrings([
    optionalEnvironmentValue('AUTH_COOKIE_HOST'),
    hostnameFromUrl(optionalEnvironmentValue('AUTH_BASE_URL') ?? ''),
    hostnameFromUrl(optionalEnvironmentValue('BASE_URL') ?? '')
  ]);
}

function shouldAttachBearer(baseUrl: string): boolean {
  const requestHost = hostnameFromUrl(baseUrl);
  if (!requestHost) {
    return false;
  }

  return bearerHosts().includes(requestHost);
}

function bearerHosts(): string[] {
  const configured = (optionalEnvironmentValue('AUTH_BEARER_HOSTS') ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  // No explicit list -> default to the non-primary first-party hosts derived at generation time,
  // so multi-service captures authenticate out of the box (only the tenant value + creds needed).
  return configured.length > 0 ? configured : DEFAULT_BEARER_HOSTS;
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
  const value = process.env[envName] ?? readGeneratedEnvFileValues()[envName] ?? defaultPlaceholderValue(envName);

  // Blank values (e.g. an untouched "NAME=" line copied from .env.generated.example, or an unset
  // CI secret expanding to '') never satisfy a required placeholder — fail fast in preflight
  // instead of sending malformed live requests.
  if (options.required && (value === undefined || value.trim() === '')) {
    throw new Error('Missing required environment variable ' + envName + ' for generated test placeholder \${' + envName + '}');
  }

  return value ?? '';
}

function optionalEnvironmentValue(envName: string): string | undefined {
  const value = resolveEnvironmentValue(envName, {});
  return value === '' ? undefined : value;
}

function readGeneratedEnvFileValues(): Record<string, string> {
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

function readableEnvFilePaths(): string[] {
  // Lowest-to-highest precedence. The user's .env is the baseline; freshly derived auth state in
  // the generated auth file is read LAST so it overrides any stale CSRF/cookie left in .env.
  // (globalSetup runs in a separate process from test workers, so workers only see it via file.)
  return uniquePaths([
    path.resolve(process.cwd(), '.env'),
    process.env.DOTENV_CONFIG_PATH,
    process.env.GENERATED_ENV_FILE || defaultGeneratedEnvFilePath()
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

function upsertEnvValue(content: string, envName: string, value: string): string {
  const lines = content ? content.split(/\\r?\\n/) : [];
  const nextLine = \`\${envName}=\${formatEnvValue(value)}\`;
  const envLinePattern = new RegExp('^\\\\s*' + escapeRegExp(envName) + '\\\\s*=');
  let updated = false;

  const nextLines = lines.map((line) => {
    if (envLinePattern.test(line)) {
      updated = true;
      return nextLine;
    }

    return line;
  });

  if (!updated) {
    if (nextLines.length > 0 && nextLines[nextLines.length - 1] !== '') {
      nextLines.push('');
    }
    nextLines.push(nextLine);
  }

  return \`\${nextLines.join('\\n').replace(/\\n*$/, '')}\\n\`;
}

function formatEnvValue(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) {
    return value;
  }

  return JSON.stringify(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\\\{}()[\\]^$+*?.]/g, '\\\\$&');
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
import { resolveGeneratedEnvValue, updateGeneratedEnvValue } from './apiTestUtils.js';

type LoginData = string | Record<string, unknown>;

interface LoginConfig {
  url: string;
  method: string;
  contentType: string;
  headers: Record<string, string>;
  data?: LoginData;
  csrfHeaderName: string;
  csrfJsonPath?: string;
  csrfSourcePath: string;
}

export default async function globalSetup(): Promise<void> {
  // Stale results from a previous calibration run would skew the recorded statuses, so each
  // calibration run starts from an empty file. Runs before the auth early-return on purpose.
  if (process.env.CALIBRATION_MODE === 'true') {
    fs.rmSync(path.resolve(process.env.CALIBRATION_OUTPUT_FILE || 'test-results/calibration-results.jsonl'), { force: true });
  }

  if (envValue('AUTH_SETUP_ENABLED', 'true').toLowerCase() === 'false') {
    return;
  }

  const config = buildLoginConfig();
  const context = await request.newContext({ ignoreHTTPSErrors: true });

  try {
    const response = await context.fetch(config.url, {
      method: config.method,
      headers: config.headers,
      data: config.data
    });

    if (!response.ok()) {
      const bodyPreview = await response.text().catch(() => '');
      const suffix = bodyPreview ? ' Body: ' + bodyPreview.slice(0, 500) : '';
      throw new Error(
        'Auth setup login failed: ' + config.method + ' ' + config.url + ' returned ' + response.status() + '.' + suffix
      );
    }

    const loginBody = await readJsonResponse(response);
    const userId = userIdFromLoginBody(loginBody);
    if (userId) {
      updateGeneratedEnvValue('USER_ID', userId);
    }

    const authToken = tokenFromLoginBody(loginBody);
    if (authToken) {
      updateGeneratedEnvValue('API_TOKEN', authToken);
      updateGeneratedEnvValue('API_AUTHORIZATION', 'Bearer ' + authToken);
    }

    const csrfToken = await extractCsrfToken(response, config, context, loginBody);
    if (!csrfToken) {
      throw new Error(
        'Auth setup login did not return a CSRF token. Set AUTH_CSRF_HEADER or AUTH_CSRF_JSON_PATH if the login response uses a custom token location.'
      );
    }

    updateGeneratedEnvValue('CSRF_TOKEN', csrfToken);

    const cookieHeader = cookieHeaderFromResponse(response);
    if (cookieHeader) {
      updateGeneratedEnvValue('API_COOKIE', cookieHeader);
    }
  } finally {
    await context.dispose();
  }
}

function buildLoginConfig(): LoginConfig {
  const contentType = envValue('AUTH_LOGIN_CONTENT_TYPE', 'application/json');
  const bodyTemplate = optionalEnvValue('AUTH_LOGIN_BODY');

  return {
    url: loginUrl(),
    method: envValue('AUTH_LOGIN_METHOD', 'POST').toUpperCase(),
    contentType,
    headers: {
      accept: 'application/json, text/plain, */*',
      'content-type': contentType,
      ...parseHeaderOverrides(envValue('AUTH_LOGIN_HEADERS', '{}'))
    },
    data: bodyTemplate ? loginDataFromBody(bodyTemplate, contentType) : defaultLoginData(contentType),
    csrfHeaderName: envValue('AUTH_CSRF_HEADER', 'x-csrf-token'),
    csrfJsonPath: optionalEnvValue('AUTH_CSRF_JSON_PATH'),
    csrfSourcePath: envValue('AUTH_CSRF_SOURCE_PATH', '/user/session')
  };
}

function loginUrl(): string {
  const explicitUrl = optionalEnvValue('AUTH_LOGIN_URL');
  if (explicitUrl) {
    return explicitUrl;
  }

  const baseUrl = envValue('AUTH_BASE_URL', envValue('BASE_URL', 'https://stageautomation.heartpace.dev')).replace(/\/$/, '');
  const loginPath = envValue('AUTH_LOGIN_PATH', '/auth/main/login');
  return baseUrl + (loginPath.startsWith('/') ? loginPath : '/' + loginPath);
}

function defaultLoginData(contentType: string): LoginData {
  const email = resolveGeneratedEnvValue('TEST_EMAIL');
  const password = resolveGeneratedEnvValue('TEST_PASSWORD');

  if (contentType.includes('application/x-www-form-urlencoded')) {
    return new URLSearchParams({ email, password }).toString();
  }

  return { email, password };
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
  const response = await context
    .fetch(resolveUrl(config.url, config.csrfSourcePath), {
      method: 'GET',
      headers: {
        accept: 'application/json, text/plain, */*',
        'x-requested-with': 'XMLHttpRequest'
      }
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
