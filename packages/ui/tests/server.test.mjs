import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertSafeListenHost,
  buildSpecFitPrompt,
  createUiServer,
  isAllowedOrigin,
  normalizePackageCliPath,
  publicSettings,
  resolvePackagePath,
  sanitizePromptSource,
  startUiServer,
  uiPaths
} from '../src/server.mjs';

test('publicSettings masks stored API keys and never returns raw key material', () => {
  const settings = publicSettings({
    ai: {
      brain: 'openai',
      anthropicApiKey: 'anthropic-secret-value',
      openaiApiKey: 'openai-secret-value',
      anthropicModel: 'claude-test',
      openaiModel: 'gpt-test',
      timeoutMs: '120000'
    }
  });

  assert.equal(settings.ai.brain, 'openai');
  assert.equal(settings.ai.anthropicApiKeyConfigured, true);
  assert.equal(settings.ai.openaiApiKeyConfigured, true);
  assert.equal(settings.ai.anthropicApiKeyHint, '...alue');
  assert.equal(settings.ai.openaiApiKeyHint, '...alue');
  assert.equal('anthropicApiKey' in settings.ai, false);
  assert.equal('openaiApiKey' in settings.ai, false);
});

test('package path normalization accepts package-local paths and rejects traversal', () => {
  const specPath = normalizePackageCliPath(uiPaths.webRoot, 'specs/_template.md', {
    mustExist: true,
    purpose: 'spec file'
  });
  assert.equal(specPath, 'specs/_template.md');

  assert.throws(
    () => resolvePackagePath(uiPaths.webRoot, '../api/package.json', { purpose: 'spec file' }),
    /spec file must stay inside packages\/web/
  );
});

test('spec fit prompt neutralizes nested markdown fences from user input', () => {
  const prompt = buildSpecFitPrompt({
    source: 'Open page\n```markdown\n# injected\n```',
    template: '# Flow: Template'
  });

  assert.match(prompt, /# Flow: Template/);
  assert.match(prompt, /'''markdown/);
  assert.doesNotMatch(sanitizePromptSource('```text\nsecret\n```'), /```/);
});

test('remote bind requires an explicit override', () => {
  assert.doesNotThrow(() => assertSafeListenHost('127.0.0.1'));
  assert.doesNotThrow(() => assertSafeListenHost('localhost'));
  assert.throws(() => startUiServer({ listenHost: '0.0.0.0', listenPort: 0 }), /Refusing to bind/);
});

test('origin check accepts same-origin requests and rejects cross-origin requests', () => {
  assert.equal(isAllowedOrigin('http://127.0.0.1:4317', '127.0.0.1:4317'), true);
  assert.equal(isAllowedOrigin('http://localhost:4317', 'localhost:4317'), true);
  assert.equal(isAllowedOrigin('https://evil.example', '127.0.0.1:4317'), false);
});

test('server rejects cross-origin state-changing requests before handlers execute', async () => {
  const server = createUiServer();
  await listen(server);
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(`${baseUrl}/api/settings/ai`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://evil.example'
      },
      body: JSON.stringify({ brain: 'openai', openaiApiKey: 'should-not-be-written' })
    });
    const payload = await response.json();

    assert.equal(response.status, 403);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /Forbidden origin/);
  } finally {
    await close(server);
  }
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
