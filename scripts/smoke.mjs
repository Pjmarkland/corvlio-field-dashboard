import { spawnSync } from 'node:child_process';

if (
  process.env.REPLIT_DEPLOYMENT
  || process.env.NODE_ENV === 'production'
  || !process.env.REPLIT_DEV_DOMAIN
) {
  console.error(
    'Smoke tests are restricted to the Replit development environment. They use temporary test data and will not run in production.',
  );
  process.exit(1);
}

const vitestArgs = [
  '--filter',
  '@workspace/corvlio-field-dashboard',
  'exec',
  'vitest',
  'run',
  '--silent=false',
  '--root',
  '../api-server',
  '--config',
  '../api-server/vitest.config.ts',
];

const checks = [
  {
    label: 'health, signed-out routes, test-business leads, and push registration',
    test: 'tests/smoke/releaseSmoke.test.ts',
  },
  {
    label: 'account deletion for a disposable PostgreSQL fixture',
    test: 'tests/lib/accountDeletionPostgres.test.ts',
  },
];

let failed = false;
for (const check of checks) {
  const result = spawnSync(
    'pnpm',
    [...vitestArgs, check.test],
    {
      cwd: process.cwd(),
      env: { ...process.env, SMOKE_RUN: '1' },
      stdio: 'inherit',
    },
  );
  if (result.error || result.status !== 0) {
    console.error(`FAIL ${check.label}`);
    failed = true;
  } else {
    console.log(`PASS ${check.label}`);
  }
}

if (failed) process.exitCode = 1;
