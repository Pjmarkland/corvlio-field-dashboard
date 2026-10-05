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
  it("preserves explicitly requested agent-version array compatibility", async () => {
    const request = vi.fn(async () => [{ version: 1, is_published: false }]);
    expect(await collectRetellListItems(request, { allowLegacyArray: true })).toEqual([{ version: 1, is_published: false }]);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
