export const DEFAULT_BUSINESS_HOURS = 'Mon-Fri 09:00-17:00';
export const DEFAULT_TIME_ZONE = 'America/New_York';

export const BUSINESS_HOURS_EXAMPLES = [
  'Mon-Fri 09:00-17:00',
  'Mon-Fri 08:00-18:00; Sat 09:00-13:00',
  '24/7',
];

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function dayIndex(token: string) {
  return DAYS.indexOf(token.trim().slice(0, 3).toLowerCase());
}

/** Returns an error message, or null when the schedule is valid. */
export function validateBusinessHours(value: string): string | null {
  const text = value.trim();
  if (!text) return 'Enter your business hours, for example Mon-Fri 09:00-17:00.';
  if (/^24\s*\/\s*7$/i.test(text)) return null;
  for (const part of text.split(';')) {
    const segment = part.trim();
    if (!segment) return 'Remove the extra semicolon, or add hours after it.';
    const match = /^([A-Za-z]{3,9}(?:\s*-\s*[A-Za-z]{3,9})?(?:\s*,\s*[A-Za-z]{3,9}(?:\s*-\s*[A-Za-z]{3,9})?)*)\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/.exec(segment);
    if (!match) return `"${segment}" needs days and a time range, like Mon-Fri 09:00-17:00.`;
    for (const dayPart of match[1].split(',')) {
      const bounds = dayPart.split('-');
      if (bounds.some((day) => dayIndex(day) < 0)) return `"${dayPart.trim()}" is not a day. Use Mon, Tue, Wed, Thu, Fri, Sat or Sun.`;
    }
    const open = TIME.exec(match[2]);
    const close = TIME.exec(match[3]);
    if (!open || !close) return 'Use 24-hour times from 00:00 to 23:59.';
    if (Number(open[1]) * 60 + Number(open[2]) >= Number(close[1]) * 60 + Number(close[2])) return 'Closing time must be later than opening time.';
  }
  return null;
}

export function validateTimeZone(value: string): string | null {
  const zone = value.trim();
  if (!zone) return 'Choose your time zone, for example America/New_York.';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return zone.includes('/') || zone === 'UTC' ? null : 'Use an IANA time zone such as America/Chicago.';
  } catch {
    return 'Use an IANA time zone such as America/Chicago.';
  }
}

export function listTimeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  try {
    const zones = intl.supportedValuesOf?.('timeZone');
    if (zones?.length) return zones;
  } catch { /* fall through */ }
  return ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu'];
}
