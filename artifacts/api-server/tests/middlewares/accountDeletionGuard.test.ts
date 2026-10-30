import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), query: vi.fn() }));
vi.mock("@clerk/express", () => ({ getAuth: mocks.auth }));
vi.mock("@workspace/db", () => ({ pool: { query: mocks.query } }));
import { accountDeletionGuard } from "../../src/middlewares/accountDeletionGuard";

function request(method = "GET", path = "/leads") {
  const req = { method, path, log: { error: vi.fn(), warn: vi.fn() } } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { req, res, next: vi.fn() };
}
const missing = () => Object.assign(new Error('relation "account_deletions" does not exist'), { code: "42P01" });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockReturnValue({ userId: "test-owner" });
});

describe("deletion guard degraded-mode boundaries", () => {
  it("does not query for anonymous Retell webhooks or block account deletion itself", async () => {
    const anonymous = request("POST", "/webhooks/retell/pre-call");
    mocks.auth.mockReturnValueOnce({ userId: null });
    await accountDeletionGuard(anonymous.req, anonymous.res, anonymous.next);
    expect(anonymous.next).toHaveBeenCalledOnce();
    const deletion = request("DELETE", "/account/me");
    await accountDeletionGuard(deletion.req, deletion.res, deletion.next);
    expect(deletion.next).toHaveBeenCalledOnce();
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("allows a valid ledger-checked account and blocks both pending/completed tombstones", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] });
    const active = request();
    await accountDeletionGuard(active.req, active.res, active.next);
    expect(active.next).toHaveBeenCalledOnce();
    for (const status of ["pending", "completed"]) {
      mocks.query.mockResolvedValueOnce({ rows: [{ status }] });
      const deleted = request();
      await accountDeletionGuard(deleted.req, deleted.res, deleted.next);
      expect(deleted.res.status).toHaveBeenCalledWith(403);
      expect(deleted.next).not.toHaveBeenCalled();
    }
  });
  it.each(["GET", "HEAD"])("allows only an existing owner's %s when the ledger is missing", async method => {
    mocks.query.mockRejectedValueOnce(missing()).mockResolvedValueOnce({ rows: [{ id: 7 }] });
    const args = request(method);
    await accountDeletionGuard(args.req, args.res, args.next);
    expect(args.next).toHaveBeenCalledOnce();
    expect(mocks.query).toHaveBeenLastCalledWith(
      "SELECT id FROM businesses WHERE clerk_user_id = $1 LIMIT 1", ["test-owner"],
    );
    expect(args.req.log.error).toHaveBeenCalledWith(expect.objectContaining({
      databaseError: expect.objectContaining({ code: "42P01", message: 'relation "account_deletions" does not exist' }),
    }), "Account deletion status lookup failed");
  });
  it("does not restore access for deleted/unconfigured identities without an owned business", async () => {
    mocks.query.mockRejectedValueOnce(missing()).mockResolvedValueOnce({ rows: [] });
    const args = request();
    await accountDeletionGuard(args.req, args.res, args.next);
    expect(args.res.status).toHaveBeenCalledWith(403);
    expect(args.next).not.toHaveBeenCalled();
  });
  it.each(["POST", "PATCH", "PUT", "DELETE"])("fails closed for %s while the ledger is missing", async method => {
    mocks.query.mockRejectedValueOnce(missing());
    const args = request(method, "/welcome/setup");
    await accountDeletionGuard(args.req, args.res, args.next);
    expect(args.res.status).toHaveBeenCalledWith(503);
    expect(args.next).not.toHaveBeenCalled();
    expect(mocks.query).toHaveBeenCalledOnce();
  });
  it.each(["ECONNREFUSED", "ETIMEDOUT", "53300", "28P01", "42501", "42703"])(
    "never bypasses a database failure with code %s", async code => {
      mocks.query.mockRejectedValueOnce(Object.assign(new Error("driver failure"), { code }));
      const args = request();
      await accountDeletionGuard(args.req, args.res, args.next);
      expect(args.res.status).toHaveBeenCalledWith(503);
      expect(args.next).not.toHaveBeenCalled();
      expect(mocks.query).toHaveBeenCalledOnce();
    },
  );
  it("does not bypass an unrelated missing table", async () => {
    mocks.query.mockRejectedValueOnce(Object.assign(new Error('relation "businesses" does not exist'), { code: "42P01" }));
    const args = request();
    await accountDeletionGuard(args.req, args.res, args.next);
    expect(args.res.status).toHaveBeenCalledWith(503);
    expect(mocks.query).toHaveBeenCalledOnce();
  });
  it("fails closed if the fallback ownership lookup fails", async () => {
    mocks.query.mockRejectedValueOnce(missing()).mockRejectedValueOnce(new Error("database unavailable"));
    const args = request();
    await accountDeletionGuard(args.req, args.res, args.next);
    expect(args.res.status).toHaveBeenCalledWith(503);
    expect(args.next).not.toHaveBeenCalled();
    expect(args.req.log.error).toHaveBeenCalledTimes(2);
  });
});
