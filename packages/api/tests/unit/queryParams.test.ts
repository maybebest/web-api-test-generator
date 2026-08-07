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
  it('preserves repeated query params in original order by default', () => {
    const entry = normalizeHarEntry(entryWithDuplicateQuery(), defaultConfig);
    expect(entry.pathWithQuery).toBe('/v1/items?id=1&id=2&sort=name');
  });

  it('supports an explicit legacy opt-out that collapses repeated params', () => {
    const config: HarApiTestConfig = {
      ...defaultConfig,
      generation: { ...defaultConfig.generation, preserveDuplicateQueryParams: false }
    };
    const entry = normalizeHarEntry(entryWithDuplicateQuery(), config);
    expect(entry.pathWithQuery).toBe('/v1/items?id=2&sort=name');
  });
});

describe('query parameter name casing', () => {
  function entryWithCamelCaseQuery(): ParsedHarEntry {
    return {
      sourceFile: 'case.har',
      entryIndex: 0,
      timeMs: 5,
      request: {
        method: 'GET',
        url: 'https://api.acme.test/v1/items?perPage=25&sortBy=name',
        headers: [],
        queryString: [
          { name: 'perPage', value: '25' },
          { name: 'sortBy', value: 'name' }
        ]
      },
      response: {
        status: 200,
        headers: [{ name: 'Content-Type', value: 'application/json' }],
        content: { mimeType: 'application/json', text: '{"items":[]}' }
      }
    };
  }

  it('preserves camelCase query param names (query params are case-sensitive)', () => {
    const entry = normalizeHarEntry(entryWithCamelCaseQuery(), defaultConfig);
    expect(entry.pathWithQuery).toBe('/v1/items?perPage=25&sortBy=name');
  });

  it('preserves camelCase query param names in the legacy collapsed path too', () => {
    const config: HarApiTestConfig = {
      ...defaultConfig,
      generation: { ...defaultConfig.generation, preserveDuplicateQueryParams: false }
    };
    const entry = normalizeHarEntry(entryWithCamelCaseQuery(), config);
    expect(entry.pathWithQuery).toBe('/v1/items?perPage=25&sortBy=name');
  });
});
