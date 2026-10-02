import { createServer, type Server } from "node:http";
import express from "express";
import { WELCOME_LAUNCH_AT } from "../../src/lib/welcomePolicy";
const mocks = vi.hoisted(() => ({
  getAuth: vi.fn(), getUser: vi.fn(), updateUserMetadata: vi.fn(), findBusiness: vi.fn(), lock: vi.fn(),
}));
vi.mock("@clerk/express", () => ({
  getAuth: mocks.getAuth, clerkClient: { users: { getUser: mocks.getUser, updateUserMetadata: mocks.updateUserMetadata } },
}));
vi.mock("../../src/lib/businessDirectory", () => ({ findBusinessByClerkUserId: mocks.findBusiness }));
vi.mock("../../src/lib/provisioningStore", () => ({ provisioningStore: { lock: mocks.lock } }));
import router from "../../src/routes/welcome";
let server: Server, base: string;
let user: {
  createdAt: number; privateMetadata: Record<string, unknown>; primaryEmailAddressId: string;
  emailAddresses: { id: string; verification: { status: string } }[];
};
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).log = { error: vi.fn() }; next(); });
  app.use(router);
  server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())));
beforeEach(() => {
  vi.clearAllMocks();
  user = { createdAt: WELCOME_LAUNCH_AT + 1000, privateMetadata: {}, primaryEmailAddressId: "test-email",
    emailAddresses: [{ id: "test-email", verification: { status: "verified" } }] };
  mocks.getAuth.mockReturnValue({ userId: "test-user" });
  mocks.getUser.mockImplementation(async () => user);
  mocks.findBusiness.mockResolvedValue(undefined);
  mocks.updateUserMetadata.mockImplementation(async (_id, metadata) => {
    user.privateMetadata = { ...user.privateMetadata, ...metadata.privateMetadata };
  });
  let queue = Promise.resolve();
  mocks.lock.mockImplementation((_account, work) => {
    const result = queue.then(work); queue = result.catch(() => {}); return result;
  });
});
const claim = () => fetch(`${base}/user/welcome`, { method: "POST" });
describe("one-time verified welcome entry", () => {
  it("requires auth and never performs setup/provisioning", async () => {
    mocks.getAuth.mockReturnValue({ userId: null });
    expect((await claim()).status).toBe(401);
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.updateUserMetadata).not.toHaveBeenCalled();
  });
  it("marks a new verified user before returning and skips all later entries", async () => {
    const first = await claim();
    expect(first.headers.get("cache-control")).toContain("no-store");
    expect(await first.json()).toEqual({ showWelcome: true, nextPath: "/onboarding" });
    expect(mocks.updateUserMetadata).toHaveBeenCalledWith("test-user", expect.objectContaining({
      privateMetadata: { corvlioWelcomeSeenAt: expect.any(String) },
    }));
    expect(await (await claim()).json()).toEqual({ showWelcome: false, nextPath: "/onboarding" });
    expect(mocks.updateUserMetadata).toHaveBeenCalledOnce();
  });
  it("serializes concurrent claims for the account", async () => {
    const entries = await Promise.all([claim(), claim()]);
    expect(await Promise.all(entries.map(r => r.json()))).toEqual([
      { showWelcome: true, nextPath: "/onboarding" }, { showWelcome: false, nextPath: "/onboarding" },
    ]);
    expect(mocks.lock).toHaveBeenCalledWith("test-user", expect.any(Function));
    expect(mocks.updateUserMetadata).toHaveBeenCalledOnce();
  });
  it("never shows to an already configured business", async () => {
    mocks.findBusiness.mockResolvedValue({ id: 1 });
    expect(await (await claim()).json()).toEqual({ showWelcome: false, nextPath: "/dashboard" });
    expect(mocks.getUser).not.toHaveBeenCalled();
  });
  it("leaves older unconfigured users on their existing onboarding path", async () => {
    user.createdAt = WELCOME_LAUNCH_AT - 1;
    expect(await (await claim()).json()).toEqual({ showWelcome: false, nextPath: "/onboarding" });
    expect(mocks.updateUserMetadata).not.toHaveBeenCalled();
  });
  it("does not show or consume the flag before verification", async () => {
    user.emailAddresses[0].verification.status = "unverified";
    expect((await claim()).status).toBe(403);
    expect(mocks.updateUserMetadata).not.toHaveBeenCalled();
  });
  it("fails explicitly on metadata write failure and allows a later retry", async () => {
    mocks.updateUserMetadata.mockRejectedValueOnce(new Error("Clerk unavailable"));
    expect((await claim()).status).toBe(502);
    expect(user.privateMetadata.corvlioWelcomeSeenAt).toBeUndefined();
    expect(await (await claim()).json()).toEqual({ showWelcome: true, nextPath: "/onboarding" });
  });
});