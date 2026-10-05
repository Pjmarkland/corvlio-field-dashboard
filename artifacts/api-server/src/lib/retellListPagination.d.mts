export function collectRetellListItems<T>(
  fetchPage: (paginationKey?: string) => Promise<unknown>,
  options?: { allowLegacyArray?: boolean },
): Promise<T[]>;
