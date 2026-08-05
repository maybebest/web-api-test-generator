import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGateEnvironment, knownSecretEnvValues } from '../lib/gate-environment.mjs';

test('PsychicBook runtime email reaches external gates but not static subprocesses', () => {
  const source = {
    PATH: '/usr/bin',
    E2E_HTTP_BASIC_USERNAME: 'psychicbook',
    PSYCHICBOOK_E2E_EMAIL: 'returning-user@example.test'
  };

  const external = buildGateEnvironment(source, { profile: 'external-runtime' });
  const staticEnvironment = buildGateEnvironment(source, { profile: 'static' });

  assert.equal(external.E2E_HTTP_BASIC_USERNAME, 'psychicbook');
  assert.equal(external.PSYCHICBOOK_E2E_EMAIL, 'returning-user@example.test');
  assert.equal(staticEnvironment.E2E_HTTP_BASIC_USERNAME, undefined);
  assert.equal(staticEnvironment.PSYCHICBOOK_E2E_EMAIL, '');
  assert.deepEqual(knownSecretEnvValues(source), ['returning-user@example.test']);
});
