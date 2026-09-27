/**
 * Timezone helpers for user-local calendar days (Master Build DEEL 5).
 *
 * Lerno stores instants (UTC ISO strings) and derives calendar days for
 * streaks, daily goals and weekly summaries. Users live in timezones, so day
 * grouping uses the profile timezone (default 'UTC'). Pure and deterministic:
 * the same instant + zone always yields the same day key.
 */

/** Default timezone: behavior identical to the pre-timezone UTC logic. */
export const DEFAULT_TIMEZONE = 'UTC';

/** True for real IANA zones ('Europe/Amsterdam'); false for anything else. */
export function isValidTimeZone(value: string): boolean {
  if (value.length === 0 || value.length > 60) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Calendar day ("2026-03-05") of an instant in a zone. Falls back to the UTC
 * day for unknown zones so one bad profile value can never break progress.
 */
export function dayKeyInZone(iso: string, timeZone: string): string {
  try {
    // en-CA formats as YYYY-MM-DD, which sorts and compares as a string.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

/** Today's calendar day in a zone for a given instant (default: now). */
export function todayInZone(timeZone: string, now: Date = new Date()): string {
  return dayKeyInZone(now.toISOString(), timeZone);
}
