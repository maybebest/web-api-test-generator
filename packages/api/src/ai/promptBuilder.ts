import type { EndpointAnalysis } from './analyzer.js';

export function buildCodexImprovementPrompt(analysis: EndpointAnalysis[]): string {
  return `# Codex API Test Improvement Prompt

Act as a senior AQA/SDET/API automation engineer. Review the generated Playwright API tests and improve them while keeping them maintainable and deterministic.

## Context
- Tests were generated from HAR traffic.
- Secrets have been masked with environment placeholders.
- Static assets and tracking calls were filtered out.
- Generated schemas intentionally validate shape and types, not exact dynamic values.
- Generated run manifests summarize coverage, execution mode, mutation risk, and required environment variables.

## Endpoint Summary
${analysis
  .map(
    (endpoint) => `- ${endpoint.method} ${endpoint.pathPattern}
  - group: ${endpoint.groupName}
  - samples: ${endpoint.sampleCount}
  - statuses: ${endpoint.statuses.join(', ')}
  - request body: ${endpoint.hasRequestBody ? 'yes' : 'no'}
  - JSON response: ${endpoint.hasJsonResponse ? 'yes' : 'no'}
  - suggested assertions: ${endpoint.candidateAssertions.join('; ')}
  - dynamic candidates: ${endpoint.dynamicFieldCandidates.length > 0 ? endpoint.dynamicFieldCandidates.join(', ') : 'none'}`
  )
  .join('\n')}

## Instructions
1. Improve test names so they describe business behavior when it is inferable from paths and payloads.
2. Identify request fields that should become reusable fixtures or factories.
3. Strengthen assertions only when they are stable across environments.
4. Keep authorization, cookies, tokens, emails, passwords, and API keys in environment variables.
5. Do not add brittle assertions for generated IDs, timestamps, random strings, or session-specific values.
6. Prefer helper functions over duplicated request setup.
`;
}
