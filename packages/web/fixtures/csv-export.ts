import { Buffer } from 'node:buffer';
import { TextDecoder } from 'node:util';

import type { Download } from '@playwright/test';

const MAX_CSV_BYTES = 10 * 1024 * 1024;

type ParserState = 'field-start' | 'unquoted' | 'quoted' | 'after-quote';

export interface CsvExportExpectations {
  advertiser: string;
  brand: string;
  objective: string;
  channel: string;
  budget: readonly (string | RegExp)[];
  skuCount: number;
}

export interface CsvContentChecks {
  parsedRfc4180: boolean;
  nonEmptyRows: boolean;
  rectangularRows: boolean;
  tokens: {
    advertiser: boolean;
    brand: boolean;
    objective: boolean;
    channel: boolean;
    budget: boolean;
    skuCount: boolean;
  };
}

export interface CsvDownloadChecks extends CsvContentChecks {
  downloadSucceeded: boolean;
  csvFilename: boolean;
  utf8Readable: boolean;
}

export interface CsvContentInspection {
  checks: CsvContentChecks;
  rowCount: number;
  columnCount: number;
  diagnosticCode: 'none' | 'invalid-rfc4180';
}

export interface CsvDownloadInspection {
  checks: CsvDownloadChecks;
  rowCount: number;
  columnCount: number;
  byteLength: number;
  diagnosticCode:
    | 'none'
    | 'download-failed'
    | 'stream-unavailable'
    | 'size-limit-exceeded'
    | 'invalid-utf8'
    | 'invalid-rfc4180';
}

/**
 * Parse comma-delimited RFC 4180 records without splitting quoted commas,
 * escaped quotes or embedded record separators. CRLF is the canonical record
 * separator; LF is accepted because browser-generated CSV commonly uses it.
 */
export function parseRfc4180(input: string): string[][] {
  const source = input.startsWith('\uFEFF') ? input.slice(1) : input;
  if (source.length === 0) {
    return [];
  }

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let state: ParserState = 'field-start';
  let endedWithRecordSeparator = false;

  const commitField = (): void => {
    row.push(field);
    field = '';
    state = 'field-start';
  };
  const commitRow = (): void => {
    commitField();
    rows.push(row);
    row = [];
    endedWithRecordSeparator = true;
  };
  const consumeRecordSeparator = (index: number, appendToField: boolean): number => {
    if (source[index] === '\r') {
      if (source[index + 1] !== '\n') {
        throw new Error(`Invalid RFC 4180 CSV: lone carriage return at offset ${index}.`);
      }
      if (appendToField) {
        field += '\n';
      }
      return index + 2;
    }
    if (appendToField) {
      field += '\n';
    }
    return index + 1;
  };

  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (character === '\0') {
      throw new Error(`Invalid RFC 4180 CSV: NUL byte at offset ${index}.`);
    }

    if (state === 'quoted') {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        state = 'after-quote';
        index += 1;
        continue;
      }
      if (character === '\r' || character === '\n') {
        index = consumeRecordSeparator(index, true);
        continue;
      }
      field += character;
      index += 1;
      continue;
    }

    if (state === 'after-quote') {
      if (character === ',') {
        commitField();
        endedWithRecordSeparator = false;
        index += 1;
        continue;
      }
      if (character === '\r' || character === '\n') {
        commitRow();
        index = consumeRecordSeparator(index, false);
        continue;
      }
      throw new Error(`Invalid RFC 4180 CSV: unexpected character after closing quote at offset ${index}.`);
    }

    if (state === 'field-start' && character === '"') {
      state = 'quoted';
      endedWithRecordSeparator = false;
      index += 1;
      continue;
    }
    if (character === '"') {
      throw new Error(`Invalid RFC 4180 CSV: quote inside an unquoted field at offset ${index}.`);
    }
    if (character === ',') {
      commitField();
      endedWithRecordSeparator = false;
      index += 1;
      continue;
    }
    if (character === '\r' || character === '\n') {
      commitRow();
      index = consumeRecordSeparator(index, false);
      continue;
    }

    state = 'unquoted';
    field += character;
    endedWithRecordSeparator = false;
    index += 1;
  }

  if (state === 'quoted') {
    throw new Error('Invalid RFC 4180 CSV: unterminated quoted field.');
  }
  if (!endedWithRecordSeparator) {
    commitField();
    rows.push(row);
  }
  return rows;
}

function normalizeToken(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .replace(/\s*\|\s*/g, '|')
    .trim();
}

function regexMatches(pattern: RegExp, value: string): boolean {
  const stableFlags = pattern.flags.replace(/[gy]/g, '');
  return new RegExp(pattern.source, stableFlags).test(value);
}

function containsToken(rows: string[][], token: string | RegExp): boolean {
  const rowText = rows.map((row) => row.map(normalizeToken).join(' '));
  if (typeof token === 'string') {
    const expected = normalizeToken(token).toLocaleLowerCase('en-GB');
    return rowText.some((value) => value.toLocaleLowerCase('en-GB').includes(expected));
  }
  return rowText.some((value) => regexMatches(token, value));
}

function containsSkuCount(rows: string[][], count: number): boolean {
  if (!Number.isSafeInteger(count) || count < 0) {
    return false;
  }
  const label = /\b(?:(?:measurement|campaign|hero)\s+)?sku(?:s|\s+count)?\b|\bnumber\s+of\s+skus?\b/i;
  const exactValue = new RegExp(`^(?:${count}|${count}\\s+(?:(?:measurement|campaign|hero)\\s+)?skus?)$`, 'i');
  const labelThenValue = new RegExp(`(?:${label.source})[\\s:=-]{0,24}\\b${count}\\b`, 'i');
  const valueThenLabel = new RegExp(`\\b${count}\\b[\\s:=-]{0,24}(?:${label.source})`, 'i');

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex].map(normalizeToken);
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const cell = row[columnIndex];
      if (regexMatches(labelThenValue, cell) || regexMatches(valueThenLabel, cell)) {
        return true;
      }
      if (!regexMatches(label, cell)) {
        continue;
      }
      const adjacentValues = [row[columnIndex - 1], row[columnIndex + 1]].filter(
        (candidate): candidate is string => candidate !== undefined
      );
      if (adjacentValues.some((candidate) => regexMatches(exactValue, candidate))) {
        return true;
      }
      const nextRowValue = rows[rowIndex + 1]?.[columnIndex];
      if (nextRowValue !== undefined && regexMatches(exactValue, normalizeToken(nextRowValue))) {
        return true;
      }
    }
  }
  return false;
}

function failedContentChecks(): CsvContentChecks {
  return {
    parsedRfc4180: false,
    nonEmptyRows: false,
    rectangularRows: false,
    tokens: {
      advertiser: false,
      brand: false,
      objective: false,
      channel: false,
      budget: false,
      skuCount: false
    }
  };
}

export function inspectCsvContent(input: string, expected: CsvExportExpectations): CsvContentInspection {
  let rows: string[][];
  try {
    rows = parseRfc4180(input);
  } catch {
    return {
      checks: failedContentChecks(),
      rowCount: 0,
      columnCount: 0,
      diagnosticCode: 'invalid-rfc4180'
    };
  }

  const columnCount = rows[0]?.length ?? 0;
  const nonEmptyRows = rows.length > 0 && rows.every((candidate) => candidate.some((cell) => cell.trim().length > 0));
  const rectangularRows =
    rows.length > 0 && columnCount > 0 && rows.every((candidate) => candidate.length === columnCount);

  return {
    checks: {
      parsedRfc4180: true,
      nonEmptyRows,
      rectangularRows,
      tokens: {
        advertiser: containsToken(rows, expected.advertiser),
        brand: containsToken(rows, expected.brand),
        objective: containsToken(rows, expected.objective),
        channel: containsToken(rows, expected.channel),
        budget: expected.budget.some((token) => containsToken(rows, token)),
        skuCount: containsSkuCount(rows, expected.skuCount)
      }
    },
    rowCount: rows.length,
    columnCount,
    diagnosticCode: 'none'
  };
}

function failedDownloadInspection(
  csvFilename: boolean,
  byteLength: number,
  diagnosticCode: CsvDownloadInspection['diagnosticCode'],
  utf8Readable = false
): CsvDownloadInspection {
  return {
    checks: {
      downloadSucceeded: false,
      csvFilename,
      utf8Readable,
      ...failedContentChecks()
    },
    rowCount: 0,
    columnCount: 0,
    byteLength,
    diagnosticCode
  };
}

export async function inspectCsvDownload(
  download: Download,
  expected: CsvExportExpectations
): Promise<CsvDownloadInspection> {
  const csvFilename = /\.csv$/i.test(download.suggestedFilename());
  let downloadFailure: string | null;
  try {
    downloadFailure = await download.failure();
  } catch {
    return failedDownloadInspection(csvFilename, 0, 'download-failed');
  }
  if (downloadFailure !== null) {
    return failedDownloadInspection(csvFilename, 0, 'download-failed');
  }

  let stream;
  try {
    stream = await download.createReadStream();
  } catch {
    return failedDownloadInspection(csvFilename, 0, 'stream-unavailable');
  }
  if (!stream) {
    return failedDownloadInspection(csvFilename, 0, 'stream-unavailable');
  }

  const chunks: Buffer[] = [];
  let byteLength = 0;
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      byteLength += buffer.byteLength;
      if (byteLength > MAX_CSV_BYTES) {
        stream.destroy();
        return failedDownloadInspection(csvFilename, byteLength, 'size-limit-exceeded');
      }
      chunks.push(buffer);
    }
  } catch {
    return failedDownloadInspection(csvFilename, byteLength, 'stream-unavailable');
  }

  let content: string;
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    return failedDownloadInspection(csvFilename, byteLength, 'invalid-utf8');
  }

  const contentInspection = inspectCsvContent(content, expected);
  if (contentInspection.diagnosticCode !== 'none') {
    return failedDownloadInspection(csvFilename, byteLength, 'invalid-rfc4180', true);
  }

  return {
    checks: {
      downloadSucceeded: true,
      csvFilename,
      utf8Readable: true,
      ...contentInspection.checks
    },
    rowCount: contentInspection.rowCount,
    columnCount: contentInspection.columnCount,
    byteLength,
    diagnosticCode: 'none'
  };
}
