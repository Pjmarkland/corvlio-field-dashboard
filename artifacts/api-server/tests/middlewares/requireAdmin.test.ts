import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clerkMocks = vi.hoisted(() => ({
  getAuth: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("@clerk/express", () => ({
  getAuth: clerkMocks.getAuth,
  clerkClient: { users: { getUser: clerkMocks.getUser } },
}));

import { hasVerifiedAdminEmail, parseAdminEmails } from "../../src/middlewares/requireAdmin";
import { requireAdmin } from "../../src/middlewares/requireAdmin";
import type { NextFunction, Request, Response } from "express";

function middlewareArgs() {
  const req = { log: { warn: vi.fn() } } as unknown as Request;
  const res = { sendStatus: vi.fn(), locals: {} } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  return { req, res, next };
}

describe("admin email access", () => {
  beforeEach(() => {
    vi.stubEnv("ADMIN_EMAILS", "");
    clerkMocks.getAuth.mockReset();
    clerkMocks.getUser.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("trims and compares configured addresses without case sensitivity", () => {
    const allowedEmails = parseAdminEmails(" Founder@Example.com, , ops@example.com ");

    expect([...allowedEmails]).toEqual(["founder@example.com", "ops@example.com"]);
    expect(hasVerifiedAdminEmail([
      { emailAddress: "FOUNDER@example.com", verification: { status: "verified" } },
    ], allowedEmails)).toBe(true);
  });

  it("does not authorize unverified or unlisted email addresses", () => {
    const allowedEmails = parseAdminEmails("founder@example.com");

    expect(hasVerifiedAdminEmail([
      { emailAddress: "founder@example.com", verification: { status: "unverified" } },
    ], allowedEmails)).toBe(false);
    expect(hasVerifiedAdminEmail([
      { emailAddress: "other@example.com", verification: { status: "verified" } },
    ], allowedEmails)).toBe(false);
    expect(hasVerifiedAdminEmail([
      { emailAddress: "founder@example.com", verification: null },
    ], allowedEmails)).toBe(false);
    expect(parseAdminEmails(undefined).size).toBe(0);
  });

  it("returns a 404 without consulting Clerk when ADMIN_EMAILS is unset", async () => {
    const { req, res, next } = middlewareArgs();

    await requireAdmin(req, res, next);

    expect(res.sendStatus).toHaveBeenCalledWith(404);
    expect(clerkMocks.getAuth).not.toHaveBeenCalled();
    expect(clerkMocks.getUser).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("returns a 404 for signed-out users and calls next only for a verified allowlisted email", async () => {
    vi.stubEnv("ADMIN_EMAILS", " founder@example.com ");
    const signedOut = middlewareArgs();
    clerkMocks.getAuth.mockReturnValue({ userId: null });

    await requireAdmin(signedOut.req, signedOut.res, signedOut.next);
    expect(signedOut.res.sendStatus).toHaveBeenCalledWith(404);
    expect(clerkMocks.getUser).not.toHaveBeenCalled();

    const authorized = middlewareArgs();
    clerkMocks.getAuth.mockReturnValue({ userId: "user-123" });
    clerkMocks.getUser.mockResolvedValue({
      emailAddresses: [{
        emailAddress: "FOUNDER@example.com",
        verification: { status: "verified" },
      }],
    });

    await requireAdmin(authorized.req, authorized.res, authorized.next);
    expect(authorized.next).toHaveBeenCalledOnce();
    expect(authorized.res.sendStatus).not.toHaveBeenCalled();
    expect(authorized.res.locals.adminEmail).toBe("founder@example.com");
  });
});