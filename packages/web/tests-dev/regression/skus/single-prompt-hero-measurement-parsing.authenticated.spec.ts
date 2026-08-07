// Spec-bound header: sha256 is the behavioral hash of the spec (computed via
// scripts/ai/lib/spec-parser.mjs specSha256). Re-stamp with `npm run ai:spec:drift`
// if the spec's behavioral sections change.
/* spec: specs/skus/single-prompt-hero-measurement-parsing.md version:2.0.0 sha256:13c4a16523d2dc886287c8975fddd83bed146dd5e2f9407a91aa023c78484840 */
import { test, expect } from '../../../fixtures/test';
import type { TestDataManager } from '../../../fixtures/test-data-manager';
import { buildToObjective, nectarData } from '../../../pages/NectarFlow';
import { PlanningPage } from '../../../pages/PlanningPage';
import { SinglePromptParseComponent, type ParseSurface } from '../../../pages/SinglePromptParseComponent';

// All 18 spec Data Cases are emitted as live journey tests. The spec's abstract SKU
// ids 1..9 are resolved AT RUNTIME to the first nine real brand-linked catalogue SKUs
// (dataManager.listBrandLinkedSkus for the fixture brand), so the prompts never rot
// with catalogue changes: prompt/pattern templates reference them as {1}..{9}.
//
// Live UI contracts reused from the proven SKU suites:
//   - summary counters concatenate rows without whitespace, so counts are matched with
//     a digit-lookbehind regex ("(?<!\d)6 SKUs?") and never with toHaveText;
//   - an empty counter renders "To be defined";
//   - the standard two-step flow's hero stage renders "Add hero SKU" controls.

type ParseSignal = {
  surface: ParseSurface;
  // RegExp source; {n} placeholders are substituted with the runtime SKU pool ids.
  pattern: string;
};

type CaseAction =
  | { kind: 'prompt'; template: string }
  | { kind: 'confirm-parsed' }
  | { kind: 'confirm-measurement' }
  | { kind: 'open-hero-modal' }
  | { kind: 'remove-hero-sku'; index: number }
  | { kind: 'confirm-modal' };

// One journey through the guided planner: fresh plan -> SKU-stage prompt(s) ->
// per-variant expected signals. Multi-variant rows (equivalence/decision-table
// cases) drive one fresh journey per variant.
type CaseVariant = {
  actions: CaseAction[];
  contains: ParseSignal[];
  absent: ParseSignal[];
};

type ParseDataCase = {
  caseId: string;
  sourceId: string;
  title: string;
  timeoutMs: number;
  expected: { variants: CaseVariant[] };
};

const PRM001_PROMPT = '{1}, {2}, {3}, {4} and hero skus {3}, {5}, {6}';

// Digit-lookbehind counter pattern (live DOM contract: "12 SKUs" must not satisfy "2 SKUs").
const skuCount = (count: number): string => `(?<!\\d)${count} SKUs?`;
const EMPTY_COUNTER = 'To be defined';
const HERO_STEP_LABEL = 'Add hero SKU';

// The prompts use abstract ids {1}..{9}; the pool must cover all of them.
const PROMPT_SKU_POOL_SIZE = 9;

// Resolve the nine real catalogue SKUs the prompts reference and verify (via the
// spec-mandated dataManager.ensureBrandLinkedSkus precondition helper, which fails
// closed on an unlinked SKU) that every one of them is linked to the fixture brand.
const resolvePromptSkuPool = async (dataManager: TestDataManager): Promise<string[]> => {
  const linked = await dataManager.listBrandLinkedSkus(nectarData.brand);
  if (linked.length < PROMPT_SKU_POOL_SIZE) {
    throw new Error(
      `Brand "${nectarData.brand}" has only ${linked.length} linked SKUs; the single-prompt cases need ${PROMPT_SKU_POOL_SIZE}.`
    );
  }
  const pool = linked.slice(0, PROMPT_SKU_POOL_SIZE);
  await dataManager.ensureBrandLinkedSkus(nectarData.brand, pool);
  return pool;
};

const resolveSku = (index: number, skuPool: string[]): string => {
  const sku = skuPool[index - 1];
  if (!sku) {
    throw new Error(`Abstract SKU id {${index}} is outside the resolved pool of ${skuPool.length} brand-linked SKUs.`);
  }
  return sku;
};

// Substitute {n} placeholders with the runtime catalogue SKU ids.
const resolveTemplate = (template: string, skuPool: string[]): string =>
  template.replace(/\{(\d+)\}/g, (_match, digits: string) => resolveSku(Number(digits), skuPool));

const resolvePattern = (pattern: string, skuPool: string[]): RegExp => new RegExp(resolveTemplate(pattern, skuPool));

async function performAction(planningPage: PlanningPage, action: CaseAction, skuPool: string[]): Promise<void> {
  switch (action.kind) {
    case 'prompt':
      await planningPage.sendChatMessage(resolveTemplate(action.template, skuPool));
      await planningPage.waitForAssistantIdle();
      return;
    case 'confirm-parsed':
      // Commit the parsed single-prompt selection via the active chat-stage Confirm.
      await planningPage.confirmPlan();
      await planningPage.waitForAssistantIdle();
      return;
    case 'confirm-measurement':
      // Standard two-step flow: commit Measurement SKUs and wait for the hero stage.
      await planningPage.confirmMeasurementSkus();
      return;
    case 'open-hero-modal':
      await planningPage.openHeroEditModal();
      return;
    case 'remove-hero-sku':
      await planningPage.modalRemoveSku(resolveSku(action.index, skuPool)).click();
      return;
    case 'confirm-modal':
      await planningPage.editModalConfirm().click();
      await planningPage.editSkuModal().waitFor({ state: 'hidden', timeout: 30_000 });
      return;
  }
}

// Drive one fresh guided journey (advertiser + brand + objective) to the SKU stage,
// then execute the variant's prompt/confirm/modal actions.
async function runVariantJourney(planningPage: PlanningPage, variant: CaseVariant, skuPool: string[]): Promise<void> {
  await buildToObjective(planningPage);
  for (const action of variant.actions) {
    await performAction(planningPage, action, skuPool);
  }
}

// --- Data cases: recognition/routing rows asserted under AC-004 -------------------
const recognitionCases: ParseDataCase[] = [
  {
    caseId: 'DC-002',
    sourceId: 'TC-PRM-002',
    title: 'recognized single prompt bypasses the two-step Measurement/Hero selection tables',
    timeoutMs: 480_000,
    expected: {
      variants: [
        {
          actions: [{ kind: 'prompt', template: PRM001_PROMPT }, { kind: 'confirm-parsed' }],
          contains: [
            { surface: 'measurement-count', pattern: skuCount(6) },
            { surface: 'hero-count', pattern: skuCount(3) }
          ],
          absent: [{ surface: 'hero-step', pattern: HERO_STEP_LABEL }]
        }
      ]
    }
  },
  {
    caseId: 'DC-005',
    sourceId: 'TC-PRM-005',
    title: 'Measurement-only prompt falls back to the standard two-step flow',
    timeoutMs: 480_000,
    expected: {
      variants: [
        {
          actions: [{ kind: 'prompt', template: '{1}, {2}, {3}, {4}' }, { kind: 'confirm-measurement' }],
          contains: [
            { surface: 'hero-step', pattern: HERO_STEP_LABEL },
            { surface: 'measurement-count', pattern: skuCount(4) },
            { surface: 'hero-count', pattern: EMPTY_COUNTER }
          ],
          absent: []
        }
      ]
    }
  },
  {
    caseId: 'DC-012',
    sourceId: 'TC-PRM-012',
    title: 'dangling hero keyword: Measurement parsed, no Hero entry created',
    timeoutMs: 480_000,
    expected: {
      variants: [
        {
          actions: [{ kind: 'prompt', template: '{1}, {2}, {3} and hero skus' }, { kind: 'confirm-measurement' }],
          contains: [
            { surface: 'hero-step', pattern: HERO_STEP_LABEL },
            { surface: 'measurement-count', pattern: skuCount(3) },
            { surface: 'hero-count', pattern: EMPTY_COUNTER }
          ],
          absent: []
        }
      ]
    }
  },
  {
    caseId: 'DC-016',
    sourceId: 'TC-PRM-016',
    title: 'clause order equivalence: hero-first prompt parses identically to the forward prompt',
    timeoutMs: 960_000,
    expected: {
      variants: [
        {
          actions: [{ kind: 'prompt', template: PRM001_PROMPT }, { kind: 'confirm-parsed' }],
          contains: [
            { surface: 'measurement-count', pattern: skuCount(6) },
            { surface: 'hero-count', pattern: skuCount(3) }
          ],
          absent: []
        },
        {
          actions: [
            { kind: 'prompt', template: 'hero skus {3}, {5}, {6} and {1}, {2}, {3}, {4}' },
            { kind: 'confirm-parsed' }
          ],
          contains: [
            { surface: 'measurement-count', pattern: skuCount(6) },
            { surface: 'hero-count', pattern: skuCount(3) }
          ],
          absent: []
        }
      ]
    }
  },
  {
    caseId: 'DC-017',
    sourceId: 'TC-PRM-017',
    title: 'hero keyword with no SKU ids fabricates no Measurement or Hero selection',
    timeoutMs: 480_000,
    expected: {
      variants: [
        {
          actions: [{ kind: 'prompt', template: 'please add some hero skus for me' }],
          contains: [
            { surface: 'measurement-count', pattern: EMPTY_COUNTER },
            { surface: 'hero-count', pattern: EMPTY_COUNTER }
          ],
          absent: []
        }
      ]
    }
  }
];

// --- Data cases: applied-state rows asserted under AC-005 -------------------------
const applyCases: ParseDataCase[] = [
  {
    caseId: 'DC-009',
    sourceId: 'TC-PRM-009',
    title: 'confirmed parse persists hero flags: summary reflects 6 Measurements with 3 Heroes',
    timeoutMs: 480_000,
    expected: {
      variants: [
        {
          actions: [{ kind: 'prompt', template: PRM001_PROMPT }, { kind: 'confirm-parsed' }],
          contains: [
            { surface: 'measurement-count', pattern: skuCount(6) },
            { surface: 'hero-count', pattern: skuCount(3) }
          ],
          absent: []
        }
      ]
    }
  },
  {
    caseId: 'DC-010',
    sourceId: 'TC-PRM-010',
    title: 'follow-up prompt extends the applied selection without restarting the flow',
    timeoutMs: 600_000,
    expected: {
      variants: [
        {
          actions: [
            { kind: 'prompt', template: PRM001_PROMPT },
            { kind: 'confirm-parsed' },
            { kind: 'prompt', template: 'add {7}, {8} and hero skus {8}' }
          ],
          contains: [
            { surface: 'measurement-count', pattern: skuCount(8) },
            { surface: 'hero-count', pattern: skuCount(4) }
          ],
          absent: []
        }
      ]
    }
  }
];

// --- Data cases: set-equality rows asserted under AC-006 --------------------------
const equalityCases: ParseDataCase[] = [
  {
    caseId: 'DC-001',
    sourceId: 'TC-PRM-001',
    title: 'hero list extending the typed Measurement list auto-adds: 6 Measurements, 3 Heroes',
    timeoutMs: 480_000,
    expected: {
      variants: [
        {
          actions: [{ kind: 'prompt', template: PRM001_PROMPT }, { kind: 'confirm-parsed' }],
          contains: [
            { surface: 'measurement-count', pattern: skuCount(6) },
            { surface: 'hero-count', pattern: skuCount(3) }
          ],
          absent: []
        }
      ]
    }
  },
  {
    caseId: 'DC-003',
    sourceId: 'TC-PRM-003',
    title: 'hero strict subset of typed Measurement: no auto-add, 4 Measurements, 1 Hero',
    timeoutMs: 480_000,
    expected: {
      variants: [
        {
          actions: [{ kind: 'prompt', template: '{1}, {2}, {3}, {4} and hero skus {3}' }, { kind: 'confirm-parsed' }],
          contains: [
            { surface: 'measurement-count', pattern: skuCount(4) },
            { surface: 'hero-count', pattern: skuCount(1) }
          ],
          absent: []
        }
      ]
    }
  },
  {
    caseId: 'DC-004',
    sourceId: 'TC-PRM-004',
    title: 'disjoint hero list is unioned into Measurement: 4 Measurements, 2 Heroes',
    timeoutMs: 480_000,
    expected: {
      variants: [
        {
          actions: [{ kind: 'prompt', template: '{1}, {2} and hero skus {7}, {8}' }, { kind: 'confirm-parsed' }],
          contains: [
            { surface: 'measurement-count', pattern: skuCount(4) },
            { surface: 'hero-count', pattern: skuCount(2) }
          ],
          absent: []
        }
      ]
    }
  },
  {
    caseId: 'DC-006',
    sourceId: 'TC-PRM-006',
    title: 'casing and separator variants of the hero keyword parse equivalently',
    timeoutMs: 1_440_000,
    expected: {
      variants: [
        {
          actions: [
            { kind: 'prompt', template: '{1}, {2}, {3}, {4} and HERO SKUS {3}, {5}, {6}' },
            { kind: 'confirm-parsed' }
          ],
          contains: [
            { surface: 'measurement-count', pattern: skuCount(6) },
            { surface: 'hero-count', pattern: skuCount(3) }
          ],
          absent: []
        },
        {
          actions: [
            { kind: 'prompt', template: '{1}, {2}, {3}, {4} and Hero SKUs: {3}, {5}, {6}' },
            { kind: 'confirm-parsed' }
          ],
          contains: [
            { surface: 'measurement-count', pattern: skuCount(6) },
            { surface: 'hero-count', pattern: skuCount(3) }
          ],
          absent: []
        },
        {
          actions: [
            { kind: 'prompt', template: '{1} {2} {3} {4} and hero skus {3} {5} {6}' },
            { kind: 'confirm-parsed' }
          ],
          contains: [
            { surface: 'measurement-count', pattern: skuCount(6) },
            { surface: 'hero-count', pattern: skuCount(3) }
          ],
          absent: []
        }
      ]
    }
  },
  {
    caseId: 'DC-007',
    sourceId: 'TC-PRM-007',
    title: 'duplicate ids within and across lists dedupe to 5 Measurements and 3 Heroes',
    timeoutMs: 480_000,
    expected: {
      variants: [
        {
          actions: [
            { kind: 'prompt', template: '{1}, {2}, {2}, {3}, {3} and hero skus {3}, {3}, {5}, {5}, {6}' },
            { kind: 'confirm-parsed' }
          ],
          contains: [
            { surface: 'measurement-count', pattern: skuCount(5) },
            { surface: 'hero-count', pattern: skuCount(3) }
          ],
          absent: []
        }
      ]
    }
  },
  {
    caseId: 'DC-008',
    sourceId: 'TC-PRM-008',
    title: 'invalid hero id 99999 is never silently added: 3 Measurements, 1 Hero',
    timeoutMs: 480_000,
    expected: {
      variants: [
        {
          actions: [
            { kind: 'prompt', template: '{1}, {2}, {3} and hero skus {3}, 99999' },
            { kind: 'confirm-parsed' }
          ],
          contains: [
            { surface: 'measurement-count', pattern: skuCount(3) },
            { surface: 'hero-count', pattern: skuCount(1) }
          ],
          absent: []
        }
      ]
    }
  },
  {
    caseId: 'DC-011',
    sourceId: 'TC-PRM-011',
    title: 'boundary: a single SKU declared in both roles yields 1 Measurement and 1 Hero',
    timeoutMs: 480_000,
    expected: {
      variants: [
        {
          actions: [{ kind: 'prompt', template: '{1} and hero skus {1}' }, { kind: 'confirm-parsed' }],
          contains: [
            { surface: 'measurement-count', pattern: skuCount(1) },
            { surface: 'hero-count', pattern: skuCount(1) }
          ],
          absent: []
        }
      ]
    }
  },
  {
    caseId: 'DC-013',
    sourceId: 'TC-PRM-013',
    title: 'decision table: subset, extension, disjoint and measurement-only prompts',
    timeoutMs: 1_920_000,
    expected: {
      variants: [
        {
          actions: [{ kind: 'prompt', template: '{1}, {2}, {3} and hero skus {2}' }, { kind: 'confirm-parsed' }],
          contains: [
            { surface: 'measurement-count', pattern: skuCount(3) },
            { surface: 'hero-count', pattern: skuCount(1) }
          ],
          absent: []
        },
        {
          actions: [
            { kind: 'prompt', template: '{1}, {2}, {3} and hero skus {3}, {4}, {5}' },
            { kind: 'confirm-parsed' }
          ],
          contains: [
            { surface: 'measurement-count', pattern: skuCount(5) },
            { surface: 'hero-count', pattern: skuCount(3) }
          ],
          absent: []
        },
        {
          actions: [{ kind: 'prompt', template: '{1}, {2} and hero skus {6}, {7}' }, { kind: 'confirm-parsed' }],
          contains: [
            { surface: 'measurement-count', pattern: skuCount(4) },
            { surface: 'hero-count', pattern: skuCount(2) }
          ],
          absent: []
        },
        {
          actions: [{ kind: 'prompt', template: '{1}, {2}, {3}' }, { kind: 'confirm-measurement' }],
          contains: [
            { surface: 'hero-step', pattern: HERO_STEP_LABEL },
            { surface: 'measurement-count', pattern: skuCount(3) },
            { surface: 'hero-count', pattern: EMPTY_COUNTER }
          ],
          absent: []
        }
      ]
    }
  },
  {
    caseId: 'DC-014',
    sourceId: 'TC-PRM-014',
    title: 'hero edit modal opened from the parsed summary lists the assigned Hero SKUs',
    timeoutMs: 600_000,
    expected: {
      variants: [
        {
          actions: [
            { kind: 'prompt', template: PRM001_PROMPT },
            { kind: 'confirm-parsed' },
            { kind: 'open-hero-modal' }
          ],
          contains: [
            { surface: 'edit-modal', pattern: '{3}' },
            { surface: 'edit-modal', pattern: '{5}' },
            { surface: 'edit-modal', pattern: '{6}' }
          ],
          absent: []
        }
      ]
    }
  },
  {
    caseId: 'DC-015',
    sourceId: 'TC-PRM-015',
    title: 'unassigning a parsed Hero recomputes the Hero count and keeps the Measurement row',
    timeoutMs: 600_000,
    expected: {
      variants: [
        {
          actions: [
            { kind: 'prompt', template: PRM001_PROMPT },
            { kind: 'confirm-parsed' },
            { kind: 'open-hero-modal' },
            { kind: 'remove-hero-sku', index: 5 },
            { kind: 'confirm-modal' }
          ],
          contains: [
            { surface: 'hero-count', pattern: skuCount(2) },
            { surface: 'measurement-count', pattern: skuCount(6) }
          ],
          absent: []
        }
      ]
    }
  },
  {
    caseId: 'DC-018',
    sourceId: 'TC-PRM-018',
    title: 'fully overlapping lists: 3 Measurements all Hero-flagged, no auto-add growth',
    timeoutMs: 480_000,
    expected: {
      variants: [
        {
          actions: [
            { kind: 'prompt', template: '{1}, {2}, {3} and hero skus {1}, {2}, {3}' },
            { kind: 'confirm-parsed' }
          ],
          contains: [
            { surface: 'measurement-count', pattern: skuCount(3) },
            { surface: 'hero-count', pattern: skuCount(3) }
          ],
          absent: []
        }
      ]
    }
  }
];

// Spec Stability Requirements declare Parallel Safe = no, so the suite runs serially:
// every test drives a fresh live conversational plan against the shared dev catalogue.
test.describe.serial('Single-prompt Hero and Measurement recognition and parsing', () => {
  test(
    'AC-001 single-prompt-hero-measurement-parsing guided flow entry',
    {
      tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@single-prompt-hero-measurement-parsing']
    },
    async ({ page }) => {
      test.setTimeout(240_000);
      const planningPage = new PlanningPage(page);

      await test.step('walk the planner entry path', async () => {
        await planningPage.goto();
        await planningPage.startNectarAiPlanner();
      });

      await test.step('Assert AC-001: the guided objective-and-budget flow is active', async () => {
        await expect(planningPage.buildByObjectiveButton()).toBeVisible();
      });
    }
  );

  test(
    'AC-002 the catalogue supplies the brand-linked SKUs the prompts reference',
    {
      tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@single-prompt-hero-measurement-parsing']
    },
    async ({ dataManager }) => {
      test.setTimeout(240_000);

      await test.step('seed and verify the prompt SKU pool via the dataManager precondition helper', async () => {
        await resolvePromptSkuPool(dataManager);
      });

      await test.step('Assert AC-002: the brand catalogue resolves every SKU the prompts name', async () => {
        await expect
          .poll(async () => (await dataManager.listBrandLinkedSkus(nectarData.brand)).length, { timeout: 60_000 })
          .toBeGreaterThanOrEqual(PROMPT_SKU_POOL_SIZE);
      });
    }
  );

  test(
    'AC-003 advertiser and brand selection lands on the summary panel',
    {
      tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@single-prompt-hero-measurement-parsing']
    },
    async ({ page }) => {
      test.setTimeout(240_000);
      const planningPage = new PlanningPage(page);

      await test.step('walk the guided flow through advertiser and brand confirmation', async () => {
        await planningPage.goto();
        await planningPage.startNectarAiPlanner();
        await planningPage.chooseBuildByObjectiveAndBudget();
        await planningPage.selectAdvertiser(nectarData.advertiser);
        await planningPage.selectBrand(nectarData.brand);
        await planningPage.confirmAdvertiserAndBrand();
      });

      await test.step('Assert AC-003: the summary panel shows the confirmed advertiser and brand', async () => {
        await expect(planningPage.summaryAdvertiser()).toContainText(nectarData.advertiser);
        await expect(planningPage.summaryBrands()).toContainText(nectarData.brand);
      });
    }
  );

  for (const dataCase of recognitionCases) {
    test(
      `${dataCase.caseId} ${dataCase.sourceId} ${dataCase.title}`,
      {
        tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@single-prompt-hero-measurement-parsing']
      },
      async ({ page, dataManager }) => {
        test.setTimeout(dataCase.timeoutMs);
        const planningPage = new PlanningPage(page);
        const parseComponent = new SinglePromptParseComponent(page);
        const skuPool: string[] = [];

        await test.step('resolve the real brand-linked SKU pool the prompts reference', async () => {
          skuPool.push(...(await resolvePromptSkuPool(dataManager)));
        });

        await test.step('Assert AC-004: the assistant parses the single prompt into Measurement and Hero sets', async () => {
          for (const variant of dataCase.expected.variants) {
            await runVariantJourney(planningPage, variant, skuPool);
            for (const signal of variant.contains) {
              await expect(parseComponent.surface(signal.surface)).toContainText(resolvePattern(signal.pattern, skuPool));
            }
            for (const signal of variant.absent) {
              await expect(parseComponent.surface(signal.surface)).not.toContainText(
                resolvePattern(signal.pattern, skuPool)
              );
            }
          }
        });
      }
    );
  }

  for (const dataCase of applyCases) {
    test(
      `${dataCase.caseId} ${dataCase.sourceId} ${dataCase.title}`,
      {
        tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@single-prompt-hero-measurement-parsing']
      },
      async ({ page, dataManager }) => {
        test.setTimeout(dataCase.timeoutMs);
        const planningPage = new PlanningPage(page);
        const parseComponent = new SinglePromptParseComponent(page);
        const skuPool: string[] = [];

        await test.step('resolve the real brand-linked SKU pool the prompts reference', async () => {
          skuPool.push(...(await resolvePromptSkuPool(dataManager)));
        });

        await test.step('Assert AC-005: the parsed Measurement and Hero SKUs are applied to the plan summary', async () => {
          for (const variant of dataCase.expected.variants) {
            await runVariantJourney(planningPage, variant, skuPool);
            for (const signal of variant.contains) {
              await expect(parseComponent.surface(signal.surface)).toContainText(resolvePattern(signal.pattern, skuPool));
            }
            for (const signal of variant.absent) {
              await expect(parseComponent.surface(signal.surface)).not.toContainText(
                resolvePattern(signal.pattern, skuPool)
              );
            }
          }
        });
      }
    );
  }

  for (const dataCase of equalityCases) {
    test(
      `${dataCase.caseId} ${dataCase.sourceId} ${dataCase.title}`,
      {
        tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@single-prompt-hero-measurement-parsing']
      },
      async ({ page, dataManager }) => {
        test.setTimeout(dataCase.timeoutMs);
        const planningPage = new PlanningPage(page);
        const parseComponent = new SinglePromptParseComponent(page);
        const skuPool: string[] = [];

        await test.step('resolve the real brand-linked SKU pool the prompts reference', async () => {
          skuPool.push(...(await resolvePromptSkuPool(dataManager)));
        });

        await test.step('Assert AC-006: the Measurement and Hero sets equal the expected parse for the case', async () => {
          for (const variant of dataCase.expected.variants) {
            await runVariantJourney(planningPage, variant, skuPool);
            for (const signal of variant.contains) {
              await expect(parseComponent.surface(signal.surface)).toContainText(resolvePattern(signal.pattern, skuPool));
            }
            for (const signal of variant.absent) {
              await expect(parseComponent.surface(signal.surface)).not.toContainText(
                resolvePattern(signal.pattern, skuPool)
              );
            }
          }
        });
      }
    );
  }

  test(
    'NEG-001 a prompt naming a SKU not linked to the brand is not silently applied',
    {
      tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@single-prompt-hero-measurement-parsing']
    },
    async ({ page, dataManager }) => {
      test.setTimeout(480_000);
      const planningPage = new PlanningPage(page);
      const parseComponent = new SinglePromptParseComponent(page);
      const skuPool: string[] = [];

      await test.step('drive a fresh plan to the SKU stage and send the unknown-SKU prompt', async () => {
        skuPool.push(...(await resolvePromptSkuPool(dataManager)));
        await buildToObjective(planningPage);
        await planningPage.sendChatMessage(resolveTemplate('{1}, {2} and hero skus 9999999', skuPool));
        await planningPage.waitForAssistantIdle();
      });

      await test.step('Assert NEG-001: nothing is silently applied to the plan for the unrecognised SKU', async () => {
        // The unrecognised id must be surfaced for user review instead of being
        // silently committed: no Measurement or Hero selection lands in the summary
        // without an explicit confirmation of a valid selection.
        await expect(parseComponent.measurementCounter()).toContainText(EMPTY_COUNTER);
        await expect(parseComponent.heroCounter()).toContainText(EMPTY_COUNTER);
      });
    }
  );

  test(
    'NEG-002 a SKU listed as both Measurement and Hero is recognised in both roles',
    {
      tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@single-prompt-hero-measurement-parsing']
    },
    async ({ page, dataManager }) => {
      test.setTimeout(480_000);
      const planningPage = new PlanningPage(page);
      const parseComponent = new SinglePromptParseComponent(page);
      const skuPool: string[] = [];

      await test.step('send a prompt whose hero SKU is also a typed Measurement SKU and confirm it', async () => {
        skuPool.push(...(await resolvePromptSkuPool(dataManager)));
        await buildToObjective(planningPage);
        await planningPage.sendChatMessage(resolveTemplate('{1}, {2} and hero skus {2}', skuPool));
        await planningPage.waitForAssistantIdle();
        await planningPage.confirmPlan();
        await planningPage.waitForAssistantIdle();
      });

      await test.step('Assert NEG-002: the dual-role SKU is counted once in each role', async () => {
        await expect(parseComponent.measurementCounter()).toContainText(resolvePattern(skuCount(2), skuPool));
        await expect(parseComponent.heroCounter()).toContainText(resolvePattern(skuCount(1), skuPool));
      });
    }
  );
});
