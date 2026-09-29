import type { SessionType } from '../types';

/**
 * Small, pure copy helpers for study sessions, so every screen says the same
 * thing ("Start practice", "10 questions") and the wording can be tested.
 */

/** The text on the button that starts a session of this kind. */
export function startLabel(type: SessionType): string {
  switch (type) {
    case 'learn':
      return 'Start learning';
    case 'practice':
      return 'Start practice';
    case 'review':
      return 'Start review';
    case 'test':
      return 'Start test';
  }
}

/** "10 questions", "1 question", "5 concepts". */
export function countLabel(type: SessionType, count: number): string {
  const noun = type === 'learn' ? 'concept' : 'question';
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export function difficultyLabel(difficulty: 'easy' | 'medium' | 'hard'): string {
  return difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
}

/** Why the engine picked a concept, in a word the student understands. */
export function conceptReasonLabel(reason: string): string | null {
  switch (reason) {
    case 'weak':
      return 'Weak';
    case 'new':
      return 'New';
    case 'learning':
      return 'Learning';
    case 'due':
      return 'Due';
    case 'confirmation':
      return 'Confirm';
    case 'mistake':
      return 'Missed recently';
    case 'focus':
      return 'Focus';
    default:
      return null;
  }
}

/** "Osmosis improved from 42% → 61%" */
export function improvementSentence(name: string, beforePercent: number, afterPercent: number): string {
  return `${name} improved from ${beforePercent}% → ${afterPercent}%`;
}

/** "You know this well" / "Needs practice" for a mastery percentage (engine thresholds). */
export function masteryBand(percent: number): 'weak' | 'learning' | 'good' | 'strong' {
  if (percent < 30) return 'weak';
  if (percent < 60) return 'learning';
  if (percent < 85) return 'good';
  return 'strong';
}

/** "Exam in 9 days", "Exam tomorrow", "Exam today". Null when there is no upcoming exam. */
export function examInLabel(daysLeft: number | null | undefined): string | null {
  if (daysLeft === null || daysLeft === undefined || daysLeft < 0) return null;
  if (daysLeft === 0) return 'Exam today';
  if (daysLeft === 1) return 'Exam tomorrow';
  return `Exam in ${daysLeft} days`;
}

/** "3 days ago", "yesterday", "today" for an ISO timestamp (calendar days, local time). */
export function relativeDay(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  const start = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((start(now) - start(then)) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** "25 minutes", "1 minute", "1 hour 5 minutes" — the spoken form of a duration. */
export function minutesLong(minutes: number): string {
  const rounded = Math.max(0, Math.round(minutes));
  const unit = (value: number, noun: string) => `${value} ${noun}${value === 1 ? '' : 's'}`;
  if (rounded < 60) return unit(rounded, 'minute');
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest === 0 ? unit(hours, 'hour') : `${unit(hours, 'hour')} ${unit(rest, 'minute')}`;
}
