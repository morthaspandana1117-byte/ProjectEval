import { env } from "../config/env.js";

export const SESSION_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date (YYYY-MM-DD) in the configured event time zone. */
export function todayInEventZone(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: env.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function isValidSession(value) {
  if (typeof value !== "string" || !SESSION_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

// ---------------------------------------------------------------------------
// Event-timezone date-times (deadlines). Admins enter wall-clock times in
// EVENT_TIMEZONE; they are stored and returned as UTC instants.
// ---------------------------------------------------------------------------

export const MIN_DATETIME_YEAR = 2000;
export const MAX_DATETIME_YEAR = 2100;
const LOCAL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const DAY_MS = 86_400_000;

export class DateTimeInputError extends Error {}

export function isSupportedTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

const wallClockFormatters = new Map();
function wallClockParts(instant, timeZone) {
  if (!wallClockFormatters.has(timeZone)) {
    wallClockFormatters.set(
      timeZone,
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    );
  }
  const parts = Object.fromEntries(
    wallClockFormatters
      .get(timeZone)
      .formatToParts(instant)
      .map((p) => [p.type, p.value])
  );
  return { ...parts, hour: String(Number(parts.hour) % 24).padStart(2, "0") };
}

/** The wall-clock time in `timeZone` for a UTC instant, expressed as if it were UTC (ms). */
function wallClockMs(instantMs, timeZone) {
  const p = wallClockParts(new Date(instantMs), timeZone);
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
}

/**
 * Converts an event-timezone wall-clock value ("YYYY-MM-DDTHH:mm[:ss]") to a UTC Date.
 * Rejects malformed or impossible calendar values, years outside 2000–2100, unsupported
 * time zones, and local times that are skipped or repeated by a daylight-saving change.
 */
export function zonedDateTimeToUtc(value, timeZone = env.timezone) {
  const match = typeof value === "string" ? LOCAL_DATETIME.exec(value) : null;
  if (!match) throw new DateTimeInputError("Use the format YYYY-MM-DDTHH:mm.");

  const [year, month, day, hour, minute] = match.slice(1, 6).map(Number);
  const second = match[6] === undefined ? 0 : Number(match[6]);
  if (year < MIN_DATETIME_YEAR || year > MAX_DATETIME_YEAR) {
    throw new DateTimeInputError(`Choose a date between ${MIN_DATETIME_YEAR} and ${MAX_DATETIME_YEAR}.`);
  }
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(wall);
  if (
    month < 1 ||
    month > 12 ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new DateTimeInputError(`${value} is not a real calendar date and time.`);
  }
  if (!isSupportedTimeZone(timeZone)) {
    throw new DateTimeInputError(`The event timezone "${timeZone}" is not supported.`);
  }

  // Try every UTC offset in effect around this date; keep instants whose local time matches.
  const offsets = new Set([wall - DAY_MS, wall, wall + DAY_MS].map((t) => wallClockMs(t, timeZone) - t));
  const matches = [...new Set([...offsets].map((offset) => wall - offset))].filter(
    (instant) => wallClockMs(instant, timeZone) === wall
  );
  if (matches.length === 0) {
    throw new DateTimeInputError(`${value} does not exist in ${timeZone} (skipped by a daylight-saving change).`);
  }
  if (matches.length > 1) {
    throw new DateTimeInputError(
      `${value} is ambiguous in ${timeZone} (it occurs twice because of a daylight-saving change). Choose another time.`
    );
  }
  return new Date(matches[0]);
}

/** "YYYY-MM-DDTHH:mm" wall-clock value of a UTC instant in `timeZone` (for date-time inputs). */
export function toZonedLocalString(date, timeZone = env.timezone) {
  const p = wallClockParts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Human-readable time in the event timezone with its label, e.g. "20 Oct 2026, 17:00 IST". */
export function formatInEventZone(date, timeZone = env.timezone) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).format(date);
}
