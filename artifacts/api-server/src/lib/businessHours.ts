export const DEFAULT_BUSINESS_HOURS = "Mon-Fri 09:00-17:00";
export const DEFAULT_TIME_ZONE = "America/New_York";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
type Opening = { day: number; start: number; end: number };

export function validTimeZone(value: string): boolean {
  if (!value.includes("/") && value !== "UTC") return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }).format(); return true; }
  catch { return false; }
}

export function parseBusinessHours(value: string): Opening[] | null {
  if (/^24\s*\/\s*7$/i.test(value.trim())) return DAYS.map((_, day) => ({ day, start: 0, end: 1440 }));
  const openings: Opening[] = [];
  for (const part of value.split(";")) {
    const match = /^\s*(.+?)\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/i.exec(part);
    if (!match) return null;
    const fullDays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dayIndex = (v: string) => DAYS.findIndex((day, i) => day.toLowerCase() === v.toLowerCase() || fullDays[i].toLowerCase() === v.toLowerCase());
    const [sh, sm, eh, em] = match.slice(2).map(Number);
    if (sh > 23 || eh > 23 || sm > 59 || em > 59) return null;
    const start = sh * 60 + sm, end = eh * 60 + em;
    if (start === end) return null;
    for (const group of match[1].split(",")) {
      const days = /^\s*([a-z]+)(?:\s*-\s*([a-z]+))?\s*$/i.exec(group);
      if (!days) return null;
      const from = dayIndex(days[1]), to = dayIndex(days[2] ?? days[1]);
      if (from < 0 || to < 0) return null;
      for (let offset = 0; offset < 7; offset++) {
        const day = (from + offset) % 7;
        openings.push({ day, start, end: end > start ? end : end + 1440 });
        if (day === to) break;
      }
    }
  }
  return openings.length ? openings : null;
}

export function businessClock(hours: string, timeZone: string, now = new Date()) {
  const zone = validTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  const currentLocalTime = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, weekday: "long", year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(now);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23",
  }).formatToParts(now);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  const day = DAYS.indexOf(p.weekday), minute = Number(p.hour) * 60 + Number(p.minute);
  const openings = parseBusinessHours(hours);
  if (!openings) return { current_local_time: currentLocalTime, business_is_open: "unknown", next_opening: "" };
  const open = openings.some(o =>
    (o.day === day && minute >= o.start && minute < o.end)
    || ((o.day + 1) % 7 === day && o.end > 1440 && minute < o.end - 1440));
  let next: { distance: number; day: number; minute: number } | undefined;
  for (const o of openings) {
    let distance = ((o.day - day + 7) % 7) * 1440 + o.start - minute;
    if (distance <= 0) distance += 7 * 1440;
    if (!next || distance < next.distance) next = { distance, day: o.day, minute: o.start };
  }
  const nextOpening = next
    ? `${DAYS[next.day]} ${String(Math.floor(next.minute / 60)).padStart(2, "0")}:${String(next.minute % 60).padStart(2, "0")} (${zone})`
    : "";
  return { current_local_time: currentLocalTime, business_is_open: open ? "true" : "false", next_opening: nextOpening };
}