/**
 * Wall-clock ↔ UTC conversion for a named timezone, with no date library.
 *
 * Everything in the database is UTC. Everything a human types or reads — slot
 * times, calendar cells — is wall clock in APP_TIMEZONE. These are the two
 * functions that cross that line; nothing else should do date arithmetic on
 * local strings.
 */

/** Milliseconds that `tz` is ahead of UTC at the given instant. */
function offsetMs(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);

  const f: Record<string, number> = {};
  for (const p of parts) if (p.type !== "literal") f[p.type] = Number(p.value);

  const asIfUtc = Date.UTC(f.year, f.month - 1, f.day, f.hour % 24, f.minute, f.second);
  return asIfUtc - at.getTime();
}

/**
 * Turn a wall-clock time in `tz` into the UTC instant it names.
 *
 * Two passes: the first guess can land on the wrong side of a DST boundary, so
 * the offset is recomputed at the candidate instant and applied again. (India
 * has no DST, but this has to stay correct if the timezone is ever changed.)
 */
export function zonedToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number,
  tz: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
  const first = new Date(naive - offsetMs(new Date(naive), tz));
  const second = new Date(naive - offsetMs(first, tz));
  return second;
}

/** '2026-09-22' + '08:45' in `tz` → the UTC instant. */
export function localDateTimeToUtc(localDate: string, localTime: string, tz: string): Date {
  const [y, m, d] = localDate.split("-").map(Number);
  const [hh, mm] = localTime.split(":").map(Number);
  return zonedToUtc(y, m, d, hh, mm, tz);
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = Sunday
  date: string; // 'YYYY-MM-DD'
  time: string; // 'HH:MM'
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/** Break a UTC instant into its wall-clock parts in `tz`. */
export function utcToLocalParts(at: Date | string, tz: string): LocalParts {
  const d = typeof at === "string" ? new Date(at) : at;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(d);

  const f: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") f[p.type] = p.value;

  const hour = Number(f.hour) % 24;
  const pad = (n: number) => String(n).padStart(2, "0");

  return {
    year: Number(f.year),
    month: Number(f.month),
    day: Number(f.day),
    hour,
    minute: Number(f.minute),
    weekday: WEEKDAY_INDEX[f.weekday] ?? 0,
    date: `${f.year}-${f.month}-${f.day}`,
    time: `${pad(hour)}:${pad(Number(f.minute))}`,
  };
}

export const DAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];
export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** 'YYYY-MM-DD' for today in `tz`. */
export function todayLocal(tz: string): string {
  return utcToLocalParts(new Date(), tz).date;
}

/** Add whole days to a 'YYYY-MM-DD' string without touching timezones. */
export function addDays(localDate: string, days: number): string {
  const [y, m, d] = localDate.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/** Day of week (0 = Sunday) of a 'YYYY-MM-DD' string. */
export function weekdayOf(localDate: string): number {
  const [y, m, d] = localDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** 'Tue 22 Sep, 08:45' — the label used across the UI. */
export function formatSlotLabel(at: Date | string, tz: string): string {
  const d = typeof at === "string" ? new Date(at) : at;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/** 'in 3 hours' / '2 days ago' — coarse on purpose. */
export function relative(at: Date | string): string {
  const d = typeof at === "string" ? new Date(at) : at;
  const diff = d.getTime() - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const sign = diff < 0 ? -1 : 1;

  if (mins < 60) return rtf.format(sign * mins, "minute");
  const hours = Math.round(mins / 60);
  if (hours < 24) return rtf.format(sign * hours, "hour");
  const days = Math.round(hours / 24);
  if (days < 30) return rtf.format(sign * days, "day");
  return rtf.format(sign * Math.round(days / 30), "month");
}
