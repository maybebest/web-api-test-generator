import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const scriptPath = path.resolve('scripts/calibration-report.mjs');

async function makeWorkDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'har-api-tests-calibration-'));
}

function runReport(
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv = {}
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(process.execPath, [scriptPath, ...args], {
    cwd,
    env: { ...process.env, CALIBRATION_OUTPUT_FILE: '', ...env }
  });
}

function jsonlLine(label: string, actual: number, host?: string): string {
  return `${JSON.stringify({ label, host, expected: { kind: 'family', family: '4xx' }, actual })}\n`;
}

describe('calibration report script', () => {
  it('merges --write-overrides with existing overrides instead of overwriting them', async () => {
    const cwd = await makeWorkDir();
    await fs.mkdir(path.join(cwd, 'config'), { recursive: true });
    await fs.writeFile(
      path.join(cwd, 'config', 'calibration-overrides.json'),
      `${JSON.stringify([
        { title: 'negative: POST /old rejects missing field', observedStatus: 422 },
        { title: 'negative: POST /shared rejects missing field', observedStatus: 400 }
      ])}\n`,
      'utf8'
    );
    const resultsPath = path.join(cwd, 'results.jsonl');
    await fs.writeFile(
      resultsPath,
      jsonlLine('negative: POST /shared rejects missing field', 422) +
        jsonlLine('negative: POST /fresh rejects missing field', 404, 'api.example.test') +
        jsonlLine('security: POST /broken rejects missing authorization', 503) +
        `${JSON.stringify({ label: 'negative: POST /no-actual', expected: { kind: 'family', family: '4xx' } })}\n`,
      'utf8'
    );

    const { stderr } = await runReport(cwd, [resultsPath, '--write-overrides']);

    const overrides = JSON.parse(await fs.readFile(path.join(cwd, 'config', 'calibration-overrides.json'), 'utf8')) as Array<{
      title: string;
      hostname?: string;
      observedStatus: number;
    }>;
    // Graduated entries from earlier loops survive (ratchet)...
    expect(overrides).toContainEqual({ title: 'negative: POST /old rejects missing field', observedStatus: 422 });
    // ...fresh results win per title...
    expect(overrides).toContainEqual({ title: 'negative: POST /shared rejects missing field', observedStatus: 422 });
    // ...host-scoped rows keep their hostname...
    expect(overrides).toContainEqual({
      title: 'negative: POST /fresh rejects missing field',
      hostname: 'api.example.test',
      observedStatus: 404
    });
    // ...and review (5xx) rows plus records without an integer actual never land in the file.
    expect(overrides).toHaveLength(3);
    expect(stderr).toContain('skipping malformed line');
  });

  it('treats a bare positional argument as the input file, never as the overrides output', async () => {
    const cwd = await makeWorkDir();
    const preciousResults = path.join(cwd, 'my-precious-results.jsonl');
    const originalContent = jsonlLine('negative: POST /a rejects missing field', 422);
    await fs.writeFile(preciousResults, originalContent, 'utf8');

    await runReport(cwd, ['--write-overrides', preciousResults]);

    expect(await fs.readFile(preciousResults, 'utf8')).toBe(originalContent);
    const overrides = JSON.parse(await fs.readFile(path.join(cwd, 'config', 'calibration-overrides.json'), 'utf8'));
    expect(overrides).toEqual([{ title: 'negative: POST /a rejects missing field', observedStatus: 422 }]);
  });

  it('writes to a custom overrides path only via the unambiguous = form', async () => {
    const cwd = await makeWorkDir();
    const resultsPath = path.join(cwd, 'results.jsonl');
    await fs.writeFile(resultsPath, jsonlLine('negative: POST /a rejects missing field', 400), 'utf8');

    await runReport(cwd, [resultsPath, '--write-overrides=custom-overrides.json']);

    const overrides = JSON.parse(await fs.readFile(path.join(cwd, 'custom-overrides.json'), 'utf8'));
    expect(overrides).toEqual([{ title: 'negative: POST /a rejects missing field', observedStatus: 400 }]);
  });

  it('honors CALIBRATION_OUTPUT_FILE as the default input like the recorder does', async () => {
    const cwd = await makeWorkDir();
    const customPath = path.join(cwd, 'custom-results.jsonl');
    await fs.writeFile(customPath, jsonlLine('negative: POST /a rejects missing field', 422), 'utf8');

    const { stdout } = await runReport(cwd, [], { CALIBRATION_OUTPUT_FILE: customPath });

    expect(stdout).toContain('1 test(s)');
    expect(stdout).toContain(customPath);
  });
});
