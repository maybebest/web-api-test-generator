import assert from 'node:assert/strict';
import test from 'node:test';

import { runLocalPlaywright } from '../run-local-playwright.mjs';

test('local Playwright suite strips repo and login secrets and disables dotenv reload', () => {
  let call;
  const status = runLocalPlaywright({
    args: ['tests/smoke/example.spec.ts'],
    env: {
      PATH: '/bin',
      OPENAI_API_KEY: 'provider-secret',
      E2E_USER_PASSWORD: 'login-secret',
      API_AUTHORIZATION: 'Bearer api-secret'
    },
    spawnSyncImpl(command, args, options) {
      call = { command, args, options };
      return { status: 0 };
    }
  });

  assert.equal(status, 0);
  assert.equal(call.command, 'playwright');
  assert.deepEqual(call.args, ['test', '--project=local-chromium', 'tests/smoke/example.spec.ts']);
  assert.equal(call.options.shell, false);
  assert.equal(call.options.env.AI_GATE_SANITIZED_ENV, 'true');
  assert.equal(call.options.env.OPENAI_API_KEY, '');
  assert.equal(call.options.env.E2E_USER_PASSWORD, '');
  assert.equal(call.options.env.API_AUTHORIZATION, '');
});
