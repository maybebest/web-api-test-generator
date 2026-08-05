import assert from 'node:assert/strict';
import test from 'node:test';

import * as testHeal from '../lib/test-heal.mjs';

const { MAX_HEAL_SOURCE_BYTES, verifyHealedSourcePolicy } = testHeal;

const SOURCE = `/* recording: recordings/save.json title:Save sha256:${'a'.repeat(64)} */
import { test, expect } from '../../fixtures/test';
const payload = { planName: 'Summer' };
test('RSTEP-001 saves', { tag: ['@save'] }, async ({ page }) => {
  await test.step('ASSERT-001 result', async () => {
    await page.getByLabel('Plan name').fill(payload.planName);
    await expect(page.getByTestId('status')).toHaveText('Saved');
  });
});`;

test('policy assigns stable codes to every previously prose-only warning', () => {
  const sourceWithTwoMatchers = SOURCE.replace(
    "    await expect(page.getByTestId('status')).toHaveText('Saved');",
    "    await expect(page.getByTestId('status')).toHaveText('Saved');\n"
      + "    await expect(page.getByTestId('status')).toBeVisible();"
  );
  const cases = [
    ['empty source', SOURCE, '', 'EMPTY_HEALED_SOURCE'],
    ['oversized source', SOURCE, ' '.repeat(MAX_HEAL_SOURCE_BYTES + 1), 'HEALED_SOURCE_TOO_LARGE'],
    ['parse failure', SOURCE, 'import {', 'SOURCE_PARSE_FAILED'],
    ['skip family', SOURCE, SOURCE.replace("test('RSTEP-001 saves'", "test.skip('RSTEP-001 saves'"), 'SKIP_FAMILY_INTRODUCED'],
    ['dynamic test access', SOURCE, SOURCE.replace("test('RSTEP-001 saves'", "test[dynamicTestMethod]('RSTEP-001 saves'"), 'DYNAMIC_TEST_ACCESS_INTRODUCED'],
    ['hard sleep', SOURCE, SOURCE.replace(
      "    await page.getByLabel('Plan name').fill(payload.planName);",
      "    await page.waitForTimeout(100);\n    await page.getByLabel('Plan name').fill(payload.planName);"
    ), 'WAIT_FOR_TIMEOUT_INTRODUCED'],
    ['XPath', SOURCE, SOURCE.replace("page.getByLabel('Plan name')", "page.locator('xpath=//input')"), 'XPATH_INTRODUCED'],
    ['nth-child', SOURCE, SOURCE.replace("page.getByLabel('Plan name')", "page.locator('input:nth-child(1)')"), 'NTH_CHILD_INTRODUCED'],
    ['positional pick', SOURCE, SOURCE.replace("page.getByLabel('Plan name')", "page.getByLabel('Plan name').first()"), 'POSITIONAL_LOCATOR_EXCEPTION_MISSING'],
    ['assertion removal', SOURCE, SOURCE.replace("    await expect(page.getByTestId('status')).toHaveText('Saved');\n", ''), 'ASSERTION_COUNT_REDUCED'],
    ['matcher reduction', sourceWithTwoMatchers, sourceWithTwoMatchers.replace("    await expect(page.getByTestId('status')).toHaveText('Saved');\n", ''), 'ASSERTION_MATCHER_REDUCED'],
    ['try/catch', SOURCE, SOURCE.replace(
      "    await expect(page.getByTestId('status')).toHaveText('Saved');",
      "    try {\n      await expect(page.getByTestId('status')).toHaveText('Saved');\n    } catch {}"
    ), 'TRY_CATCH_INTRODUCED'],
    ['guarded assertion', SOURCE, SOURCE.replace(
      "    await expect(page.getByTestId('status')).toHaveText('Saved');",
      "    if (await page.getByTestId('status').isVisible()) {\n"
        + "      await expect(page.getByTestId('status')).toHaveText('Saved');\n    }"
    ), 'GUARDED_ASSERTION_INTRODUCED'],
    ['secret-like literal', SOURCE, `${SOURCE}\nconst leaked = 'sk_live_1234567890abcdefghijklmnop';\n`, 'SECRET_LIKE_LITERAL']
  ];

  for (const [label, previousSource, healedSource, expectedCode] of cases) {
    const result = verifyHealedSourcePolicy({ previousSource, healedSource });
    assert.equal(result.passed, false, label);
    assert.ok(result.issueCodes.includes(expectedCode), `${label}: ${expectedCode}`);
  }
});

test('policy warning normalization keeps only allowlisted unique codes and supplies a safe fallback', () => {
  assert.equal(typeof testHeal.normalizeHealPolicyIssueCodes, 'function');
  assert.deepEqual(
    testHeal.normalizeHealPolicyIssueCodes([
      'SKIP_FAMILY_INTRODUCED',
      'provider supplied detail',
      'SKIP_FAMILY_INTRODUCED',
      'WAIT_FOR_TIMEOUT_INTRODUCED'
    ]),
    ['SKIP_FAMILY_INTRODUCED', 'WAIT_FOR_TIMEOUT_INTRODUCED']
  );
  assert.deepEqual(
    testHeal.normalizeHealPolicyIssueCodes(['provider supplied detail'], { requireAtLeastOne: true }),
    ['POLICY_WARNING_UNCLASSIFIED']
  );
  assert.deepEqual(testHeal.normalizeHealPolicyIssueCodes(undefined), []);
});

for (const [label, candidate, code] of [
  ['expected value', SOURCE.replace("'Saved'", "'Save failed'"), 'ASSERTION_ARGUMENT_CHANGED'],
  ['test title', SOURCE.replace('RSTEP-001 saves', 'unrelated test'), 'TEST_TITLE_CHANGED'],
  ['recording header', SOURCE.replace(/^\/\* recording:.*\*\/\n/, ''), 'TRACEABILITY_HEADER_CHANGED'],
  ['action payload', SOURCE.replace('fill(payload.planName)', "fill('Other')"), 'ACTION_PAYLOAD_CHANGED'],
  ['tag', SOURCE.replace("'@save'", "'@other'"), 'TEST_OPTIONS_CHANGED']
]) {
  test(`policy rejects changed ${label}`, () => {
    const result = verifyHealedSourcePolicy({ previousSource: SOURCE, healedSource: candidate });
    assert.equal(result.passed, false);
    assert.ok(result.issueCodes.includes(code));
  });
}

test('policy rejects changing a non-locator assertion subject', () => {
  const source = `import { test, expect } from '../../fixtures/test';
test('total stays correct', async ({ actualTotal, unrelatedTotal }) => {
  await expect(actualTotal).toBe(42);
});`;
  const candidate = source.replace('expect(actualTotal)', 'expect(unrelatedTotal)');

  const result = verifyHealedSourcePolicy({ previousSource: source, healedSource: candidate });

  assert.equal(result.passed, false);
  assert.ok(result.issueCodes.includes('ASSERTION_ARGUMENT_CHANGED'));
});

test('policy rejects changing an aliased request mutation payload', () => {
  const source = `import { test } from '../../fixtures/test';
test('enables the setting', async ({ request: api }) => {
  await api.post('/settings', { data: { enabled: true } });
});`;
  const candidate = source.replace('enabled: true', 'enabled: false');

  const result = verifyHealedSourcePolicy({ previousSource: source, healedSource: candidate });

  assert.equal(result.passed, false);
  assert.ok(result.issueCodes.includes('ACTION_PAYLOAD_CHANGED'));
});

test('policy records title drift for test declaration variants', () => {
  const source = `import { test, expect } from '../../fixtures/test';
test.only('locked title', async () => {
  await expect(1).toBe(1);
});`;
  const candidate = source.replace('locked title', 'changed title');

  const result = verifyHealedSourcePolicy({ previousSource: source, healedSource: candidate });

  assert.equal(result.passed, false);
  assert.ok(result.issueCodes.includes('TEST_TITLE_CHANGED'));
});

function assertPolicyRejected(source, candidate, label) {
  const result = verifyHealedSourcePolicy({ previousSource: source, healedSource: candidate });
  assert.equal(result.passed, false, `${label} must fail closed`);
  assert.ok(result.issues.length > 0, `${label} must report a bounded policy issue`);
  return result;
}

test('policy compares the complete executable AST outside locator and synchronization repairs', () => {
  const source = `import { test, expect } from '../../fixtures/test';
let planName = 'Summer';
async function submit(page) {
  await page.getByRole('button', { name: 'Save' }).click();
}
test('saves the plan', async ({ page }) => {
  await submit(page);
  planName = 'Autumn';
  await expect(page.getByTestId('status')).toHaveText(planName);
});`;
  const cases = [
    ['action removal', source.replace("  await page.getByRole('button', { name: 'Save' }).click();\n", '')],
    ['page reload', source.replace('  await submit(page);', '  await page.reload();\n  await submit(page);')],
    ['DOM-mutating page.evaluate', source.replace(
      '  await submit(page);',
      "  await page.evaluate(() => document.body.dataset.healed = 'yes');\n  await submit(page);"
    )],
    ['let initializer drift', source.replace("let planName = 'Summer';", "let planName = 'Winter';")],
    ['assignment drift', source.replace("planName = 'Autumn';", "planName = 'Winter';")],
    ['helper body drift', source.replace('await page.getByRole', 'await page.reload();\n  await page.getByRole')],
    ['control-flow drift', source.replace('  await submit(page);', '  if (page) {\n    await submit(page);\n  }')],
    ['while-loop drift', source.replace(
      '  await submit(page);',
      '  while (page) {\n    await submit(page);\n    break;\n  }'
    )]
  ];

  for (const [label, candidate] of cases) assertPolicyRejected(source, candidate, label);
});

test('policy retains locator replacement and explicit locator-wait synchronization repairs', () => {
  const locatorRepair = SOURCE.replace(
    "page.getByLabel('Plan name')",
    "page.getByTestId('plan-name')"
  );
  assert.deepEqual(
    verifyHealedSourcePolicy({ previousSource: SOURCE, healedSource: locatorRepair }),
    { passed: true, issues: [], issueCodes: [] }
  );

  const synchronizationRepair = SOURCE.replace(
    "    await page.getByLabel('Plan name').fill(payload.planName);",
    "    await page.getByLabel('Plan name').waitFor({ state: 'visible' });\n"
      + "    await page.getByLabel('Plan name').fill(payload.planName);"
  );
  assert.deepEqual(
    verifyHealedSourcePolicy({ previousSource: SOURCE, healedSource: synchronizationRepair }),
    { passed: true, issues: [], issueCodes: [] }
  );
});

test('policy rejects locator changes whose arguments are not side-effect-free static expressions', () => {
  const candidate = SOURCE.replace(
    "page.getByLabel('Plan name')",
    'page.getByRole(resolveRoleFromProductState())'
  );
  assertPolicyRejected(SOURCE, candidate, 'effectful locator argument');

  const unknownFactory = SOURCE.replace(
    "page.getByLabel('Plan name')",
    "page.getByProductState('Plan name')"
  );
  assertPolicyRejected(SOURCE, unknownFactory, 'unvalidated getBy factory');
});

test('policy keeps getter, computed-read, proxy, and spread effects outside locator holes', () => {
  const getterSource = `import { test } from '../../fixtures/test';
const locatorState = {
  get role() {
    document.body.dataset.locatorRead = 'yes';
    return 'button';
  }
};
test('uses a static role', async ({ page }) => {
  await page.getByRole('button', { name: 'Save' }).click();
});`;
  for (const [label, role] of [
    ['getter property read', 'locatorState.role'],
    ['getter element read', "locatorState['role']"]
  ]) {
    assertPolicyRejected(
      getterSource,
      getterSource.replace("getByRole('button'", `getByRole(${role}`),
      label
    );
  }

  const proxySource = `import { test } from '../../fixtures/test';
const locatorOptions = new Proxy({ name: 'Save' }, {
  get(target, key) {
    document.body.dataset.locatorRead = String(key);
    return Reflect.get(target, key);
  }
});
test('uses static options', async ({ page }) => {
  await page.getByRole('button', { name: 'Save' }).click();
});`;
  assertPolicyRejected(
    proxySource,
    proxySource.replace("{ name: 'Save' }).click()", '{ ...locatorOptions }).click()'),
    'proxy options spread'
  );
});

test('policy does not hide effectful locator receivers in synchronization or nested locator holes', () => {
  const source = `import { test } from '../../fixtures/test';
function mutateDomAndReturnPage(page) {
  document.body.dataset.locatorRead = 'yes';
  return page;
}
test('uses a safe locator root', async ({ page }) => {
  await page.getByRole('button', { name: 'Save' }).click();
});`;
  const synchronizationCandidate = source.replace(
    "  await page.getByRole('button', { name: 'Save' }).click();",
    "  await mutateDomAndReturnPage(page).getByText('Ready').waitFor({ state: 'visible' });\n"
      + "  await page.getByRole('button', { name: 'Save' }).click();"
  );
  assertPolicyRejected(source, synchronizationCandidate, 'effectful synchronization locator root');

  const nestedLocatorCandidate = source.replace(
    "page.getByRole('button', { name: 'Save' })",
    "page.getByRole('button', { name: 'Save' }).filter({ "
      + "has: mutateDomAndReturnPage(page).getByText('Ready') })"
  );
  assertPolicyRejected(source, nestedLocatorCandidate, 'effectful nested locator root');
});

test('policy rejects new compiler, lint, arbitrary, and unjustified exception comments', () => {
  for (const [label, comment] of [
    ['TypeScript suppression', '// @ts-ignore'],
    ['ESLint suppression', '// eslint-disable-next-line no-undef'],
    ['arbitrary comment', '// trust this healed selector'],
    ['unjustified locator exception', '// locator-policy:exception']
  ]) {
    const candidate = SOURCE.replace(
      "    await page.getByLabel('Plan name').fill(payload.planName);",
      `    ${comment}\n    await page.getByLabel('Plan name').fill(payload.planName);`
    );
    const result = assertPolicyRejected(SOURCE, candidate, label);
    assert.ok(result.issueCodes.includes('COMMENTS_CHANGED'), `${label} comment code`);
  }
});

test('policy rejects moving an existing suppression comment onto a healed locator', () => {
  const source = `import { test } from '../../fixtures/test';
test('keeps suppression placement', async ({ page }) => {
  // @ts-ignore fixture intentionally exercises an impossible assignment
  const impossible: never = 'fixture';
  await page.getByLabel('Plan name').fill('Summer');
});`;
  const candidate = source
    .replace('  // @ts-ignore fixture intentionally exercises an impossible assignment\n', '')
    .replace(
      "  await page.getByLabel('Plan name').fill('Summer');",
      "  // @ts-ignore fixture intentionally exercises an impossible assignment\n"
        + "  await page.getByTestId('plan-name').fill('Summer');"
    );

  const result = assertPolicyRejected(source, candidate, 'moved TypeScript suppression');

  assert.ok(result.issueCodes.includes('COMMENTS_CHANGED'));
});

test('policy rejects a remote locator exception that does not precede its positional pick', () => {
  for (const candidate of [
    `// locator-policy:exception remote note does not document the healed locator\n${SOURCE.replace(
      "page.getByTestId('status')",
      "page.getByRole('status').first()"
    )}`,
    `${SOURCE.replace(
      "page.getByTestId('status')",
      "page.getByRole('status').first()"
    )}\n// locator-policy:exception remote EOF note does not document the healed locator`
  ]) {
    const result = assertPolicyRejected(SOURCE, candidate, 'remote locator exception');
    assert.ok(result.issueCodes.includes('COMMENTS_CHANGED'));
  }
});

test('policy cannot bind a new exception to an unchanged positional locator', () => {
  const source = `import { test } from '../../fixtures/test';
test('uses one existing positional locator', async ({ page }) => {
  await page.getByRole('status').first().click();
  await page.getByRole('button', { name: 'Save' }).click();
});`;
  const candidate = source
    .replace(
      "  await page.getByRole('status').first().click();",
      '  // locator-policy:exception this note only describes the existing status locator\n'
        + "  await page.getByRole('status').first().click();"
    )
    .replace(
      "page.getByRole('button', { name: 'Save' })",
      "page.getByRole('button', { name: 'Save' }).nth(2)"
    );

  const result = assertPolicyRejected(source, candidate, 'misbound locator exception');

  assert.ok(result.issueCodes.includes('COMMENTS_CHANGED'));
});

test('policy synchronization allowlist excludes outcome-bearing hidden and detached waits', () => {
  for (const state of ['hidden', 'detached']) {
    const candidate = SOURCE.replace(
      "    await page.getByLabel('Plan name').fill(payload.planName);",
      `    await page.getByLabel('Plan name').waitFor({ state: '${state}' });\n`
        + "    await page.getByLabel('Plan name').fill(payload.planName);"
    );
    assertPolicyRejected(SOURCE, candidate, `${state} locator wait`);
  }
});

test('policy preserves assertion step, branch, loop, and pre-action position', () => {
  const prefix = `import { test, expect } from '../../fixtures/test';\n`;
  const stepSource = `${prefix}test('step position', async ({ page }) => {
  await test.step('act', async () => {
    await page.getByTestId('save').click();
  });
  await test.step('assert', async () => {
    await expect(page.getByTestId('status')).toHaveText('Saved');
  });
});`;
  const stepCandidate = stepSource
    .replace("    await page.getByTestId('save').click();", "    await expect(page.getByTestId('status')).toHaveText('Saved');")
    .replace("    await expect(page.getByTestId('status')).toHaveText('Saved');\n  });\n});", "    await page.getByTestId('save').click();\n  });\n});");

  const branchSource = `${prefix}test('branch position', async ({ page, enabled }) => {
  if (enabled) {
    await expect(page.getByTestId('status')).toHaveText('Saved');
  } else {
    await page.getByTestId('cancel').click();
  }
});`;
  const branchCandidate = branchSource
    .replace("    await expect(page.getByTestId('status')).toHaveText('Saved');", "    await page.getByTestId('cancel').click();")
    .replace("    await page.getByTestId('cancel').click();\n  }\n});", "    await expect(page.getByTestId('status')).toHaveText('Saved');\n  }\n});");

  const loopSource = `${prefix}test('loop position', async ({ page, items }) => {
  for (const item of items) {
    await item.open();
  }
  await expect(page.getByTestId('status')).toHaveText('Saved');
});`;
  const loopCandidate = loopSource
    .replace('    await item.open();', "    await expect(page.getByTestId('status')).toHaveText('Saved');")
    .replace("  await expect(page.getByTestId('status')).toHaveText('Saved');\n});", '  await item.open();\n});');

  const actionSource = `${prefix}test('action position', async ({ page }) => {
  await page.getByTestId('save').click();
  await expect(page.getByTestId('status')).toHaveText('Saved');
});`;
  const actionCandidate = `${prefix}test('action position', async ({ page }) => {
  await expect(page.getByTestId('status')).toHaveText('Saved');
  await page.getByTestId('save').click();
});`;

  for (const [label, source, candidate] of [
    ['step move', stepSource, stepCandidate],
    ['branch move', branchSource, branchCandidate],
    ['loop move', loopSource, loopCandidate],
    ['pre-action move', actionSource, actionCandidate]
  ]) assertPolicyRejected(source, candidate, label);
});

test('policy preserves the complete Playwright action inventory, identity, options, and removal', () => {
  const actionCases = [
    ['click', ''],
    ['dblclick', "{ button: 'left' }"],
    ['check', "{ force: false }"],
    ['uncheck', "{ position: { x: 1, y: 2 } }"],
    ['hover', "{ trial: true }"],
    ['focus', ''],
    ['blur', ''],
    ['clear', "{ timeout: 500 }"],
    ['dispatchEvent', "'input', { value: 'one' }"],
    ['press', "'Enter', { delay: 10 }"],
    ['scrollIntoViewIfNeeded', "{ timeout: 500 }"],
    ['selectText', "{ timeout: 500 }"],
    ['setChecked', "true, { force: false }"],
    ['tap', "{ position: { x: 1, y: 2 } }"]
  ];

  for (const [method, args] of actionCases) {
    const call = `await page.getByTestId('control').${method}(${args});`;
    const source = `import { test } from '../../fixtures/test';\ntest('action', async ({ page }) => { ${call} });`;
    const removed = assertPolicyRejected(source, source.replace(call, ''), `${method} removal`);
    assert.ok(removed.issueCodes.includes('ACTION_PAYLOAD_CHANGED'), `${method} removal action code`);
    const renamed = assertPolicyRejected(source, source.replace(`.${method}(`, '.screenshot('), `${method} identity`);
    assert.ok(renamed.issueCodes.includes('ACTION_PAYLOAD_CHANGED'), `${method} identity action code`);
    const changedOptions = assertPolicyRejected(
      source,
      source.replace(`${method}(${args})`, `${method}(${args ? `${args}, ` : ''}{ timeout: 999 })`),
      `${method} options`
    );
    assert.ok(changedOptions.issueCodes.includes('ACTION_PAYLOAD_CHANGED'), `${method} options action code`);
  }
});

test('policy action diagnostics include page DOM evaluation methods', () => {
  const source = `import { test } from '../../fixtures/test';
test('evaluates DOM state', async ({ page }) => {
  await page.$eval('#status', (element, text) => { element.textContent = text; }, 'Saved');
});`;
  const candidate = source.replace("page.$eval('#status'", () => "page.$$eval('#status'");

  const result = assertPolicyRejected(source, candidate, 'page DOM evaluation identity');

  assert.ok(result.issueCodes.includes('ACTION_PAYLOAD_CHANGED'));
});

test('policy protects static computed request mutations and rejects unresolved dynamic calls', () => {
  const staticSource = `import { test } from '../../fixtures/test';
test('mutates through a static computed method', async ({ request: api }) => {
  await api['post']('/settings', { data: { enabled: true } });
});`;
  const staticResult = assertPolicyRejected(
    staticSource,
    staticSource.replace('enabled: true', 'enabled: false'),
    'static computed request payload'
  );
  assert.ok(staticResult.issueCodes.includes('ACTION_PAYLOAD_CHANGED'));

  const templateSource = staticSource.replace("api['post']", 'api[`post`]');
  const templateResult = assertPolicyRejected(
    templateSource,
    templateSource.replace('enabled: true', 'enabled: false'),
    'static template-computed request payload'
  );
  assert.ok(templateResult.issueCodes.includes('ACTION_PAYLOAD_CHANGED'));

  const dynamicSource = `import { test } from '../../fixtures/test';
const mutationMethod = process.env.MUTATION_METHOD;
test('mutates through a dynamic method', async ({ request: api, page }) => {
  await api[mutationMethod]('/settings', { data: { enabled: true } });
  await page.getByTestId('save').click();
});`;
  const dynamicCandidate = dynamicSource.replace("getByTestId('save')", "getByRole('button', { name: 'Save' })");
  const dynamicResult = assertPolicyRejected(dynamicSource, dynamicCandidate, 'unresolved dynamic request mutation');
  assert.ok(dynamicResult.issueCodes.includes('UNRESOLVED_DYNAMIC_REQUEST_MUTATION'));

  for (const [label, access, setup = ''] of [
    ['request fixture member', 'fixtures.request[mutationMethod]', ''],
    ['request fixture element member', "fixtures['request'][mutationMethod]", ''],
    ['property-access request alias', 'api[mutationMethod]', '  const api = fixtures.request;\n']
  ]) {
    const memberSource = `import { test } from '../../fixtures/test';
const mutationMethod = process.env.MUTATION_METHOD;
test('mutates through a fixture member', async (fixtures) => {
${setup}  await ${access}('/settings', { data: { enabled: true } });
  await fixtures.page.getByTestId('save').click();
});`;
    const memberCandidate = memberSource.replace(
      "getByTestId('save')",
      "getByRole('button', { name: 'Save' })"
    );
    const memberResult = assertPolicyRejected(memberSource, memberCandidate, label);
    assert.ok(memberResult.issueCodes.includes('UNRESOLVED_DYNAMIC_REQUEST_MUTATION'), `${label} issue code`);
  }
});
