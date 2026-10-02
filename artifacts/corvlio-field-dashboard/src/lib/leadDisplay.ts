export const UNKNOWN_CALLER = 'Unknown caller';
export const NO_DETAILS = 'No details captured';
export const NO_PHONE = 'No phone captured';

export function displayName(name?: string | null) {
  return name?.trim() || UNKNOWN_CALLER;
}
export function displayIssue(issue?: string | null) {
  return issue?.trim() || NO_DETAILS;
}
export function displayPhone(phone?: string | null) {
  return phone?.trim() || NO_PHONE;
}
/** Keep an explicit caller-supplied callback authoritative, even for legacy responses. */
export function preferLeadCallback<T extends { phone: string; callbackNumber?: string | null }>(lead: T): T {
  return { ...lead, phone: lead.callbackNumber?.trim() || lead.phone };
}
/** Returns a dialable string or null when the phone has too few digits. */
export function usablePhone(phone?: string | null) {
  const trimmed = phone?.trim() ?? '';
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7) return null;
  return trimmed.startsWith('+') ? `+${digits}` : digits;
}
export function nameInitials(name?: string | null) {
  const n = name?.trim();
  if (!n) return '?';
  return n.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}
