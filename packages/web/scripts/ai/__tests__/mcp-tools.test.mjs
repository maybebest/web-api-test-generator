import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createMcpTools,
  McpToolError,
  MCP_TOOL_DEFINITIONS,
  redactSensitiveText
} from '../lib/mcp-tools.mjs';

test('MCP exposes exactly the bounded plan, act_step, and generation-task tools', () => {
  assert.deepEqual(MCP_TOOL_DEFINITIONS.map((tool) => tool.name), ['plan', 'act_step', 'generate_test']);
  for (const tool of MCP_TOOL_DEFINITIONS) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
  assert.match(MCP_TOOL_DEFINITIONS[2].description, /does not generate Playwright code/i);
});

test('plan confines paths, requires deterministic validation, and returns a bounded validated session', async (t) => {
  const fixture = await createFixture(t);
  const invalidTools = createMcpTools({
    ...fixture.options,
    validateSpec: () => validationFixture({ valid: false })
  });

  await assert.rejects(
    () => invalidTools.call('plan', { specPath: 'specs/flow.md' }),
    (error) => error instanceof McpToolError && error.code === 'SPEC_INVALID'
  );
  await invalidTools.close();

  const tools = createMcpTools(fixture.options);
  await assert.rejects(
    () => tools.call('plan', { specPath: 'specs/../outside.md' }),
    (error) => error instanceof McpToolError && ['FILE_NOT_FOUND', 'PATH_OUTSIDE_ROOT'].includes(error.code)
  );
  await assert.rejects(
    () => tools.call('plan', { specPath: '/tmp/outside.md' }),
    (error) => error instanceof McpToolError && error.code === 'INVALID_SPEC_PATH'
  );

  const plan = await tools.call('plan', { specPath: 'specs/flow.md' });
  assert.equal(plan.kind, 'validated-plan');
  assert.match(plan.sessionId, /^session-/);
  assert.equal(plan.policyVerdict.engine, 'deterministic-spec-policy');
  assert.equal(plan.policyVerdict.destructiveActions, 'deny');
  assert.equal(plan.steps.length, 3);
  assert.equal(plan.limits.maxSteps, 25);
  assert.equal(plan.targetTestFile, 'tests/regression/generated.spec.ts');
  await tools.close();
});

test('act_step enforces domain, latest refs, sensitive input, and deny-by-default destructive policy', async (t) => {
  const calls = [];
  const fixture = await createFixture(t, {
    runBrowser: createBrowserRunner(calls, {
      snapshot: snapshotJson({
        e1: { role: 'button', name: 'Delete plan' },
        e2: { role: 'textbox', name: 'Email address' },
        e3: { role: 'textbox', name: 'Password' }
      }, '- textbox "Password" token=super-secret-value')
    })
  });
  const tools = createMcpTools(fixture.options);
  const plan = await tools.call('plan', { specPath: 'specs/flow.md' });

  await assert.rejects(
    () => tools.call('act_step', { sessionId: plan.sessionId, action: 'goto', url: 'https://prod.example.com/' }),
    (error) => error instanceof McpToolError && error.code === 'DOMAIN_NOT_ALLOWED'
  );
  await assert.rejects(
    () => tools.call('act_step', { sessionId: plan.sessionId, action: 'goto', url: 'http://localhost:3000/?token=secret' }),
    (error) => error instanceof McpToolError && error.code === 'SENSITIVE_URL'
  );
  await assert.rejects(
    () => tools.call('act_step', { sessionId: plan.sessionId, action: 'click', ref: '@e1' }),
    (error) => error instanceof McpToolError && error.code === 'STALE_OR_UNKNOWN_REF'
  );

  const opened = await tools.call('act_step', {
    sessionId: plan.sessionId,
    action: 'goto',
    url: 'http://localhost:3000/checkout?view=compact'
  });
  assert.deepEqual(opened.snapshot.refs.map((entry) => entry.ref), ['@e1', '@e2', '@e3']);
  assert.doesNotMatch(opened.snapshot.text, /super-secret-value/);
  assert.match(opened.snapshot.text, /token=\*\*\*/);
  assert.equal(opened.url, 'http://localhost:3000/checkout');

  await assert.rejects(
    () => tools.call('act_step', { sessionId: plan.sessionId, action: 'click', ref: '@e99' }),
    (error) => error instanceof McpToolError && error.code === 'STALE_OR_UNKNOWN_REF'
  );
  await assert.rejects(
    () => tools.call('act_step', { sessionId: plan.sessionId, action: 'fill', ref: '@e3', value: 'not-echoed' }),
    (error) => error instanceof McpToolError && error.code === 'SENSITIVE_TARGET'
  );

  const filled = await tools.call('act_step', {
    sessionId: plan.sessionId,
    action: 'fill',
    ref: '@e2',
    value: 'qa@example.test'
  });
  assert.doesNotMatch(JSON.stringify(filled), /qa@example\.test/);

  await assert.rejects(
    () => tools.call('act_step', { sessionId: plan.sessionId, action: 'click', ref: '@e1' }),
    (error) => {
      assert.equal(error.code, 'ACTION_BLOCKED_BY_POLICY');
      assert.match(error.data.policy, /deny-by-default/i);
      return true;
    }
  );
  assert.ok(calls.some((args) => args.includes('fill') && args.includes('qa@example.test')));
  assert.ok(!calls.some((args) => args.includes('click') && args.includes('@e1')));
  await tools.close();
});

test('act_step permits a destructive action only through an exact machine-policy allowlist', async (t) => {
  const calls = [];
  const fixture = await createFixture(t, {
    destructiveActionAllowlist: ['click:Delete plan'],
    runBrowser: createBrowserRunner(calls, {
      snapshot: snapshotJson({ e1: { role: 'button', name: 'Delete plan' } })
    })
  });
  const tools = createMcpTools(fixture.options);
  const plan = await tools.call('plan', { specPath: 'specs/flow.md' });
  await tools.call('act_step', { sessionId: plan.sessionId, action: 'goto', url: 'http://localhost:3000/' });
  const deleted = await tools.call('act_step', { sessionId: plan.sessionId, action: 'click', ref: '@e1' });

  assert.equal(deleted.step, 2);
  assert.ok(calls.some((args) => args.includes('click') && args.includes('@e1')));
  await tools.close();
});

test('act_step redacts exact submitted values and common PII from snapshot text and ref names', async (t) => {
  const submittedValue = 'unique-campaign-label';
  let filled = false;
  const fixture = await createFixture(t, {
    runBrowser: async (args) => {
      if (args.includes('fill')) filled = true;
      if (args.includes('snapshot')) {
        return okResult(snapshotJson(
          {
            e1: {
              role: 'textbox',
              name: filled
                ? `${submittedValue} person@example.test +44 7700 900123 4111 1111 1111 1111`
                : 'Customer note'
            }
          },
          filled
            ? `Saved ${submittedValue} for person@example.test, +44 7700 900123, 4111 1111 1111 1111.`
            : '- textbox "Customer note" [ref=e1]'
        ));
      }
      return okResult();
    }
  });
  const tools = createMcpTools(fixture.options);
  const plan = await tools.call('plan', { specPath: 'specs/flow.md' });
  await tools.call('act_step', {
    sessionId: plan.sessionId,
    action: 'goto',
    url: 'http://localhost:3000/'
  });

  const result = await tools.call('act_step', {
    sessionId: plan.sessionId,
    action: 'fill',
    ref: '@e1',
    value: submittedValue
  });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /unique-campaign-label|person@example\.test|7700 900123|4111 1111 1111 1111/);
  assert.match(serialized, /\*\*\*|REDACTED/);
  await tools.close();
});

test('act_step caps each validated session at 25 successful steps', async (t) => {
  const fixture = await createFixture(t, { runBrowser: createBrowserRunner([], {}) });
  const tools = createMcpTools(fixture.options);
  const plan = await tools.call('plan', { specPath: 'specs/flow.md' });
  await tools.call('act_step', {
    sessionId: plan.sessionId,
    action: 'goto',
    url: 'http://localhost:3000/'
  });
  for (let index = 1; index < 25; index += 1) {
    await tools.call('act_step', {
      sessionId: plan.sessionId,
      action: 'press',
      key: 'Escape'
    });
  }
  await assert.rejects(
    () => tools.call('act_step', {
      sessionId: plan.sessionId,
      action: 'press',
      key: 'Escape'
    }),
    (error) => error instanceof McpToolError && error.code === 'STEP_LIMIT'
  );
  await tools.close();
});

test('post-action snapshots cap text and refs, and only returned refs become actionable', async (t) => {
  const refs = Object.fromEntries(
    Array.from({ length: 105 }, (_, index) => [`e${index + 1}`, { role: 'button', name: `Choice ${index + 1}` }])
  );
  const fixture = await createFixture(t, {
    runBrowser: createBrowserRunner([], {
      snapshot: snapshotJson(refs, `value="private-value" ${'x'.repeat(10_000)}`)
    })
  });
  const tools = createMcpTools(fixture.options);
  const plan = await tools.call('plan', { specPath: 'specs/flow.md' });
  const opened = await tools.call('act_step', {
    sessionId: plan.sessionId,
    action: 'goto',
    url: 'http://localhost:3000/'
  });

  assert.equal(opened.snapshot.refs.length, 100);
  assert.ok(opened.snapshot.text.length <= 8_000);
  assert.equal(opened.snapshot.truncated, true);
  assert.doesNotMatch(opened.snapshot.text, /private-value/);
  await assert.rejects(
    () => tools.call('act_step', {
      sessionId: plan.sessionId,
      action: 'click',
      ref: '@e101'
    }),
    (error) => error instanceof McpToolError && error.code === 'STALE_OR_UNKNOWN_REF'
  );
  await tools.close();
});

test('generate_test previews by default and writes the bound generation artifacts under .ai-runs/mcp', async (t) => {
  const fixture = await createFixture(t);
  const tools = createMcpTools(fixture.options);
  const plan = await tools.call('plan', { specPath: 'specs/flow.md' });

  const preview = await tools.call('generate_test', {
    sessionId: plan.sessionId
  });
  assert.equal(preview.kind, 'generation-task-preview');
  assert.equal(preview.generatedCode, false);
  assert.equal(preview.wroteFiles, false);
  assert.ok(preview.preview.length <= 6_000);
  await assert.rejects(() => fs.stat(path.join(fixture.webRoot, '.ai-runs')), /ENOENT/);
  await assert.rejects(
    () => tools.call('generate_test', {
      sessionId: plan.sessionId,
      outputPath: '../../outside'
    }),
    (error) => error instanceof McpToolError && error.code === 'INVALID_ARGUMENT'
  );

  const written = await tools.call('generate_test', {
    sessionId: plan.sessionId,
    write: true
  });
  assert.equal(written.kind, 'generation-task-written');
  assert.equal(written.generatedCode, false);
  assert.match(written.taskPath, /^\.ai-runs\/mcp\//);
  assert.match(written.providerInputPath, /^\.ai-runs\/mcp\//);
  assert.match(written.manifestPath, /^\.ai-runs\/mcp\//);
  const task = await fs.readFile(path.join(fixture.webRoot, written.taskPath), 'utf8');
  const providerInput = await fs.readFile(path.join(fixture.webRoot, written.providerInputPath), 'utf8');
  const manifest = JSON.parse(await fs.readFile(path.join(fixture.webRoot, written.manifestPath), 'utf8'));
  assert.match(task, /## Original Flow Spec/);
  assert.match(providerInput, /^# Playwright Generation Input/);
  assert.ok(task.includes(`sha256:${manifest.specSha256}`));
  assert.equal(manifest.providerInputPath, 'provider-input.md');
  assert.match(manifest.providerInputSha256, /^[a-f0-9]{64}$/);
  assert.match(manifest.agentTaskSha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.specPath, 'specs/flow.md');
  assert.equal(manifest.flowId, 'FLOW-MCP-001');
  assert.equal(manifest.policyVerdict.decision, 'allow');
  await tools.close();
});

test('generate_test redacts common PII from its task preview', async (t) => {
  const fixture = await createFixture(t, {
    validateSpec: () => validationFixture({
      flowId: 'person@example.test +44 7700 900123 4111 1111 1111 1111'
    })
  });
  const tools = createMcpTools(fixture.options);
  const plan = await tools.call('plan', { specPath: 'specs/flow.md' });
  const preview = await tools.call('generate_test', {
    sessionId: plan.sessionId
  });

  assert.doesNotMatch(preview.preview, /person@example\.test|7700 900123|4111 1111 1111 1111/);
  assert.match(preview.preview, /\*\*\*@\*\*\*|REDACTED/);
  await tools.close();
});

test('generate_test removes its staging directory when the second artifact write fails', async (t) => {
  let writeCount = 0;
  const failingFileSystem = new Proxy(fsSync, {
    get(target, property, receiver) {
      if (property === 'writeFileSync') {
        return (...args) => {
          writeCount += 1;
          if (writeCount === 2) throw new Error('injected second-write failure');
          return target.writeFileSync(...args);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
  const fixture = await createFixture(t, { fileSystem: failingFileSystem });
  const tools = createMcpTools(fixture.options);
  const plan = await tools.call('plan', { specPath: 'specs/flow.md' });

  await assert.rejects(
    () => tools.call('generate_test', {
      sessionId: plan.sessionId,
      write: true
    }),
    (error) => error instanceof McpToolError && error.code === 'TASK_WRITE_FAILED'
  );
  assert.deepEqual(await fs.readdir(path.join(fixture.webRoot, '.ai-runs', 'mcp')), []);
  await tools.close();
});

test('an expired touched session closes its browser before it is rejected', async (t) => {
  const calls = [];
  let currentTime = Date.parse('2026-07-11T12:00:00.000Z');
  const fixture = await createFixture(t, {
    now: () => new Date(currentTime),
    runBrowser: createBrowserRunner(calls, {})
  });
  const tools = createMcpTools(fixture.options);
  const plan = await tools.call('plan', { specPath: 'specs/flow.md' });
  await tools.call('act_step', {
    sessionId: plan.sessionId,
    action: 'goto',
    url: 'http://localhost:3000/'
  });
  currentTime += 31 * 60 * 1_000;

  await assert.rejects(
    () => tools.call('generate_test', {
      sessionId: plan.sessionId
    }),
    (error) => error instanceof McpToolError && error.code === 'SESSION_EXPIRED'
  );
  assert.ok(calls.some((args) => args.at(-1) === 'close'));
  await tools.close();
});

test('browser failures and redaction never expose raw credential material', async (t) => {
  const fixture = await createFixture(t, {
    runBrowser: async (args) => {
      if (args.includes('close')) return okResult();
      return {
        status: 1,
        stdout: 'Bearer top-secret-token',
        stderr: 'password=hunter2',
        failure: {
          kind: 'process-failure',
          detail: 'Bearer top-secret-token password=hunter2',
          fallback: { nextStep: 'Use the configured safe fallback.' }
        }
      };
    }
  });
  const tools = createMcpTools(fixture.options);
  const plan = await tools.call('plan', { specPath: 'specs/flow.md' });
  await assert.rejects(
    () => tools.call('act_step', {
      sessionId: plan.sessionId,
      action: 'goto',
      url: 'http://localhost:3000/'
    }),
    (error) => {
      const serialized = JSON.stringify({ message: error.message, data: error.data });
      assert.doesNotMatch(serialized, /top-secret-token|hunter2/);
      assert.equal(error.data.kind, 'process-failure');
      return true;
    }
  );
  assert.equal(redactSensitiveText('Bearer abc.def password=hunter2 token=secret'), '*** password=*** token=***');
  assert.doesNotMatch(
    redactSensitiveText('person@example.test +44 7700 900123 4111 1111 1111 1111 unique-value', ['unique-value']),
    /person@example\.test|7700 900123|4111 1111 1111 1111|unique-value/
  );
  await tools.close();
});

async function createFixture(t, overrides = {}) {
  const webRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-tools-'));
  t.after(() => fs.rm(webRoot, { recursive: true, force: true }));
  await fs.mkdir(path.join(webRoot, 'specs'), { recursive: true });
  await fs.mkdir(path.join(webRoot, 'tests', 'regression'), { recursive: true });
  await fs.writeFile(path.join(webRoot, 'specs', 'flow.md'), '# Flow: MCP fixture\n');
  await fs.writeFile(
    path.join(webRoot, 'agent-browser.json'),
    JSON.stringify({ allowedDomains: ['localhost', '127.0.0.1', '*.example.test'] })
  );

  let sequence = 0;
  const options = {
    webRoot,
    env: {},
    now: () => new Date('2026-07-11T12:00:00.000Z'),
    tokenFactory: (label) => `${label}-${String(++sequence).padStart(3, '0')}-abcdefghijklmnop`,
    validateSpec: () => validationFixture(),
    runBrowser: overrides.runBrowser ?? createBrowserRunner([], {}),
    ...overrides
  };
  return { webRoot, options };
}

function validationFixture({
  valid = true,
  content = '# Flow: MCP fixture\n\n## Notes\n\nDeterministic local fixture.',
  flowId = 'FLOW-MCP-001'
} = {}) {
  return {
    valid,
    issues: valid ? [] : ['Spec failed deterministic validation.'],
    metadata: {
      'Flow ID': flowId,
      'Spec Version': '1.0.0',
      'Generation Mode': 'single',
      'Target Test File': 'tests/regression/generated.spec.ts',
      'Base Path': '/checkout'
    },
    acceptanceCriteria: ['AC-001'],
    flowSteps: [
      { step: '1', acIds: ['AC-001'], action: 'Open checkout', target: '/checkout', expectedResult: 'Checkout opens' },
      { step: '2', acIds: ['AC-001'], action: 'Submit form', target: 'Submit', expectedResult: 'Confirmation appears' },
      { step: '3', acIds: ['AC-001'], action: 'Review result', target: 'Status', expectedResult: 'Success is visible' }
    ],
    locatorHints: [],
    mocksJson: [],
    stability: { parallelSafe: 'yes', dataIsolation: 'per-test', allowedRetries: '0' },
    variants: { header: ['Locale', 'Role', 'Plan'], rows: [['en-GB', 'tester', 'default']] },
    includes: ['none'],
    businessRules: [],
    dataCases: [],
    dataCasesJson: [{ caseId: 'DC-001', inputs: {}, expected: { result: 'success' } }],
    negativeCases: [],
    content
  };
}

function createBrowserRunner(calls, { snapshot = snapshotJson({ e1: { role: 'button', name: 'Continue' } }) } = {}) {
  return async (args) => {
    calls.push(args);
    if (args.includes('snapshot')) return okResult(snapshot);
    if (args.includes('is')) return okResult(JSON.stringify({ success: true, data: { visible: true } }));
    return okResult();
  };
}

function snapshotJson(refs, snapshot = '- button "Continue" [ref=e1]') {
  return JSON.stringify({ success: true, data: { snapshot, refs } });
}

function okResult(stdout = '') {
  return { status: 0, stdout, stderr: '', failure: null };
}
