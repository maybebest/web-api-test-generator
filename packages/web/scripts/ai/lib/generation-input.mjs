import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createTaskContent,
  resolveDomArtifactPath
} from '../create-generation-task.mjs';
import { buildGenerationContextPack, renderGenerationContextPack } from './generation-context-pack.mjs';
import { compileGenerationIr, renderGenerationIr } from './generation-ir.mjs';
import {
  resolveGenerationMode,
  specGenerationMode,
  specSha256
} from './spec-parser.mjs';
import { validateSpecFile } from '../validate-flow-spec.mjs';

const DEFAULT_WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function invalidSpecMessage(specPath, issues) {
  return [
    `Cannot generate from invalid flow spec: ${specPath}`,
    ...issues.map((issue) => `- ${issue}`)
  ].join('\n');
}

// The single entry point for turning a saved flow spec into provider input.
// Validation, mode resolution, behavioral hash calculation, DOM-artifact review,
// and task rendering all happen before the caller can invoke a model.
export function buildGenerationInput({
  specPath,
  specFilePath,
  targetTestFile,
  domArtifactPath,
  mode,
  webRoot = DEFAULT_WEB_ROOT,
  contextMaxChars = 3_500
}) {
  if (!specPath || !String(specPath).trim()) {
    throw new Error('Missing flow spec path.');
  }

  const normalizedSpecPath = String(specPath).trim();
  const sourceSpecPath = specFilePath ? String(specFilePath).trim() : normalizedSpecPath;
  const validation = validateSpecFile(sourceSpecPath);
  if (!validation.valid) {
    throw new Error(invalidSpecMessage(normalizedSpecPath, validation.issues ?? []));
  }

  return buildGenerationInputFromValidatedSpec({
    specPath: normalizedSpecPath,
    specFilePath: sourceSpecPath,
    validation,
    specSha256: specSha256(validation.content),
    targetTestFile,
    domArtifactPath,
    mode,
    webRoot,
    contextMaxChars
  });
}

export function buildGenerationInputFromValidatedSpec({
  specPath,
  specFilePath,
  validation,
  specSha256: sourceSha256,
  targetTestFile,
  domArtifactPath,
  mode,
  webRoot = DEFAULT_WEB_ROOT,
  contextMaxChars = 3_500
}) {
  if (!specPath || !String(specPath).trim()) {
    throw new Error('Missing flow spec path.');
  }
  const normalizedSpecPath = String(specPath).trim();
  if (!validation?.valid) {
    throw new Error(invalidSpecMessage(normalizedSpecPath, validation?.issues ?? []));
  }
  if (typeof sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sourceSha256)) {
    throw new Error('Validated generation input requires the current behavioral spec SHA-256.');
  }
  if (sourceSha256 !== specSha256(validation.content)) {
    throw new Error('Validated generation input behavioral spec SHA-256 does not match the captured validated content.');
  }

  const resolvedTarget = String(targetTestFile ?? validation.metadata['Target Test File'] ?? '').trim();
  if (!resolvedTarget) {
    throw new Error(`Spec ${normalizedSpecPath} does not define a target test file.`);
  }

  const generationMode = resolveGenerationMode({
    cliMode: mode,
    specMode: specGenerationMode(validation.metadata)
  });
  const sourceSpecIdentity = specFilePath ? String(specFilePath).trim() : normalizedSpecPath;
  const reviewedDomArtifactPath = resolveDomArtifactPath(sourceSpecIdentity, domArtifactPath, webRoot, sourceSha256);
  const contextPack = buildGenerationContextPack({
    webRoot,
    specPath: normalizedSpecPath,
    targetTestFile: resolvedTarget,
    domArtifactPath: reviewedDomArtifactPath,
    validation,
    specSha256: sourceSha256,
    specFilePath: sourceSpecIdentity,
    maxChars: contextMaxChars
  });
  const ir = compileGenerationIr(validation, {
    specPath: normalizedSpecPath,
    targetTestFile: resolvedTarget,
    generationMode,
    specSha256: sourceSha256
  });
  const agentTask = createTaskContent({
    specPath: normalizedSpecPath,
    targetTestFile: resolvedTarget,
    validation,
    domArtifactPath: reviewedDomArtifactPath,
    generationMode,
    contextPack,
    specHash: sourceSha256
  });
  const prompt = `${renderGenerationIr(ir)}\n## DOM and Repository Context\n\n${renderGenerationContextPack(contextPack)}\n`;
  const cacheIdentityPack = {
    ...contextPack,
    existingTarget: { path: contextPack.existingTarget.path }
  };
  const cacheIdentityPrompt = `${renderGenerationIr(ir)}\n## DOM and Repository Context\n\n${renderGenerationContextPack(cacheIdentityPack)}\n`;

  return {
    prompt,
    cacheIdentityPrompt,
    validation,
    generationMode,
    specSha256: sourceSha256,
    targetTestFile: resolvedTarget,
    domArtifactPath: reviewedDomArtifactPath,
    contextPack,
    ir,
    agentTask
  };
}
