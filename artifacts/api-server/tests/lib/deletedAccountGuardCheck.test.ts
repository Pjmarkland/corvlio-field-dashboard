import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), error: vi.fn() }));
vi.mock('@workspace/db', () => ({ pool: { query: mocks.query } }));
vi.mock('../../src/lib/logger', () => ({ logger: { error: mocks.error } }));

import {
  getDeletedAccountGuardStatus,
  verifyDeletedAccountGuards,
} from '../../src/lib/deletedAccountGuardCheck';

const allGuardRows = [
  { object_name: 'public.guard_deleted_account_data()', ready: true },
  { object_name: 'public.businesses.guard_deleted_account_businesses', ready: true },
  { object_name: 'public.notification_devices.guard_deleted_account_notification_devices', ready: true },
  { object_name: 'public.notification_events.guard_deleted_account_notification_events', ready: true },
  { object_name: 'public.notification_poll_state.guard_deleted_account_notification_poll_state', ready: true },
  { object_name: 'public.notification_seen_leads.guard_deleted_account_notification_seen_leads', ready: true },
  { object_name: 'public.provisioning_attempts.guard_deleted_account_provisioning_attempts', ready: true },
];

describe('deleted-account guard startup check', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stays quiet when the function and all six enabled triggers are present', async () => {
    mocks.query.mockResolvedValue({ rows: allGuardRows });
    await expect(verifyDeletedAccountGuards()).resolves.toEqual({
      status: 'present',
      missing: [],
    });
    expect(mocks.query).toHaveBeenCalledOnce();
    expect(mocks.query.mock.calls[0]?.[0]).toContain('pg_trigger');
    expect(mocks.query.mock.calls[0]?.[0]).not.toMatch(/\b(CREATE|ALTER|DROP)\b/i);
    expect(mocks.error).not.toHaveBeenCalled();
    expect(getDeletedAccountGuardStatus()).toEqual({ status: 'present', missing: [] });
  });

  it('logs missing guards and resolves so API startup continues', async () => {
    mocks.query.mockResolvedValue({
      rows: allGuardRows.map((row) => ({
        ...row,
        ready: row.object_name === 'public.notification_devices.guard_deleted_account_notification_devices'
          ? false
          : row.ready,
      })),
    });

    await expect(verifyDeletedAccountGuards()).resolves.toEqual({
      status: 'missing',
      missing: ['public.notification_devices.guard_deleted_account_notification_devices'],
    });
    expect(mocks.error).toHaveBeenCalledOnce();
    expect(mocks.error.mock.calls[0]?.[0]).toMatchObject({
      missing: ['public.notification_devices.guard_deleted_account_notification_devices'],
      repairScript: 'scripts/apply-deleted-account-guards.sql',
    });
    expect(mocks.error.mock.calls[0]?.[1]).toMatch(/API startup will continue/);
    expect(getDeletedAccountGuardStatus()).toEqual({
      status: 'missing',
      missing: ['public.notification_devices.guard_deleted_account_notification_devices'],
    });
  });

  it('reports a missing guard function by name without blocking startup', async () => {
    mocks.query.mockResolvedValue({
      rows: allGuardRows.map((row) => ({
        ...row,
        ready: row.object_name === 'public.guard_deleted_account_data()'
          ? false
          : row.ready,
      })),
    });

    await expect(verifyDeletedAccountGuards()).resolves.toEqual({
      status: 'missing',
      missing: ['public.guard_deleted_account_data()'],
    });
    expect(mocks.error).toHaveBeenCalledOnce();
    expect(mocks.error.mock.calls[0]?.[0]).toMatchObject({
      missing: ['public.guard_deleted_account_data()'],
      repairScript: 'scripts/apply-deleted-account-guards.sql',
    });
  });

  it('logs an unavailable check and resolves so API startup continues', async () => {
    mocks.query.mockRejectedValue(new Error('database address must not be exposed'));
    await expect(verifyDeletedAccountGuards()).resolves.toEqual({
      status: 'unknown',
      missing: [],
    });
    expect(mocks.error).toHaveBeenCalledOnce();
    expect(mocks.error.mock.calls[0]?.[1]).toMatch(/API startup will continue/);
    expect(JSON.stringify(mocks.error.mock.calls)).not.toContain('private database hostname');
  });
});
