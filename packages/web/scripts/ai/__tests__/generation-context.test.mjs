import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeGenerationContext } from '../lib/generation-context.mjs';

test('generation context removes legacy person-dependent authorization without changing the source spec', () => {
  const legacy = `## Metadata

| Field | Value |
|---|---|
| Review Status | pending-review |
| Review Sign-off | pending |
| Flow ID | FLOW-001 |

- Human review must confirm selectors before human sign-off.
- The viewport probes remain pending human review and must receive human sign-off.
- Product/UX owners must review them before this pending-review flow is promoted.
- Capture assistant text for manual review.
- Blocker: MUTATION_APPROVAL.
`;

  const sanitized = sanitizeGenerationContext(legacy);

  assert.match(sanitized, /Flow ID \| FLOW-001/);
  assert.match(sanitized, /automated validation must confirm selectors before machine policy verdict/i);
  assert.match(sanitized, /pending automated validation and must pass machine policy validation/i);
  assert.match(sanitized, /automated support-matrix checks must validate them/i);
  assert.match(sanitized, /automated evidence capture/i);
  assert.match(sanitized, /MUTATION_POLICY/);
  assert.doesNotMatch(
    sanitized,
    /Review Status|Review Sign-off|pending-review|human review|human sign-off|manual review|MUTATION_APPROVAL/i
  );
  assert.match(legacy, /Review Status/, 'sanitization must not mutate the caller-owned source string');
});
