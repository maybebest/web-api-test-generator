import type { NormalizedHarEntry } from '../types/har.js';

export interface EndpointAnalysis {
  groupName: string;
  method: string;
  pathPattern: string;
  sampleCount: number;
  statuses: number[];
  hasRequestBody: boolean;
  hasJsonResponse: boolean;
  candidateAssertions: string[];
  dynamicFieldCandidates: string[];
}

export function analyzeEntriesForCodex(entries: NormalizedHarEntry[]): EndpointAnalysis[] {
  const grouped = new Map<string, NormalizedHarEntry[]>();

  for (const entry of entries) {
    const key = `${entry.groupName}:${entry.method}:${entry.pathPattern}`;
    grouped.set(key, [...(grouped.get(key) ?? []), entry]);
  }

  return [...grouped.values()]
    .map((samples) => {
      const first = samples[0];
      return {
        groupName: first.groupName,
        method: first.method,
        pathPattern: first.pathPattern,
        sampleCount: samples.length,
        statuses: [...new Set(samples.map((sample) => sample.responseStatus))].sort((left, right) => left - right),
        hasRequestBody: samples.some((sample) => sample.requestBody !== undefined),
        hasJsonResponse: samples.some((sample) => sample.responseBody !== undefined),
        candidateAssertions: buildCandidateAssertions(samples),
        dynamicFieldCandidates: [...new Set(samples.flatMap((sample) => sample.dynamicSegments))].sort()
      };
    })
    .sort((left, right) => `${left.groupName} ${left.method} ${left.pathPattern}`.localeCompare(`${right.groupName} ${right.method} ${right.pathPattern}`));
}

function buildCandidateAssertions(samples: NormalizedHarEntry[]): string[] {
  const assertions = new Set<string>();
  for (const sample of samples) {
    assertions.add(`status is ${sample.responseStatus}`);
    if (sample.responseContentType) {
      assertions.add(`content-type contains ${sample.responseContentType.split(';')[0]}`);
    }
    if (sample.responseBody !== undefined) {
      assertions.add('response matches generated JSON schema');
    }
    assertions.add(`response time <= ${Math.max(2000, sample.responseTimeMs)}ms`);
  }

  return [...assertions].sort();
}
