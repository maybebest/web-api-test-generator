import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCli } from './healer/heal-test.mjs';

export * from './healer/heal-test.mjs';

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  await runCli();
}
