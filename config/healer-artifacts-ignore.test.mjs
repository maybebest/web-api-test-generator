import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { URL, fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

function checkIgnored(paths) {
  return spawnSync('git', ['check-ignore', '--no-index', '--stdin'], {
    cwd: repoRoot,
    encoding: 'utf8',
    input: `${paths.join('\n')}\n`,
    shell: false
  });
}

test('root healer runtime, candidate, and promotion artifacts are ignored exactly', () => {
  const artifactPaths = [
    '.ai-runs/heal/run-id/evidence.json',
    'tests/.root.heal-run-id.candidate.spec.ts',
    'tests/ui/.site-navigation.heal-run-id.candidate.spec.ts',
    'tests-dev/.root.heal-run-id.candidate.authenticated.spec.ts',
    'tests-dev/ui/.profile-sections.heal-run-id.candidate.spec.ts',
    'tests/.root.spec.ts.run-id.uuid.promotion',
    'tests/ui/.site-navigation.spec.ts.run-id.uuid.promotion',
    'tests-dev/.root.spec.ts.run-id.uuid.promotion',
    'tests-dev/ui/.profile-sections.spec.ts.run-id.uuid.promotion'
  ];
  const result = checkIgnored(artifactPaths);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split('\n'), artifactPaths);
});

test('root healer ignore rules do not hide ordinary test files', () => {
  const result = checkIgnored([
    'tests/ui/site-navigation.spec.ts',
    'tests-dev/ui/profile-sections.spec.ts',
    'tests/.hidden.spec.ts',
    'tests/ui/.site-navigation.candidate.spec.ts'
  ]);

  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, '');
});
