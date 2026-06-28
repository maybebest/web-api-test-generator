import path from 'node:path';
import type { HarApiTestConfig } from '../types/config.js';
import type { NormalizedHarEntry } from '../types/har.js';
import { writeJsonFile } from '../utils/fileSystem.js';

export async function writeRequestFixtures(
  entries: NormalizedHarEntry[],
  outDir: string,
  config: HarApiTestConfig
): Promise<string[]> {
  const written: string[] = [];
  const fixturesDir = path.join(outDir, config.output.fixturesDir);

  for (const entry of entries) {
    if (!entry.fixtureName || entry.requestBody === undefined) {
      continue;
    }

    const filePath = path.join(fixturesDir, entry.fixtureName);
    await writeJsonFile(filePath, entry.requestBody);
    written.push(filePath);
  }

  return written.sort();
}
