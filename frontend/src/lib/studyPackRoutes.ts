import type { RecommendedAction, StudyPackDetail, StudyPackTodayTask, TestMode } from '../types';

export type PackTab =
  | 'overview'
  | 'learn'
  | 'concepts'
  | 'flashcards'
  | 'practice'
  | 'test'
  | 'progress'
  | 'sources'
  | 'tutor';

export const PACK_TABS: { id: PackTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'learn', label: 'Learn' },
  { id: 'concepts', label: 'Concepts' },
  { id: 'flashcards', label: 'Flashcards' },
  { id: 'practice', label: 'Practice' },
  { id: 'test', label: 'Test' },
  { id: 'progress', label: 'Progress' },
  { id: 'sources', label: 'Sources' },
  { id: 'tutor', label: 'AI Tutor' },
];

/** Reads the tab from the query string, falling back to the overview. */
export function parsePackTab(search: string): PackTab {
  const value = new URLSearchParams(search).get('tab');
  return PACK_TABS.some((tab) => tab.id === value) ? (value as PackTab) : 'overview';
}

export function packTabHref(tab: PackTab, extra?: Record<string, string>): string {
  const params = new URLSearchParams({ tab, ...extra });
  return `?${params.toString()}`;
}

/**
 * Maps the server's single recommended action onto a route inside the pack.
 * The student never has to interpret Lerno's data model: one action, one link.
 */
export function recommendedHref(
  pack: Pick<StudyPackDetail, 'legacySetId'>,
  action: RecommendedAction,
): string {
  switch (action.type) {
    case 'add-source':
      return packTabHref('sources');
    case 'generate-concepts':
      return packTabHref('concepts');
    case 'generate-flashcards':
      return packTabHref('flashcards');
    case 'generate-practice':
      return packTabHref('practice');
    case 'learn':
      return packTabHref('learn', action.conceptId ? { concept: action.conceptId } : undefined);
    case 'practice':
      return packTabHref('practice', action.conceptId ? { concept: action.conceptId } : undefined);
    case 'review':
      return pack.legacySetId ? `/sets/${pack.legacySetId}/study` : packTabHref('flashcards');
    case 'test':
      return packTabHref('test');
  }
}

/** The runner page of a study session (Learn, Practice, Review or Test). */
export function sessionHref(sessionId: string): string {
  return `/study/sessions/${sessionId}`;
}

/**
 * Same mapping for the My Study "today" tasks. An open session resumes right
 * away; everything else opens the pack's pre-start screen for that activity.
 */
export function todayTaskHref(task: StudyPackTodayTask): string {
  // "Add material" is the product's primary action: the import experience.
  if (task.type === 'add-material' || !task.packId) return '/study-packs/new';
  if (task.type === 'continue' && task.sessionId) return sessionHref(task.sessionId);
  const base = `/study-packs/${task.packId}`;
  const concept = task.conceptId ? `&concept=${task.conceptId}` : '';
  switch (task.type) {
    case 'review':
      // Due concepts are reviewed in a session; due flashcards in the card view.
      return task.sessionType === 'review'
        ? `${base}?tab=practice&mode=review${concept}`
        : `${base}?tab=flashcards`;
    case 'continue':
    case 'learn':
      return `${base}?tab=learn${concept}`;
    case 'practice':
      return `${base}?tab=practice${concept}`;
    case 'test':
      return `${base}?tab=test${task.mode ? `&mode=${task.mode}` : ''}`;
    case 'generate-concepts':
      return `${base}?tab=concepts`;
    case 'generate-practice':
      return `${base}?tab=practice`;
  }
}

/** The button text that matches what a task starts. */
export function taskActionLabel(task: Pick<StudyPackTodayTask, 'type' | 'sessionType'>): string {
  switch (task.type) {
    case 'continue':
      return 'Continue session';
    case 'practice':
      return 'Start practice';
    case 'learn':
      return 'Start learning';
    case 'review':
      return task.sessionType === 'review' ? 'Start review' : 'Review cards';
    case 'test':
      return 'Start test';
    case 'add-material':
      return 'Add study material';
    case 'generate-concepts':
      return 'Extract concepts';
    case 'generate-practice':
      return 'Create questions';
  }
}

/** Where "Next: Practice Diffusion" leads: the pre-start screen of that activity. */
export function nextStepHref(
  packId: string,
  next: { type: 'learn' | 'practice' | 'review' | 'test'; conceptId: string | null },
): string {
  const base = `/study-packs/${packId}`;
  const concept = next.conceptId ? `&concept=${next.conceptId}` : '';
  switch (next.type) {
    case 'learn':
      return `${base}?tab=learn${concept}`;
    case 'practice':
      return `${base}?tab=practice${concept}`;
    case 'review':
      return `${base}?tab=practice&mode=review${concept}`;
    case 'test':
      return `${base}?tab=test`;
  }
}

/** "25 min", "1 h 5 min" — rounded, never fake precision. */
export function formatMinutes(minutes: number): string {
  const rounded = Math.max(0, Math.round(minutes));
  if (rounded < 60) return `${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** "18 October" style short date for exam chips (locale-aware). */
export function formatExamDate(examDate: string): string {
  const parsed = Date.parse(`${examDate}T00:00:00Z`);
  if (Number.isNaN(parsed)) return examDate;
  return new Date(parsed).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

export function examCountdownLabel(daysLeft: number | null): string {
  if (daysLeft === null) return '';
  if (daysLeft < 0) return `${Math.abs(daysLeft)} days ago`;
  if (daysLeft === 0) return 'today';
  if (daysLeft === 1) return '1 day left';
  return `${daysLeft} days left`;
}

const TEST_MODES: TestMode[] = ['quick10', 'quick20', 'exam'];

/** `?mode=exam` on the Test tab. Anything else falls back to the default (10 questions). */
export function parseTestMode(value: string | null | undefined): TestMode | undefined {
  return TEST_MODES.find((mode) => mode === value);
}

/** `?mode=review` on the Practice tab starts a review of due concepts instead of a practice run. */
export function isReviewMode(value: string | null | undefined): boolean {
  return value === 'review';
}
