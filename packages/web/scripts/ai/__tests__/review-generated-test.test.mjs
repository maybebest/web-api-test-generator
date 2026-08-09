import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { classifyGeneratedGateFailure } from '../lib/generated-gate-verdict.mjs';
import { buildGenerationRepairPrompt } from '../lib/generation-repair.mjs';
import { parseFlowSpec, specSha256 } from '../lib/spec-parser.mjs';
import { reviewGeneratedTest } from '../review-generated-test.mjs';
import { validateSpecDirectory, validateSpecFile } from '../validate-flow-spec.mjs';

const MEDIA_PLANNER_SCENARIO = `Scenario 4: Validate minimum campaign duration per channel
GIVEN a user is creating a media plan in Media Planner
AND the user selects a channel with a configured minimum campaign duration
WHEN the user enters a campaign start and end date
THEN the system must:
- Calculate the campaign duration
- Check if the duration meets or exceeds the minimum required for that channel
AND If the duration is too short, block the user from proceeding and display an error message indicating the minimum campaign duration for the channel (e.g., "The campaign duration for [Channel Name] must be at least [X] days.")`;

test('validator rejects acceptance criteria that are not mapped from flow steps', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace, {
    flowSteps: [
      '| 1 | AC-001 | Open page | /checkout | n/a | Checkout page is visible | heading is visible |',
      '| 2 | AC-003 | Submit | Submit button | n/a | Confirmation visible | heading visible |',
      '| 3 | AC-003 | Verify | Confirmation | n/a | Request ID visible | text visible |'
    ]
  });

  const result = validateSpecFile(specPath);

  assert.equal(result.valid, false);
  assert.match(result.issues.join('\n'), /AC-002 is not mapped/);
});

test('validator rejects bogus stability values, variants header, and includes', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace, {
    stability: ['| Parallel Safe | maybe |', '| Data Isolation | random |', '| Allowed Retries | high |'],
    variants: { header: ['Country', 'Tier'], rows: [['en', 'gold']] },
    includes: ['FLOW-DOES-NOT-EXIST-999', 'free-form text']
  });

  const result = validateSpecFile(specPath);

  assert.equal(result.valid, false);
  const joined = result.issues.join('\n');
  assert.match(joined, /Parallel Safe/);
  assert.match(joined, /Data Isolation/);
  assert.match(joined, /Allowed Retries/);
  assert.match(joined, /Variants header must be Locale \| Role \| Plan/);
  assert.match(joined, /Includes entry must be "none" or a Flow ID/);
});

test('validator authorizes a complete contract without review or sign-off metadata', () => {
  const result = validateSpecFile(writeSpec(createWorkspace()));

  assert.equal(result.valid, true, result.issues.join('\n'));
});

test('validator rejects duplicate machine-consumed metadata fields', () => {
  const duplicate = validateSpecFile(
    writeSpec(createWorkspace(), { metadataExtra: ['| Target Test File | tests/regression/other.spec.ts |'] })
  );
  assert.equal(duplicate.valid, false);
  assert.match(duplicate.issues.join('\n'), /Duplicate Metadata field\(s\) found: Target Test File/);
});

test('Markdown table parsing preserves escaped pipe characters inside cells', () => {
  const parsed = parseFlowSpec(`# Flow: escaped pipes

## Flow Steps

| Step | AC IDs | Action | Target | Input | Expected Result | Assertion Hint |
|---:|---|---|---|---|---|---|
| 1 | AC-001 | Choose product | planner | N360\\|Unilever | Knorr\\|MS | summary shows N360\\|Unilever |
`);

  assert.equal(parsed.flowSteps[0].input, 'N360|Unilever');
  assert.equal(parsed.flowSteps[0].expectedResult, 'Knorr|MS');
  assert.equal(parsed.flowSteps[0].assertionHint, 'summary shows N360|Unilever');
});

test('validator allows unresolved placeholders only in structural allow-draft mode', () => {
  const specPath = writeSpec(createWorkspace(), { owner: 'NEEDS_REVIEW' });

  const normal = validateSpecFile(specPath);
  assert.equal(normal.valid, false);
  assert.match(normal.issues.join('\n'), /NEEDS_REVIEW|placeholder/);

  const structural = validateSpecFile(specPath, { allowDraft: true });
  assert.equal(structural.valid, true, structural.issues.join('\n'));
});

test('validator rejects non-zero retry allowances', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace, {
    stability: ['| Parallel Safe | yes |', '| Data Isolation | per-test |', '| Allowed Retries | 1 |']
  });

  const result = validateSpecFile(specPath);
  assert.equal(result.valid, false);
  assert.match(result.issues.join('\n'), /Allowed Retries" must be 0/);
});

test('directory validation fails closed when no flow specs are present', () => {
  const workspace = createWorkspace();
  const result = validateSpecDirectory(workspace);

  assert.equal(result.valid, false);
  assert.match(result.issues.join('\n'), /zero-spec validation pass/);
});

test('validator --strict requires the target test file to exist', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);

  const lenient = validateSpecFile(specPath);
  assert.equal(lenient.valid, true, lenient.issues.join('\n'));

  const strict = validateSpecFile(specPath, { strict: true });
  assert.equal(strict.valid, false);
  assert.match(strict.issues.join('\n'), /Target Test File does not exist \(strict mode\)/);
});

test('manual importer creates business rules and JSON data cases for Media Planner duration scenario', () => {
  const workspace = createWorkspace();
  const specPath = path.join(workspace, 'media-planner-duration.draft.md');
  const result = spawnSync(
    process.execPath,
    [
      'scripts/ai/import-spec.mjs',
      '--text',
      MEDIA_PLANNER_SCENARIO,
      '--out',
      specPath,
      '--base-path',
      '/media-planner',
      '--auth',
      'required'
    ],
    { cwd: process.cwd(), encoding: 'utf8' }
  );

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const content = fs.readFileSync(specPath, 'utf8');
  assert.match(content, /## Business Rules/);
  assert.match(content, /## Data Cases as JSON/);
  assert.match(content, /below-minimum/);
  assert.match(content, /at-minimum/);
  assert.match(content, /above-minimum/);
  assert.match(content, /NEEDS_REVIEW: Channel Name/);
  assert.match(content, /NEEDS_REVIEW: X/);
  const acceptanceCriteria = content.match(/## Acceptance Criteria\n\n([\s\S]*?)\n\n## Locator Hints/)?.[1] ?? '';
  assert.doesNotMatch(acceptanceCriteria, /selects a channel with a configured minimum campaign duration/);

  const draftValidation = validateSpecFile(specPath, { allowDraft: true });
  assert.equal(draftValidation.valid, true, draftValidation.issues.join('\n'));

  const strictValidation = validateSpecFile(specPath);
  assert.equal(strictValidation.valid, false);
  assert.match(strictValidation.issues.join('\n'), /NEEDS_REVIEW/);
});

test('validator rejects duration specs without below equal and above boundaries', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace, {
    businessRulesRows: [
      '| RULE-001 | Validate configured campaign duration rule | inclusiveDays = endDate - startDate + 1 | Block progression below minimum |'
    ],
    dataCasesRows: [
      '| DC-001 | boundary=below-minimum; channelName=YouTube; minDurationDays=7 | blocked with YouTube minimum duration message | Missing equal and above boundaries |'
    ],
    dataCasesJson: [
      {
        caseId: 'DC-001',
        inputs: { boundary: 'below-minimum', channelName: 'YouTube', minDurationDays: 7 },
        expected: { result: 'blocked', message: 'The campaign duration for YouTube must be at least 7 days.' },
        notes: 'Missing equal and above boundaries'
      }
    ]
  });

  const result = validateSpecFile(specPath);

  assert.equal(result.valid, false);
  const joined = result.issues.join('\n');
  assert.match(joined, /at-minimum/);
  assert.match(joined, /above-minimum/);
});

test('validator rejects malformed Data Cases as JSON', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace, {
    dataCasesJsonBlock: 'not-json'
  });

  const result = validateSpecFile(specPath);

  assert.equal(result.valid, false);
  assert.match(result.issues.join('\n'), /Data Cases as JSON is not valid JSON/);
});

test('reviewer rejects AC IDs that only appear in comments', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const testPath = writeGeneratedTest(workspace, specPath, `
import { test, expect } from '../../fixtures/test';

test('flow', async ({ page }) => {
  // AC-001 AC-002 AC-003 AC-004
  await test.step('open page', async () => {
    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
  });
});
`);

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /Missing dedicated assertion test\.step for AC-001/);
});

test('reviewer defaults to single mode and rejects multiple primary test blocks', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const testPath = writeGeneratedTest(workspace, specPath, validBodyWithExtras(''));

  const result = reviewGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /Single mode must contain exactly one primary test/);
});

test('reviewer accepts one focused test in default single mode', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const testPath = writeGeneratedTest(workspace, specPath, singleBodyWithExtras(''));

  const result = reviewGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, true, result.issues.join('\n'));
});

test('unknown informational metadata neither authorizes nor blocks a valid machine-checked contract', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace, {
    metadataExtra: ['| Informational Note | ignored-by-policy |']
  });
  const testPath = writeGeneratedTest(workspace, specPath, singleBodyWithExtras(''));

  const result = reviewGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, true, result.issues.join('\n'));
});

test('reviewer accepts multiple focused tests in explicit suite mode', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const testPath = writeGeneratedTest(workspace, specPath, validBodyWithExtras(''));

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, true, result.issues.join('\n'));
});

test('reviewer flags a suite whose data cases mostly carry an empty expected', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  // 3 of 4 cases have an all-empty `expected` (null/false), so they can only assert generic
  // visibility — 75% > the 40% threshold, so the weak-coverage gate must fire.
  const testPath = writeGeneratedTest(
    workspace,
    specPath,
    `
import { test, expect } from '../../fixtures/test';

const dataCases = [
  { caseId: 'DC-001', expected: { warning: 'Media limit: 2', count: null, absent: false } },
  { caseId: 'DC-002', expected: { warning: null, count: null, absent: false } },
  { caseId: 'DC-003', expected: { warning: null, count: null, absent: false } },
  { caseId: 'DC-004', expected: { warning: null, count: null, absent: false } }
];

test.describe.serial('weak suite', () => {
  for (const dataCase of dataCases) {
    test(\`\${dataCase.caseId} weak\`, { tag: ['@generated'] }, async ({ page }) => {
      await test.step('Assert AC-001: outcome', async () => {
        await expect(page.getByRole('heading')).toBeVisible();
      });
    });
  }
});
`
  );

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.match(result.issues.join('\n'), /Weak data-case coverage: 3\/4/);
});

test('reviewer does not flag a suite whose data cases carry real expectations', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  // Only 1 of 4 cases is empty (25% < 40%), so the weak-coverage gate stays silent.
  const testPath = writeGeneratedTest(
    workspace,
    specPath,
    `
import { test, expect } from '../../fixtures/test';

const dataCases = [
  { caseId: 'DC-001', expected: { warning: null, count: 2, absent: false } },
  { caseId: 'DC-002', expected: { warning: null, count: 3, absent: false } },
  { caseId: 'DC-003', expected: { warning: 'Media limit: 2', count: null, absent: false } },
  { caseId: 'DC-004', expected: { warning: null, count: null, absent: false } }
];

test.describe.serial('strong suite', () => {
  for (const dataCase of dataCases) {
    test(\`\${dataCase.caseId} strong\`, { tag: ['@generated'] }, async ({ page }) => {
      await test.step('Assert AC-001: outcome', async () => {
        await expect(page.getByRole('heading')).toBeVisible();
      });
    });
  }
});
`
  );

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.doesNotMatch(result.issues.join('\n'), /Weak data-case coverage/);
});

test('reviewer weak-coverage gate cannot be dodged by padding the array with an expected-less row', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  // 3 empty-expected + 1 real + 1 row with NO `expected` key (the old bypass: one such row used to
  // make the whole array invisible). Now the expected-less row counts as non-asserting -> 4/5 flagged.
  const testPath = writeGeneratedTest(
    workspace,
    specPath,
    `
import { test, expect } from '../../fixtures/test';

const dataCases = [
  { caseId: 'DC-001', expected: { warning: null, count: null } },
  { caseId: 'DC-002', expected: { warning: null, count: null } },
  { caseId: 'DC-003', expected: { warning: null, count: null } },
  { caseId: 'DC-004', expected: { warning: 'Media limit: 2', count: null } },
  { caseId: 'DC-005', note: 'no expected here to dodge the gate' }
];

test.describe.serial('padded suite', () => {
  for (const dataCase of dataCases) {
    test(\`\${dataCase.caseId} padded\`, { tag: ['@generated'] }, async ({ page }) => {
      await test.step('Assert AC-001: outcome', async () => {
        await expect(page.getByRole('heading')).toBeVisible();
      });
    });
  }
});
`
  );

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.match(result.issues.join('\n'), /Weak data-case coverage: 4\/5/);
});

test('reviewer flags critical helpers called via destructuring, a saved reference, or computed access', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);

  // One fixture per evasion route (each is the ONLY reference in its fixture), so a regression in
  // any single detection path fails this test on its own — the per-name 1:1 mapping this test used
  // before was lost when the critical set shrank to setChannelMaxHeroSkus (2026-07-03).
  const routes = {
    destructured: `
  const { setChannelMaxHeroSkus } = dataManager;
  await test.step('arrange', async () => {
    await setChannelMaxHeroSkus('offsite', 2);
    await page.goto('/planning');
  });`,
    savedReference: `
  const savedRef = dataManager.setChannelMaxHeroSkus;
  await test.step('arrange', async () => {
    await savedRef('offsite', 2);
    await page.goto('/planning');
  });`,
    computedLiteral: `
  await test.step('arrange', async () => {
    await dataManager['setChannelMaxHeroSkus']('offsite', 2);
    await page.goto('/planning');
  });`
  };

  for (const [route, arrange] of Object.entries(routes)) {
    const testPath = writeGeneratedTest(
      workspace,
      specPath,
      `
import { test, expect } from '../../fixtures/test';

test('evades via ${route}', async ({ page, dataManager }) => {${arrange}
  await test.step('Assert AC-001: outcome', async () => {
    await expect(page.getByRole('heading')).toBeVisible();
  });
});
`
    );

    const result = reviewGeneratedTest({ specPath, testPath });
    assert.match(
      result.issues.join('\n'),
      /critical precondition helper "setChannelMaxHeroSkus"/,
      `route not detected: ${route}`
    );
  }
});

test('reviewer weak-coverage gate cannot be hidden by over-padding with expected-less rows', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  // 6 junk rows without `expected` + 4 empty-expected + 1 real: under the old ">= half must carry
  // expected" detection rule this array became INVISIBLE (5*2 < 11). Now one expected-bearing row is
  // enough to evaluate it, and all 10 weak/expected-less rows count as non-asserting.
  const testPath = writeGeneratedTest(
    workspace,
    specPath,
    `
import { test, expect } from '../../fixtures/test';

const dataCases = [
  { caseId: 'DC-001', note: 'junk 1' },
  { caseId: 'DC-002', note: 'junk 2' },
  { caseId: 'DC-003', note: 'junk 3' },
  { caseId: 'DC-004', note: 'junk 4' },
  { caseId: 'DC-005', note: 'junk 5' },
  { caseId: 'DC-006', note: 'junk 6' },
  { caseId: 'DC-007', expected: { warning: null } },
  { caseId: 'DC-008', expected: { warning: null } },
  { caseId: 'DC-009', expected: { warning: null } },
  { caseId: 'DC-010', expected: { warning: null } },
  { caseId: 'DC-011', expected: { warning: 'Media limit: 2' } }
];

test.describe.serial('over-padded suite', () => {
  for (const dataCase of dataCases) {
    test(\`\${dataCase.caseId} padded\`, { tag: ['@generated'] }, async ({ page }) => {
      await test.step('Assert AC-001: outcome', async () => {
        await expect(page.getByRole('heading')).toBeVisible();
      });
    });
  }
});
`
  );

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.match(result.issues.join('\n'), /Weak data-case coverage: 10\/11/);
});

test('reviewer flags critical helpers reached via alias chains, holders, and dynamic access', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);

  // Per-route fixtures for the harder indirections (see the destructuring test above for why each
  // route stands alone). The dynamic computed key carries no helper name at all, so it is banned
  // outright rather than name-flagged.
  const routes = {
    aliasChain: {
      arrange: `
  const direct = dataManager.setChannelMaxHeroSkus;
  const indirect = direct;
  await test.step('arrange', async () => {
    await indirect('offsite', 2);
    await page.goto('/planning');
  });`,
      expectPattern: /critical precondition helper "setChannelMaxHeroSkus"/
    },
    arrayHolder: {
      arrange: `
  const holders = [dataManager.setChannelMaxHeroSkus];
  await test.step('arrange', async () => {
    await holders[0]('offsite', 2);
    await page.goto('/planning');
  });`,
      expectPattern: /critical precondition helper "setChannelMaxHeroSkus"/
    },
    objectHolder: {
      arrange: `
  const bag = { call: dataManager.setChannelMaxHeroSkus };
  await test.step('arrange', async () => {
    await bag.call('offsite', 2);
    await page.goto('/planning');
  });`,
      expectPattern: /critical precondition helper "setChannelMaxHeroSkus"/
    },
    dynamicComputedKey: {
      arrange: `
  const helperName = 'setChannel' + 'MaxHeroSkus';
  await test.step('arrange', async () => {
    await dataManager[helperName]('offsite', 2);
    await page.goto('/planning');
  });`,
      expectPattern: /computed, non-literal key/
    }
  };

  for (const [route, { arrange, expectPattern }] of Object.entries(routes)) {
    const testPath = writeGeneratedTest(
      workspace,
      specPath,
      `
import { test, expect } from '../../fixtures/test';

test('evades harder via ${route}', async ({ page, dataManager }) => {${arrange}
  await test.step('Assert AC-001: outcome', async () => {
    await expect(page.getByRole('heading')).toBeVisible();
  });
});
`
    );

    const result = reviewGeneratedTest({ specPath, testPath });
    assert.match(result.issues.join('\n'), expectPattern, `route not detected: ${route}`);
  }
});

test('reviewer rejects combined-AC step titles', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const testPath = writeGeneratedTest(workspace, specPath, `
import { test, expect } from '../../fixtures/test';

test('flow', async ({ page }) => {
  await test.step('AC-001 AC-002 AC-003: combined steps', async () => {
    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Place order request' })).toBeVisible();
  });
  await test.step('NEG-001: missing email', async () => {
    await expect(page.getByLabel('Email')).toBeVisible();
  });
});
`);

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /must name at most one AC ID/);
});

test('reviewer rejects tautological literal assertions', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const testPath = writeGeneratedTest(workspace, specPath, validBodyWithExtras(`
    expect(true).toBe(true);
  `));

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /Tautological assertion rejected/);
});

test('reviewer rejects expect.poll tautology over a constant producer', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const testPath = writeGeneratedTest(workspace, specPath, validBodyWithExtras(`
    await expect.poll(async () => 1, { timeout: 5000 }).toBe(1);
  `));

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /Tautological expect\.poll/);
});

test('reviewer rejects generated tests with assertions spread across multiple steps', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const testPath = writeGeneratedTest(workspace, specPath, `
import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../fixtures/test';

class CheckoutPage {
  readonly heading: Locator;
  readonly email: Locator;
  readonly submitButton: Locator;

  constructor(private readonly page: Page) {
    this.heading = this.page.getByRole('heading', { name: 'Checkout' });
    this.email = this.page.getByLabel('Email');
    this.submitButton = this.page.getByRole('button', { name: 'Place order request' });
  }
}

test('flow', async ({ page }) => {
  const checkoutPage = new CheckoutPage(page);

  await test.step('Assert AC-001: open', async () => {
    await expect(checkoutPage.heading).toBeVisible();
  });
  await test.step('Assert AC-002: fill', async () => {
    await expect(checkoutPage.email).toBeVisible();
  });
  await test.step('Assert AC-003: submit', async () => {
    await expect(checkoutPage.submitButton).toBeVisible();
  });
  await test.step('Assert NEG-001: missing email', async () => {
    await expect(checkoutPage.email).toBeVisible();
  });
});
`);

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /single final assertion step/);
});

test('reviewer rejects direct page locators in generated test bodies', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const testPath = writeGeneratedTest(workspace, specPath, validBodyWithExtras(`
    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
  `));

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /Direct page locator creation is forbidden/);
});

test('reviewer rejects forbidden runtime patterns', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const testPath = writeGeneratedTest(workspace, specPath, `
import { test, expect } from '../../fixtures/test';

test.only('flow', async ({ page }) => {
  await test.step('AC-001: open', async () => {
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
  });
  await test.step('AC-002: fill', async () => {
    await page.waitForTimeout(1);
    await expect(page.getByLabel('Email')).toBeVisible();
  });
  await test.step('AC-003: submit', async () => {
    Promise.race([]);
    setTimeout(() => undefined, 1);
    await expect(page.getByRole('button', { name: 'Place order request' })).toBeVisible();
  });
  await test.step('NEG-001: missing email', async () => {
    await expect(page.getByLabel('Email')).toBeVisible();
  });
});
`);

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /waitForLoadState/);
  assert.match(result.issues.join('\n'), /waitForTimeout/);
  assert.match(result.issues.join('\n'), /Promise\.race/);
  assert.match(result.issues.join('\n'), /setTimeout/);
  assert.match(result.issues.join('\n'), /test\.only/);
});

test('reviewer rejects direct environment, system, and network capabilities in generated targets', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const body = singleBodyWithExtras(`
    const password = process.env.E2E_USER_PASSWORD;
    const dynamicName = 'E2E_USER_PASSWORD';
    const dynamicValue = process.env[dynamicName];
    const allEnvironment = Object.entries(process.env);
    const required = require('node:fs');
    const requiredAlias = require;
    const dynamicallyImported = import('node:net');
    const response = fetch('/credential-sink');
    const parsedEnvironment = dotenv.config().parsed;
    const requestContext = request.newContext();
    const requestPost = page.request.post('/credential-sink', { data: parsedEnvironment });
    const dynamicTarget = process.env.E2E_MP_ONSITE_CHANNEL;
    const dynamicNavigation = page.goto(dynamicTarget);
    const absoluteNavigation = page.goto('https://qa.example.test/credential-sink');
    const globalsAlias = globalThis;
    const nodeGlobalAlias = global;
    const pageAlias = page;
    const evaluateAlias = pageAlias.evaluate;
    const requestAlias = pageAlias.request;
    const context = page.context();
    const evaluated = page.evaluate(() => 1);
    void password; void dynamicValue; void allEnvironment; void required; void requiredAlias;
    void dynamicallyImported; void response; void parsedEnvironment; void requestContext; void requestPost;
    void dynamicNavigation; void absoluteNavigation; void globalsAlias; void nodeGlobalAlias;
    void evaluateAlias; void requestAlias; void context; void evaluated;
  `).replace(
    "import type { Locator, Page } from '@playwright/test';",
    "import type { Locator, Page } from '@playwright/test';\nimport fs from 'node:fs';\nimport childProcess = require('node:child_process');\nimport axios from 'axios';\nimport dotenv from 'dotenv';\nimport { resolveFreshBearerToken } from '../../fixtures/nectar-api';"
  );
  const testPath = writeGeneratedTest(workspace, specPath, body);

  const result = reviewGeneratedTest({ specPath, testPath });
  const joined = result.issues.join('\n');

  assert.equal(result.passed, false);
  assert.match(joined, /System or network module import is forbidden.*node:fs/);
  assert.match(joined, /System or network module import is forbidden.*node:child_process/);
  assert.match(joined, /System or network module import is forbidden.*axios/);
  assert.match(joined, /Unapproved package import is forbidden.*dotenv/);
  assert.match(joined, /Sensitive fixture export is forbidden.*resolveFreshBearerToken/);
  assert.match(joined, /Sensitive environment access is forbidden.*E2E_USER_PASSWORD/);
  assert.match(joined, /Computed or bulk process\.env access is forbidden/);
  assert.match(joined, /CommonJS require\(\) is forbidden/);
  assert.match(joined, /Dynamic import\(\) is forbidden/);
  assert.match(joined, /Global fetch capability is forbidden/);
  assert.match(joined, /Global runtime capability is forbidden/);
  assert.match(joined, /Browser context access is forbidden/);
  assert.match(joined, /Browser evaluation is forbidden/);
  assert.match(joined, /Playwright API request capability is forbidden/);
  assert.match(joined, /Direct page navigation must use a static relative path/);
});

// Iteration-3 gap: the blocking browser-evaluation rule caught .evaluate()
// but not the sibling escape hatches. The catalog candidate carried its
// strict-null fault inside a waitForFunction callback and sailed through
// review while the wizard candidate was blocked on .evaluate() — the same
// fault class rotating between members.
test('reviewer blocks the waitForFunction browser-evaluation escape (catalog shape)', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const testPath = writeGeneratedTest(workspace, specPath, singleBodyWithExtras(`
    await page.waitForFunction(
      (element) => element?.getAttribute('aria-sort') === 'ascending',
      await checkoutPage.confirmationRequest.elementHandle(),
    );
  `));

  const result = reviewGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /Browser evaluation is forbidden[\s\S]*waitForFunction/);
});

test('reviewer blocks $eval, $$eval, and evaluateHandle member calls', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  for (const extra of [
    "const text = await page.$eval('#price', (element) => element.textContent); void text;",
    "const rows = await page.$$eval('#rows', (elements) => elements.length); void rows;",
    'const handle = await page.evaluateHandle(() => 1); void handle;'
  ]) {
    const testPath = writeGeneratedTest(workspace, specPath, singleBodyWithExtras(extra));
    const result = reviewGeneratedTest({ specPath, testPath });
    assert.equal(result.passed, false, extra);
    assert.match(result.issues.join('\n'), /Browser evaluation is forbidden/);
  }
});

test('an explicit locator-policy exception downgrades waitForFunction to a warning', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const testPath = writeGeneratedTest(workspace, specPath, singleBodyWithExtras(`
    // locator-policy:exception counting the request collection requires a selector-count wait
    await page.waitForFunction(() => 2 > 1);
  `));

  const result = reviewGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, true, result.issues.join('\n'));
  assert.match(result.warnings.join('\n'), /waitForFunction/);
});

test('a locator-policy exception never excuses $eval or .evaluate()', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  for (const extra of [
    `// locator-policy:exception justification cannot excuse extraction
    const text = await page.$eval('#price', (element) => element.textContent); void text;`,
    `// locator-policy:exception justification cannot excuse evaluation
    const value = await page.evaluate(() => 1); void value;`
  ]) {
    const testPath = writeGeneratedTest(workspace, specPath, singleBodyWithExtras(extra));
    const result = reviewGeneratedTest({ specPath, testPath });
    assert.equal(result.passed, false, extra);
    assert.match(result.issues.join('\n'), /Browser evaluation is forbidden/);
  }
});

test('reviewer permits only explicit non-secret generated-test configuration reads', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const testPath = writeGeneratedTest(workspace, specPath, singleBodyWithExtras(`
    const channel = process.env.E2E_MP_ONSITE_CHANNEL?.trim() || 'Onsite Display';
    void channel;
  `));

  const result = reviewGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, true, result.issues.join('\n'));
});

test('reviewer rejects generated tests that reference critical precondition helpers', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const testPath = writeGeneratedTest(workspace, specPath, validBodyWithExtras(`
    await dataManager.setChannelMaxHeroSkus('offsite', 2);
  `));

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /critical precondition helper "setChannelMaxHeroSkus"/);
});

test('reviewer does not flag live-proven seeding helpers (delisted 2026-07-03)', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  // setPlanHeroSkus / setPlanMeasurementSkus were removed from CRITICAL_PRECONDITION_HELPERS after
  // being live-proven (real catalogue ids + live session + green executions). Referencing them must
  // NOT fail review — re-adding them to the set without cause would silently re-red every E2E suite.
  const testPath = writeGeneratedTest(workspace, specPath, validBodyWithExtras(`
    await dataManager.setPlanHeroSkus('current', 'offsite', ['7096764']);
    await dataManager.setPlanMeasurementSkus('current', 'offsite', ['7304367']);
  `));

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.doesNotMatch(result.issues.join('\n'), /critical precondition helper "setPlan/);
});

test('reviewer rejects test.skip defining-form even inside test.describe', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const testPath = writeGeneratedTest(workspace, specPath, `
import { test, expect } from '../../fixtures/test';

test.describe('soup', () => {
  test.skip('AC-skipped', async ({ page }) => {
    await test.step('AC-001: open', async () => {
      await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
    });
    await test.step('AC-002: fill', async () => {
      await expect(page.getByLabel('Email')).toBeVisible();
    });
    await test.step('AC-003: submit', async () => {
      await expect(page.getByRole('button', { name: 'Place order request' })).toBeVisible();
    });
    await test.step('NEG-001: missing email', async () => {
      await expect(page.getByLabel('Email')).toBeVisible();
    });
  });
});
`);

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /Forbidden test-defining control found: test\.skip/);
});

test('reviewer rejects test.use storageState literals', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const testPath = writeGeneratedTest(workspace, specPath, `
import { test, expect } from '../../fixtures/test';

test.use({ storageState: 'playwright/.auth/leaked.json' });

test('flow', async ({ page }) => {
  await test.step('AC-001: open', async () => {
    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
  });
  await test.step('AC-002: fill', async () => {
    await expect(page.getByLabel('Email')).toBeVisible();
  });
  await test.step('AC-003: submit', async () => {
    await expect(page.getByRole('button', { name: 'Place order request' })).toBeVisible();
  });
  await test.step('NEG-001: missing email', async () => {
    await expect(page.getByLabel('Email')).toBeVisible();
  });
});
`);

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /test\.use\(\{ storageState/);
});

test('reviewer rejects XPath and nth-child via page.locator', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const testPath = writeGeneratedTest(workspace, specPath, validBodyWithExtras(`
    await expect(page.locator('xpath=//body//h1')).toBeVisible();
    await expect(page.locator('//html/body')).toBeVisible();
    await expect(page.locator('div > p:nth-child(2)')).toBeVisible();
  `));

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  const joined = result.issues.join('\n');
  assert.match(joined, /XPath selector forbidden/);
  assert.match(joined, /nth-child selector chain forbidden/);
});

test('reviewer rejects persisted agent-browser refs in generated tests', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const testPath = writeGeneratedTest(workspace, specPath, validBodyWithExtras(`
    const staleAgentBrowserRef = '@e12';
    void staleAgentBrowserRef;
  `));

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /agent-browser snapshot refs/);
});

test('reviewer enforces exact locator hints', () => {
  const workspace = createWorkspace();
  // Use a hint locator that exists in neither the test body nor the repo's
  // Page Objects, so the exact-hint check is genuinely unsatisfied.
  const specPath = writeSpec(workspace, {
    locatorHints: [
      "- Prefer `getByRole('heading', { name: 'Unique Hint Heading 9f2a' })` for the page heading.",
      "- Prefer `getByRole('button', { name: 'Place order request' })` for submission."
    ]
  });
  const testPath = writeGeneratedTest(workspace, specPath, `
import { test, expect } from '../../fixtures/test';

test('flow', async ({ page }) => {
  await test.step('AC-001: open', async () => {
    await expect(page.getByRole('heading', { name: 'Wrong' })).toBeVisible();
  });
  await test.step('AC-002: fill', async () => {
    await expect(page.getByLabel('Email')).toBeVisible();
  });
  await test.step('AC-003: submit', async () => {
    await expect(page.getByRole('button', { name: 'Place order request' })).toBeVisible();
  });
  await test.step('NEG-001: missing email', async () => {
    await expect(page.getByLabel('Email')).toBeVisible();
  });
});
`);

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /Locator hint requires exact locator/);
});

// Iteration-2 regression: both wizard generations were FALSE static-review
// rejections. Candidates honored the pinned 46-char consent name, but the
// formatter wrapped the getByRole options object multiline with a trailing
// comma ('{ name: '...', }'), which the old normalized-substring match could
// never equal. Hint matching must compare the parsed call (method + folded
// arguments), not formatted text.
test('reviewer matches locator hints across formatting variance (multiline, trailing comma, quote style)', () => {
  const workspace = createWorkspace();
  const consentName = 'I confirm the details above are correct';
  const specPath = writeSpec(workspace, {
    locatorHints: [
      "- Prefer `getByRole('heading', { name: 'Checkout' })` for the page heading.",
      `- Use \`getByRole('checkbox', { name: '${consentName}' })\` for the consent control.`
    ]
  });
  const body = bodyWithPageObjectMembers({
    fields: '  readonly consent: Locator;',
    constructorLines: [
      '    this.consent = this.page.getByRole("checkbox", {',
      `      name: "${consentName}",`,
      '    });'
    ].join('\n')
  });
  const testPath = writeGeneratedTest(workspace, specPath, body);

  const result = reviewGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, true, result.issues.join('\n'));
  assert.doesNotMatch(result.issues.join('\n'), /Locator hint requires exact locator/);
});

test('reviewer still rejects a hint locator whose accessible name genuinely differs', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace, {
    locatorHints: [
      "- Prefer `getByRole('heading', { name: 'Checkout' })` for the page heading.",
      "- Use `getByRole('checkbox', { name: 'I confirm the details above are correct' })` for the consent control."
    ]
  });
  const body = bodyWithPageObjectMembers({
    fields: '  readonly consent: Locator;',
    constructorLines: [
      "    this.consent = this.page.getByRole('checkbox', {",
      "      name: 'I agree to something entirely different',",
      '    });'
    ].join('\n')
  });
  const testPath = writeGeneratedTest(workspace, specPath, body);

  const result = reviewGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(
    result.issues.join('\n'),
    /Locator hint requires exact locator usage or Page Object wrapper: getByRole\('checkbox', \{ name: 'I confirm the details above are correct' \}\)/
  );
});

test('reviewer rejects production URLs (literal, concatenated, template)', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const testPath = writeGeneratedTest(workspace, specPath, validBodyWithExtras(`
    const literal = 'https://example.com/api';
    const concat = 'https://' + 'example' + '.com' + '/v2';
    const template = \`https://example.com/v3/\${1}\`;
    void literal; void concat; void template;
  `));

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  const joined = result.issues.join('\n');
  assert.match(joined, /Hardcoded production URL is forbidden/);
  assert.match(joined, /\(folded\)/);
});

test('reviewer rejects JWT, AWS, and high-entropy secrets', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const testPath = writeGeneratedTest(workspace, specPath, validBodyWithExtras(`
    const jwt = 'eyJabc.def.ghi';
    const aws = 'AKIA1234567890ABCDEF';
    const secret = 'aB3dE5fG7hI9jK1lM2nO3pQ4';
    void jwt; void aws; void secret;
  `));

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  const joined = result.issues.join('\n');
  assert.match(joined, /JWT-shaped token/);
  assert.match(joined, /AWS access key/);
  assert.match(joined, /High-entropy string/);
});

test('reviewer enforces a dedicated step per negative case', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const testPath = writeGeneratedTest(workspace, specPath, `
import { test, expect } from '../../fixtures/test';

test('flow', async ({ page }) => {
  await test.step('AC-001: open', async () => {
    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
  });
  await test.step('AC-002: fill', async () => {
    await expect(page.getByLabel('Email')).toBeVisible();
  });
  await test.step('AC-003: submit', async () => {
    await expect(page.getByRole('button', { name: 'Place order request' })).toBeVisible();
  });
});
`);

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /Missing test\.step covering negative case NEG-001/);
});

test('reviewer rejects declared mocks that are not used by generated tests', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const body = validBodyWithExtras('').replace(
    /async function mockOrderApi\(page: Page\): Promise<void> \{[\s\S]*?\n\}\n\ntest\('/,
    "async function mockOrderApi(page: Page): Promise<void> {\n  void page;\n}\n\ntest('"
  );
  const testPath = writeGeneratedTest(workspace, specPath, body);

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /Spec declares Mocks as JSON entries/);
});

test('reviewer rejects declared mocks only mentioned in strings without route registration', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const testPath = writeGeneratedTest(workspace, specPath, `
import { test, expect } from '../../fixtures/test';

test('flow', async ({ page }) => {
  const mentionedOnly = '/api/orders 201 POST REQ-1001';
  void mentionedOnly;

  await test.step('AC-001: open', async () => {
    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
  });
  await test.step('AC-002: fill', async () => {
    await expect(page.getByLabel('Email')).toBeVisible();
  });
  await test.step('AC-003: submit', async () => {
    await expect(page.getByRole('button', { name: 'Place order request' })).toBeVisible();
  });
  await test.step('NEG-001: missing email', async () => {
    await expect(page.getByLabel('Email')).toBeVisible();
  });
});
`);

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /Declared mock URL is not registered/);
});

test('reviewer rejects missing JSON data case IDs in parameterized flows', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace, {
    dataCasesRows: [
      '| DC-001 | email=test@example.com | Confirmation visible | Primary case |',
      '| DC-002 | email=admin@example.com | Confirmation visible | Alternate case |'
    ],
    dataCasesJson: [
      {
        caseId: 'DC-001',
        inputs: { email: 'test@example.com' },
        expected: { requestId: 'REQ-1001', result: 'Confirmation visible' },
        notes: 'Primary case'
      },
      {
        caseId: 'DC-002',
        inputs: { email: 'admin@example.com' },
        expected: { requestId: 'REQ-1001', result: 'Confirmation visible' },
        notes: 'Alternate case'
      }
    ]
  });
  const testPath = writeGeneratedTest(workspace, specPath, realMockBodyWithoutDataCaseIds());

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /Data case DC-001/);
  assert.match(result.issues.join('\n'), /Data case DC-002/);
});

test('reviewer rejects tests that omit salient expected message tokens', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace, {
    mocksJsonBlock: '[]',
    businessRulesRows: [
      '| RULE-001 | Validate configured campaign duration rule | inclusiveDays = endDate - startDate + 1 | Block progression below minimum |'
    ],
    dataCasesRows: [
      '| DC-001 | boundary=below-minimum; channelName=YouTube; minDurationDays=7 | The campaign duration for YouTube must be at least 7 days. | Below minimum |',
      '| DC-002 | boundary=at-minimum; channelName=YouTube; minDurationDays=7 | No minimum duration error is shown | At minimum |',
      '| DC-003 | boundary=above-minimum; channelName=YouTube; minDurationDays=7 | No minimum duration error is shown | Above minimum |'
    ],
    dataCasesJson: [
      {
        caseId: 'DC-001',
        inputs: { boundary: 'below-minimum', channelName: 'YouTube', minDurationDays: 7 },
        expected: { result: 'blocked', message: 'The campaign duration for YouTube must be at least 7 days.' },
        notes: 'Below minimum'
      },
      {
        caseId: 'DC-002',
        inputs: { boundary: 'at-minimum', channelName: 'YouTube', minDurationDays: 7 },
        expected: { result: 'allowed', message: 'No minimum duration error is shown' },
        notes: 'At minimum'
      },
      {
        caseId: 'DC-003',
        inputs: { boundary: 'above-minimum', channelName: 'YouTube', minDurationDays: 7 },
        expected: { result: 'allowed', message: 'No minimum duration error is shown' },
        notes: 'Above minimum'
      }
    ]
  });
  const testPath = writeGeneratedTest(workspace, specPath, `
import { test, expect } from '../../fixtures/test';

test.describe.each(['DC-001', 'DC-002', 'DC-003'])('case %s', () => {
  test('flow', async ({ page }) => {
    await test.step('AC-001: open', async () => {
      await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
    });
    await test.step('AC-002: fill', async () => {
      await expect(page.getByLabel('Email')).toBeVisible();
    });
    await test.step('AC-003: submit', async () => {
      await expect(page.getByRole('button', { name: 'Place order request' })).toBeVisible();
    });
    await test.step('NEG-001: missing email', async () => {
      await expect(page.getByLabel('Email')).toBeVisible();
    });
  });
});
`);

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /YouTube|7 days|must be at least/);
});

test('reviewer accepts justified CSS selector exceptions', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const body = validBodyWithExtras('')
    .replace(
      'readonly emailError: Locator;',
      'readonly emailError: Locator;\n  readonly pageRoot: Locator;'
    )
    .replace(
      "this.emailError = this.page.getByText('Error visible');",
      "this.emailError = this.page.getByText('Error visible');\n    // locator-policy:exception synthetic fixture has no accessible landmark\n    this.pageRoot = this.page.locator('main');"
    )
    .replace(
      'await expect(checkoutPage.emailError).toBeVisible();',
      'await expect(checkoutPage.emailError).toBeVisible();\n    await expect(checkoutPage.pageRoot).toBeVisible();'
    );
  const testPath = writeGeneratedTest(workspace, specPath, body);

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, true, result.issues.join('\n'));
  assert.match(result.warnings.join('\n'), /CSS selector exception accepted/);
});

test('reviewer accepts getByTestId as a policy-approved locator', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace, {
    locatorHints: [
      "- Prefer `getByTestId('checkout-heading')` for the page heading when the test id is stable.",
      "- Prefer `getByTestId('submit-order')` for submission when the test id is stable."
    ]
  });
  const body = validBodyWithExtras('')
    .replace(
      "this.heading = this.page.getByRole('heading', { name: 'Checkout' });",
      "this.heading = this.page.getByTestId('checkout-heading');"
    )
    .replace(
      "this.submitButton = this.page.getByRole('button', { name: 'Place order request' });",
      "this.submitButton = this.page.getByTestId('submit-order');"
    )
    .replace(
      'await expect(checkoutPage.heading).toBeVisible();',
      "await expect(checkoutPage.heading).toBeVisible();\n    await expect(checkoutPage.heading).toHaveText('Checkout');"
    );
  const testPath = writeGeneratedTest(workspace, specPath, body);

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, true, result.issues.join('\n'));
});

test('reviewer rejects raw CSS without a locator-policy exception', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const testPath = writeGeneratedTest(workspace, specPath, validBodyWithExtras(`
    await expect(page.locator('main')).toBeVisible();
  `));

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /requires \/\/ locator-policy:exception/);
});

test('behavioral spec hash ignores non-behavioral notes edits', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const before = specSha256(specPath);

  fs.appendFileSync(specPath, '\nAdditional non-behavioral note.\n');

  assert.equal(specSha256(specPath), before);
});

test('reviewer requires test.describe.serial for parallel-unsafe specs', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace, {
    stability: ['| Parallel Safe | no |', '| Data Isolation | per-test |', '| Allowed Retries | 0 |']
  });
  const testPath = writeGeneratedTest(workspace, specPath, validBodyWithExtras(''));

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /test\.describe\.serial/);
});

test('reviewer rejects waitForTimeout smuggled via computed member access', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const testPath = writeGeneratedTest(workspace, specPath, validBodyWithExtras(`
    await (page as any)['waitForTimeout'](3000);
  `));

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  const joined = result.issues.join('\n');
  assert.match(joined, /Forbidden runtime pattern found: waitForTimeout/);
  assert.match(joined, /as any/);
});

test('reviewer rejects test.only smuggled via element access', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const testPath = writeGeneratedTest(workspace, specPath, `
import { test, expect } from '../../fixtures/test';

test['only']('flow', async ({ page }) => {
  await test.step('Assert AC-001: open', async () => {
    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
  });
});
`);

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /Forbidden focused test pattern|test-defining control/);
});

test('reviewer rejects XPath held in a non-const variable', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const testPath = writeGeneratedTest(workspace, specPath, validBodyWithExtras(`
    let sneaky = '//div';
    sneaky = '//html/body';
    await expect(page.locator(sneaky)).toBeVisible();
  `));

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /XPath selector forbidden/);
});

test('reviewer accepts a for...of parameterized data-case loop (no .each)', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace, {
    dataCasesRows: [
      '| DC-001 | email=test@example.com | Confirmation visible | Primary case |',
      '| DC-002 | email=admin@example.com | Confirmation visible | Alternate case |'
    ],
    dataCasesJson: [
      { caseId: 'DC-001', inputs: { email: 'test@example.com' }, expected: { requestId: 'REQ-1001', result: 'Confirmation visible' }, notes: 'Primary case' },
      { caseId: 'DC-002', inputs: { email: 'admin@example.com' }, expected: { requestId: 'REQ-1001', result: 'Confirmation visible' }, notes: 'Alternate case' }
    ]
  });
  const testPath = writeGeneratedTest(workspace, specPath, `
import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../fixtures/test';

class CheckoutPage {
  readonly heading: Locator;
  readonly confirmationRequest: Locator;

  constructor(private readonly page: Page) {
    this.heading = this.page.getByRole('heading', { name: 'Checkout' });
    this.confirmationRequest = this.page.getByText('REQ-1001');
  }

  async open(): Promise<void> {
    await this.page.goto('/checkout');
  }
}

const cases = [
  { caseId: 'DC-001', email: 'test@example.com' },
  { caseId: 'DC-002', email: 'admin@example.com' }
];

for (const dataCase of cases) {
  test(\`\${dataCase.caseId} AC-003: confirmation visible\`, async ({ page }) => {
    const checkoutPage = new CheckoutPage(page);
    await test.step('Arrange: open checkout', async () => {
      await checkoutPage.open();
      void dataCase.email;
    });
    await test.step('Assert AC-003: confirmation request is visible', async () => {
      await expect(checkoutPage.confirmationRequest).toBeVisible();
    });
  });
}
`);

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  // The data-case loop must be accepted as valid parameterization: no demand
  // for a non-existent `.each(...)` API.
  assert.doesNotMatch(result.issues.join('\n'), /enumerate them by looping|\.each/);
});

test('reviewer rejects a declared salient value parked in a dead constant', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace, {
    extraRequirements: ['- Must assert the salient expected values REQ-1001.']
  });
  const testPath = writeGeneratedTest(workspace, specPath, `
import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../fixtures/test';

const deadTokens = ['REQ-1001'];

class CheckoutPage {
  readonly heading: Locator;
  constructor(private readonly page: Page) {
    this.heading = this.page.getByRole('heading', { name: 'Checkout' });
  }
  async open(): Promise<void> {
    await this.page.goto('/checkout');
  }
}

test('AC-003: confirmation visible', async ({ page }) => {
  const checkoutPage = new CheckoutPage(page);
  await test.step('Arrange: open checkout', async () => {
    await checkoutPage.open();
  });
  await test.step('Assert AC-003: heading visible', async () => {
    await expect(checkoutPage.heading).toBeVisible();
  });
});
`);

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  const salientIssues = result.issues.join('\n');
  assert.match(salientIssues, /Salient expected value must be asserted.*REQ-1001/);
  assert.match(salientIssues, /Remedy: assert the listed token verbatim in an assertion, a step\/test title, or an iterated data row in the test body\./);
});

test('reviewer accepts a declared salient value asserted in the final step', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace, {
    extraRequirements: ['- Must assert the salient expected values REQ-1001.']
  });
  const testPath = writeGeneratedTest(workspace, specPath, singleBodyWithExtras(`
    await expect(checkoutPage.confirmationRequest).toHaveText(checkoutCase.requestId);
  `));

  const result = reviewGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, true, result.issues.join('\n'));
});

test('reviewer rejects runtime test.skip self-skips inside test bodies', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const testPath = writeGeneratedTest(workspace, specPath, singleBodyWithExtras(`
    test.skip(true, 'environment is flaky');
  `));

  const result = reviewGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /Forbidden runtime test control found: test\.skip/);
});

test('reviewer rejects zero-arg and obfuscated runtime skip forms', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const testPath = writeGeneratedTest(workspace, specPath, singleBodyWithExtras(`
    test.skip();
    (test as any)['fixme']();
    test.fail();
  `));

  const result = reviewGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  const joined = result.issues.join('\n');
  assert.match(joined, /Forbidden runtime test control found: test\.skip/);
  assert.match(joined, /Forbidden runtime test control found: test\.fixme/);
  assert.match(joined, /Forbidden runtime test control found: test\.fail/);
});

test('reviewer rejects expect.poll tautology laundered through a multi-statement producer', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  // Round-2 probe: the single-statement literal-return check accepted any
  // block body with more than one statement, so a constant producer slipped
  // through via a local const.
  const testPath = writeGeneratedTest(workspace, specPath, validBodyWithExtras(`
    await expect.poll(() => { const laundered = 1; return laundered; }).toBe(1);
  `));

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /Tautological expect\.poll rejected/);
});

test('reviewer rejects expect.poll producers folding to file-level constant literals', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const body = validBodyWithExtras(`
    await expect.poll(async () => { return pollSentinel; }, { timeout: 5000 }).toBe(7);
  `).replace(
    "import { test, expect } from '../../fixtures/test';",
    "import { test, expect } from '../../fixtures/test';\n\nconst pollSentinel = 7;"
  );
  const testPath = writeGeneratedTest(workspace, specPath, body);

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /Tautological expect\.poll rejected/);
});

test('reviewer still accepts expect.poll producers that read application state', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const testPath = writeGeneratedTest(workspace, specPath, validBodyWithExtras(`
    await expect.poll(async () => { const count = await checkoutPage.emailError.count(); return count; }).toBe(1);
  `));

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.doesNotMatch(result.issues.join('\n'), /Tautological expect\.poll/);
});

test('reviewer rejects runtime skip calls aliased through a local variable', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  // Round-2 probe: `const t = test; t.skip();` evaded both the runtime
  // test-control regex and isTestDefiningSkip (literal test/it receivers).
  const testPath = writeGeneratedTest(workspace, specPath, singleBodyWithExtras(`
    const t = test;
    t.skip();
  `));

  const result = reviewGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /Forbidden runtime test control found: test\.skip/);
});

test('reviewer rejects runtime skip laundered through destructuring and member aliases', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const testPath = writeGeneratedTest(workspace, specPath, singleBodyWithExtras(`
    const { skip: launderedSkip } = test;
    launderedSkip();
    const fixmeAlias = test.fixme;
    fixmeAlias();
  `));

  const result = reviewGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  const joined = result.issues.join('\n');
  assert.match(joined, /Forbidden runtime test control found: test\.skip/);
  assert.match(joined, /Forbidden runtime test control found: test\.fixme/);
});

test('reviewer rejects aliased test-defining skip and import-renamed runtime skip', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const body = singleBodyWithExtras(`
    runner.skip();
  `)
    .replace(
      "import { test, expect } from '../../fixtures/test';",
      "import { test as runner } from '../../fixtures/test';\nimport { test, expect } from '../../fixtures/test';"
    )
    .replace(
      'const checkoutCase = {',
      "const aliasedTest = test;\naliasedTest.skip('skipped block', async () => {});\n\nconst checkoutCase = {"
    );
  const testPath = writeGeneratedTest(workspace, specPath, body);

  const result = reviewGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  const joined = result.issues.join('\n');
  // import { test as runner }: runner.skip() is a runtime self-skip.
  assert.match(joined, /Forbidden runtime test control found: test\.skip/);
  // const aliasedTest = test; aliasedTest.skip('title', cb) defines a skipped test.
  assert.match(joined, /Forbidden test-defining control found: test\.skip/);
});

test('reviewer forbids page-receiver string-selector action APIs', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  // Round-2 probe: page.click('xpath=//...') never went through the
  // .locator() classification, so a raw XPath action passed review.
  const testPath = writeGeneratedTest(workspace, specPath, validBodyWithExtras(`
    await page.click('xpath=//button[contains(text(), "Continue")]');
  `));

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /String-selector action API forbidden in generated tests: page\.click\('xpath=/);
});

test('reviewer forbids string-selector APIs via bracket access, waitForSelector, and this.page', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const body = validBodyWithExtras(`
    await page.waitForSelector('#confirmation');
    await (page as any)['fill']('#email', 'someone@example.com');
  `).replace(
    'async submitOrder(): Promise<void> {',
    "async submitFallback(): Promise<void> {\n    await this.page.click('button.submit');\n  }\n\n  async submitOrder(): Promise<void> {"
  );
  const testPath = writeGeneratedTest(workspace, specPath, body);

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  const joined = result.issues.join('\n');
  assert.match(joined, /String-selector action API forbidden in generated tests: page\.waitForSelector/);
  assert.match(joined, /String-selector action API forbidden in generated tests: .*\['fill'\]/);
  assert.match(joined, /String-selector action API forbidden in generated tests: this\.page\.click/);
});

test('reviewer rejects single-mode AC steps whose bodies do no observable work', () => {
  const workspace = createWorkspace();
  // Empty mocks so the empty-body issues are the only failures: the probe
  // demonstrates titles-only bodies previously satisfied covered-ac-ids.
  const specPath = writeSpec(workspace, { mocksJsonBlock: '[]' });
  const testPath = writeGeneratedTest(workspace, specPath, `
import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../fixtures/test';

class CheckoutPage {
  readonly heading: Locator;
  readonly submitButton: Locator;
  readonly confirmationRequest: Locator;

  constructor(private readonly page: Page) {
    this.heading = this.page.getByRole('heading', { name: 'Checkout' });
    this.submitButton = this.page.getByRole('button', { name: 'Place order request' });
    this.confirmationRequest = this.page.getByText('REQ-1001');
  }
}

test('DC-001 AC-003: checkout request shows confirmation', { tag: ['@generated', '@regression'] }, async ({ page }) => {
  test.info().annotations.push({
    type: 'covered-ac-ids',
    description: 'AC-001 AC-002 AC-003'
  });

  const checkoutPage = new CheckoutPage(page);

  await test.step('Arrange AC-001: open checkout page', async () => {});

  await test.step('Act AC-002: submit checkout request', async () => {});

  await test.step('Assert AC-003: confirmation request is visible', async () => {
    await expect(checkoutPage.confirmationRequest).toBeVisible();
  });
});
`);

  const result = reviewGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  const joined = result.issues.join('\n');
  assert.match(joined, /Primary test step "Arrange AC-001: open checkout page" names AC-001 but its body performs no awaited locator action/);
  assert.match(joined, /Primary test step "Act AC-002: submit checkout request" names AC-002/);
  // The empty bodies must be the only failures: everything else about the
  // probe is review-clean, which is exactly why titles-only coverage passed
  // before this check existed.
  assert.equal(result.issues.length, 2, joined);
});

test('reviewer keeps accepting thin arrange steps with a single awaited POM call', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const testPath = writeGeneratedTest(workspace, specPath, singleBodyWithExtras(''));

  const result = reviewGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, true, result.issues.join('\n'));
});

test('validator requires the .authenticated.spec.ts suffix for Auth=required specs', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace, { auth: 'required' });

  const result = validateSpecFile(specPath);

  assert.equal(result.valid, false);
  assert.match(
    result.issues.join('\n'),
    /Metadata Auth is "required", so Target Test File must end with \.authenticated\.spec\.ts/
  );
});

test('validator forbids the .authenticated.spec.ts suffix when Auth is not required', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace, { targetTestFile: 'tests/regression/generated.authenticated.spec.ts' });

  const result = validateSpecFile(specPath);

  assert.equal(result.valid, false);
  assert.match(
    result.issues.join('\n'),
    /Target Test File uses the \.authenticated\.spec\.ts suffix, but metadata Auth is "none"/
  );
});

test('validator accepts Auth=required specs targeting an .authenticated.spec.ts file', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace, {
    auth: 'required',
    targetTestFile: 'tests/regression/generated.authenticated.spec.ts'
  });

  const result = validateSpecFile(specPath);

  assert.equal(result.valid, true, result.issues.join('\n'));
});

test('reviewer reports zero-arg test() calls instead of crashing', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const testPath = writeGeneratedTest(workspace, specPath, singleBodyWithExtras(`
    test();
  `));

  const result = reviewGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /Zero-argument test\(\) call found/);
});

test('reviewer no longer accepts a .each mention in comments as parameterization', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace, {
    dataCasesRows: [
      '| DC-001 | email=test@example.com | Confirmation visible | Primary case |',
      '| DC-002 | email=admin@example.com | Confirmation visible | Alternate case |'
    ],
    dataCasesJson: [
      { caseId: 'DC-001', inputs: { email: 'test@example.com' }, expected: { requestId: 'REQ-1001', result: 'Confirmation visible' }, notes: 'Primary case' },
      { caseId: 'DC-002', inputs: { email: 'admin@example.com' }, expected: { requestId: 'REQ-1001', result: 'Confirmation visible' }, notes: 'Alternate case' }
    ]
  });
  // The comment used to satisfy the raw-source `.each(` fallback even though
  // nothing enumerates the cases.
  const body = realMockBodyWithoutDataCaseIds().replace(
    "import { test, expect } from '../../fixtures/test';",
    "import { test, expect } from '../../fixtures/test';\n\n// cases.each((dataCase) => test(dataCase.caseId, () => {}));"
  );
  const testPath = writeGeneratedTest(workspace, specPath, body);

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /enumerate them by looping/);
});

test('reviewer rejects data case IDs parked in a dead constant', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace, {
    dataCasesRows: [
      '| DC-001 | email=test@example.com | Confirmation visible | Primary case |',
      '| DC-002 | email=admin@example.com | Confirmation visible | Alternate case |'
    ],
    dataCasesJson: [
      { caseId: 'DC-001', inputs: { email: 'test@example.com' }, expected: { requestId: 'REQ-1001', result: 'Confirmation visible' }, notes: 'Primary case' },
      { caseId: 'DC-002', inputs: { email: 'admin@example.com' }, expected: { requestId: 'REQ-1001', result: 'Confirmation visible' }, notes: 'Alternate case' }
    ]
  });
  const body = realMockBodyWithoutDataCaseIds().replace(
    "import { test, expect } from '../../fixtures/test';",
    "import { test, expect } from '../../fixtures/test';\n\nconst deadCaseIds = ['DC-001 primary', 'DC-002 alternate'];"
  );
  const testPath = writeGeneratedTest(workspace, specPath, body);

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /Data case DC-001/);
  assert.match(result.issues.join('\n'), /Data case DC-002/);
});

test('reviewer accepts data case IDs embedded inside live test titles (substring contract)', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace, {
    dataCasesRows: [
      '| DC-001 | email=test@example.com | Confirmation visible | Primary case |',
      '| DC-002 | email=admin@example.com | Confirmation visible | Alternate case |'
    ],
    dataCasesJson: [
      { caseId: 'DC-001', inputs: { email: 'test@example.com' }, expected: { requestId: 'REQ-1001', result: 'Confirmation visible' }, notes: 'Primary case' },
      { caseId: 'DC-002', inputs: { email: 'admin@example.com' }, expected: { requestId: 'REQ-1001', result: 'Confirmation visible' }, notes: 'Alternate case' }
    ]
  });
  // Case IDs appear only inside longer step-title literals; exact-equality
  // matching used to reject them despite the documented substring contract.
  const body = realMockBodyWithoutDataCaseIds()
    .replace("'Act: open checkout'", "'Act: open checkout for DC-001'")
    .replace("'Act: fill contact email'", "'Act: fill contact email for DC-002'");
  const testPath = writeGeneratedTest(workspace, specPath, body);

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.doesNotMatch(result.issues.join('\n'), /Data case DC-00\d must appear/);
});

test('reviewer fails closed on unfoldable locator selector arguments', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const testPath = writeGeneratedTest(workspace, specPath, validBodyWithExtras(`
    await expect(page.locator(buildDynamicSelector())).toBeVisible();
  `));

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /Unresolvable selector argument in \.locator\(buildDynamicSelector\(\)\)/);
});

test('reviewer accepts unfoldable selector arguments with a locator-policy exception', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const body = validBodyWithExtras('')
    .replace(
      'readonly emailError: Locator;',
      'readonly emailError: Locator;\n  readonly dynamicRow: Locator;'
    )
    .replace(
      "this.emailError = this.page.getByText('Error visible');",
      "this.emailError = this.page.getByText('Error visible');\n    // locator-policy:exception row selector is computed from runtime data\n    this.dynamicRow = this.page.locator(buildRowSelector());"
    );
  const testPath = writeGeneratedTest(workspace, specPath, body);

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, true, result.issues.join('\n'));
  assert.match(result.warnings.join('\n'), /Unfoldable selector exception accepted/);
});

test('reviewer folds parameter default initializers when classifying selectors', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const testPath = writeGeneratedTest(workspace, specPath, validBodyWithExtras(`
    function pickRow(selector = '//section/div[2]') {
      return page.locator(selector);
    }
    await expect(pickRow()).toBeVisible();
  `));

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /XPath selector forbidden/);
});

test('reviewer requires a locator-policy exception for .first(), .last(), and .nth(n)', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const testPath = writeGeneratedTest(workspace, specPath, validBodyWithExtras(`
    await checkoutPage.emailError.first().click();
    await checkoutPage.emailError.last().click();
    await checkoutPage.emailError.nth(2).click();
  `));

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  const joined = result.issues.join('\n');
  assert.match(joined, /Positional locator pick checkoutPage\.emailError\.first\(\)/);
  assert.match(joined, /Positional locator pick checkoutPage\.emailError\.last\(\)/);
  assert.match(joined, /Positional locator pick checkoutPage\.emailError\.nth\(2\)/);
});

test('reviewer accepts positional locator picks with a locator-policy exception', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const testPath = writeGeneratedTest(workspace, specPath, validBodyWithExtras(`
    // locator-policy:exception duplicated rows render the same error twice
    await checkoutPage.emailError.first().click();
  `));

  const result = reviewSuiteGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, true, result.issues.join('\n'));
  assert.match(result.warnings.join('\n'), /Positional locator pick exception accepted/);
});

test('reviewer hard-errors when --mode contradicts spec Generation Mode metadata', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace, { metadataExtra: ['| Generation Mode | suite |'] });
  const testPath = writeGeneratedTest(workspace, specPath, validBodyWithExtras(''));

  const result = reviewGeneratedTest({ specPath, testPath, mode: 'single' });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /--mode single conflicts with spec metadata Generation Mode "suite"/);
});

test('reviewer picks up suite mode from spec Generation Mode metadata without a flag', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace, { metadataExtra: ['| Generation Mode | suite |'] });
  const testPath = writeGeneratedTest(workspace, specPath, validBodyWithExtras(''));

  const result = reviewGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, true, result.issues.join('\n'));
});

test('validator rejects bogus Generation Mode metadata', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace, { metadataExtra: ['| Generation Mode | parallel |'] });

  const result = validateSpecFile(specPath);

  assert.equal(result.valid, false);
  assert.match(result.issues.join('\n'), /Metadata field "Generation Mode" must be "single" or "suite"/);
});

test('validator --strict flags pending-generation specs whose target test already exists', () => {
  const workspace = createWorkspace();
  // Create the target test in the repo so the CWD-relative existsSync check fires,
  // then clean it up — decoupled from any specific committed example test.
  const targetTestFile = `tests/regression/__strict-stale-${crypto.randomUUID().slice(0, 8)}.spec.ts`;
  fs.writeFileSync(path.resolve(targetTestFile), '// temporary fixture for the strict stale-status check\n');
  try {
    const specPath = writeSpec(workspace, {
      targetTestFile,
      metadataExtra: ['| Generation Status | pending-generation |']
    });

    const lenient = validateSpecFile(specPath);
    assert.equal(lenient.valid, true, lenient.issues.join('\n'));

    const strict = validateSpecFile(specPath, { strict: true });
    assert.equal(strict.valid, false);
    assert.match(strict.issues.join('\n'), /Stale Generation Status \(strict mode\)/);
  } finally {
    fs.rmSync(path.resolve(targetTestFile), { force: true });
  }
});

test('reviewer rejects headers whose hash does not match the spec', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const testPath = writeGeneratedTest(workspace, specPath, singleBodyWithExtras(''), 'a'.repeat(64));

  const result = reviewGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /header hash does not match .*Regenerate the header via the drift\/import workflow/);
});

test('reviewer requires the covered-ac-ids annotation in the single-mode primary test', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const body = singleBodyWithExtras('').replace(
    /  test\.info\(\)\.annotations\.push\(\{\n    type: 'covered-ac-ids',\n    description: 'AC-001 AC-002 AC-003'\n  \}\);\n\n/,
    ''
  );
  const testPath = writeGeneratedTest(workspace, specPath, body);

  const result = reviewGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /must declare a covered-ac-ids annotation/);
});

test('reviewer rejects covered-ac-ids annotations naming unknown ACs or unproven coverage', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const body = singleBodyWithExtras('')
    .replace("description: 'AC-001 AC-002 AC-003'", "description: 'AC-001 AC-002 AC-003 AC-009'")
    .replace("'Arrange AC-001: open checkout page'", "'Arrange: open checkout page'");
  const testPath = writeGeneratedTest(workspace, specPath, body);

  const result = reviewGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  const joined = result.issues.join('\n');
  assert.match(joined, /covered-ac-ids annotation names AC-009, which is not in the spec's Acceptance Criteria/);
  assert.match(joined, /Primary test step title "Arrange: open checkout page" must name the AC id\(s\)/);
  assert.match(joined, /covered-ac-ids annotation claims AC-001, AC-009/);
});

test('reviewer rejects step-title AC ids missing from the covered-ac-ids annotation', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const body = singleBodyWithExtras('').replace(
    "description: 'AC-001 AC-002 AC-003'",
    "description: 'AC-001 AC-003'"
  );
  const testPath = writeGeneratedTest(workspace, specPath, body);

  const result = reviewGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(
    result.issues.join('\n'),
    /Primary test step titles name AC-002, but the covered-ac-ids annotation does not declare it/
  );
});

test('reviewer warns (non-blocking) about uncovered NEG cases in single mode', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const testPath = writeGeneratedTest(workspace, specPath, singleBodyWithExtras(''));

  const result = reviewGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, true, result.issues.join('\n'));
  assert.match(result.warnings.join('\n'), /Negative cases without dedicated NEG tests in single mode \(non-blocking\): NEG-001/);
});

test('reviewer accepts a primary test plus a well-formed NEG test in single mode', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const testPath = writeGeneratedTest(workspace, specPath, singleBodyWithNegTest());

  const result = reviewGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, true, result.issues.join('\n'));
  assert.doesNotMatch(result.warnings.join('\n'), /Negative cases without dedicated NEG tests/);
});

test('reviewer rejects single-mode NEG tests without a final Assert NEG step', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const body = singleBodyWithNegTest().replace("'Assert NEG-001: missing email error is visible'", "'Verify NEG-001: outcome'");
  const testPath = writeGeneratedTest(workspace, specPath, body);

  const result = reviewGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /must end with a final step titled "Assert NEG-001: \.\.\."/);
});

test('reviewer rejects single-mode NEG test steps without the NEG token', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const body = singleBodyWithNegTest().replace("'Arrange NEG-001: open checkout'", "'Arrange: open checkout'");
  const testPath = writeGeneratedTest(workspace, specPath, body);

  const result = reviewGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /Negative test step title "Arrange: open checkout" must include the NEG-001 token/);
});

test('reviewer requires the spec Tags to be declared via the Playwright tag option', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const body = singleBodyWithExtras('').replace(", { tag: ['@generated', '@regression'] }", '');
  const testPath = writeGeneratedTest(workspace, specPath, body);

  const result = reviewGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(
    result.issues.join('\n'),
    /Spec metadata Tags \(@generated @regression\) must be declared on the generated describe block or test/
  );
});

test('reviewer rejects Playwright tag declarations that differ from spec Tags', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const body = singleBodyWithExtras('').replace(
    "{ tag: ['@generated', '@regression'] }",
    "{ tag: ['@generated', '@smoke'] }"
  );
  const testPath = writeGeneratedTest(workspace, specPath, body);

  const result = reviewGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(
    result.issues.join('\n'),
    /Playwright tag declaration on test must equal spec metadata Tags exactly\. Expected \[@generated, @regression\]; found \[@generated, @smoke\]/
  );
});

test('gate-all fails a pending-generation spec whose target test already exists', () => {
  const workspace = createGateAllWorkspace();
  writeSpec(path.join(workspace, 'specs'), {
    metadataExtra: ['| Generation Status | pending-generation |']
  });
  fs.renameSync(path.join(workspace, 'specs', 'flow.md'), path.join(workspace, 'specs', 'stale-flow.md'));
  fs.writeFileSync(path.join(workspace, 'tests', 'regression', 'generated.spec.ts'), '// stale generated test\n');

  const result = spawnSync(
    process.execPath,
    [path.join(process.cwd(), 'scripts', 'ai', 'gate-all.mjs'), '--dir', 'specs'],
    { cwd: workspace, encoding: 'utf8' }
  );

  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /Stale Generation Status: .* is marked pending-generation but tests\/regression\/generated\.spec\.ts already exists/);
});

test('gate-all fails closed on pending generation while review-only reports no execution claim', () => {
  const workspace = createGateAllWorkspace();
  writeSpec(path.join(workspace, 'specs'), {
    metadataExtra: ['| Generation Status | pending-generation |']
  });

  const result = spawnSync(
    process.execPath,
    [path.join(process.cwd(), 'scripts', 'ai', 'gate-all.mjs'), '--dir', 'specs'],
    { cwd: workspace, encoding: 'utf8' }
  );

  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Skipping spec awaiting live generation/);
  assert.match(result.stderr, /default gate-all refuses skipped work/);

  const reviewOnly = spawnSync(
    process.execPath,
    [path.join(process.cwd(), 'scripts', 'ai', 'gate-all.mjs'), '--dir', 'specs', '--review-only'],
    { cwd: workspace, encoding: 'utf8' }
  );
  assert.equal(reviewOnly.status, 0, `${reviewOnly.stdout}\n${reviewOnly.stderr}`);
  assert.match(reviewOnly.stdout, /no execution is claimed/);
});

// gate-all resolves ai:spec:validate / ai:test:review through npm in its cwd, so expected-red
// workspaces need a fixture package.json pointing those scripts back at the real repo scripts.
function writeGateAllFixturePackageJson(workspace) {
  const validate = path.join(process.cwd(), 'scripts', 'ai', 'validate-flow-spec.mjs');
  const review = path.join(process.cwd(), 'scripts', 'ai', 'review-generated-test.mjs');
  fs.writeFileSync(
    path.join(workspace, 'package.json'),
    JSON.stringify(
      {
        name: 'gate-all-fixture',
        private: true,
        scripts: {
          'ai:spec:validate': `node ${validate}`,
          'ai:test:review': `node ${review}`
        }
      },
      null,
      2
    )
  );
}

test('gate-all treats a listed expected-red spec whose review fails as confirmed, not a failure', () => {
  const workspace = createGateAllWorkspace();
  writeGateAllFixturePackageJson(workspace);
  writeSpec(path.join(workspace, 'specs'), {});
  // A test that FAILS review (no spec header at all) — the honest-red state.
  fs.writeFileSync(
    path.join(workspace, 'tests', 'regression', 'generated.spec.ts'),
    "import { test } from '../../fixtures/test';\ntest('stub', async () => {});\n"
  );
  fs.writeFileSync(path.join(workspace, 'specs', '.expected-review-red'), 'specs/flow.md\n');

  const result = spawnSync(
    process.execPath,
    [path.join(process.cwd(), 'scripts', 'ai', 'gate-all.mjs'), '--dir', 'specs'],
    { cwd: workspace, encoding: 'utf8' }
  );

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Expected-red review confirmed/);
  assert.match(result.stdout, /Intentional honest-reds confirmed red/);
});

test('gate-all fails when an expected-red spec unexpectedly passes review (inverted assertion)', () => {
  const workspace = createGateAllWorkspace();
  writeGateAllFixturePackageJson(workspace);
  const specPath = writeSpec(path.join(workspace, 'specs'), {});
  // A test that PASSES review: valid single-mode body + correct behavioral hash header.
  fs.writeFileSync(
    path.join(workspace, 'tests', 'regression', 'generated.spec.ts'),
    `/* spec: specs/flow.md version:1.0.0 sha256:${specSha256(specPath)} */\n${singleBodyWithExtras('')}`
  );
  fs.writeFileSync(path.join(workspace, 'specs', '.expected-review-red'), 'specs/flow.md\n');

  const result = spawnSync(
    process.execPath,
    [path.join(process.cwd(), 'scripts', 'ai', 'gate-all.mjs'), '--dir', 'specs'],
    { cwd: workspace, encoding: 'utf8' }
  );

  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /unexpectedly PASSED review/);
});

test('gate-all flags stale expected-red entries that no longer match a spec', () => {
  const workspace = createGateAllWorkspace();
  writeSpec(path.join(workspace, 'specs'), {
    metadataExtra: ['| Generation Status | pending-generation |']
  });
  fs.writeFileSync(path.join(workspace, 'specs', '.expected-review-red'), 'specs/ghost.md\n');

  const result = spawnSync(
    process.execPath,
    [path.join(process.cwd(), 'scripts', 'ai', 'gate-all.mjs'), '--dir', 'specs'],
    { cwd: workspace, encoding: 'utf8' }
  );

  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /no such spec exists\. Remove the stale entry/);
});

test('directory validation flags duplicate Acceptance Criteria bullets pre-dedup', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  // The parser deduplicates AC ids, so the duplicate must be caught on the raw
  // section text. Duplicate the AC-003 bullet line.
  const content = fs.readFileSync(specPath, 'utf8');
  fs.writeFileSync(
    specPath,
    content.replace(
      '- AC-003: User can submit the order request.',
      '- AC-003: User can submit the order request.\n- AC-003: User can submit the order request again.'
    )
  );

  const result = validateSpecDirectory(workspace);

  assert.equal(result.valid, false);
  assert.match(result.issues.join('\n'), /Duplicate AC ID "AC-003" within/);
});

test('bare ai:spec:validate defaults to validating the specs directory', () => {
  const workspace = createGateAllWorkspace();
  writeSpec(path.join(workspace, 'specs'), {
    metadataExtra: ['| Generation Status | pending-generation |']
  });

  const result = spawnSync(
    process.execPath,
    [path.join(process.cwd(), 'scripts', 'ai', 'validate-flow-spec.mjs')],
    { cwd: workspace, encoding: 'utf8' }
  );

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Flow spec directory validation passed: specs/);
});

// --- Iteration-2 reviewer AST-shape regressions -----------------------------
// Shape 1 (8/10 blocking diagnostics): template-literal step titles whose
// STATIC parts carry the AC-### tokens were read as '' by stringValue(), so
// every such step failed "must name the AC id(s)" and cascaded into
// covered-ac-ids derived mismatches. Minimal recreation of the archived
// candidates dbc084f1/35cadb54/00559fb1 (.ai-runs/rejected/*/candidate.ts).

test('reviewer accepts template-literal step titles whose static parts name the AC ids (iteration-2 shape 1)', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const body = singleBodyWithExtras('')
    .replace(
      "await test.step('Act AC-002: submit checkout request', async () => {",
      'await test.step(`Act AC-002: submit checkout request for ${checkoutCase.email}`, async () => {'
    )
    .replace(
      "await test.step('Assert AC-003: confirmation request is visible', async () => {",
      'await test.step(`Assert AC-003: confirmation ${checkoutCase.requestId} is visible`, async () => {'
    );
  const testPath = writeGeneratedTest(workspace, specPath, body);

  const result = reviewGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, true, result.issues.join('\n'));
});

test('reviewer still rejects a template step title whose AC id itself is interpolated (guard)', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const body = singleBodyWithExtras('')
    .replace(
      "const checkoutCase = {",
      "const acLabel = 'AC-001';\n\nconst checkoutCase = {"
    )
    .replace(
      "await test.step('Arrange AC-001: open checkout page', async () => {",
      'await test.step(`Arrange ${acLabel}: open checkout page`, async () => {'
    );
  const testPath = writeGeneratedTest(workspace, specPath, body);

  const result = reviewGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /must name the AC id\(s\)/);
});

test('reviewer still rejects a template step title with no AC id in its static parts', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const body = singleBodyWithExtras('').replace(
    "await test.step('Arrange AC-001: open checkout page', async () => {",
    'await test.step(`Arrange: open ${checkoutCase.email} checkout page`, async () => {'
  );
  const testPath = writeGeneratedTest(workspace, specPath, body);

  const result = reviewGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /must name the AC id\(s\)/);
});

test('template interpolation wildcard cannot merge static spans into a fake AC id', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  // Static parts "Arrange AC-" + "001..." must NOT be read as AC-001: the
  // interpolation sits inside the token, so the id is not statically proven.
  const body = singleBodyWithExtras('').replace(
    "await test.step('Arrange AC-001: open checkout page', async () => {",
    'await test.step(`Arrange AC-${checkoutCase.caseId}001: open checkout page`, async () => {'
  );
  const testPath = writeGeneratedTest(workspace, specPath, body);

  const result = reviewGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /must name the AC id\(s\)/);
});

// Shape 2 (2/10 blocking diagnostics): `const badgeObject = pageObject.badgeObject();
// expect(badgeObject)` — a bare identifier aliasing a Page-Object locator call
// was never an accepted expect receiver.

function poAliasBody(finalStepLines) {
  return singleBodyWithExtras('')
    .replace(
      '  async open(): Promise<void> {',
      '  confirmationRequestLocator(): Locator {\n    return this.confirmationRequest;\n  }\n\n  async open(): Promise<void> {'
    )
    .replace(
      '    await expect(checkoutPage.confirmationRequest).toBeVisible();',
      finalStepLines
    );
}

test('reviewer accepts a const alias of a Page-Object locator call as expect receiver (iteration-2 shape 2)', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const testPath = writeGeneratedTest(
    workspace,
    specPath,
    poAliasBody(
      '    const confirmationRequestObject = checkoutPage.confirmationRequestLocator();\n    await expect(confirmationRequestObject).toBeVisible();'
    )
  );

  const result = reviewGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, true, result.issues.join('\n'));
});

test('reviewer rejects an aliased expect receiver that is reassigned', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const testPath = writeGeneratedTest(
    workspace,
    specPath,
    poAliasBody(
      '    let confirmationRequestObject = checkoutPage.confirmationRequestLocator();\n    confirmationRequestObject = checkoutPage.confirmationRequestLocator();\n    await expect(confirmationRequestObject).toBeVisible();'
    )
  );

  const result = reviewGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /must target a Page or Page Object locator expression/);
});

test('reviewer rejects a bare-identifier expect receiver aliasing a non-Page-Object expression', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const testPath = writeGeneratedTest(
    workspace,
    specPath,
    poAliasBody(
      '    const confirmationRequestObject = checkoutCase;\n    await expect(confirmationRequestObject).toBeVisible();'
    )
  );

  const result = reviewGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /must target a Page or Page Object locator expression/);
});

// --- Remedy-bearing diagnostics (cycle-2 improvement A) ---
// The only observed repair call re-failed the same rule because the diagnostic
// named the violation without its remedy. Both high-frequency rules must state
// the concrete fix, and that remedy must survive verbatim into the repair
// prompt the provider actually sees.

test('expect-target diagnostics carry the move-into-test-body remedy', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const testPath = writeGeneratedTest(
    workspace,
    specPath,
    poAliasBody(
      '    const confirmationRequestObject = checkoutCase;\n    await expect(confirmationRequestObject).toBeVisible();'
    )
  );

  const result = reviewGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, false);
  const joined = result.issues.join('\n');
  assert.match(joined, /must target a Page or Page Object locator expression/);
  assert.match(joined, /Remedy: move the assertion into the test body; expect\(\) inside Page Object methods is not recognized\./);
});

test('remedy clauses reach the generation repair prompt through the gate verdict', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const testPath = writeGeneratedTest(
    workspace,
    specPath,
    poAliasBody(
      '    const confirmationRequestObject = checkoutCase;\n    await expect(confirmationRequestObject).toBeVisible();'
    )
  );

  const result = reviewGeneratedTest({ specPath, testPath });
  assert.equal(result.passed, false);

  const verdict = classifyGeneratedGateFailure({ stage: 'static-review', issues: result.issues });
  const prompt = buildGenerationRepairPrompt({
    source: fs.readFileSync(testPath, 'utf8'),
    verdict
  });

  assert.match(prompt, /move the assertion into the test body/);
  assert.match(prompt, /expect\(\) inside Page Object methods is not recognized/);
});

function createWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ai-review-'));
}

// A workspace shaped like the repo root (specs/ + tests/regression/) so CLI
// scripts that resolve relative paths can run against it as cwd.
function createGateAllWorkspace() {
  const workspace = createWorkspace();
  fs.mkdirSync(path.join(workspace, 'specs'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'tests', 'regression'), { recursive: true });
  return workspace;
}

function reviewSuiteGeneratedTest(args) {
  return reviewGeneratedTest({ ...args, mode: 'suite' });
}

function writeSpec(workspace, overrides = {}) {
  const specPath = path.join(workspace, 'flow.md');
  const flowSteps = overrides.flowSteps ?? [
    '| 1 | AC-001 | Open page | /checkout | n/a | Checkout page is visible | heading is visible |',
    '| 2 | AC-002 | Fill email | Email field | test@example.com | Email accepted | field has value |',
    '| 3 | AC-003 | Submit | Submit button | n/a | Confirmation visible | heading visible |'
  ];
  const stability = overrides.stability ?? [
    '| Parallel Safe | yes |',
    '| Data Isolation | per-test |',
    '| Allowed Retries | 0 |'
  ];
  const variants = overrides.variants ?? { header: ['Locale', 'Role', 'Plan'], rows: [['en-US', 'guest', 'standard']] };
  const includes = overrides.includes ?? ['none'];
  const businessRulesRows = overrides.businessRulesRows ?? [
    '| RULE-001 | Checkout request returns a visible confirmation | Submitting the checkout form returns a request ID | Confirmation is visible |'
  ];
  const dataCasesRows = overrides.dataCasesRows ?? [
    '| DC-001 | email=test@example.com | Confirmation visible | Primary case |'
  ];
  const dataCasesJson =
    overrides.dataCasesJson ??
    [
      {
        caseId: 'DC-001',
        inputs: {
          email: 'test@example.com'
        },
        expected: {
          requestId: 'REQ-1001',
          result: 'Confirmation visible'
        },
        notes: 'Primary case'
      }
    ];
  const dataCasesJsonBlock = overrides.dataCasesJsonBlock ?? JSON.stringify(dataCasesJson, null, 2);
  const mocksJsonBlock =
    overrides.mocksJsonBlock ??
    JSON.stringify(
      [
        {
          method: 'POST',
          url: '/api/orders',
          status: 201,
          body: {
            requestId: 'REQ-1001'
          }
        }
      ],
      null,
      2
    );
  const variantsTable = [
    `| ${variants.header.join(' | ')} |`,
    `|${variants.header.map(() => '---').join('|')}|`,
    ...variants.rows.map((row) => `| ${row.join(' | ')} |`)
  ].join('\n');
  const includesBullets = includes.map((entry) => `- ${entry}`).join('\n');
  let content = `# Flow: Test flow

## Metadata

| Field | Value |
|---|---|
| Flow ID | ${overrides.flowId ?? `FLOW-TEST-${crypto.randomUUID().slice(0, 8)}`} |
| Spec Version | 1.0.0 |
| Owner | ${overrides.owner ?? 'aqa-team@example.com'} |
| Priority | P1 |
| Test Type | regression |
| Auth | ${overrides.auth ?? 'none'} |
| Target Test File | ${overrides.targetTestFile ?? 'tests/regression/generated.spec.ts'} |
| Base Path | /checkout |
| Tags | @generated @regression |
${(overrides.metadataExtra ?? []).join('\n')}

## User Story

As a shopper,
I want to submit a checkout form,
So that I receive a confirmation.

## Preconditions

- Checkout page is available.

## Out-of-scope

- Payment processing.

## Stability Requirements

| Field | Value |
|---|---|
${stability.join('\n')}

## Variants

${variantsTable}

## Includes

${includesBullets}

## Business Rules

| Rule ID | Rule | Formula | Blocking Behavior |
|---|---|---|---|
${businessRulesRows.join('\n')}

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
${dataCasesRows.join('\n')}

## Data Cases as JSON

\`\`\`json
${dataCasesJsonBlock}
\`\`\`

## Test Data

| Name | Value | Notes |
|---|---|---|
| email | test@example.com | fake user only |

## Mocks

| API/Route | Scenario | Response |
|---|---|---|
| /checkout | Open page | HTML form |

## Mocks as JSON

\`\`\`json
${mocksJsonBlock}
\`\`\`

## Flow Steps

| Step | AC IDs | Action | Target | Input | Expected Result | Assertion Hint |
|---:|---|---|---|---|---|---|
${flowSteps.join('\n')}

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | Missing email | Error visible |

## Acceptance Criteria

- AC-001: Checkout entry page is visible.
- AC-002: User can fill required contact fields.
- AC-003: User can submit the order request.

## Locator Hints

${(overrides.locatorHints ?? [
  "- Prefer `getByRole('heading', { name: 'Checkout' })` for the page heading.",
  "- Prefer `getByRole('button', { name: 'Place order request' })` for submission."
]).join('\n')}

## Generated Test Requirements

- Must import from fixtures/test.
- Must use test.step.
- Must use semantic locators.
- Must include meaningful expect assertions.
- Default generation mode is single-test mode.
- Generate a suite only when explicitly requested.
- In single-test mode, must generate one requested-scenario test with one primary final assertion step.
- In suite mode, must cover every AC ID from this spec.
- Default generated-test execution target is Chromium only.
- Cross-browser generated-test execution is opt-in.
- Must annotate or comment AC coverage.
- Must not use page.waitForTimeout.
- Must not use XPath.
- Must not use test.only.
- Must not silently skip.
- Must not use real credentials.
- Must not commit auth state.
${(overrides.extraRequirements ?? []).join('\n')}

## Notes

- Test fixture spec.
`;

  if (content.includes('__BEHAVIORAL_HASH__')) {
    content = content.replace('__BEHAVIORAL_HASH__', specSha256(content));
  }
  fs.writeFileSync(specPath, content);
  return specPath;
}

function singleBodyWithExtras(extra) {
  return `
import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../fixtures/test';

const checkoutCase = {
  caseId: 'DC-001',
  email: 'test@example.com',
  requestId: 'REQ-1001'
} as const;

class CheckoutPage {
  readonly heading: Locator;
  readonly email: Locator;
  readonly submitButton: Locator;
  readonly confirmationRequest: Locator;

  constructor(private readonly page: Page) {
    this.heading = this.page.getByRole('heading', { name: 'Checkout' });
    this.email = this.page.getByLabel('Email');
    this.submitButton = this.page.getByRole('button', { name: 'Place order request' });
    this.confirmationRequest = this.page.getByText(checkoutCase.requestId);
  }

  async open(): Promise<void> {
    await this.page.goto('/checkout');
    await this.heading.waitFor({ state: 'visible' });
  }

  async fillEmail(email: string): Promise<void> {
    await this.email.fill(email);
  }

  async submitOrder(): Promise<void> {
    await this.submitButton.click();
  }
}

async function mockOrderApi(page: Page): Promise<void> {
  await page.route('**/api/orders', async (route) => {
    const method = 'POST';
    void method;
    await route.fulfill({ status: 201, body: JSON.stringify({ requestId: checkoutCase.requestId }) });
  });
}

test('DC-001 AC-003: checkout request shows confirmation', { tag: ['@generated', '@regression'] }, async ({ page }) => {
  test.info().annotations.push({
    type: 'covered-ac-ids',
    description: 'AC-001 AC-002 AC-003'
  });

  const checkoutPage = new CheckoutPage(page);

  await test.step('Arrange AC-001: open checkout page', async () => {
    await mockOrderApi(page);
    await checkoutPage.open();
  });

  await test.step('Act AC-002: submit checkout request', async () => {
    await checkoutPage.fillEmail(checkoutCase.email);
    await checkoutPage.submitOrder();
  });

  await test.step('Assert AC-003: confirmation request is visible', async () => {
    await expect(checkoutPage.confirmationRequest).toBeVisible();
${extra ? `    ${extra.replace(/^\s+/gm, '    ').trim()}` : ''}
  });
});
`;
}

// Single-mode body: one primary test plus a well-formed optional NEG test
// (NEG token in every step title, final "Assert NEG-###: ..." step).
function singleBodyWithNegTest() {
  return (
    singleBodyWithExtras('')
      .replace(
        'readonly confirmationRequest: Locator;',
        'readonly confirmationRequest: Locator;\n  readonly emailError: Locator;'
      )
      .replace(
        'this.confirmationRequest = this.page.getByText(checkoutCase.requestId);',
        "this.confirmationRequest = this.page.getByText(checkoutCase.requestId);\n    this.emailError = this.page.getByText('Error visible');"
      ) +
    `
test('NEG-001: missing email shows validation', async ({ page }) => {
  const checkoutPage = new CheckoutPage(page);

  await test.step('Arrange NEG-001: open checkout', async () => {
    await mockOrderApi(page);
    await checkoutPage.open();
  });

  await test.step('Act NEG-001: submit without email', async () => {
    await checkoutPage.submitOrder();
  });

  await test.step('Assert NEG-001: missing email error is visible', async () => {
    await expect(checkoutPage.emailError).toBeVisible();
  });
});
`
  );
}

function validBodyWithExtras(extra) {
  return `
import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../fixtures/test';

const checkoutCase = {
  email: 'test@example.com',
  requestId: 'REQ-1001'
} as const;

class CheckoutPage {
  readonly heading: Locator;
  readonly email: Locator;
  readonly submitButton: Locator;
  readonly confirmationRequest: Locator;
  readonly emailError: Locator;

  constructor(private readonly page: Page) {
    this.heading = this.page.getByRole('heading', { name: 'Checkout' });
    this.email = this.page.getByLabel('Email');
    this.submitButton = this.page.getByRole('button', { name: 'Place order request' });
    this.confirmationRequest = this.page.getByText(checkoutCase.requestId);
    this.emailError = this.page.getByText('Error visible');
  }

  async open(): Promise<void> {
    await this.page.goto('/checkout');
    await this.heading.waitFor({ state: 'visible' });
  }

  async fillEmail(email: string): Promise<void> {
    await this.email.fill(email);
  }

  async submitOrder(): Promise<void> {
    await this.submitButton.click();
  }
}

async function mockOrderApi(page: Page): Promise<void> {
  await page.route('**/api/orders', async (route) => {
    const method = 'POST';
    void method;
    await route.fulfill({ status: 201, body: JSON.stringify({ requestId: checkoutCase.requestId }) });
  });
}

test('AC-001: checkout entry page is visible', { tag: ['@generated', '@regression'] }, async ({ page }) => {
  const checkoutPage = new CheckoutPage(page);

  await test.step('Arrange: mock checkout API', async () => {
    await mockOrderApi(page);
  });
  await test.step('Act: open checkout', async () => {
    await checkoutPage.open();
  });
  await test.step('Assert AC-001: checkout entry page is visible', async () => {
    await expect(checkoutPage.heading).toBeVisible();
  });
});

test('AC-002: user can fill contact fields', { tag: ['@generated', '@regression'] }, async ({ page }) => {
  const checkoutPage = new CheckoutPage(page);

  await test.step('Arrange: open checkout', async () => {
    await mockOrderApi(page);
    await checkoutPage.open();
  });
  await test.step('Act: fill contact email', async () => {
    await checkoutPage.fillEmail(checkoutCase.email);
  });
  await test.step('Assert AC-002: email field contains submitted value', async () => {
    await expect(checkoutPage.email).toHaveValue(checkoutCase.email);
  });
});

test('AC-003: user can submit order request', { tag: ['@generated', '@regression'] }, async ({ page }) => {
  const checkoutPage = new CheckoutPage(page);

  await test.step('Arrange: completed checkout form', async () => {
    await mockOrderApi(page);
    await checkoutPage.open();
    await checkoutPage.fillEmail(checkoutCase.email);
  });
  await test.step('Act: submit order request', async () => {
    await checkoutPage.submitOrder();
  });
  await test.step('Assert AC-003: confirmation request is visible', async () => {
    await expect(checkoutPage.confirmationRequest).toBeVisible();
  });
});

test('NEG-001: missing email shows validation', { tag: ['@generated', '@regression'] }, async ({ page }) => {
  const checkoutPage = new CheckoutPage(page);

  await test.step('Arrange: open checkout', async () => {
    await mockOrderApi(page);
    await checkoutPage.open();
  });
  await test.step('Act: submit without email', async () => {
    await checkoutPage.submitOrder();
  });
  await test.step('Assert NEG-001: missing email error is visible', async () => {
    await expect(checkoutPage.emailError).toBeVisible();
${extra ? `    ${extra.replace(/^\s+/gm, '    ').trim()}` : ''}
  });
});
`;
}

function realMockBodyWithoutDataCaseIds() {
  return `
import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../fixtures/test';

class CheckoutPage {
  readonly heading: Locator;
  readonly email: Locator;
  readonly submitButton: Locator;
  readonly confirmationRequest: Locator;
  readonly emailError: Locator;

  constructor(private readonly page: Page) {
    this.heading = this.page.getByRole('heading', { name: 'Checkout' });
    this.email = this.page.getByLabel('Email');
    this.submitButton = this.page.getByRole('button', { name: 'Place order request' });
    this.confirmationRequest = this.page.getByText('REQ-1001');
    this.emailError = this.page.getByText('Error visible');
  }

  async open(): Promise<void> {
    await this.page.goto('/checkout');
    await this.heading.waitFor({ state: 'visible' });
  }

  async fillEmail(email: string): Promise<void> {
    await this.email.fill(email);
  }

  async submitOrder(): Promise<void> {
    await this.submitButton.click();
  }
}

async function mockOrderApi(page: Page): Promise<void> {
  await page.route('**/api/orders', async (route) => {
    const method = 'POST';
    void method;
    await route.fulfill({ status: 201, body: JSON.stringify({ requestId: 'REQ-1001' }) });
  });
}

test('AC-001: checkout entry page is visible', { tag: ['@generated', '@regression'] }, async ({ page }) => {
  const checkoutPage = new CheckoutPage(page);

  await test.step('Arrange: mock checkout API', async () => {
    await mockOrderApi(page);
  });
  await test.step('Act: open checkout', async () => {
    await checkoutPage.open();
  });
  await test.step('Assert AC-001: checkout entry page is visible', async () => {
    await expect(checkoutPage.heading).toBeVisible();
  });
});

test('AC-002: user can fill contact fields', { tag: ['@generated', '@regression'] }, async ({ page }) => {
  const checkoutPage = new CheckoutPage(page);

  await test.step('Arrange: open checkout', async () => {
    await mockOrderApi(page);
    await checkoutPage.open();
  });
  await test.step('Act: fill contact email', async () => {
    await checkoutPage.fillEmail('test@example.com');
  });
  await test.step('Assert AC-002: email field contains submitted value', async () => {
    await expect(checkoutPage.email).toHaveValue('test@example.com');
  });
});

test('AC-003: user can submit order request', { tag: ['@generated', '@regression'] }, async ({ page }) => {
  const checkoutPage = new CheckoutPage(page);

  await test.step('Arrange: completed checkout form', async () => {
    await mockOrderApi(page);
    await checkoutPage.open();
    await checkoutPage.fillEmail('test@example.com');
  });
  await test.step('Act: submit order request', async () => {
    await checkoutPage.submitOrder();
  });
  await test.step('Assert AC-003: confirmation request is visible', async () => {
    await expect(checkoutPage.confirmationRequest).toBeVisible();
  });
});

test('NEG-001: missing email shows validation', { tag: ['@generated', '@regression'] }, async ({ page }) => {
  const checkoutPage = new CheckoutPage(page);

  await test.step('Arrange: open checkout', async () => {
    await mockOrderApi(page);
    await checkoutPage.open();
  });
  await test.step('Act: submit without email', async () => {
    await checkoutPage.submitOrder();
  });
  await test.step('Assert NEG-001: missing email error is visible', async () => {
    await expect(checkoutPage.emailError).toBeVisible();
  });
});
`;
}

function writeGeneratedTest(workspace, specPath, body, headerHash = undefined) {
  const testPath = path.join(workspace, 'generated.spec.ts');
  const hash = headerHash ?? specSha256(specPath);
  fs.writeFileSync(testPath, `/* spec: ${specPath} version:1.0.0 sha256:${hash} */\n${body}`);
  return testPath;
}

// --- Non-blocking grounding warnings (iteration-1 runtime-rejection shapes) ---

function bodyWithPageObjectMembers({ fields = '', constructorLines = '', methods = '' } = {}) {
  return singleBodyWithExtras('')
    .replace(
      '  readonly confirmationRequest: Locator;',
      `  readonly confirmationRequest: Locator;\n${fields}`
    )
    .replace(
      '    this.confirmationRequest = this.page.getByText(checkoutCase.requestId);',
      `    this.confirmationRequest = this.page.getByText(checkoutCase.requestId);\n${constructorLines}`
    )
    .replace(
      '  async open(): Promise<void> {',
      `${methods}  async open(): Promise<void> {`
    );
}

test('reviewer warns (non-blocking) on accessible-name literals not traceable to hints or salient tokens', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  // Iteration-1 rejection shapes: the wizard's hallucinated 'Consent' checkbox
  // name and the catalog's exact-true 'Price' column header (real header text
  // was 'Price ↑' because of a CSS ::after sort arrow).
  const body = bodyWithPageObjectMembers({
    fields: '  readonly consent: Locator;\n  readonly priceHeader: Locator;',
    constructorLines: [
      "    this.consent = this.page.getByRole('checkbox', { name: 'Consent' });",
      "    this.priceHeader = this.page.getByRole('columnheader', { name: 'Price', exact: true });"
    ].join('\n')
  });
  const testPath = writeGeneratedTest(workspace, specPath, body);

  const result = reviewGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, true, result.issues.join('\n'));
  const warningsText = result.warnings.join('\n');
  assert.match(warningsText, /Ungrounded accessible name[^\n]*'Consent'/);
  assert.match(warningsText, /Ungrounded accessible name[^\n]*'Price'/);
});

test('reviewer keeps grounded accessible names silent (hints, salient tokens, DOM candidates)', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace, {
    locatorHints: [
      "- Prefer `getByRole('heading', { name: 'Checkout' })` for the page heading.",
      "- Prefer `getByRole('button', { name: 'Place order request' })` for submission.",
      "- The email field is `getByLabel('Email')`."
    ]
  });
  // 'REQ-1001' is a salient expected value from the data cases; 'Price ↑' is
  // only known from the DOM artifact candidate list.
  const body = bodyWithPageObjectMembers({
    fields: '  readonly requestBadge: Locator;\n  readonly priceHeader: Locator;',
    constructorLines: [
      "    this.requestBadge = this.page.getByRole('link', { name: 'REQ-1001', exact: true });",
      "    this.priceHeader = this.page.getByRole('columnheader', { name: 'Price ↑', exact: true });"
    ].join('\n')
  });
  const testPath = writeGeneratedTest(workspace, specPath, body);

  const withDomCandidates = reviewGeneratedTest({
    specPath,
    testPath,
    domCandidateNames: ['Price ↑']
  });
  assert.equal(withDomCandidates.passed, true, withDomCandidates.issues.join('\n'));
  assert.doesNotMatch(withDomCandidates.warnings.join('\n'), /Ungrounded accessible name/);

  // Without the DOM candidate list, the same 'Price ↑' literal is ungrounded.
  const withoutDomCandidates = reviewGeneratedTest({ specPath, testPath });
  assert.equal(withoutDomCandidates.passed, true);
  assert.match(withoutDomCandidates.warnings.join('\n'), /Ungrounded accessible name[^\n]*'Price ↑'/);
});

test('reviewer warns (non-blocking) on getAttribute reads guarded by a manual throw', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  // Iteration-1 catalog rejection shape: aria-sort read via getAttribute with
  // a hand-rolled throw instead of the auto-retrying toHaveAttribute.
  const body = bodyWithPageObjectMembers({
    methods: `  async assertPriceSorted(expectedAriaSort: string): Promise<void> {
    const actualAriaSort = await this.heading.getAttribute('aria-sort');
    if (actualAriaSort !== expectedAriaSort) {
      throw new Error('Expected Price header aria-sort=' + expectedAriaSort);
    }
  }

  async assertInlineSorted(): Promise<void> {
    if ((await this.heading.getAttribute('aria-sort')) !== 'ascending') {
      throw new Error('Price header is not sorted ascending');
    }
  }

`
  });
  const testPath = writeGeneratedTest(workspace, specPath, body);

  const result = reviewGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, true, result.issues.join('\n'));
  const attributeWarnings = result.warnings.filter((warning) => /Non-retrying attribute assertion/.test(warning));
  assert.equal(attributeWarnings.length, 2, result.warnings.join('\n'));
  assert.match(attributeWarnings.join('\n'), /toHaveAttribute/);
});

test('reviewer stays silent on retrying attribute assertions and unguarded attribute reads', () => {
  const workspace = createWorkspace();
  const specPath = writeSpec(workspace);
  const body = bodyWithPageObjectMembers({
    methods: `  async readSortState(): Promise<string | null> {
    return this.heading.getAttribute('aria-sort');
  }

`
  }).replace(
    '    await expect(checkoutPage.confirmationRequest).toBeVisible();',
    [
      '    await expect(checkoutPage.confirmationRequest).toBeVisible();',
      "    await expect(checkoutPage.heading).toHaveAttribute('aria-sort', 'ascending');"
    ].join('\n')
  );
  const testPath = writeGeneratedTest(workspace, specPath, body);

  const result = reviewGeneratedTest({ specPath, testPath });

  assert.equal(result.passed, true, result.issues.join('\n'));
  assert.doesNotMatch(result.warnings.join('\n'), /Non-retrying attribute assertion/);
});
