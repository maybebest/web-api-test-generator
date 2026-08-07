import { Readable } from 'node:stream';

import type { Download } from '@playwright/test';

import { expect, test } from '../../fixtures/test';
import {
  inspectCsvContent,
  inspectCsvDownload,
  parseRfc4180,
  type CsvExportExpectations
} from '../../fixtures/csv-export';

const expectedPlan: CsvExportExpectations = {
  advertiser: 'N360_Unilever_MS',
  brand: 'Unilever | Knorr | MS',
  objective: 'Customer retention',
  channel: 'Meta',
  budget: [/\b7k\b/i, /(?<!\d)(?:£\s*)?7(?:[,\s]?000)(?:\.0{1,2})?(?!\d)/i],
  skuCount: 1
};

test('RFC 4180 parser preserves quoted commas, escaped quotes, embedded newlines and empty fields', () => {
  const csv = '\uFEFFName,Notes,Optional\r\n"Knorr, UK","Line 1\r\nLine 2 with ""quotes""",\r\n';

  expect(parseRfc4180(csv)).toEqual([
    ['Name', 'Notes', 'Optional'],
    ['Knorr, UK', 'Line 1\nLine 2 with "quotes"', '']
  ]);
});

test('RFC 4180 parser rejects malformed quoting and lone carriage returns', () => {
  expect(() => parseRfc4180('a,"unterminated')).toThrow(/unterminated quoted field/i);
  expect(() => parseRfc4180('a,b"c')).toThrow(/quote inside an unquoted field/i);
  expect(() => parseRfc4180('"a" trailing,b')).toThrow(/unexpected character after closing quote/i);
  expect(() => parseRfc4180('a,b\rc,d')).toThrow(/lone carriage return/i);
});

test('CSV inspection is layout-independent while requiring rectangular non-empty rows and plan tokens', () => {
  const csv = [
    'Advertiser,Brand,Objective,Channel,Budget,Measurement SKUs',
    'N360_Unilever_MS,"Unilever | Knorr | MS",Customer retention,Meta,"£7,000.00",1'
  ].join('\r\n');

  const inspection = inspectCsvContent(csv, expectedPlan);

  expect(inspection).toEqual({
    checks: {
      parsedRfc4180: true,
      nonEmptyRows: true,
      rectangularRows: true,
      tokens: {
        advertiser: true,
        brand: true,
        objective: true,
        channel: true,
        budget: true,
        skuCount: true
      }
    },
    rowCount: 2,
    columnCount: 6,
    diagnosticCode: 'none'
  });
});

test('download inspection waits for a successful CSV stream and validates its decoded content', async () => {
  const csv = [
    'Advertiser,Brand,Objective,Channel,Budget,Measurement SKUs',
    'N360_Unilever_MS,"Unilever | Knorr | MS",Customer retention,Meta,7k,1'
  ].join('\n');
  const download = {
    suggestedFilename: () => 'saved-plan.CSV',
    failure: async () => null,
    createReadStream: async () => Readable.from([Buffer.from(csv, 'utf8')])
  } as unknown as Download;

  const inspection = await inspectCsvDownload(download, expectedPlan);

  expect(inspection.checks).toEqual({
    downloadSucceeded: true,
    csvFilename: true,
    utf8Readable: true,
    parsedRfc4180: true,
    nonEmptyRows: true,
    rectangularRows: true,
    tokens: {
      advertiser: true,
      brand: true,
      objective: true,
      channel: true,
      budget: true,
      skuCount: true
    }
  });
  expect(inspection.byteLength).toBe(Buffer.byteLength(csv));
  expect(inspection.diagnosticCode).toBe('none');
});

test('CSV inspection reports malformed, empty, ragged and missing-token content without exposing raw data', () => {
  expect(inspectCsvContent('"unterminated', expectedPlan)).toEqual({
    checks: {
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
    },
    rowCount: 0,
    columnCount: 0,
    diagnosticCode: 'invalid-rfc4180'
  });

  const ragged = inspectCsvContent('Header A,Header B\r\nvalue\r\n,', expectedPlan);
  expect(ragged.checks.nonEmptyRows).toBe(false);
  expect(ragged.checks.rectangularRows).toBe(false);
  expect(Object.values(ragged.checks.tokens)).toEqual([false, false, false, false, false, false]);

  const unrelatedOne = inspectCsvContent('Measurement SKUs,Other\r\n,1', expectedPlan);
  expect(unrelatedOne.checks.tokens.skuCount).toBe(false);

  const wrongBudget = inspectCsvContent('Budget,Measurement SKUs\r\n17000,1', expectedPlan);
  expect(wrongBudget.checks.tokens.budget).toBe(false);
});
