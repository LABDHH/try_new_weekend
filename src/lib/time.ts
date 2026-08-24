/**
 * WALL-CLOCK TIME, IN THE TRAVELLER'S ZONE.
 *
 * departAt/returnBy cross the wire as UTC instants (the client picks a naive
 * local time and calls toISOString), and the server runs in UTC. So every
 * getHours()/getDate() on the server silently answers a question nobody asked:
 * "what time is it in UTC?"
 *
 * Someone leaving Bangalore at 05:00 on Saturday is at 2026-09-04T23:30Z, and
 * a UTC server reads that back as FRIDAY 23:30 — wrong day, wrong time, on the
 * one constraint a traveller cannot flex.
 *
 * So: anything the traveller sees, or the model reasons about, is formatted in
 * their zone. Only genuine instants stay in UTC — the Routes API departureTime
 * and the "is departure in the past" check are points on a timeline, not
 * wall-clock readings, and are correct as-is.
 *
 * Deliberately dependency-free and client-safe: the question flow imports the
 * answers schema, which imports this.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** Formatters are expensive to build and pure, so they are reused per zone. */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      // h23 rather than hour12:false — the latter renders midnight as "24:00"
      // on some ICU builds, which breaks every string comparison downstream.
      hourCycle: "h23",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

/** The calendar/clock reading of an instant, as seen in `timeZone`. */
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = formatter(timeZone).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

/** YYYY-MM-DD as seen in `timeZone`. */
export function zonedDate(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** HH:MM as seen in `timeZone`. */
export function zonedTime(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * Calendar arithmetic on a YYYY-MM-DD string.
 *
 * Anchored in UTC on purpose: these are civil dates, not instants, so no zone
 * or DST rule should ever apply to "the day after the 5th".
 */
export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Whole calendar days from `a` to `b`, both YYYY-MM-DD. */
export function daysBetween(a: string, b: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/** Long month name as seen in `timeZone` — "what season is it there". */
export function zonedMonthName(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "long" }).format(date);
}

/** "Saturday, Sep 5, 07:00" as seen in `timeZone`. */
export function zonedHuman(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/**
 * Whether a string is an IANA zone this runtime actually knows.
 *
 * The zone arrives from the browser, so it is untrusted input like any other —
 * an unknown value must fail validation rather than throw from inside a
 * formatter three layers down.
 */
export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The browser's own zone. Falls back to UTC where Intl is unavailable. */
export function detectTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
