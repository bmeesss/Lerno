/**
 * The exam countdown is a calendar-day difference in the student's own
 * timezone. These cases sit on the boundaries where a UTC-only comparison is
 * off by one: just before/after local midnight, DST changes, month and year ends.
 */
import { describe, expect, it } from 'vitest';
import { addDaysIso, daysUntil, todayIso } from './study-pack-rules.js';

describe('exam countdown across timezones and date boundaries', () => {
  const exam = '2026-10-08';

  it('counts whole days from noon UTC', () => {
    const now = new Date('2026-09-29T12:00:00.000Z');
    expect(daysUntil(exam, now)).toBe(9);
    expect(daysUntil(exam, now, 'Europe/Amsterdam')).toBe(9);
    expect(daysUntil(exam, now, 'America/New_York')).toBe(9);
  });

  it('uses the local calendar day, not the UTC day, late in the evening UTC', () => {
    // 23:30 UTC on the 29th is already the 30th in Amsterdam (CEST, UTC+2).
    const now = new Date('2026-09-29T23:30:00.000Z');
    expect(daysUntil(exam, now, 'UTC')).toBe(9);
    expect(daysUntil(exam, now, 'Europe/Amsterdam')).toBe(8);
    // …and still the 29th in New York (EDT, UTC-4).
    expect(daysUntil(exam, now, 'America/New_York')).toBe(9);
  });

  it('uses the local calendar day early in the morning UTC', () => {
    // 01:30 UTC on the 30th is still the evening of the 29th in New York.
    const now = new Date('2026-09-30T01:30:00.000Z');
    expect(daysUntil(exam, now, 'UTC')).toBe(8);
    expect(daysUntil(exam, now, 'America/New_York')).toBe(9);
    expect(daysUntil(exam, now, 'Pacific/Auckland')).toBe(8);
  });

  it('is zero on the exam day, one the day before and negative afterwards', () => {
    expect(daysUntil(exam, new Date('2026-10-08T00:05:00.000Z'), 'UTC')).toBe(0);
    expect(daysUntil(exam, new Date('2026-10-07T21:59:00.000Z'), 'Europe/Amsterdam')).toBe(1);
    // 22:01 UTC is 00:01 on the exam day in Amsterdam.
    expect(daysUntil(exam, new Date('2026-10-07T22:01:00.000Z'), 'Europe/Amsterdam')).toBe(0);
    expect(daysUntil(exam, new Date('2026-10-10T12:00:00.000Z'))).toBe(-2);
  });

  it('is exact across the autumn DST change', () => {
    // Amsterdam leaves DST on 2026-10-25: that local day has 25 hours.
    const before = new Date('2026-10-24T22:30:00.000Z'); // 00:30 CEST on the 25th
    expect(daysUntil('2026-10-26', before, 'Europe/Amsterdam')).toBe(1);
    const after = new Date('2026-10-25T23:30:00.000Z'); // 00:30 CET on the 26th
    expect(daysUntil('2026-10-26', after, 'Europe/Amsterdam')).toBe(0);
  });

  it('is exact across month and year ends', () => {
    const newYearsEve = new Date('2026-12-31T23:30:00.000Z'); // already Jan 1 in Amsterdam
    expect(daysUntil('2027-01-05', newYearsEve, 'UTC')).toBe(5);
    expect(daysUntil('2027-01-05', newYearsEve, 'Europe/Amsterdam')).toBe(4);
    expect(daysUntil('2026-03-01', new Date('2026-02-27T12:00:00.000Z'))).toBe(2);
  });

  it('falls back to UTC for an unknown timezone instead of throwing', () => {
    const now = new Date('2026-09-29T23:30:00.000Z');
    expect(daysUntil(exam, now, 'Mars/Olympus')).toBe(9);
  });

  it('derives today and plan dates from the same local day', () => {
    const now = new Date('2026-09-29T23:30:00.000Z');
    expect(todayIso(now)).toBe('2026-09-29');
    expect(todayIso(now, 'Europe/Amsterdam')).toBe('2026-09-30');
    expect(addDaysIso(todayIso(now, 'Europe/Amsterdam'), 8)).toBe('2026-10-08');
  });
});
