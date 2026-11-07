import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@workspace/db', () => ({ pool: { query: mocks.query } }));

import { verifyDeletedAccountGuards } from '../../src/lib/deletedAccountGuardCheck';

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

  it('accepts the function and all six enabled triggers', async () => {
    mocks.query.mockResolvedValue({ rows: allGuardRows });
    await expect(verifyDeletedAccountGuards()).resolves.toBeUndefined();
    expect(mocks.query).toHaveBeenCalledOnce();
    expect(mocks.query.mock.calls[0]?.[0]).toContain('pg_trigger');
    expect(mocks.query.mock.calls[0]?.[0]).not.toMatch(/\b(CREATE|ALTER|DROP)\b/i);
  });

  it('fails closed with a repair instruction when a guard is missing', async () => {
    mocks.query.mockResolvedValue({
      rows: allGuardRows.map((row) => ({
        ...row,
        ready: row.object_name === 'public.notification_devices.guard_deleted_account_notification_devices'
          ? false
          : row.ready,
      })),
    });

    await expect(verifyDeletedAccountGuards()).rejects.toThrow(
      /notification_devices.*apply-deleted-account-guards\.sql.*does not run database DDL/,
    );
  });

  it('does not start when the database check itself fails', async () => {
    mocks.query.mockRejectedValue(new Error('database address must not be exposed'));
    await expect(verifyDeletedAccountGuards()).rejects.toThrow(
      /cannot verify the deleted-account guards.*No database changes were attempted/,
    );
  });
});
