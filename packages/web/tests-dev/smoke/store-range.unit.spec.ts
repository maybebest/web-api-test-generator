import { test, expect } from '@playwright/test';
import { isStoreCountValid } from '../../data/store-range';

const rows = [
  { stores: 49, min: 50, max: 300, expected: false },
  { stores: 50, min: 50, max: 300, expected: true },
  { stores: 300, min: 50, max: 300, expected: true },
  { stores: 301, min: 50, max: 300, expected: false },
  { stores: 49, min: 50, max: null, expected: false },
  { stores: 100000, min: 50, max: null, expected: true },
  { stores: 1, min: null, max: 300, expected: true },
  { stores: 301, min: null, max: 300, expected: false },
  { stores: 1, min: null, max: null, expected: true },
  { stores: 0, min: 50, max: 300, expected: false }
] as const;

test('store-volume predicate handles two-sided, one-sided and unset bounds', () => {
  expect(rows.map((row) => isStoreCountValid(row.stores, row.min, row.max))).toEqual(
    rows.map((row) => row.expected)
  );
});
