import { describe, expect, it, vi } from "vitest";
import { collectRetellListItems } from "../../src/lib/retellListPagination.mjs";

describe("Retell paginated list responses", () => {
  it("collects phone numbers from all pages using the v2 items envelope", async () => {
    const phoneNumbers = Array.from({ length: 103 }, (_, i) => ({ phone_number: `+1555${String(i).padStart(7, "0")}` }));
    const request = vi.fn(async (path: string) => {
      const cursor = new URL(path, "https://retell.example").searchParams.get("pagination_key");
      return cursor === null
        ? { items: phoneNumbers.slice(0, 50), has_more: true, pagination_key: "page 2/+" }
        : cursor === "page 2/+"
          ? { items: phoneNumbers.slice(50, 100), has_more: true, pagination_key: "page 3" }
          : { items: phoneNumbers.slice(100), has_more: false };
    });
    const result = await collectRetellListItems<{ phone_number: string }>(key =>
      request(`/v2/list-phone-numbers${key === undefined ? "" : `?${new URLSearchParams({ pagination_key: key })}`}`));
    expect(result).toEqual(phoneNumbers);
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[0][0]).toBe("/v2/list-phone-numbers");
    expect(new URL(request.mock.calls[1][0], "https://retell.example").searchParams.get("pagination_key")).toBe("page 2/+");
  });
  it("returns an empty final page without an unnecessary next request", async () => {
    const request = vi.fn(async () => ({ items: [], has_more: false, pagination_key: "unused" }));
    expect(await collectRetellListItems(request)).toEqual([]);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("continues through empty intermediate pages", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ items: [], has_more: true, pagination_key: "next" })
      .mockResolvedValueOnce({ items: [{ id: "last" }], has_more: false });
    expect(await collectRetellListItems(request)).toEqual([{ id: "last" }]);
  });
  it.each([null, [], { items: [] }, { items: {}, has_more: false }])("rejects malformed or legacy versioned-list responses: %j", async page => {
    await expect(collectRetellListItems(async () => page)).rejects.toThrow("Invalid Retell list response");
  });
  it.each([undefined, null, "", " "])("rejects has_more without a usable next cursor: %j", async key => {
    await expect(collectRetellListItems(async () => ({ items: [], has_more: true, pagination_key: key })))
      .rejects.toThrow("Invalid Retell pagination");
  });
  it("rejects cursor cycles instead of looping or returning a partial list", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ items: [1], has_more: true, pagination_key: "a" })
      .mockResolvedValueOnce({ items: [2], has_more: true, pagination_key: "b" })
      .mockResolvedValueOnce({ items: [3], has_more: true, pagination_key: "a" });
    await expect(collectRetellListItems(request)).rejects.toThrow("repeated cursor");
    expect(request).toHaveBeenCalledTimes(3);
  });
  it("propagates later-page failures instead of reporting a partial inventory", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ items: [1], has_more: true, pagination_key: "next" })
      .mockRejectedValueOnce(new Error("Provider unavailable"));
    await expect(collectRetellListItems(request)).rejects.toThrow("Provider unavailable");
  });
  it.each(["true", "false", null])("rejects a nonboolean has_more rather than truncating inventory: %j", async hasMore => {
    await expect(collectRetellListItems(async () => ({ items: [{ phone_number: "+15550000001" }], has_more: hasMore })))
      .rejects.toThrow("Invalid Retell list response");
  });
  it("rejects a malformed later page instead of returning the collected first page", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ items: [{ phone_number: "+15550000001" }], has_more: true, pagination_key: "next" })
      .mockResolvedValueOnce([{ phone_number: "+15550000002" }]);
    // Even supported array compatibility is first-page-only; mixing formats
    // halfway through pagination must never look like a complete inventory.
    await expect(collectRetellListItems(request))
      .rejects.toThrow("Invalid Retell list response");
    expect(request.mock.calls.map(args => args[0])).toEqual([undefined, "next"]);
  });
  it("rejects obsolete agent-version arrays instead of bypassing the pagination contract", async () => {
    const request = vi.fn(async () => [{ version: 1, is_published: false }]);
    await expect(collectRetellListItems(request)).rejects.toThrow("Invalid Retell list response");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("collects every v3 call page with the cursor in the POST body and preserves filters", async () => {
    const filters = { agent: [{ agent_id: "agent_fixture", version: [2] }] };
    const calls = Array.from({ length: 101 }, (_, i) => ({ call_id: `fixture_call_${i}` }));
    const request = vi.fn(async (_path: string, body: Record<string, unknown>) => {
      expect(body.filter_criteria).toEqual(filters);
      expect(body.limit).toBe(50);
      if (body.pagination_key === undefined)
        return { items: calls.slice(0, 50), has_more: true, pagination_key: "calls /+?& page2" };
      if (body.pagination_key === "calls /+?& page2")
        return { items: calls.slice(50, 100), has_more: true, pagination_key: "calls page3" };
      return { items: calls.slice(100), has_more: false };
    });
    const result = await collectRetellListItems(key => request("/v3/list-calls", {
      filter_criteria: filters, limit: 50, ...(key === undefined ? {} : { pagination_key: key }),
    }));
    expect(result).toEqual(calls);
    expect(request.mock.calls.map(([path]) => path)).toEqual(Array(3).fill("/v3/list-calls"));
    expect(request.mock.calls.map(([, body]) => body.pagination_key))
      .toEqual([undefined, "calls /+?& page2", "calls page3"]);
  });
});
