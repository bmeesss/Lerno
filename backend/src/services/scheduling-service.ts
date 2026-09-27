/**
 * Spaced-repetition scheduling (spec §7).
 *
 * Deterministic interval ladder — no ML, no opacity. This is the ONLY place
 * where review intervals are calculated, so the algorithm can be replaced
 * later without touching the rest of the application.
 *
 * Ladder (after N consecutive correct reviews):
 *   1st correct → 1 day
 *   2nd         → 3 days
 *   3rd         → 7 days
 *   4th         → 14 days
 *   5th+        → 30 days (cap)
 *
 * Incorrect → card returns to the current session (requeued) and the interval
 * is reduced by one step (streak -1, floor 0 = back in the learning queue).
 */

export const REVIEW_INTERVALS_DAYS: readonly number[] = [1, 3, 7, 14, 30];

export const DEFAULT_EASE = 2.0;
export const MIN_EASE = 1.0;
export const MAX_EASE = 3.0;

export type ReviewOutcome = 'correct' | 'incorrect';

export interface SchedulingState {
  repetitionCount: number;
  ease: number | null;
  correctCount: number;
  incorrectCount: number;
}

export interface SchedulingResult {
  repetitionCount: number;
  ease: number;
  lastReviewedAt: string;
  nextReviewAt: string;
  correctCount: number;
  incorrectCount: number;
  /** True when the card must rejoin the current study session queue. */
  requeued: boolean;
}

/** Days until the next review for a given streak length. */
export function intervalDaysFor(repetitionCount: number): number {
  if (repetitionCount <= 0) return 0; // still in the learning queue
  const index = Math.min(repetitionCount, REVIEW_INTERVALS_DAYS.length) - 1;
  return REVIEW_INTERVALS_DAYS[index]!;
}

export function scheduleReview(
  state: SchedulingState,
  outcome: ReviewOutcome,
  now: Date = new Date(),
): SchedulingResult {
  const currentEase = state.ease ?? DEFAULT_EASE;
  const lastReviewedAt = now.toISOString();

  if (outcome === 'correct') {
    const repetitionCount = Math.min(state.repetitionCount + 1, REVIEW_INTERVALS_DAYS.length);
    const ease = Math.min(MAX_EASE, round2(currentEase + 0.05));
    const nextReviewAt = addDays(now, intervalDaysFor(repetitionCount));
    return {
      repetitionCount,
      ease,
      lastReviewedAt,
      nextReviewAt,
      correctCount: state.correctCount + 1,
      incorrectCount: state.incorrectCount,
      requeued: false,
    };
  }

  // Incorrect: reduce the interval by one step and rejoin the session queue.
  const repetitionCount = Math.max(0, state.repetitionCount - 1);
  const ease = Math.max(MIN_EASE, round2(currentEase - 0.2));
  const nextReviewAt = addDays(now, intervalDaysFor(repetitionCount));
  return {
    repetitionCount,
    ease,
    lastReviewedAt,
    nextReviewAt,
    correctCount: state.correctCount,
    incorrectCount: state.incorrectCount + 1,
    requeued: true,
  };
}

/** Cards below this ease are considered "difficult" for practice mixing. */
export function isDifficult(ease: number | null, incorrectCount: number): boolean {
  if (incorrectCount >= 3) return true;
  return (ease ?? DEFAULT_EASE) < 1.5;
}

function addDays(date: Date, days: number): string {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString();
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
