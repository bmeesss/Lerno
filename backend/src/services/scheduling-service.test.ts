import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EASE,
  intervalDaysFor,
  isDifficult,
  scheduleReview,
  REVIEW_INTERVALS_DAYS,
} from './scheduling-service.js';

const NOW = new Date('2026-01-01T12:00:00.000Z');

describe('intervalDaysFor', () => {
  it('follows the spec ladder 1 → 3 → 7 → 14 → 30', () => {
    expect(REVIEW_INTERVALS_DAYS).toEqual([1, 3, 7, 14, 30]);
    expect(intervalDaysFor(1)).toBe(1);
    expect(intervalDaysFor(2)).toBe(3);
    expect(intervalDaysFor(3)).toBe(7);
    expect(intervalDaysFor(4)).toBe(14);
    expect(intervalDaysFor(5)).toBe(30);
    expect(intervalDaysFor(9)).toBe(30); // capped
  });

  it('returns 0 (immediate) for cards not yet learned', () => {
    expect(intervalDaysFor(0)).toBe(0);
    expect(intervalDaysFor(-2)).toBe(0);
  });
});

describe('scheduleReview', () => {
  it('schedules a first correct review 1 day out', () => {
    const result = scheduleReview(
      { repetitionCount: 0, ease: null, correctCount: 0, incorrectCount: 0 },
      'correct',
      NOW,
    );
    expect(result.repetitionCount).toBe(1);
    expect(result.nextReviewAt).toBe('2026-01-02T12:00:00.000Z');
    expect(result.correctCount).toBe(1);
    expect(result.requeued).toBe(false);
    expect(result.ease).toBeCloseTo(DEFAULT_EASE + 0.05);
    expect(result.lastReviewedAt).toBe(NOW.toISOString());
  });

  it('walks up the ladder across consecutive correct reviews', () => {
    let state = { repetitionCount: 0, ease: 2.0, correctCount: 0, incorrectCount: 0 };
    const expectedDays = [1, 3, 7, 14, 30, 30];
    for (const days of expectedDays) {
      const result = scheduleReview(state, 'correct', NOW);
      expect(result.repetitionCount).toBeLessThanOrEqual(5);
      const expectedDate = new Date(NOW.getTime() + days * 86_400_000);
      expect(result.nextReviewAt).toBe(expectedDate.toISOString());
      state = {
        repetitionCount: result.repetitionCount,
        ease: result.ease,
        correctCount: result.correctCount,
        incorrectCount: result.incorrectCount,
      };
    }
  });

  it('reduces the interval and requeues on incorrect', () => {
    const result = scheduleReview(
      { repetitionCount: 3, ease: 2.2, correctCount: 3, incorrectCount: 0 },
      'incorrect',
      NOW,
    );
    expect(result.repetitionCount).toBe(2);
    expect(result.requeued).toBe(true);
    expect(result.incorrectCount).toBe(1);
    expect(result.correctCount).toBe(3);
    // Reduced streak of 2 → 3 days
    expect(result.nextReviewAt).toBe('2026-01-04T12:00:00.000Z');
    expect(result.ease).toBeCloseTo(2.0);
  });

  it('floors the streak at 0 with an immediate review time', () => {
    const result = scheduleReview(
      { repetitionCount: 1, ease: 1.2, correctCount: 1, incorrectCount: 2 },
      'incorrect',
      NOW,
    );
    expect(result.repetitionCount).toBe(0);
    expect(result.nextReviewAt).toBe(NOW.toISOString());
    expect(result.ease).toBeCloseTo(1.0); // clamped at MIN_EASE
  });

  it('treats a brand-new card answered incorrectly as still unlearned', () => {
    const result = scheduleReview(
      { repetitionCount: 0, ease: null, correctCount: 0, incorrectCount: 0 },
      'incorrect',
      NOW,
    );
    expect(result.repetitionCount).toBe(0);
    expect(result.nextReviewAt).toBe(NOW.toISOString()); // immediate learning queue
    expect(result.requeued).toBe(true);
    expect(result.incorrectCount).toBe(1);
  });

  it('caps the streak so long histories stay at the 30-day interval', () => {
    const result = scheduleReview(
      { repetitionCount: 40, ease: 2.5, correctCount: 40, incorrectCount: 0 },
      'correct',
      NOW,
    );
    expect(result.repetitionCount).toBe(5);
    expect(result.nextReviewAt).toBe('2026-01-31T12:00:00.000Z');
  });

  it('normalizes malformed progress state instead of producing NaN', () => {
    const badStates = [
      { repetitionCount: -3, ease: Number.NaN, correctCount: -1, incorrectCount: -2 },
      { repetitionCount: Number.POSITIVE_INFINITY, ease: 99, correctCount: 2, incorrectCount: 1 },
      { repetitionCount: 2.7, ease: -4, correctCount: 1.9, incorrectCount: 0 },
    ];
    for (const state of badStates) {
      for (const outcome of ['correct', 'incorrect'] as const) {
        const result = scheduleReview(state, outcome, NOW);
        expect(Number.isFinite(result.repetitionCount)).toBe(true);
        expect(result.repetitionCount).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(result.ease)).toBe(true);
        expect(result.correctCount).toBeGreaterThanOrEqual(0);
        expect(result.incorrectCount).toBeGreaterThanOrEqual(0);
        expect(Number.isNaN(Date.parse(result.nextReviewAt))).toBe(false);
        expect(Number.isNaN(Date.parse(result.lastReviewedAt))).toBe(false);
        // Still deterministic for the same bad input.
        expect(scheduleReview(state, outcome, NOW)).toEqual(result);
      }
    }
  });

  it('is deterministic for the same inputs', () => {
    const state = { repetitionCount: 2, ease: 1.8, correctCount: 2, incorrectCount: 1 };
    expect(scheduleReview(state, 'correct', NOW)).toEqual(scheduleReview(state, 'correct', NOW));
    expect(scheduleReview(state, 'incorrect', NOW)).toEqual(
      scheduleReview(state, 'incorrect', NOW),
    );
  });
});

describe('isDifficult', () => {
  it('flags low ease and repeatedly-failed cards', () => {
    expect(isDifficult(1.2, 0)).toBe(true);
    expect(isDifficult(2.0, 3)).toBe(true);
    expect(isDifficult(2.0, 1)).toBe(false);
    expect(isDifficult(null, 0)).toBe(false);
  });
});
