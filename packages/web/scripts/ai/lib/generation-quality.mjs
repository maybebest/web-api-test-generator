import { createHash } from 'node:crypto';

import {
  PROMOTION_GATE_POLICY,
  PROMOTION_GATE_REPEAT_EACH
} from './generated-gate-policy.mjs';

export function generationQualityFingerprint({
  sourceSha256,
  outcome,
  stage,
  reasonCode,
  repairCount
}) {
  return createHash('sha256').update(JSON.stringify({
    policy: PROMOTION_GATE_POLICY,
    repeatEach: PROMOTION_GATE_REPEAT_EACH,
    sourceSha256: sourceSha256 ?? null,
    outcome,
    stage,
    reasonCode,
    repairCount
  }), 'utf8').digest('hex');
}

export function acceptedGenerationQualityFingerprint({ sourceSha256, repairCount }) {
  return generationQualityFingerprint({
    sourceSha256,
    outcome: 'accepted',
    stage: 'accepted',
    reasonCode: 'PASSED',
    repairCount
  });
}
