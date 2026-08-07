import { isLocatorSafeRole } from './selector-policy.mjs';

export const SCOPED_ROLE_TARGET_UNNAMED = 'SCOPED_ROLE_TARGET_UNNAMED';
export const SCOPED_ROLE_SCOPE_ROLES = Object.freeze([
  'banner', 'navigation', 'main', 'complementary', 'region', 'dialog'
]);

const SCOPE_SET = new Set(SCOPED_ROLE_SCOPE_ROLES);
const IDENTITY_KEYS = new Set(['type', 'locator', 'scope', 'target', 'warningCodes']);
const OPTIONAL_DISCOVERY_KEYS = new Set(['score', 'reason']);

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a plain object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} must be a plain object.`);
  }
  return value;
}

function exactKeys(value, keys, label) {
  const extras = Object.keys(value).filter((key) => !keys.has(key));
  if (extras.length) throw new Error(`${label} contains unsupported field(s): ${extras.join(', ')}.`);
}

function name(value, label) {
  if (value === null) return null;
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`${label} must be a trimmed static string or null.`);
  }
  return value;
}

function roleOptions(accessibleName) {
  return accessibleName === null ? '' : `, { name: ${JSON.stringify(accessibleName)} }`;
}

export function renderScopedRoleLocator({ scope, target }) {
  return `page.getByRole(${JSON.stringify(scope.role)}${roleOptions(scope.accessibleName)})`
    + `.getByRole(${JSON.stringify(target.role)}${roleOptions(target.accessibleName)})`;
}

export function createScopedRoleCandidate({
  scopeRole,
  scopeAccessibleName = null,
  targetRole,
  targetAccessibleName = null
}) {
  const scopeName = name(scopeAccessibleName, 'Scoped role scope name');
  const targetName = name(targetAccessibleName, 'Scoped role target name');
  if (!SCOPE_SET.has(scopeRole)) throw new Error(`Unsupported scoped role container: ${scopeRole ?? '(missing)'}.`);
  if (!isLocatorSafeRole(targetRole)) throw new Error(`Unsupported scoped role target: ${targetRole ?? '(missing)'}.`);
  const scope = { role: scopeRole, accessibleName: scopeName };
  const target = { role: targetRole, accessibleName: targetName };
  return {
    type: 'scopedRole',
    locator: renderScopedRoleLocator({ scope, target }),
    scope,
    target,
    score: 85,
    reason: 'A semantic container plus descendant role is live-audited when no direct stable identity exists.',
    warningCodes: targetName === null ? [SCOPED_ROLE_TARGET_UNNAMED] : []
  };
}

export function normalizeScopedRoleCandidate(candidateValue) {
  const candidate = plainObject(candidateValue, 'Scoped role candidate');
  const auditKeys = new Set([
    ...IDENTITY_KEYS, ...OPTIONAL_DISCOVERY_KEYS, 'preferred', 'matchCount', 'unique', 'snapshotMatchCount',
    'snapshotUnique', 'matchEvidence'
  ]);
  exactKeys(candidate, auditKeys, 'Scoped role candidate');
  const scope = plainObject(candidate.scope, 'Scoped role scope');
  const target = plainObject(candidate.target, 'Scoped role target');
  exactKeys(scope, new Set(['role', 'accessibleName']), 'Scoped role scope');
  exactKeys(target, new Set(['role', 'accessibleName']), 'Scoped role target');
  const canonical = createScopedRoleCandidate({
    scopeRole: scope.role,
    scopeAccessibleName: scope.accessibleName,
    targetRole: target.role,
    targetAccessibleName: target.accessibleName
  });
  for (const key of IDENTITY_KEYS) {
    if (JSON.stringify(candidate[key]) !== JSON.stringify(canonical[key])) {
      throw new Error(`Scoped role candidate.${key} is not canonical.`);
    }
  }
  const hasScore = candidate.score !== undefined;
  const hasReason = candidate.reason !== undefined;
  if (hasScore !== hasReason) {
    throw new Error('Scoped role candidate score and reason must be supplied together.');
  }
  if (hasScore && (candidate.score !== canonical.score || candidate.reason !== canonical.reason)) {
    throw new Error('Scoped role candidate discovery metadata is not canonical.');
  }
  return {
    ...Object.fromEntries([...IDENTITY_KEYS].map((key) => [key, canonical[key]])),
    ...(hasScore ? { score: canonical.score, reason: canonical.reason } : {}),
    ...Object.fromEntries([...auditKeys]
      .filter((key) => !IDENTITY_KEYS.has(key)
        && !OPTIONAL_DISCOVERY_KEYS.has(key)
        && candidate[key] !== undefined)
      .map((key) => [key, candidate[key]]))
  };
}

export function scopedRoleLocatorForPage(page, candidateValue) {
  const candidate = normalizeScopedRoleCandidate(candidateValue);
  const scope = candidate.scope.accessibleName === null
    ? page.getByRole(candidate.scope.role)
    : page.getByRole(candidate.scope.role, { name: candidate.scope.accessibleName });
  return candidate.target.accessibleName === null
    ? scope.getByRole(candidate.target.role)
    : scope.getByRole(candidate.target.role, { name: candidate.target.accessibleName });
}
