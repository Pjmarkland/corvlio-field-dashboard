export function collectRetellListItems<T>(
  fetchPage: (paginationKey?: string) => Promise<unknown>,
): Promise<T[]>;
