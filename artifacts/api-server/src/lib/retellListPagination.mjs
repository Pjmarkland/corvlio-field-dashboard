/**
 * Collect a Retell list without silently returning a partial inventory.
 * The caller owns the supported endpoint, HTTP method, and authentication.
 * This module performs no network requests or provider/database mutations.
 */
export async function collectRetellListItems(fetchPage, { allowLegacyArray = false } = {}) {
  const items = [];
  const seenKeys = new Set();
  let paginationKey;

  while (true) {
    const page = await fetchPage(paginationKey);
    // Agent-version callers previously accepted arrays. Preserve that
    // compatibility only when explicitly requested, never for versioned lists.
    if (Array.isArray(page) && allowLegacyArray && paginationKey === undefined) {
      return page;
    }
    if (!page || Array.isArray(page) || !Array.isArray(page.items)
      || typeof page.has_more !== "boolean") {
      throw new Error("Invalid Retell list response: expected items and has_more");
    }
    items.push(...page.items);
    if (!page.has_more) return items;

    const nextKey = page.pagination_key;
    if (typeof nextKey !== "string" || !nextKey.trim() || seenKeys.has(nextKey)) {
      throw new Error("Invalid Retell pagination: missing or repeated cursor; refusing a partial list");
    }
    seenKeys.add(nextKey);
    paginationKey = nextKey;
  }
}
