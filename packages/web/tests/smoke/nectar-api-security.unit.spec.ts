import { expect, test } from '@playwright/test';
import { resolveMsalRefreshEndpoint, resolveNectarBaseUrl } from '../../fixtures/nectar-api';

const controlledEnv = [
  'BASE_URL',
  'CHANNEL_BASE_URL',
  'PLAYWRIGHT_TEST_BASE_URL',
  'NECTAR_API_ALLOWED_HOSTS',
  'NECTAR_AUTH_ALLOWED_ISSUERS',
  'NECTAR_ALLOW_INSECURE_HTTP'
] as const;

test.beforeEach(() => {
  for (const name of controlledEnv) {
    delete process.env[name];
  }
});

test.afterAll(() => {
  for (const name of controlledEnv) {
    delete process.env[name];
  }
});

test('bearer transport requires HTTPS and an explicitly approved host', () => {
  expect(resolveNectarBaseUrl()).toBe('https://www.dev.pollen.js-devops.co.uk');
  expect(() => resolveNectarBaseUrl('https://attacker.example.test')).toThrow(/unapproved host/);

  process.env.NECTAR_API_ALLOWED_HOSTS = 'api.qa.example.test';
  expect(resolveNectarBaseUrl('https://api.qa.example.test/path')).toBe('https://api.qa.example.test');
  expect(() => resolveNectarBaseUrl('http://api.qa.example.test')).toThrow(/must use HTTPS/);
});

test('refresh tokens are sent only to an exact approved issuer and tenant', () => {
  const trustedIssuer = 'https://tenant.b2clogin.com/tenant-id/v2.0/';
  const trustedToken = unsignedJwt({ iss: trustedIssuer, acr: 'B2C_1_signin', aud: 'client-id' });
  const attackerToken = unsignedJwt({
    iss: 'https://attacker.b2clogin.com/attacker-tenant/v2.0/',
    acr: 'B2C_1_signin',
    aud: 'client-id'
  });

  expect(() => resolveMsalRefreshEndpoint(trustedToken)).toThrow(/unapproved issuer/);
  process.env.NECTAR_AUTH_ALLOWED_ISSUERS = trustedIssuer;
  expect(resolveMsalRefreshEndpoint(trustedToken)).toBe(
    'https://tenant.b2clogin.com/tenant-id/B2C_1_signin/oauth2/v2.0/token'
  );
  expect(() => resolveMsalRefreshEndpoint(attackerToken)).toThrow(/unapproved issuer/);
});

function unsignedJwt(payload: Record<string, unknown>): string {
  return ['header', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'signature'].join('.');
}
