import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/config/defaultConfig.js';
import { planGeneratedTests } from '../../src/generator/testPlanner.js';
import { filterHarEntries } from '../../src/har/filters.js';
import { normalizeHarEntries } from '../../src/har/normalizer.js';
import { parseHarInputs } from '../../src/har/parser.js';

describe('HAR parsing and normalization pipeline', () => {
  it('parses HAR inputs, filters noise, and normalizes API entries deterministically', async () => {
    const entries = await parseHarInputs(['examples/session.har']);
    const filtered = filterHarEntries(entries, defaultConfig, {
      include: [],
      exclude: [],
      ignoredDomains: [],
      firstPartyDomains: [],
      methods: [],
      statuses: []
    });
    const normalized = normalizeHarEntries(filtered, defaultConfig, 'https://api.example.com');

    expect(entries).toHaveLength(4);
    expect(filtered).toHaveLength(2);
    expect(normalized.map((entry) => `${entry.method} ${entry.pathPattern}`)).toEqual([
      'GET /v1/users',
      'POST /v1/users'
    ]);
    expect(normalized[0].requestHeaders.authorization).toBe('${API_AUTHORIZATION}');
    expect(normalized[1].requestBody).toEqual({
      email: '${TEST_EMAIL}',
      name: 'Grace Hopper',
      password: '${TEST_PASSWORD}'
    });
  });

  it('accepts a directory of HAR files', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'har-api-tests-'));
    await fs.copyFile('examples/session.har', path.join(tmpDir, 'session.har'));

    const entries = await parseHarInputs([tmpDir]);

    expect(entries).toHaveLength(4);
  });

  it('parses markdown files that contain HAR JSON after a title', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'har-api-tests-md-'));
    const harText = await fs.readFile('examples/session.har', 'utf8');
    const markdownPath = path.join(tmpDir, 'session.md');
    await fs.writeFile(markdownPath, `Session capture\n${harText}`, 'utf8');

    const entries = await parseHarInputs([markdownPath]);

    expect(entries).toHaveLength(4);
  });

  it('parses markdown captures with prose braces around a fenced json block', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'har-api-tests-md-fenced-'));
    const harText = await fs.readFile('examples/session.har', 'utf8');
    const markdownPath = path.join(tmpDir, 'capture.md');
    const markdown = [
      '# Session capture',
      '',
      'Recorded with {tool} against the {staging} environment.',
      '',
      '```',
      'const config = { retries: 2 };',
      '```',
      '',
      '```json',
      harText.trim(),
      '```',
      '',
      'Trailing prose with a stray } brace and another { one.',
      ''
    ].join('\n');
    await fs.writeFile(markdownPath, markdown, 'utf8');

    const entries = await parseHarInputs([markdownPath]);

    expect(entries).toHaveLength(4);
  });

  it('supports postData.params and decodes base64 JSON responses before normalization', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'har-api-tests-encoded-'));
    const harPath = path.join(tmpDir, 'encoded.har');
    const responseBody = { id: 7, displayName: 'Grace Hopper' };
    await fs.writeFile(
      harPath,
      JSON.stringify({
        log: {
          entries: [
            {
              startedDateTime: '2026-08-01T10:15:30.000Z',
              time: 12.5,
              request: {
                method: 'POST',
                url: 'https://api.example.test/v1/users',
                headers: [{ name: 'Content-Type', value: 'application/x-www-form-urlencoded' }],
                postData: {
                  mimeType: 'application/x-www-form-urlencoded',
                  params: [
                    { name: 'name', value: 'Grace Hopper' },
                    { name: 'password', value: 'captured-password' }
                  ]
                }
              },
              response: {
                status: 201,
                headers: [{ name: 'Content-Type', value: 'application/json' }],
                content: {
                  mimeType: 'application/json',
                  encoding: 'base64',
                  text: Buffer.from(JSON.stringify(responseBody), 'utf8').toString('base64')
                }
              }
            }
          ]
        }
      }),
      'utf8'
    );

    const parsed = await parseHarInputs([harPath]);
    const [normalized] = normalizeHarEntries(parsed, defaultConfig);

    expect(normalized.startedDateTime).toBe('2026-08-01T10:15:30.000Z');
    expect(normalized.requestBody).toBe('name=Grace%20Hopper&password=${TEST_PASSWORD}');
    expect(normalized.responseBody).toEqual(responseBody);
  });

  it('fails closed for malformed or conflicting urlencoded HAR bodies', () => {
    const entry = {
      sourceFile: 'malformed-form.har',
      entryIndex: 0,
      timeMs: 10,
      request: {
        method: 'POST',
        url: 'https://api.example.test/v1/users',
        headers: [{ name: 'Content-Type', value: 'application/x-www-form-urlencoded' }],
        postData: {
          mimeType: 'application/x-www-form-urlencoded',
          text: 'name=Grace%ZZHopper',
          params: [{ name: 'name', value: 'Grace Hopper' }]
        }
      },
      response: { status: 200, headers: [] }
    };

    expect(() => normalizeHarEntries([entry], defaultConfig)).toThrow(
      /Malformed application\/x-www-form-urlencoded HAR body: invalid percent escape/
    );

    expect(() =>
      normalizeHarEntries(
        [
          {
            ...entry,
            request: {
              ...entry.request,
              postData: {
                ...entry.request.postData,
                text: 'name=Grace',
                params: [{ name: 'name', value: 'Ada' }]
              }
            }
          }
        ],
        defaultConfig
      )
    ).toThrow(/postData\.text and postData\.params describe different fields/);
  });

  it('rejects malformed nested HAR values with a precise JSON path', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'har-api-tests-invalid-'));
    const cases: Array<{ name: string; entry: unknown; expected: RegExp }> = [
      {
        name: 'relative-url',
        entry: {
          request: { method: 'GET', url: '/relative', headers: [] },
          response: { status: 200, headers: [] }
        },
        expected: /\$\.log\.entries\[0\]\.request\.url/
      },
      {
        name: 'invalid-status',
        entry: {
          request: { method: 'GET', url: 'https://api.example.test/v1/users', headers: [] },
          response: { status: 700, headers: [] }
        },
        expected: /\$\.log\.entries\[0\]\.response\.status/
      },
      {
        name: 'invalid-base64',
        entry: {
          request: { method: 'GET', url: 'https://api.example.test/v1/users', headers: [] },
          response: {
            status: 200,
            headers: [],
            content: { mimeType: 'application/json', encoding: 'base64', text: 'not base64!' }
          }
        },
        expected: /\$\.log\.entries\[0\]\.response\.content\.text/
      }
    ];

    for (const testCase of cases) {
      const filePath = path.join(tmpDir, `${testCase.name}.har`);
      await fs.writeFile(filePath, JSON.stringify({ log: { entries: [testCase.entry] } }), 'utf8');
      await expect(parseHarInputs([filePath])).rejects.toThrow(testCase.expected);
    }
  });

  it('masks multipart secrets, preserves boundaries, and plans CSRF variants', () => {
    const boundary = '----WebKitFormBoundaryTest';
    const multipartBody = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="_csrf"',
      '',
      'real-csrf-token',
      `--${boundary}`,
      'Content-Disposition: form-data; name="PasswordForm[password]"',
      '',
      'real-password',
      `--${boundary}--`,
      ''
    ].join('\r\n');
    const [entry] = normalizeHarEntries(
      [
        {
          sourceFile: 'multipart.har',
          entryIndex: 0,
          timeMs: 25,
          request: {
            method: 'POST',
            url: 'https://api.example.test/user/password/1234567890',
            headers: [
              { name: 'Content-Type', value: `multipart/form-data; boundary=${boundary}` },
              { name: 'X-CSRF-Token', value: 'real-csrf-token' }
            ],
            postData: {
              mimeType: `multipart/form-data; boundary=${boundary}`,
              text: multipartBody
            }
          },
          response: {
            status: 200,
            headers: [{ name: 'Content-Type', value: 'application/json' }],
            content: {
              mimeType: 'application/json',
              text: '{"ok":true}'
            }
          }
        }
      ],
      defaultConfig
    );

    expect(entry.pathWithQuery).toBe('/user/password/${USER_ID}');
    expect(entry.requestHeaders['x-csrf-token']).toBe('${CSRF_TOKEN}');
    const maskedBody = String(entry.requestBody);
    expect(maskedBody).toContain(boundary);
    expect(maskedBody).toContain('${CSRF_TOKEN}');
    expect(maskedBody).toContain('${TEST_PASSWORD}');

    const plan = planGeneratedTests([entry], defaultConfig);
    const missingCsrfField = plan.endpointCases.find((testCase) => testCase.title.includes('rejects missing _csrf'));
    const invalidCsrfHeader = plan.endpointCases.find(
      (testCase) => testCase.category === 'security' && testCase.title.includes('rejects invalid x-csrf-token')
    );

    // Multipart missing-field negative drops the field from the body.
    expect(String(missingCsrfField?.requestBody)).not.toContain('name="_csrf"');
    // Security check corrupts the CSRF header (no per-field boundary/invalid-type explosion anymore).
    expect(invalidCsrfHeader?.requestHeaders['x-csrf-token']).toBe('invalid-csrf-token');
    expect(plan.endpointCases.some((testCase) => testCase.category === 'smoke')).toBe(true);
  });
});
