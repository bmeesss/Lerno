import { describe, expect, it } from 'vitest';
import { dayKeyInZone, isValidTimeZone, todayInZone } from './timezone.js';

describe('timezone helpers', () => {
  it('accepts real IANA zones and rejects anything else', () => {
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Europe/Amsterdam')).toBe(true);
    expect(isValidTimeZone('Pacific/Auckland')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone('UTC+2')).toBe(false);
  });

  it('groups instants into user-local calendar days', () => {
    // 2026-03-05 23:30 UTC is already March 6 in Amsterdam (UTC+1).
    expect(dayKeyInZone('2026-03-05T23:30:00.000Z', 'UTC')).toBe('2026-03-05');
    expect(dayKeyInZone('2026-03-05T23:30:00.000Z', 'Europe/Amsterdam')).toBe('2026-03-06');
    // …and still March 5 in New York (UTC-5).
    expect(dayKeyInZone('2026-03-05T23:30:00.000Z', 'America/New_York')).toBe('2026-03-05');
    expect(dayKeyInZone('2026-03-05T04:30:00.000Z', 'America/New_York')).toBe('2026-03-04');
  });

  it('falls back to the UTC day for unknown zones', () => {
    expect(dayKeyInZone('2026-03-05T23:30:00.000Z', 'Mars/Olympus')).toBe('2026-03-05');
  });

  it('computes today in a zone for a fixed instant', () => {
    const now = new Date('2026-03-08T22:00:00.000Z'); // Sunday 22:00 UTC…
    expect(todayInZone('UTC', now)).toBe('2026-03-08');
    expect(todayInZone('Pacific/Auckland', now)).toBe('2026-03-09'); // …Monday in Auckland
  });
});
