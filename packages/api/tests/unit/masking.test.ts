import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/config/defaultConfig.js';
import { isSecretLikeValue, maskHeaders, maskJsonValue } from '../../src/utils/masking.js';

describe('masking utilities', () => {
  it('replaces secret headers with environment placeholders', () => {
    expect(
      maskHeaders(
        {
          Authorization: 'Bearer secret-token-value-that-is-long',
          Cookie: 'sid=abc',
          Accept: 'application/json',
          Host: 'api.example.test'
        },
        defaultConfig
      )
    ).toEqual({
      accept: 'application/json',
      authorization: '${API_AUTHORIZATION}',
      cookie: '${API_COOKIE}'
    });
  });

  it('replaces dynamic header identifiers with named environment placeholders', () => {
    expect(
      maskHeaders(
        {
          'X-Site-UUID': '842795ed-552b-47c6-8cb7-bcbf54ec8adb',
          'X-Request-Time': '2026-05-29T12:00:01.000Z'
        },
        defaultConfig
      )
    ).toEqual({
      'x-request-time': '${X_REQUEST_TIME}',
      'x-site-uuid': '${X_SITE_UUID}'
    });
  });

  it('masks secret JSON fields recursively', () => {
    expect(
      maskJsonValue(
        {
          email: 'real.person@example.com',
          profile: {
            password: 'super-secret',
            name: 'Ada'
          }
        },
        defaultConfig
      )
    ).toEqual({
      email: '${TEST_EMAIL}',
      profile: {
        name: 'Ada',
        password: '${TEST_PASSWORD}'
      }
    });
  });

  it('never masks structural header values like content-type as secrets', () => {
    expect(
      maskHeaders(
        {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/vnd.api+json'
        },
        defaultConfig
      )
    ).toEqual({
      accept: 'application/vnd.api+json',
      'content-type': 'application/x-www-form-urlencoded'
    });
  });

  it('does not classify media types as secret-like values', () => {
    expect(isSecretLikeValue('application/x-www-form-urlencoded')).toBe(false);
    expect(isSecretLikeValue('application/vnd.api+json')).toBe(false);
    expect(isSecretLikeValue('Bearer abcdefghijklmnopqrstuvwxyz0123456789')).toBe(true);
  });

  it('masks secrets nested inside JSON encoded as a string (no leak through user_data blobs)', () => {
    const masked = maskJsonValue(
      {
        user_data: JSON.stringify({ email: 'real.person@example.com', user_hash: 'a'.repeat(40) })
      },
      defaultConfig
    ) as { user_data: string };

    expect(masked.user_data).not.toContain('real.person@example.com');
    expect(masked.user_data).toContain('${TEST_EMAIL}');
  });

  it('sweeps embedded bearer tokens and JWTs out of free-text string values', () => {
    const jwt = 'eyJhbGciOiJIUzI1Ni1.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dQw4w9WgXcQabc';
    const masked = maskJsonValue({ frame: `42["auth",{"Authorization":"Bearer ${jwt}"}]` }, defaultConfig) as {
      frame: string;
    };

    expect(masked.frame).not.toContain(jwt);
    expect(masked.frame).toContain('${API_TOKEN}');
  });
});
