import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  compileRecordingGenerationIr,
  renderRecordingGenerationIr
} from '../lib/recording-generation-ir.mjs';
import { normalizeRecordingFile } from '../lib/recording-parser.mjs';
import { loadGenerationPrompt } from '../ai-generate.mjs';

test('recording generation IR preserves every required step/assertion in at most 65% of normalized task data', () => {
  const normalized = normalizeRecordingFile('recordings/checkout-confirmation.json');
  const targetTestFile = normalized.targetTestFile;
  const ir = compileRecordingGenerationIr(normalized, { targetTestFile });
  const rendered = renderRecordingGenerationIr(ir);
  const legacyNormalized = JSON.stringify(normalized, null, 2);

  assert.equal(ir.schemaVersion, 'recording-generation-ir/v1');
  assert.equal(ir.target.testFile, targetTestFile);
  assert.equal(
    ir.target.exactHeader,
    `/* recording: ${normalized.recordingPath} title:${normalized.title} sha256:${normalized.sha256} */`
  );
  for (const step of normalized.steps) {
    assert.match(rendered, new RegExp(step.id));
    if (step.assertionId) assert.match(rendered, new RegExp(step.assertionId));
  }
  for (const assertion of normalized.assertions) assert.match(rendered, new RegExp(assertion.id));
  assert.match(rendered, /urlForTest|bestLocator|Recording Customer/);
  assert.ok(
    rendered.length <= legacyNormalized.length * 0.65,
    `recording IR too large: legacy=${legacyNormalized.length}, ir=${rendered.length}`
  );
});

test('ai-generate recognizes a recording task, stage, policy, and manifest fingerprint', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'recording-generation-task-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const fingerprint = 'c'.repeat(64);
  const taskPath = path.join(directory, 'generation-task.md');
  fs.writeFileSync(taskPath, '# Codex Recording Generation Task: checkout\n\n## Target\n\n- target\n');
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ generationFingerprint: fingerprint }));

  const request = loadGenerationPrompt({ taskPath });

  assert.equal(request.stage, 'recording-generation');
  assert.equal(request.generationFingerprint, fingerprint);
  assert.match(request.systemPrompt, /Policy recording-generation-policy\/v1/);
  assert.doesNotMatch(request.systemPrompt, /covered-ac-ids|AC-###/);
});
