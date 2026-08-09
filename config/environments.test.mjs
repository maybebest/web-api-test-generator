import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { URL } from 'node:url';
import ts from 'typescript';

const environmentSource = fs.readFileSync(new URL('./environments.ts', import.meta.url), 'utf8');
const sourceWithoutDotenv = environmentSource.replace(/^import '\.\/load-dotenv';\s*/u, '');
assert.notEqual(sourceWithoutDotenv, environmentSource, 'environment test must isolate the dotenv side effect');
const environmentJavaScript = ts.transpileModule(sourceWithoutDotenv, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;
const environmentModuleUrl = `data:text/javascript;base64,${Buffer.from(environmentJavaScript).toString('base64')}`;

const baseEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  TEST_ENV: 'dev',
  WEB_BASIC_AUTH_USER: 'fixture-user',
  WEB_BASIC_AUTH_PASSWORD: 'fixture-password',
  AGENT_PASSWORD: 'fixture-password',
  ADMIN_EMAIL: 'admin@example.test',
  ADMIN_PASSWORD: 'fixture-password'
};

function selectedEnvironment(env = {}) {
  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '--eval',
    `import { environment } from ${JSON.stringify(environmentModuleUrl)}; process.stdout.write(JSON.stringify(environment));`
  ], { encoding: 'utf8', env });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('dev selects the exact PsychicBook development endpoints', () => {
  assert.deepEqual(selectedEnvironment({ TEST_ENV: 'dev' }), {
    name: 'dev',
    webUrl: 'https://user.dev.psychicbook.net',
    apiUrl: 'https://api.dev.psychicbook.net',
    helpdeskUrl: 'https://helpdesk.dev.psychicbook.net',
    generationApiUrl: 'https://agpt.dev.psychicbook.net/api',
    emailCode: '1234',
    smsCode: '1234'
  });
});

test('stage remains the unchanged default environment', () => {
  assert.deepEqual(selectedEnvironment(), {
    name: 'stage',
    webUrl: 'https://user.stage.psychicbook.net',
    apiUrl: 'https://api.stage.psychicbook.net',
    helpdeskUrl: 'https://helpdesk.stage.psychicbook.net',
    generationApiUrl: 'https://agpt.stage.psychicbook.net/api',
    emailCode: '1234',
    smsCode: '1234'
  });
});

test('dev environment lets the real root Playwright config collect tests without replacing reports', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'environment-list-report-'));
  const reportDirectory = path.join(workspace, 'playwright-report');
  const sentinel = path.join(reportDirectory, 'existing-report.sentinel');
  fs.mkdirSync(reportDirectory, { recursive: true });
  fs.writeFileSync(sentinel, 'preserve-existing-report');

  try {
    const result = spawnSync(
      'npx',
      ['playwright', 'test', '--list', '--project=api', '--reporter=line'],
      {
        cwd: process.cwd(),
        env: { ...baseEnv, PLAYWRIGHT_HTML_OUTPUT_DIR: reportDirectory },
        encoding: 'utf8',
        shell: false
      }
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Total: 8 tests in 6 files/);
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'preserve-existing-report');
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
