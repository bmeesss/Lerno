import { describe, expect, it } from 'vitest';
import type { LearningSessionRecord } from '../lib/db/types.js';
import {
  addActiveSeconds,
  canTransition,
  currentPositionNumber,
  firstOpenPosition,
  IDLE_GAP_CAP_SECONDS,
  isOpenStatus,
  isResumable,
  learnMinutes,
  positionLabel,
  questionMinutes,
  RESUME_WINDOW_DAYS,
  sessionLabel,
  sessionProgress,
  sessionTitle,
  toResumeCard,
} from './session-model.js';

const NOW = new Date('2026-09-29T12:00:00.000Z');

function session(overrides: Partial<LearningSessionRecord> = {}): LearningSessionRecord {
  return {
    id: 's1',
    userId: 'u1',
    packId: 'p1',
    type: 'practice',
    status: 'active',
    mode: null,
    title: 'Practice Biology',
    focusConceptId: null,
    targetConceptIds: [],
    testId: null,
    itemCount: 10,
    answeredCount: 5,
    currentPosition: 5,
    startedAt: NOW.toISOString(),
    completedAt: null,
    lastActivityAt: NOW.toISOString(),
    durationSeconds: 0,
    result: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

describe('session lifecycle', () => {
  it('moves not_started → active → completed | abandoned and never backwards', () => {
    expect(canTransition('not_started', 'active')).toBe(true);
    expect(canTransition('not_started', 'abandoned')).toBe(true);
    expect(canTransition('active', 'completed')).toBe(true);
    expect(canTransition('active', 'abandoned')).toBe(true);
    expect(canTransition('not_started', 'completed')).toBe(false);
    expect(canTransition('completed', 'active')).toBe(false);
    expect(canTransition('abandoned', 'active')).toBe(false);
    expect(isOpenStatus('active')).toBe(true);
    expect(isOpenStatus('completed')).toBe(false);
  });

  it('is resumable only while open and within the resume window', () => {
    expect(isResumable(session(), NOW)).toBe(true);
    expect(isResumable(session({ status: 'completed' }), NOW)).toBe(false);
    expect(isResumable(session({ status: 'abandoned' }), NOW)).toBe(false);
    const old = new Date(NOW.getTime() - (RESUME_WINDOW_DAYS + 1) * 86_400_000).toISOString();
    expect(isResumable(session({ lastActivityAt: old }), NOW)).toBe(false);
    expect(isResumable(session({ status: 'not_started' }), NOW)).toBe(true);
  });
});

describe('active study time', () => {
  it('adds the gap since the last interaction', () => {
    const last = new Date(NOW.getTime() - 40_000).toISOString();
    expect(addActiveSeconds(100, last, NOW)).toBe(140);
  });

  it('caps idle gaps so a forgotten tab does not become hours of study', () => {
    const last = new Date(NOW.getTime() - 9 * 3_600_000).toISOString();
    expect(addActiveSeconds(100, last, NOW)).toBe(100 + IDLE_GAP_CAP_SECONDS);
  });

  it('ignores a clock that went backwards or a broken timestamp', () => {
    const future = new Date(NOW.getTime() + 60_000).toISOString();
    expect(addActiveSeconds(10, future, NOW)).toBe(10);
    expect(addActiveSeconds(10, 'not a date', NOW)).toBe(10);
  });
});

describe('labels and progress', () => {
  it('labels a session like a student would say it', () => {
    expect(sessionLabel({ type: 'practice', mode: null }, 'Biology')).toBe('Biology Practice');
    expect(sessionLabel({ type: 'learn', mode: null }, 'Biology')).toBe('Biology Learn');
    expect(sessionLabel({ type: 'test', mode: 'exam' }, 'Biology')).toBe('Biology Exam simulation');
    expect(sessionLabel({ type: 'test', mode: 'quick10' }, 'Biology')).toBe('Biology Test');
    expect(sessionTitle('practice', null, 'Biology')).toBe('Practice Biology');
    expect(sessionTitle('test', 'exam', 'Biology')).toBe('Exam simulation · Biology');
    expect(sessionTitle('test', 'quick20', 'Biology')).toBe('Practice test · Biology');
  });

  it('describes the position: "Question 6 of 10", concepts for Learn', () => {
    expect(positionLabel(session({ currentPosition: 5 }))).toBe('Question 6 of 10');
    expect(positionLabel(session({ type: 'learn', currentPosition: 1, itemCount: 4 }))).toBe(
      'Concept 2 of 4',
    );
    // Never beyond the last item.
    expect(currentPositionNumber(session({ currentPosition: 99 }))).toBe(10);
  });

  it('builds the resume card', () => {
    const card = toResumeCard(session(), { id: 'p1', title: 'Biology' });
    expect(card).toMatchObject({
      label: 'Biology Practice',
      positionLabel: 'Question 6 of 10',
      position: 6,
      total: 10,
      answeredCount: 5,
    });
  });

  it('measures progress by answered and skipped items', () => {
    const progress = sessionProgress(session({ itemCount: 4, currentPosition: 2 }), [
      { status: 'answered' },
      { status: 'skipped' },
      { status: 'pending' },
      { status: 'pending' },
    ]);
    expect(progress).toEqual({ position: 3, total: 4, answered: 1, skipped: 1, percent: 50 });
  });

  it('finds the first item that is still open', () => {
    expect(
      firstOpenPosition([
        { position: 0, status: 'answered' },
        { position: 1, status: 'skipped' },
        { position: 2, status: 'pending' },
      ]),
    ).toBe(2);
    expect(
      firstOpenPosition([
        { position: 0, status: 'answered' },
        { position: 1, status: 'answered' },
      ]),
    ).toBe(1);
  });

  it('estimates minutes from the shared per-item constants', () => {
    expect(questionMinutes(10)).toBe(12);
    expect(questionMinutes(5)).toBe(6);
    expect(learnMinutes(3)).toBe(9);
    expect(questionMinutes(0)).toBe(1);
  });
});
