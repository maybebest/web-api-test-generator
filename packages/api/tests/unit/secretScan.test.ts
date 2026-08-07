import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const tmpDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('secret scan safety', () => {
  it('fails closed when git cannot enumerate tracked files', async () => {
    const nonRepository = await fs.mkdtemp(path.join(os.tmpdir(), 'har-api-secret-scan-'));
    tmpDirs.push(nonRepository);
    const script = path.resolve('scripts/scan-secrets.mjs');

    const result = spawnSync(process.execPath, [script, '.'], {
      cwd: nonRepository,
      encoding: 'utf8'
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Unable to enumerate tracked files for secret scanning');
  });

  it('fails closed when the requested roots contain no tracked scannable files', () => {
    const result = spawnSync(process.execPath, ['scripts/scan-secrets.mjs', 'does-not-exist'], {
      cwd: process.cwd(),
      encoding: 'utf8'
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('refusing to pass an incomplete scan');
  });

  it('fails when one configured root is empty even if another root has scannable files', () => {
    const result = spawnSync(process.execPath, ['scripts/scan-secrets.mjs', 'scripts', 'does-not-exist'], {
      cwd: process.cwd(),
      encoding: 'utf8'
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('does-not-exist');
    expect(result.stderr).toContain('refusing to pass an incomplete scan');
  });

  it('recognizes the ownership inventory digest as metadata rather than a secret', async () => {
    const repository = await fs.mkdtemp(path.join(os.tmpdir(), 'har-api-secret-marker-'));
    tmpDirs.push(repository);
    await fs.writeFile(
      path.join(repository, '.har-api-tests-generated.json'),
      JSON.stringify({ inventorySha256: 'a'.repeat(64) }, null, 2),
      'utf8'
    );
    expect(spawnSync('git', ['init', '--quiet'], { cwd: repository }).status).toBe(0);
    expect(spawnSync('git', ['add', '.har-api-tests-generated.json'], { cwd: repository }).status).toBe(0);

    const result = spawnSync(process.execPath, [path.resolve('scripts/scan-secrets.mjs'), '.'], {
      cwd: repository,
      encoding: 'utf8'
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('No secrets or PII detected in 1 eligible file');
  });

  it('detects generic session cookies, common token prefixes, and private keys', async () => {
    const repository = await fs.mkdtemp(path.join(os.tmpdir(), 'har-api-secret-patterns-'));
    tmpDirs.push(repository);
    const githubToken = ['ghp', '_', 'A'.repeat(28)].join('');
    const privateKeyHeader = ['-----BEGIN ', 'PRIVATE KEY-----'].join('');
    await fs.writeFile(
      path.join(repository, 'leaks.ts'),
      [`Cookie: sessionid=${'s'.repeat(32)}`, githubToken, privateKeyHeader].join('\n'),
      'utf8'
    );
    expect(spawnSync('git', ['init', '--quiet'], { cwd: repository }).status).toBe(0);
    expect(spawnSync('git', ['add', 'leaks.ts'], { cwd: repository }).status).toBe(0);

    const result = spawnSync(process.execPath, [path.resolve('scripts/scan-secrets.mjs'), '.'], {
      cwd: repository,
      encoding: 'utf8'
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('[cookie header]');
    expect(result.stderr).toContain('[GitHub token]');
    expect(result.stderr).toContain('[private key]');
  });

  it('skips deleted tracked paths and scans non-ignored untracked generated files', async () => {
    const repository = await fs.mkdtemp(path.join(os.tmpdir(), 'har-api-secret-dirty-tree-'));
    tmpDirs.push(repository);
    await fs.writeFile(path.join(repository, 'old.ts'), 'export const old = true;\n', 'utf8');
    expect(spawnSync('git', ['init', '--quiet'], { cwd: repository }).status).toBe(0);
    expect(spawnSync('git', ['add', 'old.ts'], { cwd: repository }).status).toBe(0);
    await fs.rm(path.join(repository, 'old.ts'));
    const githubToken = ['ghp', '_', 'B'.repeat(28)].join('');
    await fs.writeFile(path.join(repository, 'new-generated.ts'), `export const leaked = '${githubToken}';\n`, 'utf8');

    const result = spawnSync(process.execPath, [path.resolve('scripts/scan-secrets.mjs'), '.'], {
      cwd: repository,
      encoding: 'utf8'
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('[GitHub token]');
    expect(result.stderr).not.toContain('ENOENT');
  });
});
