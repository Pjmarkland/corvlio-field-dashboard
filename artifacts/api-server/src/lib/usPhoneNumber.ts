/**
 * Accept common US phone formatting and return normalized E.164.
 * This intentionally rejects extensions and non-US country codes.
 */
export function normalizeUsPhoneNumber(value: string): string | null {
  const input = value.trim();
  if (!input || !/^\+?[0-9\s().-]+$/.test(input)) return null;

  const digits = input.replace(/\D/g, "");
  const nationalNumber = digits.length === 11 && digits.startsWith("1")
    ? digits.slice(1)
    : digits.length === 10
      ? digits
      : null;
  if (!nationalNumber || !/^[2-9]\d{2}[2-9]\d{6}$/.test(nationalNumber)) return null;

  if (input.startsWith("+") && !digits.startsWith("1")) return null;
  return `+1${nationalNumber}`;
}
