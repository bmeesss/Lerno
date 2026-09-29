import type { RecommendedAction, StudyPackDetail, StudyPackTodayTask } from '../types';

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

/** Same mapping for the My Study "today" tasks. */
export function todayTaskHref(task: StudyPackTodayTask): string {
  // "Add material" is the product's primary action: the import experience.
  if (task.type === 'add-material' || !task.packId) return '/study-packs/new';
  const base = `/study-packs/${task.packId}`;
  switch (task.type) {
    case 'review':
      return `${base}?tab=flashcards`;
    case 'learn':
      return `${base}?tab=learn${task.conceptId ? `&concept=${task.conceptId}` : ''}`;
    case 'practice':
      return `${base}?tab=practice${task.conceptId ? `&concept=${task.conceptId}` : ''}`;
    case 'test':
      return `${base}?tab=test`;
  }
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
