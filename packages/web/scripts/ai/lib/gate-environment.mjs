const BASE_ENVIRONMENT_NAMES = new Set([
  'PATH', 'TMPDIR', 'TMP', 'TEMP', 'SHELL', 'USER', 'LOGNAME', 'LANG', 'TERM', 'CI',
  'PLAYWRIGHT_TEST_BASE_URL', 'PLAYWRIGHT_TEST_SUITE_ROOT',
  'LOCAL_FIXTURE_HOST', 'LOCAL_FIXTURE_PORT',
  'E2E_AUTH_ENABLED', 'E2E_AUTH_ALLOWED_HOSTS', 'E2E_AUTH_REUSE_STATE', 'E2E_AUTH_STATE_PATH',
  'E2E_LOGIN_PATH', 'E2E_LOGIN_EMAIL_SELECTOR', 'E2E_LOGIN_PASSWORD_SELECTOR',
  'E2E_LOGIN_SUBMIT_SELECTOR', 'E2E_AUTH_SUCCESS_SELECTOR', 'E2E_AUTH_SUCCESS_URL_REGEX',
  'E2E_ALLOW_PERSISTENT_TEST_DATA',
  'TEST_ENV',
  'E2E_MP_ADVERTISER', 'E2E_MP_BRAND', 'E2E_MP_OBJECTIVE', 'E2E_MP_PRODUCT_SEARCH', 'E2E_MP_SKU',
  'E2E_MP_ONSITE_CHANNEL', 'E2E_MP_OFFSITE_CHANNEL', 'E2E_MP_ATHOME_CHANNEL', 'E2E_MP_INSTORE_CHANNEL',
  'E2E_MP_OFFSITE_PUBMATIC_CHANNEL', 'E2E_MP_CHANNEL_BOOKING_DEADLINE_DAYS',
  'E2E_MP_CHANNEL_MIN_DURATION_DAYS', 'E2E_MP_CHANNEL_MIN_STORES', 'E2E_MP_CHANNEL_MAX_STORES',
  'E2E_MP_ONSITE_DISPLAY_BOOKING_DEADLINE_DAYS', 'E2E_MP_DD_COMPETITION_PAGE_MIN_DURATION_DAYS',
  'E2E_MP_COST_PER_STORE_CHANNEL', 'E2E_MP_COST_PER_UNIT_CHANNEL', 'E2E_MP_BASE_RATE_CHANNEL',
  'E2E_MP_UNBOUNDED_CHANNEL', 'E2E_MP_STORE_VOLUME_MIN', 'E2E_MP_STORE_VOLUME_MAX',
  'E2E_MP_DELETION_ONSITE_CHANNEL', 'E2E_MP_DELETION_OFFSITE_CHANNEL',
  'E2E_MP_DELETION_STAGGERED_FIXTURE', 'E2E_MP_RECOMPUTE_CHANNEL_A', 'E2E_MP_RECOMPUTE_CHANNEL_B',
  'E2E_MP_TROLLEY_CHANNEL', 'E2E_MP_TROLLEY_COST_PER_UNIT', 'E2E_MP_TROLLEY_MS_PERCENT',
  'E2E_MP_PETROL_FLAT_CHANNEL', 'E2E_MP_PETROL_COST_PER_UNIT', 'E2E_MP_PETROL_MS_FLAT',
  'E2E_MP_TRAVELMONEY_CHANNEL', 'E2E_MP_TRAVELMONEY_COST_PER_STORE', 'E2E_MP_TRAVELMONEY_MS_PERCENT',
  'E2E_MP_BUDGETLED_CHANNEL', 'E2E_MP_BUDGETLED_BUDGET',
  'E2E_SECONDARY_SPACE_ADVERTISER', 'E2E_SECONDARY_SPACE_BRAND',
  'E2E_SECONDARY_SPACE_INTERNAL_CHANNEL', 'E2E_SECONDARY_SPACE_MUTATION_ENABLED',
  'E2E_SECONDARY_SPACE_PRODUCT_SEARCH', 'E2E_SECONDARY_SPACE_PUBLIC_CHANNEL',
  'NECTAR_PLANNING_SESSION_ID', 'NECTAR_ALLOW_INSECURE_HTTP',
  'NECTAR_API_ALLOWED_HOSTS', 'NECTAR_AUTH_ALLOWED_ISSUERS',
  'BASE_URL', 'CHANNEL_BASE_URL', 'CHANNEL_FEATURE_FLAGS',
  'ALLURE_ENABLED', 'COLLECT_PERF', 'PERF_OUTPUT_DIR'
]);

const AUTH_SECRET_NAMES = new Set([
  'E2E_USER_EMAIL', 'E2E_USER_PASSWORD', 'E2E_ADMIN_EMAIL', 'E2E_ADMIN_PASSWORD',
  'E2E_HTTP_BASIC_PASSWORD',
  'WEB_BASIC_AUTH_USER', 'WEB_BASIC_AUTH_PASSWORD', 'AGENT_PASSWORD', 'ADMIN_EMAIL', 'ADMIN_PASSWORD'
]);
const AUTH_RUNTIME_NAMES = new Set([...AUTH_SECRET_NAMES, 'E2E_HTTP_BASIC_USERNAME']);
const API_SECRET_NAMES = new Set(['API_AUTHORIZATION', 'API_TOKEN', 'CHANNEL_BEARER_TOKEN']);
const KNOWN_SECRET_NAMES = new Set([
  ...AUTH_SECRET_NAMES,
  ...API_SECRET_NAMES,
  'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'
]);
export const GATE_ENVIRONMENT_PROFILES = ['static', 'local-runtime', 'external-runtime'];
const MIN_REDACTABLE_SECRET_LENGTH = 4;

export function assertRedactableSecretValues(secretValues = []) {
  const hasUnsafeShortValue = Array.isArray(secretValues)
    && secretValues.some((value) => (
      typeof value === 'string'
      && value.length > 0
      && value.length < MIN_REDACTABLE_SECRET_LENGTH
    ));
  if (hasUnsafeShortValue) {
    throw new Error(
      'Sensitive environment values shorter than four characters cannot be safely redacted for AI provider use.'
    );
  }
}

// Actual secret VALUES present in the runner's environment, for value-based
// redaction of text that may echo them (e.g. Playwright error messages).
export function knownSecretEnvValues(source = process.env) {
  const values = [];
  for (const name of KNOWN_SECRET_NAMES) {
    const value = String(source[name] ?? '').trim();
    if (value) values.push(value);
  }
  assertRedactableSecretValues(values);
  return values;
}

export function buildGateEnvironment(source = process.env, { profile = 'external-runtime' } = {}) {
  if (!GATE_ENVIRONMENT_PROFILES.includes(profile)) {
    throw new Error(`Unsupported gate environment profile: ${profile}.`);
  }

  const allowed = new Set(BASE_ENVIRONMENT_NAMES);
  if (profile === 'external-runtime') {
    for (const name of AUTH_RUNTIME_NAMES) allowed.add(name);
    for (const name of API_SECRET_NAMES) allowed.add(name);
  }

  const environment = {};
  for (const [name, value] of Object.entries(source)) {
    if (allowed.has(name) || /^LC_[A-Z0-9_]+$/.test(name)) {
      environment[name] = value;
    }
  }

  // Playwright must never reload the repository .env after this allowlist is
  // applied. Empty known-secret values also stop nested dotenv users (which do
  // not override an existing key by default) from repopulating stripped data.
  environment.AI_GATE_SANITIZED_ENV = 'true';
  for (const name of KNOWN_SECRET_NAMES) {
    if (!allowed.has(name)) environment[name] = '';
  }
  environment.ANTHROPIC_API_KEY = '';
  environment.OPENAI_API_KEY = '';
  return environment;
}
