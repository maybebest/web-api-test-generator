import { describe, expect, it } from 'vitest';
import { Ajv } from 'ajv/dist/ajv.js';
import { generateJsonSchema, generateJsonSchemaFromSamples } from '../../src/generator/schemaGenerator.js';
import type { JsonValue } from '../../src/types/json.js';

function containsRequired(schema: unknown): boolean {
  if (Array.isArray(schema)) {
    return schema.some(containsRequired);
  }

  if (typeof schema === 'object' && schema !== null) {
    return Object.entries(schema).some(([key, value]) => key === 'required' || containsRequired(value));
  }

  return false;
}

// Same Ajv configuration as the generated support file (apiTestUtils.ts).
const ajv = new Ajv({ allErrors: true, strict: false });

function expectSelfConsistent(samples: JsonValue[], title = 'self-consistency'): void {
  const schema = generateJsonSchemaFromSamples(samples, title);
  const validate = ajv.compile(schema);
  for (const [index, sample] of samples.entries()) {
    expect(
      validate(sample),
      `sample ${index} must validate against its own schema: ${ajv.errorsText(validate.errors)}\n${JSON.stringify(schema)}`
    ).toBe(true);
  }
}

describe('schema generator', () => {
  it('infers shape from a single value without emitting required or format', () => {
    const schema = generateJsonSchema(
      {
        total: 1,
        createdAt: '2024-05-01T12:00:00.000Z',
        users: [
          {
            id: '6f9f1f50-a8d0-4f41-b44e-4c8754672027',
            name: 'Ada'
          }
        ]
      },
      'users response'
    );

    expect(schema).toMatchObject({
      $schema: 'http://json-schema.org/draft-07/schema#',
      title: 'users response',
      type: 'object',
      additionalProperties: true,
      properties: {
        total: {
          type: 'integer'
        },
        createdAt: {
          type: 'string'
        },
        users: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
            properties: {
              id: {
                type: 'string'
              },
              name: {
                type: 'string'
              }
            }
          }
        }
      }
    });
    expect(containsRequired(schema)).toBe(false);
    // The generated suite's Ajv has no format validators, so format is never emitted.
    expect(JSON.stringify(schema)).not.toContain('"format"');
  });

  it('omits required everywhere for a single sample, including nested objects', () => {
    const schema = generateJsonSchemaFromSamples(
      [
        {
          id: 'user-1',
          profile: { name: 'Ada', deletedAt: null },
          roles: [{ slug: 'admin' }]
        }
      ],
      'user response'
    );

    expect(schema).toMatchObject({
      type: 'object',
      properties: {
        profile: {
          type: 'object',
          properties: {
            name: { type: 'string' }
          }
        },
        roles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              slug: { type: 'string' }
            }
          }
        }
      }
    });
    expect(containsRequired(schema)).toBe(false);
  });

  it('intersects required keys across observed response samples', () => {
    const schema = generateJsonSchemaFromSamples(
      [
        {
          id: 'user-1',
          name: 'Ada',
          email: 'ada@example.test'
        },
        {
          id: 'user-2',
          name: 'Grace'
        }
      ],
      'users response'
    );

    expect(schema).toMatchObject({
      type: 'object',
      required: ['id', 'name'],
      properties: {
        email: {
          type: 'string'
        }
      }
    });
  });

  it('relaxes a field observed only as null to an unconstrained schema', () => {
    const schema = generateJsonSchemaFromSamples(
      [
        { id: 'user-1', deletedAt: null },
        { id: 'user-2', deletedAt: null }
      ],
      'users response'
    );

    const properties = schema.properties as Record<string, unknown>;
    expect(properties.deletedAt).toEqual({});
    expect(schema).toMatchObject({ required: ['deletedAt', 'id'] });
  });

  it('keeps the null branch when null appears alongside another type', () => {
    const schema = generateJsonSchemaFromSamples(
      [
        { id: 'user-1', deletedAt: null },
        { id: 'user-2', deletedAt: '2024-05-01T12:00:00.000Z' }
      ],
      'users response'
    );

    const properties = schema.properties as Record<string, unknown>;
    expect(properties.deletedAt).toEqual({
      anyOf: [{ type: 'null' }, { type: 'string' }]
    });
  });

  it('keeps every nullable-object branch when a third sample merges into an anyOf', () => {
    const samples: JsonValue[] = [
      { profile: null },
      { profile: { name: 'Ada' } },
      { profile: { name: 'Grace', title: 'Dr' } }
    ];
    const schema = generateJsonSchemaFromSamples(samples, 'profiles response');

    const properties = schema.properties as Record<string, { anyOf?: unknown[] }>;
    expect(properties.profile.anyOf).toHaveLength(2);
    expectSelfConsistent(samples);
  });

  it('keeps scalar branches when a third mixed-type sample merges into an anyOf', () => {
    expectSelfConsistent([{ a: 1 }, { a: { x: 1 } }, { a: 's' }]);
  });

  it('merges array item types across samples instead of taking the first sample', () => {
    const samples: JsonValue[] = [{ tags: ['a'] }, { tags: [1] }];
    const schema = generateJsonSchemaFromSamples(samples, 'tags response');

    const properties = schema.properties as Record<string, { items?: unknown }>;
    expect(properties.tags.items).toEqual({ anyOf: [{ type: 'string' }, { type: 'integer' }] });
    expectSelfConsistent(samples);
  });

  it('intersects required of array item objects across samples', () => {
    const samples: JsonValue[] = [{ items: [{ id: 1, name: 'x' }] }, { items: [{ id: 2 }] }];
    const schema = generateJsonSchemaFromSamples(samples, 'items response');

    const properties = schema.properties as Record<string, { items?: { required?: string[] } }>;
    expect(properties.items.items?.required).toEqual(['id']);
    expectSelfConsistent(samples);
  });

  it('treats an empty observed array as a wildcard regardless of sample order', () => {
    const forward = generateJsonSchemaFromSamples([{ tags: [] }, { tags: ['a'] }], 'tags');
    const reverse = generateJsonSchemaFromSamples([{ tags: ['a'] }, { tags: [] }], 'tags');

    expect((forward.properties as Record<string, unknown>).tags).toEqual({ type: 'array', items: {} });
    expect(forward.properties).toEqual(reverse.properties);
  });

  it('strips nested required from properties observed in only a subset of samples', () => {
    const samples: JsonValue[] = [{ a: { x: 1, y: 2 } }, { b: 1 }];
    const schema = generateJsonSchemaFromSamples(samples, 'subset response');

    const properties = schema.properties as Record<string, unknown>;
    expect(containsRequired(properties.a)).toBe(false);
    expect(schema.required).toEqual([]);
    expectSelfConsistent(samples);
  });

  it('stays self-consistent for a single sample whose array items mix null and objects', () => {
    expectSelfConsistent([{ items: [{ p: null }, { p: { n: 1 } }, { p: { n: 2 } }] }]);
  });

  it('generates schemas that accept every contributing sample (deterministic fuzz)', () => {
    const random = mulberry32(0x5eed);
    for (let iteration = 0; iteration < 200; iteration += 1) {
      const sampleCount = 1 + Math.floor(random() * 3);
      const samples = Array.from({ length: sampleCount }, () => randomJson(random, 0));
      expectSelfConsistent(samples, `fuzz ${iteration}`);
    }
  });
});

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomJson(random: () => number, depth: number): JsonValue {
  const roll = random();
  if (depth < 3 && roll < 0.3) {
    const keys = ['a', 'b', 'c', 'd'];
    const result: Record<string, JsonValue> = {};
    for (const key of keys) {
      if (random() < 0.6) {
        result[key] = randomJson(random, depth + 1);
      }
    }
    return result;
  }

  if (depth < 3 && roll < 0.5) {
    return Array.from({ length: Math.floor(random() * 4) }, () => randomJson(random, depth + 1));
  }

  if (roll < 0.6) {
    return null;
  }

  if (roll < 0.7) {
    return random() < 0.5;
  }

  if (roll < 0.85) {
    return random() < 0.5 ? Math.floor(random() * 100) : random() * 100;
  }

  return random().toString(36).slice(2, 10);
}
