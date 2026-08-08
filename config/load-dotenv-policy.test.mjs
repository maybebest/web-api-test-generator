import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldLoadRootDotEnv } from './load-dotenv-policy.mjs';

test('sanitized healer subprocesses never reload root .env', () => {
  assert.equal(shouldLoadRootDotEnv({}), true);
  assert.equal(shouldLoadRootDotEnv({ AI_GATE_SANITIZED_ENV: 'false' }), true);
  assert.equal(shouldLoadRootDotEnv({ AI_GATE_SANITIZED_ENV: 'true' }), false);
});
