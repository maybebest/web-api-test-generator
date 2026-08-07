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
  if (!isRecord(har) || !isRecord(har.log) || !Array.isArray(har.log.entries)) {
    throw new Error(`Invalid HAR file ${filePath} at $.log.entries: expected an array`);
  }

  for (const [index, entry] of har.log.entries.entries()) {
    const entryPath = `$.log.entries[${index}]`;
    if (!isRecord(entry) || !isRecord(entry.request) || !isRecord(entry.response)) {
      throw new Error(`Invalid HAR file ${filePath} at ${entryPath}: request and response objects are required`);
    }
    if (
      entry.startedDateTime !== undefined &&
      (typeof entry.startedDateTime !== 'string' || Number.isNaN(Date.parse(entry.startedDateTime)))
    ) {
      throw new Error(`Invalid HAR file ${filePath} at ${entryPath}.startedDateTime: expected an ISO date-time string`);
    }
    if (entry.time !== undefined && (typeof entry.time !== 'number' || !Number.isFinite(entry.time))) {
      throw new Error(`Invalid HAR file ${filePath} at ${entryPath}.time: expected a finite number`);
    }
    if (typeof entry.request.method !== 'string' || entry.request.method.trim() === '') {
      throw new Error(`Invalid HAR file ${filePath} at ${entryPath}.request.method: expected a non-empty string`);
    }
    if (typeof entry.request.url !== 'string') {
      throw new Error(`Invalid HAR file ${filePath} at ${entryPath}.request.url: expected a string`);
    }
    try {
      const url = new URL(entry.request.url);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('unsupported protocol');
      }
    } catch {
      throw new Error(`Invalid HAR file ${filePath} at ${entryPath}.request.url: expected an absolute HTTP(S) URL`);
    }
    if (!Number.isInteger(entry.response.status) || entry.response.status < 100 || entry.response.status > 599) {
      throw new Error(`Invalid HAR file ${filePath} at ${entryPath}.response.status: expected an HTTP status`);
    }

    validateNameValuePairs(entry.request.headers, filePath, `${entryPath}.request.headers`);
    validateNameValuePairs(entry.request.queryString, filePath, `${entryPath}.request.queryString`);
    validateNameValuePairs(entry.response.headers, filePath, `${entryPath}.response.headers`);

    if (entry.request.postData !== undefined) {
      if (!isRecord(entry.request.postData)) {
        throw new Error(`Invalid HAR file ${filePath} at ${entryPath}.request.postData: expected an object`);
      }
      if (entry.request.postData.text !== undefined && typeof entry.request.postData.text !== 'string') {
        throw new Error(`Invalid HAR file ${filePath} at ${entryPath}.request.postData.text: expected a string`);
      }
      if (entry.request.postData.mimeType !== undefined && typeof entry.request.postData.mimeType !== 'string') {
        throw new Error(`Invalid HAR file ${filePath} at ${entryPath}.request.postData.mimeType: expected a string`);
      }
      validateNameValuePairs(entry.request.postData.params, filePath, `${entryPath}.request.postData.params`);
    }

    if (entry.response.content !== undefined) {
      if (!isRecord(entry.response.content)) {
        throw new Error(`Invalid HAR file ${filePath} at ${entryPath}.response.content: expected an object`);
      }
      if (entry.response.content.text !== undefined && typeof entry.response.content.text !== 'string') {
        throw new Error(`Invalid HAR file ${filePath} at ${entryPath}.response.content.text: expected a string`);
      }
      if (entry.response.content.mimeType !== undefined && typeof entry.response.content.mimeType !== 'string') {
        throw new Error(`Invalid HAR file ${filePath} at ${entryPath}.response.content.mimeType: expected a string`);
      }
      if (entry.response.content.encoding !== undefined && entry.response.content.encoding !== 'base64') {
        throw new Error(`Invalid HAR file ${filePath} at ${entryPath}.response.content.encoding: only base64 is supported`);
      }
      if (
        entry.response.content.encoding === 'base64' &&
        entry.response.content.text !== undefined &&
        !isValidBase64(entry.response.content.text)
      ) {
        throw new Error(`Invalid HAR file ${filePath} at ${entryPath}.response.content.text: invalid base64 payload`);
      }
    }
  }
}

function validateNameValuePairs(value: unknown, filePath: string, jsonPath: string): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    throw new Error(`Invalid HAR file ${filePath} at ${jsonPath}: expected an array`);
  }
  value.forEach((pair, index) => {
    if (!isRecord(pair) || typeof pair.name !== 'string' || typeof pair.value !== 'string') {
      throw new Error(`Invalid HAR file ${filePath} at ${jsonPath}[${index}]: expected string name and value`);
    }
  });
}

function isValidBase64(value: string): boolean {
  return value.length % 4 === 0 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
