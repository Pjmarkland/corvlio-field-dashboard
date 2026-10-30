import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), finish: vi.fn() }));
vi.mock("@workspace/db", () => ({ pool: { query: mocks.query } }));
vi.mock("../../src/lib/accountDeletion", () => ({ finishIdentityDeletion: mocks.finish }));
vi.mock("../../src/lib/logger", () => ({ logger: { error: vi.fn() } }));
import { startAccountDeletionWorker, stopAccountDeletionWorker } from "../../src/lib/accountDeletionWorker";
afterEach(async () => { await stopAccountDeletionWorker(); vi.useRealTimers(); });
describe("account deletion retry frequency", () => {
  it("checks every five minutes, retains queued identity deletion, and stops cleanly", async () => {
    vi.useFakeTimers();
    mocks.query.mockImplementation(async (sql: string) => sql.startsWith("SELECT clerk_user_id")
      ? { rows: [{ clerk_user_id: "test-user" }] }
      : { rows: [] });
    startAccountDeletionWorker();
    startAccountDeletionWorker();
    await vi.advanceTimersByTimeAsync(299_999);
    expect(mocks.query).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.finish).toHaveBeenCalledWith("test-user");
    await stopAccountDeletionWorker();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });
});
