import { test, expect } from '../../fixtures/test';
import {
  deleteChannel,
  editChannelHeroSkus,
  evaluateHeroLimit,
  parseHeroMeasurementPrompt,
  removeSkuFromEveryChannel,
  uniqueHeroSkus
} from '../../automation/src/sku-behavior-oracle';

test.describe('pending SKU-suite expected-value oracles', () => {
  test('single-prompt oracle normalizes variants, unions Hero SKUs and surfaces unknown IDs', async () => {
    const linked = ['1', '2', '3', '4', '5', '6'];
    const variants = [
      '1, 2, 3, 4 and hero skus 3, 5, 6',
      '1, 2, 3, 4 and HERO SKUS 3, 5, 6',
      '1 2 3 4 and Hero SKUs: 3 5 6',
      'hero skus 3, 5, 6 and 1, 2, 3, 4'
    ].map((prompt) => parseHeroMeasurementPrompt(prompt, linked));
    const unknown = parseHeroMeasurementPrompt('1, 2 and hero skus 2, 9999', linked);

    expect({ variants, unknown }).toEqual({
      variants: Array.from({ length: 4 }, () => ({
        recognizedSinglePrompt: true,
        measurementSkus: ['1', '2', '3', '4', '5', '6'],
        heroSkus: ['3', '5', '6'],
        unknownSkus: []
      })),
      unknown: {
        recognizedSinglePrompt: true,
        measurementSkus: ['1', '2', '9999'],
        heroSkus: ['2', '9999'],
        unknownSkus: ['9999']
      }
    });
  });

  test('single-prompt oracle rejects empty/one-sided grammar and deduplicates overlap', async () => {
    expect({
      measurementOnly: parseHeroMeasurementPrompt('measurement skus 1, 2, 9999', ['1', '2', '3']),
      emptyHero: parseHeroMeasurementPrompt('1, 2 and hero skus', ['1', '2']),
      fullOverlap: parseHeroMeasurementPrompt('1, 2, 2, 3 and hero skus 1, 2, 3', ['1', '2', '3'])
    }).toEqual({
      measurementOnly: {
        recognizedSinglePrompt: false,
        measurementSkus: ['1', '2', '9999'],
        heroSkus: [],
        unknownSkus: ['9999']
      },
      emptyHero: {
        recognizedSinglePrompt: false,
        measurementSkus: ['1', '2'],
        heroSkus: [],
        unknownSkus: []
      },
      fullOverlap: {
        recognizedSinglePrompt: true,
        measurementSkus: ['1', '2', '3'],
        heroSkus: ['1', '2', '3'],
        unknownSkus: []
      }
    });
  });

  test('maximum-Hero oracle covers below, equal, above, singleton and unbounded limits', async () => {
    expect({
      below: evaluateHeroLimit(2, 3),
      equal: evaluateHeroLimit(3, 3),
      above: evaluateHeroLimit(4, 3),
      singletonExceeded: evaluateHeroLimit(2, 1),
      unbounded: evaluateHeroLimit(50, null),
      belowMinimum: evaluateHeroLimit(1, 3, 2)
    }).toEqual({
      below: { withinMinimum: true, withinMaximum: true, bookable: true, warning: null },
      equal: { withinMinimum: true, withinMaximum: true, bookable: true, warning: null },
      above: {
        withinMinimum: true,
        withinMaximum: false,
        bookable: false,
        warning: 'Media limit: 3 Hero SKUs. Edit SKUs'
      },
      singletonExceeded: {
        withinMinimum: true,
        withinMaximum: false,
        bookable: false,
        warning: 'Media limit: 1 Hero SKUs. Edit SKUs'
      },
      unbounded: { withinMinimum: true, withinMaximum: true, bookable: true, warning: null },
      belowMinimum: { withinMinimum: false, withinMaximum: true, bookable: false, warning: null }
    });
  });

  test('channel oracle preserves isolation and recomputes shared and unique Hero SKUs', async () => {
    const initial = { Meta: ['6001', '6002'], Onsite: ['6001'] };
    const edited = editChannelHeroSkus(initial, 'Meta', ['6001', '6003']);
    const removedEverywhere = removeSkuFromEveryChannel(initial, '6001');
    const afterDelete = deleteChannel(initial, 'Meta');

    expect({
      initial,
      edited,
      editedUnique: uniqueHeroSkus(edited),
      removedEverywhere,
      removedUnique: uniqueHeroSkus(removedEverywhere),
      afterDelete,
      afterDeleteUnique: uniqueHeroSkus(afterDelete)
    }).toEqual({
      initial: { Meta: ['6001', '6002'], Onsite: ['6001'] },
      edited: { Meta: ['6001', '6003'], Onsite: ['6001'] },
      editedUnique: ['6001', '6003'],
      removedEverywhere: { Meta: ['6002'], Onsite: [] },
      removedUnique: ['6002'],
      afterDelete: { Onsite: ['6001'] },
      afterDeleteUnique: ['6001']
    });
  });

  test('SKU oracles reject invalid limits and unknown channel mutations', async () => {
    expect(() => evaluateHeroLimit(-1, 3)).toThrow('heroCount must be a non-negative safe integer');
    expect(() => evaluateHeroLimit(2, 1, 2)).toThrow('minHeroSkus cannot exceed maxHeroSkus');
    expect(() => editChannelHeroSkus({ Meta: ['1'] }, 'Onsite', ['2'])).toThrow('unknown channel: Onsite');
    expect(() => deleteChannel({ Meta: ['1'] }, 'Onsite')).toThrow('unknown channel: Onsite');
  });
});
