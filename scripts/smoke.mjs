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

const devHost = process.env.REPLIT_DEV_DOMAIN;
if (!devHost?.endsWith('.replit.dev')) {
  console.error('FAIL live development guard status: REPLIT_DEV_DOMAIN is not a Replit development host');
  failed = true;
} else {
  try {
    const response = await fetch(`https://${devHost}/api/healthz`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    const health = await response.json();
    const guardStatus = health?.details?.deletedAccountGuards;
    if (!response.ok || !guardStatus || typeof guardStatus.status !== 'string') {
      throw new Error(`health endpoint returned HTTP ${response.status} without guard status details`);
    }

    const missing = Array.isArray(guardStatus.missing) ? guardStatus.missing : [];
    console.log(
      `Development API deleted-account guards: ${guardStatus.status}${missing.length ? ` (${missing.join(', ')})` : ''}`,
    );
    if (guardStatus.status !== 'present') {
      console.error('FAIL live development guard status: expected all guards to be present');
      failed = true;
    } else {
      console.log('PASS live development guard status');
    }
  } catch (error) {
    console.error(
      `FAIL live development guard status: ${error instanceof Error ? error.message : 'Unknown health check failure'}`,
    );
    failed = true;
  }
}

if (failed) process.exitCode = 1;
