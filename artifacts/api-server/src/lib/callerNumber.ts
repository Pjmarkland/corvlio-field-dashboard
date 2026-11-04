/**
 * Normalize caller IDs for exact suppression matching without assuming a
 * country for already international numbers.
 */
export function normalizeCallerNumber(value: string | null | undefined): string | null {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (digits.length < 7 || digits.length > 15) return null;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}
