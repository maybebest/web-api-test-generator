// Tiny dependency-free helpers for reading/writing deeply-nested fields by path.
// This is what powers the builder's "change ANY field" capability:
//   builder.set('inStore.cost.managedService.pricingModels[0].cost', 410)

export type PathSegment = string | number;
export type PathInput = string | PathSegment[];

/** Parse 'a.b[0].c' (or an array path) into ['a','b',0,'c']. */
export function toSegments(path: PathInput): PathSegment[] {
  if (Array.isArray(path)) {
    return path;
  }

  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter((segment) => segment.length > 0)
    .map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment));
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function deepClone<T>(value: T): T {
  const structured = (globalThis as { structuredClone?: <V>(input: V) => V }).structuredClone;
  if (typeof structured === 'function') {
    return structured(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

export function deepGet(target: unknown, path: PathInput): unknown {
  let current: unknown = target;
  for (const segment of toSegments(path)) {
    if (current == null) {
      return undefined;
    }
    current = (current as Record<PathSegment, unknown>)[segment];
  }
  return current;
}

/**
 * Set a value at a deep path, mutating `target` in place and creating intermediate containers.
 * The next segment's type decides the container: a numeric segment creates an array, otherwise
 * an object. Returns the same `target` for chaining.
 */
export function deepSet<T>(target: T, path: PathInput, value: unknown): T {
  const segments = toSegments(path);
  if (segments.length === 0) {
    return target;
  }

  let cursor = target as Record<PathSegment, unknown>;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const nextSegment = segments[index + 1];
    const existing = cursor[segment];

    if (existing == null || (typeof existing !== 'object')) {
      cursor[segment] = typeof nextSegment === 'number' ? [] : {};
    }

    cursor = cursor[segment] as Record<PathSegment, unknown>;
  }

  cursor[segments[segments.length - 1]] = value;
  return target;
}

/** Delete the value at a deep path (mutates). No-op if the path does not exist. */
export function deepUnset<T>(target: T, path: PathInput): T {
  const segments = toSegments(path);
  if (segments.length === 0) {
    return target;
  }

  const parent = deepGet(target, segments.slice(0, -1));
  if (parent != null && typeof parent === 'object') {
    delete (parent as Record<PathSegment, unknown>)[segments[segments.length - 1]];
  }
  return target;
}

/**
 * Recursively merge `patch` into `base` and return a NEW object. Objects are merged key by key;
 * arrays and scalars in `patch` REPLACE the value in `base` (no array concatenation), which is the
 * right semantics for partial-updating a channel payload. `undefined` values in `patch` are
 * ignored; an explicit `null` overwrites.
 */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return (patch === undefined ? base : deepClone(patch)) as T;
  }

  const result: Record<string, unknown> = deepClone(base);
  for (const [key, patchValue] of Object.entries(patch)) {
    if (patchValue === undefined) {
      continue;
    }
    result[key] = isPlainObject(patchValue) && isPlainObject(result[key])
      ? deepMerge(result[key], patchValue)
      : deepClone(patchValue);
  }
  return result as T;
}

/** Recursively remove every occurrence of the given keys (mutates). Used to drop output-only fields. */
export function pruneKeys<T>(target: T, keys: Iterable<string>): T {
  const denied = new Set(keys);
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!isPlainObject(node)) {
      return;
    }
    for (const key of Object.keys(node)) {
      if (denied.has(key)) {
        delete node[key];
        continue;
      }
      visit(node[key]);
    }
  };
  visit(target);
  return target;
}
