import type { JsonArray, JsonObject, JsonValue } from '../types/json.js';
import { isJsonArray, isJsonObject } from '../types/json.js';

export type JsonSchema = Record<string, unknown>;

export function generateJsonSchema(value: JsonValue, title: string): JsonSchema {
  return generateJsonSchemaFromSamples([value], title);
}

export function generateJsonSchemaFromSamples(values: JsonValue[], title: string): JsonSchema {
  if (values.length === 0) {
    return generateJsonSchema({}, title);
  }

  const merged = mergeSchemas(values.map(inferSchema));
  // A single sample cannot justify required: only intersections across samples can.
  const schema = values.length === 1 ? stripRequired(merged) : merged;

  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title,
    ...relaxNullOnlyNodes(schema)
  };
}

function inferSchema(value: JsonValue): JsonSchema {
  if (value === null) {
    return { type: 'null' };
  }

  if (typeof value === 'string') {
    // No format keyword: the generated suite's Ajv has no format validators (the keyword would be
    // ignored with a warning), and a single observed value cannot justify a format constraint.
    return { type: 'string' };
  }

  if (typeof value === 'number') {
    return { type: Number.isInteger(value) ? 'integer' : 'number' };
  }

  if (typeof value === 'boolean') {
    return { type: 'boolean' };
  }

  if (isJsonArray(value)) {
    return inferArraySchema(value);
  }

  if (isJsonObject(value)) {
    return inferObjectSchema(value);
  }

  return {};
}

function inferArraySchema(value: JsonArray): JsonSchema {
  if (value.length === 0) {
    return {
      type: 'array',
      items: {}
    };
  }

  return {
    type: 'array',
    items: mergeSchemas(value.map(inferSchema))
  };
}

function inferObjectSchema(value: JsonObject): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const keys = Object.keys(value).sort();

  for (const key of keys) {
    properties[key] = inferSchema(value[key]);
  }

  return {
    type: 'object',
    additionalProperties: true,
    required: keys,
    properties
  };
}

/**
 * Self-consistency invariant: every sample that contributed to a merge must validate against the
 * merged schema. anyOf operands are flattened into their branches before type grouping (a prior
 * merge result has no top-level type), same-type branches merge structurally, and required never
 * survives on a node corroborated by only a subset of the merged operands.
 */
function mergeSchemas(schemas: JsonSchema[]): JsonSchema {
  const branches = schemas.flatMap(flattenSchemaBranches);
  if (branches.length === 0 || branches.some(isUnconstrainedSchema)) {
    return {};
  }

  const byType = new Map<string, JsonSchema[]>();
  for (const branch of branches) {
    const type = String(branch.type);
    byType.set(type, [...(byType.get(type) ?? []), branch]);
  }

  const mergedBranches = [...byType.values()].map(mergeSameTypeSchemas);
  if (mergedBranches.length === 1) {
    return mergedBranches[0];
  }

  // Each anyOf branch is backed by only a subset of the operands, so no branch may keep required.
  return { anyOf: mergedBranches.map((branch) => stripRequired(branch)) };
}

function flattenSchemaBranches(schema: JsonSchema): JsonSchema[] {
  return Array.isArray(schema.anyOf) ? (schema.anyOf as JsonSchema[]).flatMap(flattenSchemaBranches) : [schema];
}

function isUnconstrainedSchema(schema: JsonSchema): boolean {
  return schema.type === undefined;
}

function mergeSameTypeSchemas(schemas: JsonSchema[]): JsonSchema {
  const type = schemas[0].type;
  if (type === 'object') {
    return mergeObjectSchemas(schemas);
  }

  if (type === 'array') {
    // An empty observed array contributes items: {} (unconstrained), which relaxes the merge.
    return { type: 'array', items: mergeSchemas(schemas.map(itemsSchema)) };
  }

  return { type };
}

function itemsSchema(schema: JsonSchema): JsonSchema {
  const items = schema.items;
  return items && typeof items === 'object' && !Array.isArray(items) ? (items as JsonSchema) : {};
}

function mergeObjectSchemas(schemas: JsonSchema[]): JsonSchema {
  const requiredSets = schemas
    .map((schema) => (Array.isArray(schema.required) ? schema.required.map(String) : []))
    .map((keys) => new Set(keys));
  const required = requiredSets.length === 0 ? [] : [...requiredSets[0]].filter((key) => requiredSets.every((set) => set.has(key)));

  const contributions = new Map<string, JsonSchema[]>();
  for (const schema of schemas) {
    const schemaProperties = schema.properties;
    if (!schemaProperties || typeof schemaProperties !== 'object' || Array.isArray(schemaProperties)) {
      continue;
    }

    for (const [key, propertySchema] of Object.entries(schemaProperties)) {
      contributions.set(key, [...(contributions.get(key) ?? []), propertySchema as JsonSchema]);
    }
  }

  const properties: Record<string, JsonSchema> = {};
  for (const [key, propertySchemas] of contributions) {
    const merged = mergeSchemas(propertySchemas);
    // A property observed in only a subset of the merged objects cannot justify nested required.
    properties[key] = propertySchemas.length < schemas.length ? stripRequired(merged) : merged;
  }

  return {
    type: 'object',
    additionalProperties: true,
    required: required.sort(),
    properties
  };
}

function stripRequired(schema: JsonSchema): JsonSchema {
  const result = transformChildSchemas(schema, stripRequired);
  delete result.required;

  if (Array.isArray(result.anyOf)) {
    result.anyOf = result.anyOf.map((branch) => stripRequired(branch as JsonSchema));
  }

  return result;
}

function relaxNullOnlyNodes(schema: JsonSchema): JsonSchema {
  if (isNullOnlySchema(schema)) {
    return {};
  }

  const result = transformChildSchemas(schema, relaxNullOnlyNodes);

  if (Array.isArray(result.anyOf)) {
    // Null observed alongside other types stays a legitimate anyOf branch.
    result.anyOf = result.anyOf.map((branch) =>
      isNullOnlySchema(branch) ? branch : relaxNullOnlyNodes(branch as JsonSchema)
    );
  }

  return result;
}

function transformChildSchemas(schema: JsonSchema, transform: (schema: JsonSchema) => JsonSchema): JsonSchema {
  const result: JsonSchema = { ...schema };
  const properties = result.properties;

  if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
    result.properties = Object.fromEntries(
      Object.entries(properties as Record<string, JsonSchema>).map(([key, child]) => [key, transform(child)])
    );
  }

  if (result.items && typeof result.items === 'object' && !Array.isArray(result.items)) {
    result.items = transform(result.items as JsonSchema);
  }

  return result;
}

function isNullOnlySchema(value: unknown): value is JsonSchema {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value as JsonSchema).type === 'null' &&
    Object.keys(value).length === 1
  );
}
