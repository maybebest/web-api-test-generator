const NON_PRODUCTION_HOST_LABELS = new Set([
  'dev',
  'development',
  'local',
  'preview',
  'qa',
  'sandbox',
  'stage',
  'staging',
  'test',
  'testing',
  'uat'
]);

/**
 * Validates the exact external target contract shared by generation readiness
 * and authenticated Playwright configuration.
 *
 * @param {string} rawUrl
 * @param {string} [exactAllowedHosts]
 * @returns {string}
 */
export function validateAuthenticatedTarget(rawUrl, exactAllowedHosts = '') {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('PLAYWRIGHT_TEST_BASE_URL must be a valid absolute URL.');
  }

  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || (url.port && url.port !== '443')
    || url.search
    || url.hash
  ) {
    throw new Error(
      'Authenticated regression requires HTTPS without embedded credentials, non-standard ports, query parameters, or fragments.'
    );
  }

  const allowedHosts = String(exactAllowedHosts ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  const hostnamePattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/;
  if (allowedHosts.some((host) => !hostnamePattern.test(host))) {
    throw new Error('E2E_AUTH_ALLOWED_HOSTS must contain comma-separated hostnames only.');
  }

  const hostname = url.hostname.toLowerCase();
  const hasNonProductionLabel = hostname.split('.').some((label) => NON_PRODUCTION_HOST_LABELS.has(label));
  if (!hasNonProductionLabel && !allowedHosts.includes(hostname)) {
    throw new Error(
      `Refusing authenticated regression against unclassified host ${hostname}. `
        + 'Use a host with an explicit non-production label or add the exact reviewed hostname to E2E_AUTH_ALLOWED_HOSTS.'
    );
  }

  return url.href;
}
