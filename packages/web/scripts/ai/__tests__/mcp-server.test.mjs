import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import test from 'node:test';

import { MCP_PROTOCOL_VERSION, runMcpServer } from '../mcp-server.mjs';
import { MCP_TOOL_DEFINITIONS } from '../lib/mcp-tools.mjs';

test('stdio MCP lifecycle initializes, lists exactly three tools, calls a handler, and emits protocol JSON only', async () => {
  let closed = false;
  const tools = {
    definitions: MCP_TOOL_DEFINITIONS,
    async call(name, args) {
      assert.equal(name, 'plan');
      assert.deepEqual(args, { specPath: 'specs/flow.md' });
      return { kind: 'validated-plan', sessionId: 'session-test' };
    },
    async close() {
      closed = true;
    }
  };
  const messages = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: MCP_PROTOCOL_VERSION } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'plan', arguments: { specPath: 'specs/flow.md' } } }
  ];
  const capture = streamsFor(messages);

  await runMcpServer({ input: capture.input, output: capture.output, error: capture.error, tools });

  const responses = capture.stdout().trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(responses.length, 3, 'initialized notification must not produce a response');
  assert.equal(responses[0].result.protocolVersion, MCP_PROTOCOL_VERSION);
  assert.deepEqual(responses[1].result.tools.map((tool) => tool.name), ['plan', 'act_step', 'generate_test']);
  assert.equal(responses[2].result.structuredContent.ok, true);
  assert.equal(responses[2].result.structuredContent.kind, 'validated-plan');
  assert.equal(capture.stderr(), '');
  assert.equal(closed, true);
});

test('stdio MCP returns bounded JSON-RPC errors for malformed and unknown requests', async () => {
  const capture = streamsForRaw([
    '{not-json}\n',
    `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' })}\n`,
    `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
    `${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'unknown/method' })}\n`
  ]);
  const tools = { definitions: MCP_TOOL_DEFINITIONS, async call() {}, async close() {} };

  await runMcpServer({ input: capture.input, output: capture.output, error: capture.error, tools });

  const responses = capture.stdout().trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(responses[0].error.code, -32700);
  assert.equal(responses[1].result.protocolVersion, MCP_PROTOCOL_VERSION);
  assert.equal(responses[2].error.code, -32601);
  assert.equal(capture.stderr(), '');
});

test('unexpected tool failures suppress details from protocol stdout and diagnostics', async () => {
  const capture = streamsFor([
    { jsonrpc: '2.0', id: 1, method: 'initialize' },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'plan', arguments: {} } }
  ]);
  const tools = {
    definitions: MCP_TOOL_DEFINITIONS,
    async call() {
      throw new Error('Bearer protocol-secret password=hunter2');
    },
    async close() {}
  };

  await runMcpServer({ input: capture.input, output: capture.output, error: capture.error, tools });

  const output = capture.stdout();
  for (const line of output.trim().split('\n')) JSON.parse(line);
  assert.doesNotMatch(output, /protocol-secret|hunter2/);
  assert.match(output, /INTERNAL_ERROR/);
  assert.equal(capture.stderr(), '[mcp] tool handler failed; details suppressed.\n');
});

function streamsFor(messages) {
  return streamsForRaw(messages.map((message) => `${JSON.stringify(message)}\n`));
}

function streamsForRaw(chunks) {
  let stdout = '';
  let stderr = '';
  return {
    input: Readable.from(chunks),
    output: new Writable({
      write(chunk, _encoding, callback) {
        stdout += chunk.toString();
        callback();
      }
    }),
    error: new Writable({
      write(chunk, _encoding, callback) {
        stderr += chunk.toString();
        callback();
      }
    }),
    stdout: () => stdout,
    stderr: () => stderr
  };
}
