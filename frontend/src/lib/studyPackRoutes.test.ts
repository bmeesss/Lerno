import { describe, expect, it } from 'vitest';
import type { StudyPackTodayTask } from '../types';
import {
  examCountdownLabel,
  formatMinutes,
  isReviewMode,
  nextStepHref,
  parsePackTab,
  parseTestMode,
  sessionHref,
  taskActionLabel,
  todayTaskHref,
} from './studyPackRoutes';

function task(overrides: Partial<StudyPackTodayTask>): StudyPackTodayTask {
  return {
    type: 'practice',
    label: 'Practice Osmosis',
    description: '',
    packId: 'pack-1',
    conceptId: null,
    conceptName: null,
    ...overrides,
  };
}

describe('study session routes', () => {
  it('opens a session on its own page', () => {
    expect(sessionHref('abc')).toBe('/study/sessions/abc');
  });

  it('sends every My Study task to the screen that starts it', () => {
    expect(todayTaskHref(task({ type: 'practice', conceptId: 'c1' }))).toBe(
      '/study-packs/pack-1?tab=practice&concept=c1',
    );
    expect(todayTaskHref(task({ type: 'learn', conceptId: 'c1' }))).toBe(
      '/study-packs/pack-1?tab=learn&concept=c1',
    );
    expect(todayTaskHref(task({ type: 'test', mode: 'exam' }))).toBe('/study-packs/pack-1?tab=test&mode=exam');
    expect(todayTaskHref(task({ type: 'test' }))).toBe('/study-packs/pack-1?tab=test');
    expect(todayTaskHref(task({ type: 'generate-concepts' }))).toBe('/study-packs/pack-1?tab=concepts');
    expect(todayTaskHref(task({ type: 'generate-practice' }))).toBe('/study-packs/pack-1?tab=practice');
  });

  it('separates flashcard review from a concept review session', () => {
    expect(todayTaskHref(task({ type: 'review', sessionType: null }))).toBe('/study-packs/pack-1?tab=flashcards');
    expect(todayTaskHref(task({ type: 'review', sessionType: 'review', conceptId: 'c2' }))).toBe(
      '/study-packs/pack-1?tab=practice&mode=review&concept=c2',
    );
  });

  it('resumes an open session directly and sends new material to the import flow', () => {
    expect(todayTaskHref(task({ type: 'continue', sessionId: 's1' }))).toBe('/study/sessions/s1');
    expect(todayTaskHref(task({ type: 'continue', sessionId: null, conceptId: 'c1' }))).toBe(
      '/study-packs/pack-1?tab=learn&concept=c1',
    );
    expect(todayTaskHref(task({ type: 'add-material', packId: null }))).toBe('/study-packs/new');
    expect(todayTaskHref(task({ type: 'practice', packId: null }))).toBe('/study-packs/new');
  });

  it('labels the button after what it starts', () => {
    expect(taskActionLabel({ type: 'practice', sessionType: 'practice' })).toBe('Start practice');
    expect(taskActionLabel({ type: 'learn', sessionType: 'learn' })).toBe('Start learning');
    expect(taskActionLabel({ type: 'review', sessionType: null })).toBe('Review cards');
    expect(taskActionLabel({ type: 'review', sessionType: 'review' })).toBe('Start review');
    expect(taskActionLabel({ type: 'test', sessionType: 'test' })).toBe('Start test');
    expect(taskActionLabel({ type: 'continue', sessionType: null })).toBe('Continue session');
    expect(taskActionLabel({ type: 'add-material', sessionType: null })).toBe('Add study material');
  });

  it('links "Next: Practice Diffusion" to the pre-start screen of that activity', () => {
    expect(nextStepHref('p1', { type: 'practice', conceptId: 'c2' })).toBe('/study-packs/p1?tab=practice&concept=c2');
    expect(nextStepHref('p1', { type: 'learn', conceptId: null })).toBe('/study-packs/p1?tab=learn');
    expect(nextStepHref('p1', { type: 'review', conceptId: null })).toBe('/study-packs/p1?tab=practice&mode=review');
    expect(nextStepHref('p1', { type: 'test', conceptId: null })).toBe('/study-packs/p1?tab=test');
  });

  it('reads the test mode and review mode from the query string safely', () => {
    expect(parseTestMode('exam')).toBe('exam');
    expect(parseTestMode('quick20')).toBe('quick20');
    expect(parseTestMode('nonsense')).toBeUndefined();
    expect(parseTestMode(null)).toBeUndefined();
    expect(isReviewMode('review')).toBe(true);
    expect(isReviewMode('exam')).toBe(false);
    expect(parsePackTab('?tab=tutor')).toBe('tutor');
    expect(parsePackTab('?tab=bogus')).toBe('overview');
  });

  it('formats minutes and exam countdowns without fake precision', () => {
    expect(formatMinutes(25)).toBe('25 min');
    expect(formatMinutes(65)).toBe('1 h 5 min');
    expect(formatMinutes(120)).toBe('2 h');
    expect(formatMinutes(-4)).toBe('0 min');
    expect(examCountdownLabel(9)).toBe('9 days left');
    expect(examCountdownLabel(1)).toBe('1 day left');
    expect(examCountdownLabel(0)).toBe('today');
    expect(examCountdownLabel(-2)).toBe('2 days ago');
    expect(examCountdownLabel(null)).toBe('');
  });
});
