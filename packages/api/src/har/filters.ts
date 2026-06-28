import type { HarApiTestConfig } from '../types/config.js';
import type { ParsedHarEntry, SupportedHttpMethod } from '../types/har.js';

export interface RuntimeFilterOptions {
  include: string[];
  exclude: string[];
  ignoredDomains: string[];
  firstPartyDomains: string[];
  methods: SupportedHttpMethod[];
  statuses: number[];
}

export function filterHarEntries(
  entries: ParsedHarEntry[],
  config: HarApiTestConfig,
  runtimeOptions: RuntimeFilterOptions
): ParsedHarEntry[] {
  return entries.filter((entry) => shouldKeepEntry(entry, config, runtimeOptions));
}

export function shouldKeepEntry(
  entry: ParsedHarEntry,
  config: HarApiTestConfig,
  runtimeOptions: RuntimeFilterOptions
): boolean {
  const url = safeParseUrl(entry.request.url);
  if (!url) {
    return false;
  }

  const method = entry.request.method.toUpperCase();
  const ignoredDomains = [...config.filters.ignoredDomains, ...runtimeOptions.ignoredDomains];
  const firstPartyDomains = [...config.filters.firstPartyDomains, ...runtimeOptions.firstPartyDomains];
  const includePatterns = [...config.filters.include, ...runtimeOptions.include];
  const excludePatterns = [...config.filters.exclude, ...runtimeOptions.exclude];
  const methods = runtimeOptions.methods.length > 0 ? runtimeOptions.methods : config.filters.methods;
  const statuses = runtimeOptions.statuses.length > 0 ? runtimeOptions.statuses : config.filters.statuses;

  if (!methods.includes(method as SupportedHttpMethod)) {
    return false;
  }

  if (statuses.length > 0 && !statuses.includes(entry.response.status)) {
    return false;
  }

  if (isStaticAsset(url.pathname, config.staticAssetExtensions)) {
    return false;
  }

  if (isTrackingDomain(url.hostname, config.trackingDomains) || isTrackingDomain(url.hostname, ignoredDomains)) {
    return false;
  }

  // When first-party domains are declared, keep only those hosts (third-party APIs are dropped).
  if (firstPartyDomains.length > 0 && !isTrackingDomain(url.hostname, firstPartyDomains)) {
    return false;
  }

  if (isBeaconPath(url.pathname, config.beaconPaths)) {
    return false;
  }

  if (includePatterns.length > 0 && !includePatterns.some((pattern) => matchesPattern(entry.request.url, pattern))) {
    return false;
  }

  if (excludePatterns.some((pattern) => matchesPattern(entry.request.url, pattern))) {
    return false;
  }

  return true;
}

export function isBeaconPath(pathname: string, beaconPaths: string[]): boolean {
  const normalized = pathname.toLowerCase();
  return beaconPaths.some((fragment) => {
    const candidate = fragment.toLowerCase();
    return normalized === candidate || normalized.endsWith(candidate) || normalized.includes(`${candidate}/`);
  });
}

function safeParseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

export function isStaticAsset(pathname: string, extensions: string[]): boolean {
  const normalized = pathname.toLowerCase();
  return extensions.some((extension) => normalized.endsWith(extension));
}

export function isTrackingDomain(hostname: string, domains: string[]): boolean {
  const normalized = hostname.toLowerCase();
  return domains.some((domain) => {
    const candidate = domain.toLowerCase();
    return normalized === candidate || normalized.endsWith(`.${candidate}`);
  });
}

export function matchesPattern(value: string, pattern: string): boolean {
  if (!pattern) {
    return false;
  }

  try {
    return new RegExp(pattern).test(value);
  } catch {
    return value.includes(pattern);
  }
}
