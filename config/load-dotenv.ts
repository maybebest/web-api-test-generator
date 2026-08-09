import path from 'node:path';

import dotenv from 'dotenv';

import { shouldLoadRootDotEnv } from './load-dotenv-policy.mjs';

/**
 * Loads .env.
 *
 * It lives in its own file on purpose: imports are executed before any code
 * in the importing file, so calling dotenv there would happen too late and
 * the config modules would read empty variables.
 */
if (shouldLoadRootDotEnv(process.env)) {
  dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
}
