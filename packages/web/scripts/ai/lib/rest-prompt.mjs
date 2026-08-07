import { sanitizeGenerationContext } from './generation-context.mjs';

const TASK_TITLE_PATTERN = /^#\s+Codex Generation Task:\s*.+$/m;

/**
 * Remove workflow instructions that are already present in the REST brain's
 * system contract. Dynamic contract data stays in the request: target
 * metadata, current DOM evidence, and the complete source flow spec.
 *
 * The helper deliberately fails open for unknown task formats. Recording and
 * ad-hoc prompts therefore keep their original content until they get their
 * own explicit compaction contract.
 */
export function compactRestGenerationTask(value) {
  const source = sanitizeGenerationContext(value).replace(/\r\n/g, '\n').trim();
  if (/^#\s+Codex Recording Generation Task:/m.test(source)) {
    const canonicalRecordingIr = extractSection(source, 'Canonical Recording Generation IR');
    if (canonicalRecordingIr) {
      return `${canonicalRecordingIr.slice(canonicalRecordingIr.indexOf('\n') + 1).trim()}\n`;
    }
    return source;
  }
  const title = source.match(TASK_TITLE_PATTERN)?.[0];
  const originalHeading = findHeading(source, 'Original Flow Spec');
  const target = extractSection(source, 'Target');

  if (!title || !originalHeading || !target) {
    return source;
  }

  const retained = [title, target];
  const dynamicRequirements = extractDynamicRequirements(source);
  if (dynamicRequirements) {
    retained.push(dynamicRequirements);
  }
  const repositoryContext = extractSection(source, 'DOM and Repository Context')
    ?? extractSection(source, 'DOM Discovery Evidence');
  if (repositoryContext) {
    retained.push(repositoryContext);
  }
  retained.push(source.slice(originalHeading.index).trim());

  return `${retained.join('\n\n')}\n`;
}

function extractDynamicRequirements(source) {
  const requirements = [];
  const header = source.match(/```ts\s*\n(\/\*\s*spec:[^\n]+\*\/)\s*\n```/i)?.[1];
  if (header) {
    requirements.push(`- Exact generated header: \`${header}\``);
  }

  const requiredStyle = extractSection(source, 'Required Test Style');
  if (requiredStyle) {
    const dynamicLinePatterns = [
      /Import from `?fixtures\/test`?/,
      /Declare the spec metadata Tags exactly/,
      /Default generation mode is/,
      /Suite generation mode was explicitly requested/,
      /Generate multiple focused tests/,
      /Split broad flows into focused tests/,
      /Add final assertion-step coverage for every AC ID/,
      /Each generated test still gets one final assertion step/,
      /Generate exactly one primary `test/,
      /Do not split every AC/,
      /The primary test must declare a `covered-ac-ids` annotation/,
      /Every `test\.step` title in the primary test/,
      /Optional NEG tests must contain/,
      /The final assertion step must name the primary/
    ];
    for (const line of requiredStyle.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('- ') && dynamicLinePatterns.some((pattern) => pattern.test(trimmed))) {
        requirements.push(trimmed);
      }
    }
  }

  return requirements.length > 0
    ? `## Dynamic Generation Requirements\n\n${[...new Set(requirements)].join('\n')}`
    : undefined;
}

function findHeading(source, name) {
  const pattern = new RegExp(`^##\\s+${escapeRegExp(name)}\\s*$`, 'm');
  const match = pattern.exec(source);
  return match ? { index: match.index, length: match[0].length } : undefined;
}

function extractSection(source, name) {
  const heading = findHeading(source, name);
  if (!heading) return undefined;

  const afterHeading = heading.index + heading.length;
  const nextHeading = /^##\s+.+?\s*$/m.exec(source.slice(afterHeading));
  const end = nextHeading ? afterHeading + nextHeading.index : source.length;
  return source.slice(heading.index, end).trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
