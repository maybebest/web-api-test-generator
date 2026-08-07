#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

import { createMcpTools, McpToolError } from './lib/mcp-tools.mjs';

export const MCP_PROTOCOL_VERSION = '2024-11-05';
const MAX_REQUEST_BYTES = 64 * 1024;

export async function runMcpServer({
  input = process.stdin,
  output = process.stdout,
  error = process.stderr,
  tools = createMcpTools()
} = {}) {
  let initialized = false;
  let negotiated = false;
  const lines = readline.createInterface({ input, crlfDelay: Infinity, terminal: false });

  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      if (Buffer.byteLength(line, 'utf8') > MAX_REQUEST_BYTES) {
        writeMessage(output, rpcError(null, -32600, 'Request exceeds the MCP input size limit.'));
        continue;
      }

      let message;
      try {
        message = JSON.parse(line);
      } catch {
        writeMessage(output, rpcError(null, -32700, 'Parse error.'));
        continue;
      }

      const hasId = Object.prototype.hasOwnProperty.call(message ?? {}, 'id');
      const id = hasId ? message.id : null;
      if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
        if (hasId) writeMessage(output, rpcError(id, -32600, 'Invalid Request.'));
        continue;
      }
      if (hasId && id !== null && typeof id !== 'string' && typeof id !== 'number') {
        writeMessage(output, rpcError(null, -32600, 'Invalid Request id.'));
        continue;
      }

      if (message.method === 'initialize') {
        if (!hasId) continue;
        negotiated = true;
        writeMessage(output, {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'web-test-generator', version: '0.1.0' },
            instructions: 'Tools are bounded by deterministic spec validation, allowlisted browser domains/actions, and generation-task artifacts.'
          }
        });
        continue;
      }

      if (message.method === 'notifications/initialized') {
        if (negotiated) initialized = true;
        continue;
      }

      if (!initialized) {
        if (hasId) writeMessage(output, rpcError(id, -32002, 'Server is not initialized.'));
        continue;
      }

      if (message.method === 'tools/list') {
        if (hasId) {
          writeMessage(output, { jsonrpc: '2.0', id, result: { tools: tools.definitions } });
        }
        continue;
      }

      if (message.method === 'tools/call') {
        if (!hasId) continue;
        const params = message.params;
        if (!params || typeof params !== 'object' || Array.isArray(params) || typeof params.name !== 'string') {
          writeMessage(output, rpcError(id, -32602, 'Invalid tools/call params.'));
          continue;
        }
        try {
          const result = await tools.call(params.name, params.arguments ?? {});
          writeMessage(output, {
            jsonrpc: '2.0',
            id,
            result: toolResult({ ok: true, ...result }, false)
          });
        } catch (toolError) {
          if (toolError instanceof McpToolError) {
            const structured = {
              ok: false,
              error: {
                code: toolError.code,
                message: toolError.message,
                ...(toolError.data === undefined ? {} : { data: toolError.data })
              }
            };
            writeMessage(output, { jsonrpc: '2.0', id, result: toolResult(structured, true) });
          } else {
            error.write('[mcp] tool handler failed; details suppressed.\n');
            writeMessage(output, {
              jsonrpc: '2.0',
              id,
              result: toolResult({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Tool execution failed.' } }, true)
            });
          }
        }
        continue;
      }

      if (hasId) writeMessage(output, rpcError(id, -32601, 'Method not found.'));
    }
  } finally {
    try {
      await tools.close?.();
    } catch {
      error.write('[mcp] session cleanup failed; details suppressed.\n');
    }
  }
}

function toolResult(structuredContent, isError) {
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent,
    ...(isError ? { isError: true } : {})
  };
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function writeMessage(output, message) {
  output.write(`${JSON.stringify(message)}\n`);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  await runMcpServer().catch(() => {
    process.stderr.write('[mcp] server terminated unexpectedly; details suppressed.\n');
    process.exitCode = 1;
  });
}
