import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createDatabasePools } from "../../../../lib/db/src/pools";

describe("bounded database connection pools", () => {
  it("caps each process at ten clients, bounds acquisition, and handles idle disconnections", async () => {
    const pools = { options: [] as any[], clients: [] as EventEmitter[] };
    class TestPool extends EventEmitter {
      constructor(options: unknown) {
        super();
        pools.options.push(options);
        pools.clients.push(this);
      }
    }
    const warning = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    createDatabasePools(TestPool as unknown as Parameters<typeof createDatabasePools>[0],
      "postgres://test-user:test-password@test-host/test-db");
    expect(pools.options.map(option => option.max)).toEqual([8, 2]);
    for (const options of pools.options) {
      expect(options.connectionTimeoutMillis).toBe(5_000);
      expect(options.idleTimeoutMillis).toBe(10_000);
    }
    expect(pools.options[1].statement_timeout).toBe(15_000);
    for (const client of pools.clients) {
      expect(() => client.emit("error", Object.assign(new Error("connect postgres://test-user:test-password@test-host/test-db"), {
        code: "ECONNREFUSED",
      }))).not.toThrow();
    }
    expect(warning).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(warning.mock.calls)).not.toContain("test-password");
  });
});
