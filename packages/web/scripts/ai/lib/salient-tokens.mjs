// Single source of truth for salient expected-value tokens. The generated-test
// reviewer enforces this exact derivation, and the provider input advertises
// the same list, so the model is told every token the reviewer will demand.

// Conservative: only genuinely salient fragments — IDs (REQ-1001), "N days",
// "must be at least/most" phrases, and quoted substrings. The previous
// blanket "any capitalized word" rule was satisfiable by token-stuffing a dead
// constant, so it has been removed in favor of the explicit declared list below.
export function salientExpectedTokens(value) {
  if (!value || /NEEDS_REVIEW/i.test(value)) {
    return [];
  }

  const tokens = new Set();
  for (const match of value.matchAll(/\b[A-Z]{2,}-\d+\b/g)) {
    tokens.add(match[0]);
  }
  for (const match of value.matchAll(/\b\d+\s+days?\b/gi)) {
    tokens.add(match[0]);
  }
  if (/must be at least/i.test(value)) {
    tokens.add('must be at least');
  }
  if (/must be at most/i.test(value)) {
    tokens.add('must be at most');
  }
  for (const match of value.matchAll(/["'`]([^"'`]{3,})["'`]/g)) {
    tokens.add(match[1].trim());
  }

  return [...tokens];
}

// Reads "Must assert the salient expected values A, B, and C." from the spec's
// Generated Test Requirements and returns the listed phrases verbatim.
export function parseDeclaredSalientValues(parsedSpec) {
  const requirements = parsedSpec.sections?.['Generated Test Requirements'] ?? '';
  const match = requirements.match(/must assert the salient expected values?\s+(.+?)\.?$/im);
  if (!match) {
    return [];
  }

  return match[1]
    .split(/\s*,\s*|\s+and\s+/i)
    .map((part) => part.replace(/^["'`]|["'`]$/g, '').trim())
    .filter((part) => part.length > 0 && !/^and$/i.test(part));
}

export function primitiveMockValues(value) {
  if (value === null || value === undefined) {
    return [];
  }

  if (['string', 'number', 'boolean'].includes(typeof value)) {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => primitiveMockValues(entry));
  }

  if (typeof value === 'object') {
    return Object.values(value).flatMap((entry) => primitiveMockValues(entry));
  }

  return [];
}

function primitiveExpectedValues(dataCases) {
  if (!Array.isArray(dataCases)) {
    return [];
  }

  return dataCases.flatMap((dataCase) => primitiveMockValues(dataCase.expected));
}

// The complete salient token list for a parsed flow spec: extracted from Flow
// Step expected results and JSON data-case expected values, plus the spec
// author's explicit "Must assert the salient expected values ..." declaration.
// That explicit contract is authoritative and harder to game than heuristics.
export function collectSpecSalientTokens(parsedSpec) {
  const extracted = [
    ...parsedSpec.flowSteps.map((step) => step.expectedResult ?? ''),
    ...primitiveExpectedValues(parsedSpec.dataCasesJson.value)
  ].flatMap((value) => salientExpectedTokens(String(value)));
  const declared = parseDeclaredSalientValues(parsedSpec);

  return [...new Set([...extracted, ...declared])];
}
