import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteRetellCall } from "../../src/lib/retellCallDeletion";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Retell call deletion", () => {
  it("uses the documented delete endpoint and treats an already-absent call as success", async () => {
    vi.stubEnv("RETELL_API_KEY", "test-key");
    const request = vi.fn().mockResolvedValue({ status: 422 });

    await expect(deleteRetellCall("call/id", request as typeof fetch)).resolves.toBeUndefined();

    expect(request).toHaveBeenCalledWith(
      "https://api.retellai.com/v2/delete-call/call%2Fid",
      { method: "DELETE", headers: { Authorization: "Bearer test-key" } },
    );
  });

  it("does not report non-idempotent provider failures as success", async () => {
    vi.stubEnv("RETELL_API_KEY", "test-key");
    const request = vi.fn().mockResolvedValue({ status: 500 });

    await expect(deleteRetellCall("call-1", request as typeof fetch))
      .rejects.toThrow("Retell call deletion failed with status 500");
  });
});
