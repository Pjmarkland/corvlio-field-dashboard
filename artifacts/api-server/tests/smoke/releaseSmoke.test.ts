import express from 'express';
import { createServer, type Server } from 'node:http';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  selectCount: 0,
  rows: [] as any[],
  aggregate: {
    totalLeads: '1',
    contactedLeads: '0',
    thisWeekLeads: '1',
    averageReplyMinutes: null as string | null,
  },
  healthQuery: vi.fn(),
  registerDevice: vi.fn(),
}));

vi.mock('@clerk/express', () => ({
  getAuth: (req: express.Request) => ({ userId: req.get('x-smoke-user') ?? null }),
}));

vi.mock('../../src/lib/businessDirectory', () => ({
  findBusinessByClerkUserId: async (userId: string) => userId === 'smoke-owner'
    ? {
        id: 987654,
        businessName: 'Smoke Test Plumbing',
        retellPhoneNumber: null,
        timeZone: 'America/New_York',
        isSample: true,
        provisioningState: 'sample',
      }
    : undefined,
}));

vi.mock('../../src/lib/notificationService', () => ({
  getNotificationStatus: vi.fn(),
  listNotificationOutbox: vi.fn(),
  registerNotificationDevice: fixture.registerDevice,
  revokeNotificationDevice: vi.fn(),
}));

vi.mock('@workspace/db', async () => {
  const { leadsTable } = await import('../../../../lib/db/src/schema/leads');
  const dialect = new PgDialect();
  const db = {
    select: () => {
      const selectIndex = fixture.selectCount++;
      if (selectIndex > 0) {
        return {
          from: () => ({
            where: async () => [fixture.aggregate],
          }),
        };
      }

      const pageQuery = {
        showSpam: false,
        orderBy: (..._args: unknown[]) => pageQuery,
        limit: () => pageQuery,
        offset: async (offset: number) => fixture.rows
          .filter((row) => Boolean(row.isSpam) === pageQuery.showSpam)
          .slice(offset, offset + 25),
      };
      return {
        from: () => ({
          where: (condition: unknown) => {
            const query = dialect.sqlToQuery(condition as Parameters<typeof dialect.sqlToQuery>[0]);
            pageQuery.showSpam = query.params.includes(true);
            return pageQuery;
          },
        }),
      };
    },
  };
  return { db, leadsTable, pool: { query: fixture.healthQuery } };
});

import healthRouter from '../../src/routes/health';
import leadsRouter from '../../src/routes/leads';
import notificationsRouter from '../../src/routes/notifications';

let server: Server;
let baseUrl: string;

async function checkSmoke(name: string, check: () => Promise<void>): Promise<void> {
  try {
    await check();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : 'Unknown failure'}`);
    throw error;
  }
}

async function request(path: string, options: RequestInit = {}) {
  return fetch(`${baseUrl}${path}`, options);
}

describe('release smoke checks', () => {
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use(healthRouter);
    app.use(leadsRouter);
    app.use(notificationsRouter);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    fixture.selectCount = 0;
    fixture.rows = [{
      id: 987,
      callerName: 'Smoke Fixture Caller',
      phoneNumber: '+15555550101',
      issueReason: 'Test-only plumbing request',
      address: '1 Test Lane',
      urgencyLevel: 'normal',
      status: 'new',
      createdAt: new Date('2026-11-01T12:00:00.000Z'),
      contactedAt: null,
      callerId: null,
      callbackNumber: null,
      availability: null,
      tradeIntakeAnswers: null,
      isSpam: false,
    }];
    fixture.healthQuery.mockResolvedValue({ rows: [{ value: 1 }] });
    fixture.registerDevice.mockResolvedValue({
      id: 19,
      platform: 'ios',
      enabled: true,
      lastSeenAt: '2026-11-01T12:00:00.000Z',
    });
  });

  it('serves the database health endpoint', async () => {
    await checkSmoke('health endpoint', async () => {
      const response = await request('/healthz');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'ok' });
      expect(fixture.healthQuery).toHaveBeenCalledWith('SELECT 1');
    });
  });

  it('rejects signed-out access to protected leads and push routes', async () => {
    await checkSmoke('signed-out protected routes return 401', async () => {
      const leads = await request('/leads');
      const pushRegistration = await request('/notification-devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'smoke-test-device-token-0001', platform: 'ios' }),
      });
      expect(leads.status).toBe(401);
      expect(pushRegistration.status).toBe(401);
      expect(fixture.registerDevice).not.toHaveBeenCalled();
    });
  });

  it('loads leads for a configured test business', async () => {
    await checkSmoke('test-business leads list', async () => {
      const response = await request('/leads', { headers: { 'x-smoke-user': 'smoke-owner' } });
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        configured: true,
        isSample: true,
        businessName: 'Smoke Test Plumbing',
      });
      expect(body.leads).toEqual([
        expect.objectContaining({ id: '987', name: 'Smoke Fixture Caller' }),
      ]);
    });
  });

  it('registers a test iOS push token only for the authenticated test business', async () => {
    await checkSmoke('push-token registration', async () => {
      const response = await request('/notification-devices', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-smoke-user': 'smoke-owner',
        },
        body: JSON.stringify({
          token: 'smoke-test-device-token-0001',
          platform: 'ios',
          apnsEnvironment: 'sandbox',
          enabled: true,
        }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ id: 19, platform: 'ios', enabled: true });
      expect(fixture.registerDevice).toHaveBeenCalledWith(expect.objectContaining({
        clerkUserId: 'smoke-owner',
        businessId: '987654',
        platform: 'ios',
        token: 'smoke-test-device-token-0001',
      }));
    });
  });
});
