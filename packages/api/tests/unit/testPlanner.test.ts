import { describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../../src/config/defaultConfig.js';
import { planGeneratedTests, warnPossibleMissingCorrelation } from '../../src/generator/testPlanner.js';
import type { NormalizedHarEntry } from '../../src/types/har.js';

describe('v2 test planner (smoke + extended)', () => {
  it('generates exactly one smoke test per endpoint for every method, including mutating ones', () => {
    const plan = planGeneratedTests(
      [postUsers({ entryIndex: 0 }), postUsers({ entryIndex: 1 }), deleteUserItem({ entryIndex: 2 })],
      defaultConfig
    );
    const smoke = plan.endpointCases.filter((testCase) => testCase.category === 'smoke');

    expect(smoke.map((testCase) => testCase.title).sort()).toEqual([
      'smoke: DELETE /users/{param} returns 204',
      'smoke: POST /users returns 201'
    ]);
    // A generic create POST stays active; a DELETE replay is destructive -> fixme.
    const post = smoke.find((testCase) => testCase.method === 'POST');
    const del = smoke.find((testCase) => testCase.method === 'DELETE');
    expect(post?.execution).toBe('active');
    expect(post?.mutationRisk).toBe('guarded');
    expect(del?.execution).toBe('fixme');
    expect(del?.mutationRisk).toBe('unsafe');
  });

  it('downgrades destructive mutating smokes (logout/password) to fixme but keeps login and safe POSTs active', () => {
    const plan = planGeneratedTests(
      [loginEntry({ entryIndex: 0 }), logoutEntry({ entryIndex: 1 }), postUsers({ entryIndex: 2 })],
      defaultConfig
    );
    const smoke = (needle: string) =>
      plan.endpointCases.find((testCase) => testCase.category === 'smoke' && testCase.title.includes(needle));

    expect(smoke('POST /auth/main/login')?.execution).toBe('active');
    expect(smoke('POST /auth/main/logout')?.execution).toBe('fixme');
    expect(smoke('POST /auth/main/logout')?.mutationRisk).toBe('unsafe');
    expect(smoke('POST /users')?.execution).toBe('active');
  });

  it('expands a login request into smoke + missing-field negative + security variants (no boundary explosion)', () => {
    const plan = planGeneratedTests([loginEntry()], defaultConfig);
    const titles = plan.endpointCases.map((testCase) => testCase.title);

    expect(titles).toContain('smoke: POST /auth/main/login returns 200');
    expect(titles).toContain('negative: POST /auth/main/login rejects missing email');
    expect(titles).toContain('negative: POST /auth/main/login rejects missing password');
    expect(titles).toContain('security: POST /auth/main/login rejects missing authorization');
    expect(titles).toContain('security: POST /auth/main/login rejects invalid authorization');
    // Boundary and invalid-type per-field tests are no longer generated.
    expect(titles.some((title) => title.startsWith('boundary:'))).toBe(false);
    expect(titles.some((title) => title.includes('rejects invalid email'))).toBe(false);
    expect(plan.endpointCases.find((testCase) => testCase.title.includes('missing password'))?.expectedStatus).toEqual({
      kind: 'family',
      family: '4xx'
    });
  });

  it('infers negatives/security once per endpoint when re-captures differ only by multipart boundary', () => {
    const plan = planGeneratedTests(
      [multipartAvatarEntry('----boundaryA', { entryIndex: 0 }), multipartAvatarEntry('----boundaryB', { entryIndex: 1 })],
      defaultConfig
    );
    const titles = plan.endpointCases.map((testCase) => testCase.title);

    expect(titles.filter((title) => title === 'negative: POST /me/avatar rejects missing avatar')).toHaveLength(1);
    expect(titles.filter((title) => title === 'negative: POST /me/avatar rejects missing caption')).toHaveLength(1);
    expect(titles.filter((title) => title === 'security: POST /me/avatar rejects missing authorization')).toHaveLength(1);
    expect(titles.filter((title) => title === 'security: POST /me/avatar rejects invalid authorization')).toHaveLength(1);
    expect(titles.some((title) => title.includes(' [2]'))).toBe(false);
  });

  it('keeps genuinely distinct logical negatives while deduping endpoint re-captures', () => {
    const plan = planGeneratedTests(
      [
        loginEntry({ entryIndex: 0 }),
        loginEntry({ entryIndex: 1, requestBody: { email: 'other@example.test', password: 'other-secret' } })
      ],
      defaultConfig
    );
    const negativeTitles = plan.endpointCases
      .filter((testCase) => testCase.category === 'negative')
      .map((testCase) => testCase.title)
      .sort();

    expect(negativeTitles).toEqual([
      'negative: POST /auth/main/login rejects missing email',
      'negative: POST /auth/main/login rejects missing password'
    ]);
  });

  it('does not infer negatives for endpoints that did not return a 2xx status', () => {
    const plan = planGeneratedTests([loginEntry({ responseStatus: 500 })], defaultConfig);

    expect(plan.endpointCases.filter((testCase) => testCase.category === 'negative')).toHaveLength(0);
    expect(plan.endpointCases.filter((testCase) => testCase.category === 'security')).toHaveLength(0);
    // The smoke test still replays the observed (500) response.
    expect(plan.endpointCases.find((testCase) => testCase.category === 'smoke')?.expectedStatus).toEqual({
      kind: 'exact',
      status: 500
    });
  });

  it('synthesizes a self-cleaning CRUD flow ordered create -> read -> update -> delete', () => {
    const plan = planGeneratedTests(
      [
        postUsers({ entryIndex: 0 }),
        getUserItem({ entryIndex: 1 }),
        putUserItem({ entryIndex: 2 }),
        deleteUserItem({ entryIndex: 3 })
      ],
      defaultConfig
    );
    const crud = plan.scenarioCases.find((scenario) => scenario.category === 'crud');

    expect(crud?.title).toBe('crud: api.example.test users create-read-update-delete flow');
    expect(crud?.steps.map((step) => step.method)).toEqual(['POST', 'GET', 'PUT', 'DELETE']);
    expect(crud?.steps[crud.steps.length - 1].method).toBe('DELETE');
    expect(crud?.mutationRisk).toBe('guarded');
    expect(crud?.execution).toBe('active');
  });

  it('marks a CRUD flow without cleanup as unsafe/fixme', () => {
    const plan = planGeneratedTests([getUserItem({ entryIndex: 0 }), putUserItem({ entryIndex: 1 })], defaultConfig);
    const crud = plan.scenarioCases.find((scenario) => scenario.category === 'crud');

    expect(crud?.title).toBe('crud: api.example.test users read-update flow');
    expect(crud?.mutationRisk).toBe('unsafe');
    expect(crud?.execution).toBe('fixme');
  });

  it('classifies a POST to an item path as update, not create', () => {
    const plan = planGeneratedTests([getUserItem({ entryIndex: 0 }), postUserItem({ entryIndex: 1 })], defaultConfig);
    const crud = plan.scenarioCases.find((scenario) => scenario.category === 'crud');

    expect(crud?.title).toBe('crud: api.example.test users read-update flow');
    expect(crud?.steps.map((step) => step.method)).toEqual(['GET', 'POST']);
    expect(plan.scenarioCases.some((scenario) => scenario.title.includes('create-read'))).toBe(false);
    // Update without create+delete cleanup stays unsafe -> fixme.
    expect(crud?.mutationRisk).toBe('unsafe');
    expect(crud?.execution).toBe('fixme');
  });

  it('still classifies a POST to a collection path as create', () => {
    const plan = planGeneratedTests([postUsers({ entryIndex: 0 }), getUserItem({ entryIndex: 1 })], defaultConfig);
    const crud = plan.scenarioCases.find((scenario) => scenario.category === 'crud');

    expect(crud?.title).toBe('crud: api.example.test users create-read flow');
    expect(crud?.steps.map((step) => step.method)).toEqual(['POST', 'GET']);
  });

  it('keeps a collection POST with query placeholders (cache buster) classified as create', () => {
    const plan = planGeneratedTests(
      [
        postUsers({ entryIndex: 0, pathWithQuery: '/users?_=${CACHE_BUSTER}' }),
        getUserItem({ entryIndex: 1 }),
        deleteUserItem({ entryIndex: 2 })
      ],
      defaultConfig
    );
    const crud = plan.scenarioCases.find((scenario) => scenario.category === 'crud');

    expect(crud?.title).toBe('crud: api.example.test users create-read-delete flow');
    expect(crud?.mutationRisk).toBe('guarded');
    expect(crud?.execution).toBe('active');
  });

  it('classifies a POST to a nested collection (mid-path param) as create', () => {
    const plan = planGeneratedTests(
      [
        postUserRoles({ entryIndex: 0 }),
        getUserRoles({ entryIndex: 1 })
      ],
      defaultConfig
    );
    const crud = plan.scenarioCases.find((scenario) => scenario.category === 'crud');

    expect(crud?.title).toBe('crud: api.example.test users/{param}/roles create-read flow');
    expect(crud?.steps.map((step) => step.method)).toEqual(['POST', 'GET']);
  });

  it('groups a trailing-slash collection with its item path into one CRUD resource', () => {
    const plan = planGeneratedTests(
      [
        postUsers({
          entryIndex: 0,
          id: 'post-api-example-test-notes',
          path: '/notes/',
          pathPattern: '/notes/',
          pathWithQuery: '/notes/',
          testName: 'POST /notes/ returns 201'
        }),
        getUserItem({
          entryIndex: 1,
          id: 'get-api-example-test-notes-param',
          path: '/notes/abc123',
          pathPattern: '/notes/{param}',
          pathWithQuery: '/notes/${NOTE_ID}',
          dynamicSegments: ['NOTE_ID'],
          testName: 'GET /notes/{param} returns 200'
        })
      ],
      defaultConfig
    );
    const crud = plan.scenarioCases.find((scenario) => scenario.category === 'crud');

    expect(crud?.title).toBe('crud: api.example.test notes create-read flow');
    expect(crud?.steps.map((step) => step.method)).toEqual(['POST', 'GET']);
  });

  it('applies calibration overrides to inferred negative/security cases by exact title', () => {
    const plan = planGeneratedTests([loginEntry()], defaultConfig, {
      calibrationOverrides: [
        { title: 'negative: POST /auth/main/login rejects missing email', observedStatus: 422 },
        { title: 'negative: POST /auth/main/login rejects missing password', observedStatus: 200 },
        { title: 'security: POST /auth/main/login rejects invalid authorization', observedStatus: 503 },
        { title: 'smoke: POST /auth/main/login returns 200', observedStatus: 422 },
        { title: 'negative: POST /auth/main/login rejects missing nonexistent', observedStatus: 422 }
      ]
    });
    const byTitle = (title: string) => plan.endpointCases.find((testCase) => testCase.title === title);

    const confirmed = byTitle('negative: POST /auth/main/login rejects missing email');
    expect(confirmed?.expectedStatus).toEqual({ kind: 'exact', status: 422 });
    expect(confirmed?.execution).toBe('active');
    expect(confirmed?.calibration).toBe('confirmed');

    const lenient = byTitle('negative: POST /auth/main/login rejects missing password');
    expect(lenient?.execution).toBe('fixme');
    expect(lenient?.calibration).toBe('lenient');
    expect(lenient?.expectedStatus).toEqual({ kind: 'family', family: '4xx' });

    // 5xx observations are inconclusive -> ignored.
    const inconclusive = byTitle('security: POST /auth/main/login rejects invalid authorization');
    expect(inconclusive?.execution).toBe('fixme');
    expect(inconclusive?.calibration).toBeUndefined();

    // Overrides never touch observed smoke cases.
    const smoke = byTitle('smoke: POST /auth/main/login returns 200');
    expect(smoke?.calibration).toBeUndefined();
    expect(smoke?.expectedStatus).toEqual({ kind: 'exact', status: 200 });

    // Cases without a matching override title stay untouched.
    const untouched = byTitle('security: POST /auth/main/login rejects missing authorization');
    expect(untouched?.execution).toBe('fixme');
    expect(untouched?.calibration).toBeUndefined();
  });

  it('generates invalid path parameter negatives for dynamic endpoints', () => {
    const plan = planGeneratedTests([userEntry()], defaultConfig);
    const invalidPathCase = plan.endpointCases.find((testCase) => testCase.title.includes('invalid path parameter'));

    expect(invalidPathCase?.pathWithQuery).toBe('/users/user/invalid-id');
    // Inferred validation is a triage candidate by default.
    expect(invalidPathCase?.execution).toBe('fixme');
  });

  it('does not treat query-string placeholders as path parameters', () => {
    const plan = planGeneratedTests(
      [accountEntry({ pathWithQuery: '/me/account?_=${CACHE_BUSTER}' })],
      defaultConfig
    );

    expect(plan.endpointCases.some((testCase) => testCase.title.includes('invalid path parameter'))).toBe(false);
  });

  it('keeps the original query string when corrupting a real path parameter', () => {
    const plan = planGeneratedTests(
      [userEntry({ pathWithQuery: '/users/user/${USER_ID}?_=${CACHE_BUSTER}' })],
      defaultConfig
    );
    const invalidPathCase = plan.endpointCases.find((testCase) => testCase.title.includes('invalid path parameter'));

    expect(invalidPathCase?.pathWithQuery).toBe('/users/user/invalid-id?_=${CACHE_BUSTER}');
  });

  it('prefers a request-body-bearing capture as the endpoint representative so negatives survive', () => {
    const bodiless = postUsers({
      entryIndex: 0,
      requestBody: undefined,
      fixtureName: undefined,
      responseBody: { ok: true },
      schemaName: 'post-api-example-test-users.response.schema.json'
    });
    const withBody = postUsers({
      entryIndex: 1,
      requestBody: { email: '${TEST_EMAIL}', name: 'Grace' },
      responseBody: { ok: true },
      schemaName: 'post-api-example-test-users.response.schema.json'
    });

    const plan = planGeneratedTests([bodiless, withBody], defaultConfig);
    const smoke = plan.endpointCases.find((testCase) => testCase.category === 'smoke');
    const negativeTitles = plan.endpointCases
      .filter((testCase) => testCase.category === 'negative')
      .map((testCase) => testCase.title)
      .sort();

    expect(smoke?.sourceEntryId).toBe(withBody.id);
    expect(smoke?.requestBody).toEqual(withBody.requestBody);
    expect(negativeTitles).toEqual([
      'negative: POST /users rejects missing email',
      'negative: POST /users rejects missing name'
    ]);
  });

  it('never lets confirmed calibration overrides resurrect policy-skipped cases', () => {
    const override = { title: 'negative: POST /auth/main/login rejects missing email', observedStatus: 422 };

    const replayOnly = planGeneratedTests([loginEntry()], defaultConfig, {
      inferredRunMode: 'replay-only',
      calibrationOverrides: [override]
    });
    const replayCase = replayOnly.endpointCases.find((testCase) => testCase.title === override.title);
    expect(replayCase?.execution).toBe('skip');
    expect(replayCase?.expectedStatus).toEqual({ kind: 'exact', status: 422 });
    expect(replayCase?.calibration).toBe('confirmed');

    const allSkipped = planGeneratedTests([loginEntry()], defaultConfig, {
      mutationPolicy: 'all-skipped',
      calibrationOverrides: [override]
    });
    expect(allSkipped.endpointCases.find((testCase) => testCase.title === override.title)?.execution).toBe('skip');
  });

  it('scopes calibration overrides by hostname when present and falls back to bare titles', () => {
    const title = 'negative: POST /auth/main/login rejects missing email';
    const entries = [
      loginEntry({ entryIndex: 0 }),
      loginEntry({
        entryIndex: 1,
        id: 'post-api-other-test-auth-main-login',
        hostname: 'api.other.test',
        defaultBaseUrl: 'https://api.other.test',
        originalUrl: 'https://api.other.test/auth/main/login'
      })
    ];

    const scoped = planGeneratedTests(entries, defaultConfig, {
      calibrationOverrides: [{ title, hostname: 'api.example.test', observedStatus: 422 }]
    });
    const scopedCases = scoped.endpointCases.filter((testCase) => testCase.title === title);
    expect(scopedCases).toHaveLength(2);
    expect(scopedCases.find((testCase) => testCase.hostname === 'api.example.test')?.calibration).toBe('confirmed');
    expect(scopedCases.find((testCase) => testCase.hostname === 'api.other.test')?.calibration).toBeUndefined();

    // Overrides without a hostname (older files) keep matching every host by title.
    const bare = planGeneratedTests(entries, defaultConfig, {
      calibrationOverrides: [{ title, observedStatus: 422 }]
    });
    expect(
      bare.endpointCases.filter((testCase) => testCase.title === title).every((testCase) => testCase.calibration === 'confirmed')
    ).toBe(true);
  });

  it('runs inferred negative/security tests when inferredRunMode is all-active', () => {
    const plan = planGeneratedTests([userEntry()], defaultConfig, { inferredRunMode: 'all-active' });
    const invalidPathCase = plan.endpointCases.find((testCase) => testCase.title.includes('invalid path parameter'));

    expect(invalidPathCase?.execution).toBe('active');
  });

  it('skips inferred mutating tests when mutation policy requires review', () => {
    const plan = planGeneratedTests([loginEntry()], defaultConfig, { mutationPolicy: 'all-skipped' });

    expect(plan.endpointCases.find((testCase) => testCase.category === 'smoke')?.execution).toBe('active');
    expect(
      plan.endpointCases.filter((testCase) => testCase.origin === 'inferred').every((testCase) => testCase.execution === 'skip')
    ).toBe(true);
  });

  it('uses configured expected statuses when negativeStatusPolicy is config', () => {
    const plan = planGeneratedTests([loginEntry()], {
      ...defaultConfig,
      generation: {
        ...defaultConfig.generation,
        negativeStatusPolicy: 'config',
        expectedStatuses: {
          ...defaultConfig.generation.expectedStatuses,
          security: {
            ...defaultConfig.generation.expectedStatuses.security,
            'missing-auth': { kind: 'exact', status: 499 }
          }
        }
      }
    });

    expect(plan.endpointCases.find((testCase) => testCase.title.includes('rejects missing authorization'))?.expectedStatus).toEqual(
      { kind: 'exact', status: 499 }
    );
  });

  it('infers login/logout and profile flow scenarios from chronological entries', () => {
    const entries = [
      loginEntry({ entryIndex: 0 }),
      accountEntry({ entryIndex: 1 }),
      logoutEntry({ entryIndex: 2 }),
      userEntry({ entryIndex: 3 })
    ];

    const plan = planGeneratedTests(entries, defaultConfig);

    expect(plan.scenarioCases.map((scenario) => scenario.title)).toEqual(
      expect.arrayContaining([
        'scenario: api.example.test login account logout flow',
        'scenario: api.example.test profile read flow'
      ])
    );

    const loginFlow = plan.scenarioCases.find((scenario) => scenario.title.includes('login account logout'));
    const profileFlow = plan.scenarioCases.find((scenario) => scenario.title.includes('profile read'));
    // The login/logout flow is isolated (own session) and therefore safe to run active.
    expect(loginFlow?.isolated).toBe(true);
    expect(loginFlow?.execution).toBe('active');
    // Read-only profile flow shares the global session.
    expect(profileFlow?.isolated).toBe(false);
  });
});

// A4 regression guard: warnPossibleMissingCorrelation must warn when a placeholder is reused in the
// PATH of >=2 steps (a static env value the generator does not chain), and stay silent otherwise.
// A prior version had this inverted (warned on isolated single-use, silent on real reuse).
describe('A4 missing-correlation warning', () => {
  function captureWarn(entries: NormalizedHarEntry[]): string[] {
    const messages: string[] = [];
    const spy = vi.spyOn(console, 'warn').mockImplementation((message?: unknown) => {
      messages.push(String(message));
    });
    try {
      warnPossibleMissingCorrelation('users read/update flow', entries);
    } finally {
      spy.mockRestore();
    }
    return messages;
  }

  it('warns when a placeholder is reused across the path of two steps', () => {
    // GET then PUT on /users/${USER_ID}: the same USER_ID appears in both step paths.
    const messages = captureWarn([getUserItem(), putUserItem()]);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('USER_ID');
    expect(messages[0]).toMatch(/correlated/);
  });

  it('stays silent for an isolated login flow with no reused placeholder', () => {
    // login + a create POST: neither path carries a placeholder, so nothing is "reused".
    expect(captureWarn([loginEntry(), postUsers()])).toEqual([]);
  });

  it('stays silent when a placeholder appears in only one step', () => {
    // Only the GET carries ${USER_ID}; the POST /users path has no placeholder -> count 1, not reuse.
    expect(captureWarn([getUserItem(), postUsers()])).toEqual([]);
  });

  it('stays silent for a single-entry scenario', () => {
    expect(captureWarn([getUserItem()])).toEqual([]);
  });

  it('ignores placeholders that appear only in the query string, not the path', () => {
    // The same ${USER_ID} is reused, but only in the QUERY of both steps — the warning is about PATH
    // correlation, so it must stay silent.
    const first = getUserItem({ id: 'q-a', pathPattern: '/users', pathWithQuery: '/users?ref=${USER_ID}' });
    const second = putUserItem({ id: 'q-b', pathPattern: '/orders', pathWithQuery: '/orders?ref=${USER_ID}' });
    expect(captureWarn([first, second])).toEqual([]);
  });
});

function loginEntry(overrides: Partial<NormalizedHarEntry> = {}): NormalizedHarEntry {
  return {
    id: 'post-api-example-test-auth-main-login',
    sourceFile: 'login.har',
    entryIndex: 0,
    method: 'POST',
    originalUrl: 'https://api.example.test/auth/main/login',
    defaultBaseUrl: 'https://api.example.test',
    hostname: 'api.example.test',
    path: '/auth/main/login',
    pathPattern: '/auth/main/login',
    pathWithQuery: '/auth/main/login',
    query: {},
    requestHeaders: {
      authorization: '${API_AUTHORIZATION}',
      'content-type': 'application/json'
    },
    requestBody: {
      email: '${TEST_EMAIL}',
      password: '${TEST_PASSWORD}'
    },
    requestMimeType: 'application/json',
    responseStatus: 200,
    responseHeaders: {
      'content-type': 'application/json'
    },
    responseContentType: 'application/json',
    responseBody: {
      ok: true
    },
    responseTimeMs: 100,
    groupName: 'api-example-test-auth',
    testName: 'POST /auth/main/login returns 200',
    fixtureName: 'post-api-example-test-auth-main-login.request.json',
    schemaName: 'post-api-example-test-auth-main-login.response.schema.json',
    dynamicSegments: [],
    ...overrides
  };
}

function logoutEntry(overrides: Partial<NormalizedHarEntry> = {}): NormalizedHarEntry {
  return {
    ...loginEntry(),
    id: 'post-api-example-test-auth-main-logout',
    entryIndex: 2,
    path: '/auth/main/logout',
    pathPattern: '/auth/main/logout',
    pathWithQuery: '/auth/main/logout',
    requestBody: undefined,
    fixtureName: undefined,
    testName: 'POST /auth/main/logout returns 200',
    ...overrides
  };
}

function accountEntry(overrides: Partial<NormalizedHarEntry> = {}): NormalizedHarEntry {
  return {
    ...loginEntry(),
    id: 'get-api-example-test-me-account',
    entryIndex: 1,
    method: 'GET',
    path: '/me/account',
    pathPattern: '/me/account',
    pathWithQuery: '/me/account',
    requestBody: undefined,
    fixtureName: undefined,
    testName: 'GET /me/account returns 200',
    ...overrides
  };
}

function userEntry(overrides: Partial<NormalizedHarEntry> = {}): NormalizedHarEntry {
  return {
    ...accountEntry(),
    id: 'get-api-example-test-users-user-param',
    entryIndex: 3,
    method: 'GET',
    path: '/users/user/abc123',
    pathPattern: '/users/user/{param}',
    pathWithQuery: '/users/user/${USER_ID}',
    testName: 'GET /users/user/{param} returns 200',
    dynamicSegments: ['USER_ID'],
    ...overrides
  };
}

function resourceEntry(overrides: Partial<NormalizedHarEntry>): NormalizedHarEntry {
  return {
    ...loginEntry(),
    requestHeaders: { 'content-type': 'application/json' },
    responseBody: undefined,
    schemaName: undefined,
    fixtureName: undefined,
    requestBody: undefined,
    dynamicSegments: [],
    ...overrides
  };
}

function postUsers(overrides: Partial<NormalizedHarEntry> = {}): NormalizedHarEntry {
  return resourceEntry({
    id: 'post-api-example-test-users',
    method: 'POST',
    path: '/users',
    pathPattern: '/users',
    pathWithQuery: '/users',
    requestBody: { name: 'Grace' },
    fixtureName: 'post-api-example-test-users.request.json',
    responseStatus: 201,
    testName: 'POST /users returns 201',
    ...overrides
  });
}

function getUserItem(overrides: Partial<NormalizedHarEntry> = {}): NormalizedHarEntry {
  return resourceEntry({
    id: 'get-api-example-test-users-param',
    method: 'GET',
    path: '/users/abc123',
    pathPattern: '/users/{param}',
    pathWithQuery: '/users/${USER_ID}',
    responseStatus: 200,
    dynamicSegments: ['USER_ID'],
    testName: 'GET /users/{param} returns 200',
    ...overrides
  });
}

function putUserItem(overrides: Partial<NormalizedHarEntry> = {}): NormalizedHarEntry {
  return resourceEntry({
    id: 'put-api-example-test-users-param',
    method: 'PUT',
    path: '/users/abc123',
    pathPattern: '/users/{param}',
    pathWithQuery: '/users/${USER_ID}',
    requestBody: { name: 'Ada' },
    fixtureName: 'put-api-example-test-users-param.request.json',
    responseStatus: 200,
    dynamicSegments: ['USER_ID'],
    testName: 'PUT /users/{param} returns 200',
    ...overrides
  });
}

function postUserItem(overrides: Partial<NormalizedHarEntry> = {}): NormalizedHarEntry {
  return resourceEntry({
    id: 'post-api-example-test-users-param',
    method: 'POST',
    path: '/users/abc123',
    pathPattern: '/users/{param}',
    pathWithQuery: '/users/${USER_ID}',
    requestBody: { password: 'next-secret' },
    fixtureName: 'post-api-example-test-users-param.request.json',
    responseStatus: 200,
    dynamicSegments: ['USER_ID'],
    testName: 'POST /users/{param} returns 200',
    ...overrides
  });
}

function getUserRoles(overrides: Partial<NormalizedHarEntry> = {}): NormalizedHarEntry {
  return resourceEntry({
    id: 'get-api-example-test-users-param-roles',
    method: 'GET',
    path: '/users/abc123/roles',
    pathPattern: '/users/{param}/roles',
    pathWithQuery: '/users/${USER_ID}/roles',
    responseStatus: 200,
    dynamicSegments: ['USER_ID'],
    testName: 'GET /users/{param}/roles returns 200',
    ...overrides
  });
}

function postUserRoles(overrides: Partial<NormalizedHarEntry> = {}): NormalizedHarEntry {
  return resourceEntry({
    id: 'post-api-example-test-users-param-roles',
    method: 'POST',
    path: '/users/abc123/roles',
    pathPattern: '/users/{param}/roles',
    pathWithQuery: '/users/${USER_ID}/roles',
    requestBody: { role: 'admin' },
    fixtureName: 'post-api-example-test-users-param-roles.request.json',
    responseStatus: 201,
    dynamicSegments: ['USER_ID'],
    testName: 'POST /users/{param}/roles returns 201',
    ...overrides
  });
}

function multipartAvatarEntry(boundary: string, overrides: Partial<NormalizedHarEntry> = {}): NormalizedHarEntry {
  const body = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="avatar"; filename="avatar.png"',
    'Content-Type: image/png',
    '',
    'png-bytes',
    `--${boundary}`,
    'Content-Disposition: form-data; name="caption"',
    '',
    'profile picture',
    `--${boundary}--`,
    ''
  ].join('\r\n');

  return resourceEntry({
    id: 'post-api-example-test-me-avatar',
    method: 'POST',
    path: '/me/avatar',
    pathPattern: '/me/avatar',
    pathWithQuery: '/me/avatar',
    requestHeaders: {
      authorization: '${API_AUTHORIZATION}',
      'content-type': `multipart/form-data; boundary=${boundary}`
    },
    requestBody: body,
    requestMimeType: `multipart/form-data; boundary=${boundary}`,
    fixtureName: 'post-api-example-test-me-avatar.request.json',
    responseStatus: 200,
    testName: 'POST /me/avatar returns 200',
    ...overrides
  });
}

function deleteUserItem(overrides: Partial<NormalizedHarEntry> = {}): NormalizedHarEntry {
  return resourceEntry({
    id: 'delete-api-example-test-users-param',
    method: 'DELETE',
    path: '/users/abc123',
    pathPattern: '/users/{param}',
    pathWithQuery: '/users/${USER_ID}',
    responseStatus: 204,
    dynamicSegments: ['USER_ID'],
    testName: 'DELETE /users/{param} returns 204',
    ...overrides
  });
}
