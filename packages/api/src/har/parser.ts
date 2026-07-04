import fs from 'node:fs/promises';
import path from 'node:path';
import type { HarFile, ParsedHarEntry } from '../types/har.js';
import { findHarFiles } from '../utils/fileSystem.js';
import { compareStrings } from '../utils/compare.js';

export async function parseHarInputs(inputs: string[]): Promise<ParsedHarEntry[]> {
  const files = await findHarFiles(inputs);
  const parsed: ParsedHarEntry[] = [];

  for (const file of files) {
    parsed.push(...(await parseHarFile(file)));
  }

  return parsed.sort((left, right) => {
    const sourceCompare = compareStrings(left.sourceFile, right.sourceFile);
    return sourceCompare === 0 ? left.entryIndex - right.entryIndex : sourceCompare;
  });
}

export async function parseHarFile(filePath: string): Promise<ParsedHarEntry[]> {
  const har = await readHarJson(filePath);
  validateHarFile(har, filePath);

  return har.log.entries.map((entry, index) => ({
    sourceFile: path.resolve(filePath),
    entryIndex: index,
    startedDateTime: entry.startedDateTime,
    timeMs: typeof entry.time === 'number' ? Math.max(0, entry.time) : 0,
    request: entry.request,
    response: entry.response
  }));
}

async function readHarJson(filePath: string): Promise<HarFile> {
  const content = await fs.readFile(filePath, 'utf8');
  try {
    return JSON.parse(content) as HarFile;
  } catch {
    return parseEmbeddedHarJson(content, filePath);
  }
}

function parseEmbeddedHarJson(content: string, filePath: string): HarFile {
  const fenced = parseFencedHarBlock(content);
  if (fenced) {
    return fenced;
  }

  const jsonStart = content.indexOf('{');
  const jsonEnd = content.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    throw new Error(`Invalid HAR JSON in ${filePath}: no JSON object or fenced \`\`\`json block found`);
  }

  try {
    return JSON.parse(content.slice(jsonStart, jsonEnd + 1)) as HarFile;
  } catch {
    throw new Error(`Invalid HAR JSON in ${filePath}: embedded JSON could not be parsed`);
  }
}

function parseFencedHarBlock(content: string): HarFile | undefined {
  for (const match of content.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
    const candidate = tryParseHarObject(match[1]);
    if (candidate) {
      return candidate;
    }
  }

  return undefined;
}

function tryParseHarObject(text: string): HarFile | undefined {
  try {
    const parsed = JSON.parse(text) as HarFile;
    return parsed && typeof parsed === 'object' && Array.isArray(parsed.log?.entries) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function validateHarFile(har: HarFile, filePath: string): void {
  if (!har?.log || !Array.isArray(har.log.entries)) {
    throw new Error(`Invalid HAR file: ${filePath}`);
  }

  for (const [index, entry] of har.log.entries.entries()) {
    if (!entry.request?.method || !entry.request.url || typeof entry.response?.status !== 'number') {
      throw new Error(`Invalid HAR entry ${index} in ${filePath}`);
    }
  }
}
