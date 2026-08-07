import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createGenerationCacheCandidate,
  createGenerationCacheKey,
  invalidateGenerationCacheReference,
  promoteGenerationCache,
  readGenerationCache,
  rejectGenerationCache,
  writeGenerationCache
} from '../lib/generation-cache.mjs';

const QUALITY_FINGERPRINT = 'f'.repeat(64);
const TARGET_A = 'a'.repeat(64);
const TARGET_B = 'b'.repeat(64);
const TARGET_C = 'c'.repeat(64);

async function withTempDir(prefix, fn) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await fn(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

const keyInput = {
  provider: 'openai',
  model: 'gpt-test',
  systemPrompt: 'stable system instructions',
  prompt: 'generate the requested test',
  contractVersion: 'rest-output-v2',
  knobs: { reasoningEffort: 'none', structuredOutput: true }
};

test('cache key is deterministic across object key order', () => {
  const first = createGenerationCacheKey(keyInput);
  const second = createGenerationCacheKey({
    ...keyInput,
    knobs: { structuredOutput: true, reasoningEffort: 'none' }
  });

  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, second);
});

test('cache key changes for every result-affecting input', () => {
  const baseline = createGenerationCacheKey(keyInput);
  const variants = [
    { provider: 'anthropic' },
    { model: 'gpt-other' },
    { systemPrompt: 'different system instructions' },
    { prompt: 'generate a different test' },
    { contractVersion: 'rest-output-v3' },
    { knobs: { reasoningEffort: 'low', structuredOutput: true } }
  ];

  for (const variant of variants) {
    assert.notEqual(createGenerationCacheKey({ ...keyInput, ...variant }), baseline);
  }
});

test('cache key rejects missing and unsafe-to-canonicalize values', () => {
  assert.throws(
    () => createGenerationCacheKey({ ...keyInput, prompt: ' ' }),
    /prompt must be a non-empty string/
  );
  assert.throws(
    () => createGenerationCacheKey({ ...keyInput, knobs: { temperature: Number.NaN } }),
    /finite numbers/
  );

  const circular = {};
  circular.self = circular;
  assert.throws(
    () => createGenerationCacheKey({ ...keyInput, knobs: circular }),
    /circular references/
  );
});

test('write and read round-trip stores only the digest, response, normalized usage, and fixed metadata', async () => {
  await withTempDir('generation-cache-', async (temporaryRoot) => {
    const cacheDir = path.join(temporaryRoot, 'generations');
    const secretPrompt = 'do work with sk-test-never-persist-this-prompt';
    const key = createGenerationCacheKey({ ...keyInput, prompt: secretPrompt });
    const { filePath } = await writeGenerationCache({
      cacheDir,
      key,
      provider: keyInput.provider,
      model: keyInput.model,
      contractVersion: keyInput.contractVersion,
      text: 'import { test } from "../../fixtures/test";',
      validationStatus: 'accepted',
      qualityFingerprint: QUALITY_FINGERPRINT,
      outputSha256: TARGET_B,
      usage: {
        inputTokens: 120,
        outputTokens: 30,
        cachedTokens: 80,
        retryTokens: null,
        retryCount: 0,
        latencyMs: 42.5,
        requestId: 'req_test-123',
        resultCacheHit: false,
        apiKey: 'sk-test-must-be-discarded',
        rawPrompt: secretPrompt
      },
      now: () => new Date('2026-08-01T12:00:00.000Z')
    });

    const hit = await readGenerationCache({
      cacheDir,
      key,
      provider: keyInput.provider,
      model: keyInput.model,
      contractVersion: keyInput.contractVersion,
      currentTargetSha256: null
    });
    const { cacheReference, ...cacheValue } = hit;
    assert.match(cacheReference.entryVersion, /^[a-f0-9]{64}$/);
    assert.deepEqual(cacheValue, {
      text: 'import { test } from "../../fixtures/test";',
      usage: {
        inputTokens: 120,
        outputTokens: 30,
        cachedTokens: 80,
        retryCount: 0,
        retryTokens: null,
        latencyMs: 42.5,
        resultCacheHit: false,
        requestId: 'req_test-123'
      },
      metadata: {
        provider: 'openai',
        model: 'gpt-test',
        contractVersion: 'rest-output-v2',
        createdAt: '2026-08-01T12:00:00.000Z',
        acceptedAt: '2026-08-01T12:00:00.000Z',
        validationStatus: 'accepted',
        qualityFingerprint: QUALITY_FINGERPRINT
      }
    });

    const stored = await fs.readFile(filePath, 'utf8');
    assert.doesNotMatch(stored, /never-persist-this-prompt|must-be-discarded|rawPrompt|apiKey/);
    assert.equal((await fs.stat(cacheDir)).mode & 0o777, 0o700);
    assert.equal((await fs.stat(filePath)).mode & 0o777, 0o600);
  });
});

test('read treats missing, corrupt, oversized-shape, and mismatched entries as misses', async () => {
  await withTempDir('generation-cache-invalid-', async (cacheDir) => {
    const key = createGenerationCacheKey(keyInput);
    const expected = {
      cacheDir,
      key,
      provider: keyInput.provider,
      model: keyInput.model,
      contractVersion: keyInput.contractVersion,
      currentTargetSha256: null
    };

    assert.equal(await readGenerationCache(expected), null);
    await fs.writeFile(path.join(cacheDir, `${key}.json`), '{broken json', 'utf8');
    assert.equal(await readGenerationCache(expected), null);

    await fs.writeFile(path.join(cacheDir, `${key}.json`), JSON.stringify({
      schemaVersion: 1,
      key: '0'.repeat(64),
      responseText: 'valid-looking result',
      usage: {},
      metadata: {
        provider: keyInput.provider,
        model: keyInput.model,
        contractVersion: keyInput.contractVersion,
        createdAt: '2026-08-01T12:00:00.000Z'
      }
    }), 'utf8');
    assert.equal(await readGenerationCache(expected), null);
  });
});

test('read rejects metadata mismatches and unexpected persisted fields', async () => {
  await withTempDir('generation-cache-mismatch-', async (cacheDir) => {
    const key = createGenerationCacheKey(keyInput);
    const options = {
      cacheDir,
      key,
      provider: keyInput.provider,
      model: keyInput.model,
      contractVersion: keyInput.contractVersion,
      currentTargetSha256: null
    };
    const { filePath } = await writeGenerationCache({
      ...options,
      text: 'const generated = true;',
      validationStatus: 'accepted',
      qualityFingerprint: QUALITY_FINGERPRINT,
      outputSha256: TARGET_B,
      usage: { inputTokens: 10 }
    });

    assert.equal(await readGenerationCache({ ...options, model: 'gpt-other' }), null);

    const raw = JSON.parse(await fs.readFile(filePath, 'utf8'));
    raw.usage.unknownProviderPayload = 'not allowed';
    await fs.writeFile(filePath, JSON.stringify(raw), 'utf8');
    assert.equal(await readGenerationCache(options), null);
  });
});

test('invalid keys cannot escape the configured cache directory', async () => {
  await withTempDir('generation-cache-key-', async (cacheDir) => {
    await assert.rejects(
      readGenerationCache({
        cacheDir,
        key: '../outside',
        provider: 'openai',
        model: 'gpt-test',
        contractVersion: 'v1',
        currentTargetSha256: null
      }),
      /lowercase SHA-256 hex digest/
    );
  });
});

test('concurrent writes leave one complete readable entry and no temporary files', async () => {
  await withTempDir('generation-cache-race-', async (cacheDir) => {
    const key = createGenerationCacheKey(keyInput);
    const base = {
      cacheDir,
      key,
      provider: keyInput.provider,
      model: keyInput.model,
      contractVersion: keyInput.contractVersion,
      validationStatus: 'accepted',
      qualityFingerprint: QUALITY_FINGERPRINT,
      outputSha256: TARGET_B,
      currentTargetSha256: null,
      usage: { inputTokens: 1, outputTokens: 1 }
    };

    await Promise.all([
      writeGenerationCache({ ...base, text: 'const winner = "one";' }),
      writeGenerationCache({ ...base, text: 'const winner = "two";' })
    ]);

    const hit = await readGenerationCache(base);
    assert.ok(['const winner = "one";', 'const winner = "two";'].includes(hit?.text));
    assert.deepEqual((await fs.readdir(cacheDir)).filter((name) => name.endsWith('.tmp')), []);
  });
});

test('provider results remain unreadable until a verified orchestrator promotes them', async () => {
  await withTempDir('generation-cache-acceptance-', async (cacheDir) => {
    const key = createGenerationCacheKey(keyInput);
    const candidate = createGenerationCacheCandidate({
      cacheDir,
      key,
      provider: keyInput.provider,
      model: keyInput.model,
      contractVersion: keyInput.contractVersion,
      text: 'const candidate = true;',
      usage: { inputTokens: 10, outputTokens: 4 }
    });
    const lookup = {
      cacheDir,
      key,
      provider: keyInput.provider,
      model: keyInput.model,
      contractVersion: keyInput.contractVersion,
      currentTargetSha256: null
    };

    assert.equal(await readGenerationCache(lookup), null);
    await rejectGenerationCache(candidate, { validationStatus: 'rejected', failureStage: 'review' });
    assert.equal(await readGenerationCache(lookup), null);

    await promoteGenerationCache(candidate, { qualityFingerprint: QUALITY_FINGERPRINT, outputSha256: TARGET_B });
    const accepted = await readGenerationCache(lookup);
    assert.equal(accepted.text, 'const candidate = true;');
    assert.equal(accepted.metadata.validationStatus, 'accepted');
    assert.equal(accepted.metadata.qualityFingerprint, QUALITY_FINGERPRINT);
  });
});

test('accepted cache reuse requires the current target to match the cached input or output state', async () => {
  await withTempDir('generation-cache-target-', async (cacheDir) => {
    const key = createGenerationCacheKey(keyInput);
    const candidate = createGenerationCacheCandidate({
      cacheDir, key, provider: keyInput.provider, model: keyInput.model,
      contractVersion: keyInput.contractVersion, text: 'const generated = true;',
      inputTargetSha256: TARGET_A
    });
    const cacheReference = await promoteGenerationCache(candidate, {
      qualityFingerprint: QUALITY_FINGERPRINT,
      outputSha256: TARGET_B
    });
    const lookup = { cacheDir, key, provider: keyInput.provider, model: keyInput.model, contractVersion: keyInput.contractVersion };

    assert.equal((await readGenerationCache({ ...lookup, currentTargetSha256: TARGET_A })).text, 'const generated = true;');
    assert.deepEqual((await readGenerationCache({ ...lookup, currentTargetSha256: TARGET_B })).cacheReference, cacheReference);
    assert.equal(await readGenerationCache({ ...lookup, currentTargetSha256: TARGET_C }), null);
    assert.equal(await readGenerationCache({ ...lookup, currentTargetSha256: null }), null);
    await assert.rejects(readGenerationCache(lookup), /currentTargetSha256/);
  });
});

test('missing targets are explicit and stale references never remove a replacement entry', async () => {
  await withTempDir('generation-cache-reference-', async (cacheDir) => {
    const key = createGenerationCacheKey(keyInput);
    const makeCandidate = (text) => createGenerationCacheCandidate({
      cacheDir, key, provider: keyInput.provider, model: keyInput.model,
      contractVersion: keyInput.contractVersion, text, inputTargetSha256: null
    });
    const stale = await promoteGenerationCache(makeCandidate('const first = true;'), {
      qualityFingerprint: QUALITY_FINGERPRINT, outputSha256: TARGET_A
    });
    const current = await promoteGenerationCache(makeCandidate('const second = true;'), {
      qualityFingerprint: QUALITY_FINGERPRINT, outputSha256: TARGET_B
    });

    assert.equal(await invalidateGenerationCacheReference(stale, { cacheDir }), false);
    assert.equal((await readGenerationCache({
      cacheDir, key, provider: keyInput.provider, model: keyInput.model,
      contractVersion: keyInput.contractVersion, currentTargetSha256: null
    })).text, 'const second = true;');
    assert.equal(await invalidateGenerationCacheReference(current, { cacheDir }), true);
  });
});

test('promotion requires the verified output digest and invalidation rejects a symlinked cache directory', async (t) => {
  await withTempDir('generation-cache-safe-remove-', async (root) => {
    const cacheDir = path.join(root, 'real-cache');
    const key = createGenerationCacheKey(keyInput);
    const candidate = createGenerationCacheCandidate({ cacheDir, key, provider: keyInput.provider, model: keyInput.model,
      contractVersion: keyInput.contractVersion, text: 'const generated = true;', inputTargetSha256: null });
    await assert.rejects(promoteGenerationCache(candidate, { qualityFingerprint: QUALITY_FINGERPRINT }), /outputSha256/);
    const reference = await promoteGenerationCache(candidate, { qualityFingerprint: QUALITY_FINGERPRINT, outputSha256: TARGET_B });
    const alias = path.join(root, 'cache-alias');
    await fs.symlink(cacheDir, alias, 'dir');
    assert.throws(() => invalidateGenerationCacheReference(reference, { cacheDir: alias }), /symbolic links/);
    assert.notEqual(await readGenerationCache({ cacheDir, key, provider: keyInput.provider, model: keyInput.model,
      contractVersion: keyInput.contractVersion, currentTargetSha256: null }), null);
  });
});

test('overlapping promotions return their own exact versions and a stale first reference cannot delete the second', async () => {
  await withTempDir('generation-cache-promotion-race-', async (cacheDir) => {
    const key = createGenerationCacheKey(keyInput);
    const candidate = (text, inputTargetSha256) => createGenerationCacheCandidate({
      cacheDir, key, provider: keyInput.provider, model: keyInput.model,
      contractVersion: keyInput.contractVersion, text, inputTargetSha256
    });
    let releaseSecond;
    const firstWritten = new Promise((resolve) => { releaseSecond = resolve; });
    let releaseFirst;
    const secondWritten = new Promise((resolve) => { releaseFirst = resolve; });
    let interleavedWrites = 0;
    const interleavedWrite = async (options) => {
      interleavedWrites += 1;
      if (options.text === 'const second = true;') await firstWritten;
      const result = await writeGenerationCache(options);
      if (options.text === 'const first = true;') {
        releaseSecond();
        await secondWritten;
      } else {
        releaseFirst();
      }
      return result;
    };

    const firstPromise = promoteGenerationCache(candidate('const first = true;', TARGET_A), {
      qualityFingerprint: QUALITY_FINGERPRINT, outputSha256: TARGET_B, writeCache: interleavedWrite
    });
    const secondPromise = promoteGenerationCache(candidate('const second = true;', TARGET_C), {
      qualityFingerprint: QUALITY_FINGERPRINT, outputSha256: 'd'.repeat(64), writeCache: interleavedWrite
    });
    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    assert.equal(interleavedWrites, 2);
    assert.notEqual(first.entryVersion, second.entryVersion);
    assert.equal(invalidateGenerationCacheReference(first, { cacheDir }), false);
    assert.equal((await readGenerationCache({ cacheDir, key, provider: keyInput.provider, model: keyInput.model,
      contractVersion: keyInput.contractVersion, currentTargetSha256: TARGET_C })).text, 'const second = true;');
  });
});

test('cache reads and writes reject a symlinked cache-directory ancestor', async () => {
  await withTempDir('generation-cache-ancestor-', async (root) => {
    await withTempDir('generation-cache-ancestor-outside-', async (outside) => {
      const directCacheDir = path.join(outside, 'cache');
      const key = createGenerationCacheKey(keyInput);
      await writeGenerationCache({
        cacheDir: directCacheDir,
        key,
        provider: keyInput.provider,
        model: keyInput.model,
        contractVersion: keyInput.contractVersion,
        text: 'outside',
        validationStatus: 'accepted',
        qualityFingerprint: QUALITY_FINGERPRINT,
        inputTargetSha256: null,
        outputSha256: TARGET_B
      });
      await fs.symlink(outside, path.join(root, 'linked-parent'), 'dir');
      const linkedCacheDir = path.join(root, 'linked-parent/cache');

      await assert.rejects(
        writeGenerationCache({
          cacheDir: linkedCacheDir,
          key,
          provider: keyInput.provider,
          model: keyInput.model,
          contractVersion: keyInput.contractVersion,
          text: 'must-not-write',
          validationStatus: 'accepted',
          qualityFingerprint: QUALITY_FINGERPRINT,
          inputTargetSha256: null,
          outputSha256: TARGET_C
        }),
        /cache directory.*symbolic link|cache.*symlink/i
      );
      await assert.rejects(
        readGenerationCache({
          cacheDir: linkedCacheDir,
          key,
          provider: keyInput.provider,
          model: keyInput.model,
          contractVersion: keyInput.contractVersion,
          currentTargetSha256: TARGET_B
        }),
        /cache directory.*symbolic link|cache.*symlink/i
      );
    });
  });
});

test('invalidation truncates only its held inode and preserves path replacements', async () => {
  await withTempDir('generation-cache-invalidation-swap-', async (cacheDir) => {
    const key = createGenerationCacheKey(keyInput);
    const reference = await promoteGenerationCache(createGenerationCacheCandidate({
      cacheDir,
      key,
      provider: keyInput.provider,
      model: keyInput.model,
      contractVersion: keyInput.contractVersion,
      text: 'old',
      inputTargetSha256: null
    }), { qualityFingerprint: QUALITY_FINGERPRINT, outputSha256: TARGET_B });
    const filePath = path.join(cacheDir, `${key}.json`);
    const replacement = JSON.parse(fsSync.readFileSync(filePath, 'utf8'));
    replacement.entryVersion = 'd'.repeat(64);
    replacement.responseText = 'external replacement';
    const originalFtruncateSync = fsSync.ftruncateSync;
    let installed = false;
    let displacedPath;
    let quarantinePath;
    fsSync.ftruncateSync = function installReplacementBeforeRemoval(descriptor, length) {
      if (!installed) {
        installed = true;
        quarantinePath = fsSync.readdirSync(cacheDir)
          .map((name) => path.join(cacheDir, name))
          .find((candidatePath) => candidatePath.endsWith('.quarantine'));
        assert.ok(quarantinePath);
        displacedPath = `${quarantinePath}.held-inode`;
        fsSync.renameSync(quarantinePath, displacedPath);
        fsSync.writeFileSync(quarantinePath, 'external quarantine replacement');
        fsSync.writeFileSync(filePath, `${JSON.stringify(replacement)}\n`);
      }
      return originalFtruncateSync.call(this, descriptor, length);
    };
    try {
      assert.equal(invalidateGenerationCacheReference(reference, { cacheDir }), true);
    } finally {
      fsSync.ftruncateSync = originalFtruncateSync;
    }

    assert.equal(installed, true);
    assert.equal(JSON.parse(fsSync.readFileSync(filePath, 'utf8')).entryVersion, replacement.entryVersion);
    assert.equal(fsSync.readFileSync(quarantinePath, 'utf8'), 'external quarantine replacement');
    assert.equal(fsSync.statSync(displacedPath).size, 0);
  });
});

test('invalidation empties its held inode after an unverified short read without touching replacements', async () => {
  await withTempDir('generation-cache-invalidation-short-read-', async (cacheDir) => {
    const key = createGenerationCacheKey(keyInput);
    const reference = await promoteGenerationCache(createGenerationCacheCandidate({
      cacheDir,
      key,
      provider: keyInput.provider,
      model: keyInput.model,
      contractVersion: keyInput.contractVersion,
      text: 'isolated response body',
      inputTargetSha256: null
    }), { qualityFingerprint: QUALITY_FINGERPRINT, outputSha256: TARGET_B });
    const filePath = path.join(cacheDir, `${key}.json`);
    const replacement = JSON.parse(fsSync.readFileSync(filePath, 'utf8'));
    replacement.entryVersion = 'e'.repeat(64);
    replacement.responseText = 'external key replacement';
    const originalReadSync = fsSync.readSync;
    let displacedPath;
    let quarantinePath;
    let intercepted = false;
    fsSync.readSync = function interruptQuarantineRead(descriptor, ...args) {
      if (!intercepted) {
        intercepted = true;
        quarantinePath = fsSync.readdirSync(cacheDir)
          .map((name) => path.join(cacheDir, name))
          .find((candidatePath) => candidatePath.endsWith('.quarantine'));
        assert.ok(quarantinePath);
        displacedPath = `${quarantinePath}.held-inode`;
        fsSync.renameSync(quarantinePath, displacedPath);
        fsSync.writeFileSync(quarantinePath, 'external quarantine replacement');
        fsSync.writeFileSync(filePath, `${JSON.stringify(replacement)}\n`);
        return 0;
      }
      return originalReadSync.call(this, descriptor, ...args);
    };
    try {
      assert.equal(invalidateGenerationCacheReference(reference, { cacheDir }), false);
    } finally {
      fsSync.readSync = originalReadSync;
    }

    assert.equal(intercepted, true);
    assert.equal(fsSync.statSync(displacedPath).size, 0);
    assert.equal(fsSync.readFileSync(quarantinePath, 'utf8'), 'external quarantine replacement');
    assert.equal(JSON.parse(fsSync.readFileSync(filePath, 'utf8')).entryVersion, replacement.entryVersion);
  });
});
