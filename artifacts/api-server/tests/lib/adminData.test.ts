import { beforeEach, describe, expect, it, vi } from "vitest";

const clerkMocks = vi.hoisted(() => ({
  getUser: vi.fn(),
}));

vi.mock("@clerk/express", () => ({
  clerkClient: { users: { getUser: clerkMocks.getUser } },
}));

import { loadOwnerProfile } from "../../src/lib/adminData";

describe("admin owner profile lookup", () => {
  beforeEach(() => {
    clerkMocks.getUser.mockReset();
  });

  it("returns unavailable owner details when Clerk no longer has the profile", async () => {
    const notFound = Object.assign(new Error("Not Found"), { status: 404 });
    clerkMocks.getUser.mockRejectedValue(notFound);

    await expect(loadOwnerProfile("deleted-clerk-user")).resolves.toEqual({
      ownerName: null,
      ownerLastSignInAt: null,
    });
  });

  it("rethrows Clerk errors other than a missing user profile", async () => {
    const clerkFailure = Object.assign(new Error("Service unavailable"), { status: 503 });
    clerkMocks.getUser.mockRejectedValue(clerkFailure);

    await expect(loadOwnerProfile("clerk-user")).rejects.toBe(clerkFailure);
  });

  it("still loads names and last sign-in for a profile that exists", async () => {
    const lastSignInAt = 1_750_000_000_000;
    clerkMocks.getUser.mockResolvedValue({
      firstName: "Ada",
      lastName: "Lovelace",
      lastSignInAt,
    });

    await expect(loadOwnerProfile("clerk-user")).resolves.toEqual({
      ownerName: "Ada Lovelace",
      ownerLastSignInAt: new Date(lastSignInAt),
    });
  });
});