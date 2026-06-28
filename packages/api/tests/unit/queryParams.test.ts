import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/config/defaultConfig.js';
import { normalizeHarEntry } from '../../src/har/normalizer.js';
import type { HarApiTestConfig } from '../../src/types/config.js';
import type { ParsedHarEntry } from '../../src/types/har.js';

function entryWithDuplicateQuery(): ParsedHarEntry {
  return {
    sourceFile: 'dup.har',
    entryIndex: 0,
    timeMs: 12,
    request: {
      method: 'GET',
      url: 'https://api.acme.test/v1/items?id=1&id=2&sort=name',
      headers: [],
      queryString: [
        { name: 'id', value: '1' },
        { name: 'id', value: '2' },
        { name: 'sort', value: 'name' }
      ]
    },
    response: {
      status: 200,
      headers: [{ name: 'Content-Type', value: 'application/json' }],
      content: { mimeType: 'application/json', text: '{"items":[]}' }
    }
  };
}

describe('duplicate query parameters', () => {
  it('collapses repeated query params to the last value by default (key-sorted)', () => {
    const entry = normalizeHarEntry(entryWithDuplicateQuery(), defaultConfig);
    expect(entry.pathWithQuery).toBe('/v1/items?id=2&sort=name');
  });

  it('preserves repeated query params in original order when the opt-in flag is enabled', () => {
    const config: HarApiTestConfig = {
      ...defaultConfig,
      generation: { ...defaultConfig.generation, preserveDuplicateQueryParams: true }
    };
    const entry = normalizeHarEntry(entryWithDuplicateQuery(), config);
    expect(entry.pathWithQuery).toBe('/v1/items?id=1&id=2&sort=name');
  });
});
