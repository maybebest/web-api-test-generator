import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/config/defaultConfig.js';
import { isBeaconPath, isStaticAsset, isTrackingDomain, shouldKeepEntry } from '../../src/har/filters.js';
import type { ParsedHarEntry } from '../../src/types/har.js';

const runtime = {
  include: [],
  exclude: [],
  ignoredDomains: [],
  firstPartyDomains: [],
  methods: [],
  statuses: []
};

describe('HAR filters', () => {
  it('treats Intercom and other analytics vendors as tracking domains', () => {
    expect(isTrackingDomain('api-iam.eu.intercom.io', defaultConfig.trackingDomains)).toBe(true);
    expect(isTrackingDomain('o123.ingest.de.sentry.io', defaultConfig.trackingDomains)).toBe(true);
    expect(isTrackingDomain('stageautomation.heartpace.dev', defaultConfig.trackingDomains)).toBe(false);
  });

  it('drops telemetry beacon paths', () => {
    expect(isBeaconPath('/messenger/web/ping', defaultConfig.beaconPaths)).toBe(true);
    expect(isBeaconPath('/messenger/web/metrics', defaultConfig.beaconPaths)).toBe(true);
    expect(isBeaconPath('/v1/users', defaultConfig.beaconPaths)).toBe(false);
  });

  it('still recognizes static assets', () => {
    expect(isStaticAsset('/app/main.js', defaultConfig.staticAssetExtensions)).toBe(true);
    expect(isStaticAsset('/v1/users', defaultConfig.staticAssetExtensions)).toBe(false);
  });

  it('drops third-party hosts and beacons but keeps the first-party API', () => {
    expect(shouldKeepEntry(entry('https://api-iam.eu.intercom.io/messenger/web/ping'), defaultConfig, runtime)).toBe(false);
    expect(shouldKeepEntry(entry('https://stageautomation.heartpace.dev/me/account'), defaultConfig, runtime)).toBe(true);
  });

  it('keeps only first-party hosts when firstPartyDomains is set', () => {
    const firstParty = { ...runtime, firstPartyDomains: ['heartpace.dev'] };
    expect(shouldKeepEntry(entry('https://stageautomation.heartpace.dev/me/account'), defaultConfig, firstParty)).toBe(true);
    expect(shouldKeepEntry(entry('https://heartpace.featurebase.app/api/v1/x'), defaultConfig, firstParty)).toBe(false);
    expect(shouldKeepEntry(entry('https://dmdemo.heartpace.com/x'), defaultConfig, firstParty)).toBe(false);
  });

  it('drops entries with an unparseable URL instead of throwing', () => {
    expect(shouldKeepEntry(entry('not-a-valid-url'), defaultConfig, runtime)).toBe(false);
  });
});

function entry(url: string): ParsedHarEntry {
  return {
    sourceFile: 'test.har',
    entryIndex: 0,
    timeMs: 10,
    request: { method: 'GET', url, headers: [] },
    response: { status: 200, headers: [] }
  };
}
