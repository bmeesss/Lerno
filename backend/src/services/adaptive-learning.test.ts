import { describe, expect, it } from 'vitest';
import type { ConceptRecord } from '../lib/db/types.js';
import {
  applyRating,
  applyVerdict,
  conceptReviewAt,
  emptyMastery,
  isConceptDue,
  isWeakConcept,
  masteryLabel,
  rankLearnCandidates,
  rankRecommendations,
} from './study-pack-rules.js';

const NOW = new Date('2026-09-29T12:00:00.000Z');

function concept(id: string, position: number): ConceptRecord {
  return {
    id,
    packId: 'pack',
    sourceId: null,
    name: id,
    explanation: '',
    origin: 'user',
    position,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
}

describe('adaptive mastery model', () => {
  it('raises mastery and confidence after correct answers and lowers them after incorrect ones', () => {
    const initial = emptyMastery();
    const correct = applyVerdict(initial, 'correct', NOW);
    expect(correct.mastery).toBeGreaterThan(initial.mastery);
    expect(correct.confidence).toBeGreaterThan(initial.confidence);

    const incorrect = applyVerdict(correct, 'incorrect', NOW);
    expect(incorrect.mastery).toBeLessThan(correct.mastery);
    expect(incorrect.confidence).toBeLessThan(correct.confidence);
    expect(incorrect.attempts).toBe(2);
  });

  it('uses product-facing mastery bands without storing labels', () => {
    expect(masteryLabel({ mastery: 0, attempts: 0 })).toBe('New');
    expect(masteryLabel({ mastery: 0.29, attempts: 1 })).toBe('Weak');
    expect(masteryLabel({ mastery: 0.3, attempts: 1 })).toBe('Learning');
    expect(masteryLabel({ mastery: 0.6, attempts: 1 })).toBe('Familiar');
    expect(masteryLabel({ mastery: 0.85, attempts: 1 })).toBe('Mastered');
    expect(isWeakConcept({ ...emptyMastery(), mastery: 0.29, attempts: 1 })).toBe(true);
    expect(isWeakConcept({ ...emptyMastery(), mastery: 0.3, attempts: 1 })).toBe(false);
  });

  it('changes self-rating mastery and schedules a transparent performance-based interval', () => {
    const starting = { ...emptyMastery(), mastery: 0.4, attempts: 2 };
    const again = applyRating(starting, 'again', NOW);
    const easy = applyRating(starting, 'easy', NOW);
    expect(again.mastery).toBeLessThan(starting.mastery);
    expect(again.confidence).toBeLessThan(starting.confidence);
    expect(easy.mastery).toBeGreaterThan(starting.mastery);
    expect(easy.confidence).toBeGreaterThan(starting.confidence);
    expect(Date.parse(again.nextReviewAt!) - NOW.getTime()).toBe(60 * 60 * 1000);
    expect(Date.parse(easy.nextReviewAt!) - NOW.getTime()).toBe(7 * 86_400_000);
  });

  it('ranks weak, new, due, learning and mastered concepts from the current state', () => {
    const weak = { ...emptyMastery(), mastery: 0.2, attempts: 2, nextReviewAt: '2026-10-10T00:00:00Z' };
    const fresh = emptyMastery();
    const due = {
      ...emptyMastery(),
      mastery: 0.7,
      attempts: 3,
      lastPracticedAt: '2026-09-01T12:00:00Z',
      nextReviewAt: '2026-09-20T00:00:00Z',
    };
    const learning = { ...emptyMastery(), mastery: 0.45, attempts: 2, nextReviewAt: '2026-10-10T00:00:00Z' };
    const mastered = { ...emptyMastery(), mastery: 0.95, attempts: 4, nextReviewAt: '2026-10-10T00:00:00Z' };
    const ranked = rankLearnCandidates(
      [
        { concept: concept('mastered', 4), state: mastered },
        { concept: concept('learning', 3), state: learning },
        { concept: concept('new', 1), state: fresh },
        { concept: concept('due', 2), state: due },
        { concept: concept('weak', 0), state: weak },
      ],
      [],
      NOW,
    );
    expect(ranked.map((entry) => entry.concept.id)).toEqual([
      'weak', 'new', 'due', 'learning', 'mastered',
    ]);
    expect(isConceptDue(due, NOW)).toBe(true);
  });

  it('prioritizes nearer exam dates while retaining a transparent base score', () => {
    const noDeadline = { id: 'regular', priority: 95, examDaysLeft: null };
    const examSoon = { id: 'exam', priority: 55, examDaysLeft: 2 };
    expect(rankRecommendations([noDeadline, examSoon]).map((item) => item.id)).toEqual([
      'exam', 'regular',
    ]);
  });

  it('schedules incorrect answers soon and extends intervals with stronger mastery', () => {
    const correctState = { ...emptyMastery(), mastery: 0.9, confidence: 0.9 };
    const weakState = { ...emptyMastery(), mastery: 0.1, confidence: 0.5 };
    expect(Date.parse(conceptReviewAt(correctState, 'correct', NOW)) - NOW.getTime()).toBe(
      14 * 86_400_000,
    );
    expect(Date.parse(conceptReviewAt(weakState, 'incorrect', NOW)) - NOW.getTime()).toBe(
      60 * 60 * 1000,
    );
  });
});
