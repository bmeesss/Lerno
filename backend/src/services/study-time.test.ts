/**
 * Estimated study time: a transparent, rule-based calculation. No AI, no vanity
 * numbers — the same input always gives the same answer, with a breakdown a
 * student can check.
 */
import { describe, expect, it } from 'vitest';
import { STUDY_TIME_RULES, estimateStudyTime, formatStudyTime } from './study-time.js';

describe('study time: the calculation', () => {
  it('never promises less than five minutes', () => {
    const estimate = estimateStudyTime({
      concepts: 0,
      flashcards: 0,
      practiceQuestions: 0,
      sourceCharacters: 0,
    });

    expect(estimate.minutes).toBe(STUDY_TIME_RULES.minimumMinutes);
    expect(estimate.label).toBe('~5 min');
  });

  it('adds up concepts, cards, questions and reading', () => {
    // 10 × 1.5 + 20 × 0.4 + 10 × 1.2 + 9 000/900 = 15 + 8 + 12 + 10 = 45
    const estimate = estimateStudyTime({
      concepts: 10,
      flashcards: 20,
      practiceQuestions: 10,
      sourceCharacters: 9_000,
    });

    expect(estimate.minutes).toBe(45);
    expect(estimate.label).toBe('~45 min');
    expect(estimate.breakdown).toEqual({
      conceptsMinutes: 15,
      flashcardsMinutes: 8,
      questionsMinutes: 12,
      readingMinutes: 10,
    });
  });

  it('counts concepts only', () => {
    expect(
      estimateStudyTime({ concepts: 4, flashcards: 0, practiceQuestions: 0, sourceCharacters: 0 }).minutes,
    ).toBe(5);
    expect(
      estimateStudyTime({ concepts: 8, flashcards: 0, practiceQuestions: 0, sourceCharacters: 0 }).minutes,
    ).toBe(10);
  });

  it('counts cards only', () => {
    expect(
      estimateStudyTime({ concepts: 0, flashcards: 25, practiceQuestions: 0, sourceCharacters: 0 }).minutes,
    ).toBe(10);
  });

  it('counts questions only', () => {
    expect(
      estimateStudyTime({ concepts: 0, flashcards: 0, practiceQuestions: 10, sourceCharacters: 0 }).minutes,
    ).toBe(10);
  });

  it('scales only the practice part with difficulty', () => {
    const base = { concepts: 0, flashcards: 0, practiceQuestions: 20, sourceCharacters: 0 };

    const easy = estimateStudyTime({ ...base, difficulty: 'easy' });
    const medium = estimateStudyTime({ ...base, difficulty: 'medium' });
    const hard = estimateStudyTime({ ...base, difficulty: 'hard' });

    expect(easy.breakdown.questionsMinutes).toBe(20.4);
    expect(medium.breakdown.questionsMinutes).toBe(24);
    expect(hard.breakdown.questionsMinutes).toBe(30);
    expect(easy.minutes).toBeLessThan(medium.minutes);
    expect(medium.minutes).toBeLessThan(hard.minutes);
    // Reading and concepts do not move with the difficulty switch.
    expect(easy.breakdown.conceptsMinutes).toBe(medium.breakdown.conceptsMinutes);
  });

  it('defaults to medium when no difficulty is given', () => {
    const base = { concepts: 0, flashcards: 0, practiceQuestions: 10, sourceCharacters: 0 };

    expect(estimateStudyTime(base).minutes).toBe(estimateStudyTime({ ...base, difficulty: 'medium' }).minutes);
    expect(estimateStudyTime({ ...base, difficulty: null }).minutes).toBe(10);
  });

  it('caps the reading contribution at thirty minutes', () => {
    const huge = estimateStudyTime({
      concepts: 0,
      flashcards: 0,
      practiceQuestions: 0,
      sourceCharacters: 5_000_000,
    });

    expect(huge.breakdown.readingMinutes).toBe(STUDY_TIME_RULES.maxReadingMinutes);
    expect(huge.minutes).toBe(30);
  });

  it('rounds to a number a student would say out loud', () => {
    const estimate = estimateStudyTime({
      concepts: 1,
      flashcards: 1,
      practiceQuestions: 1,
      sourceCharacters: 0,
    });

    // 1.5 + 0.4 + 1.2 = 3.1 → the daily minimum of 5 stays, rounded to five.
    expect(estimate.minutes % 5).toBe(0);
  });

  it('ignores negative input instead of producing nonsense', () => {
    const estimate = estimateStudyTime({
      concepts: -5,
      flashcards: -5,
      practiceQuestions: -5,
      sourceCharacters: -100,
    });

    expect(estimate.minutes).toBe(STUDY_TIME_RULES.minimumMinutes);
    expect(estimate.breakdown.conceptsMinutes).toBe(0);
  });

  it('explains exactly where the number comes from', () => {
    const estimate = estimateStudyTime({
      concepts: 12,
      flashcards: 24,
      practiceQuestions: 8,
      sourceCharacters: 18_000,
      difficulty: 'hard',
    });

    expect(estimate.explanation).toBe(
      '12 concepts × 1.5 min + 24 cards × 0.4 min + 8 questions × 1.2 min (hard) + reading 18000 characters',
    );
  });

  it('is deterministic: the same input gives the same estimate', () => {
    const input = {
      concepts: 24,
      flashcards: 30,
      practiceQuestions: 12,
      sourceCharacters: 22_500,
      difficulty: 'medium' as const,
    };

    expect(estimateStudyTime(input)).toEqual(estimateStudyTime(input));
  });
});

describe('study time: the label', () => {
  it('formats minutes', () => {
    expect(formatStudyTime(45)).toBe('~45 min');
    expect(formatStudyTime(5)).toBe('~5 min');
    expect(formatStudyTime(59)).toBe('~59 min');
  });

  it('formats whole and partial hours', () => {
    expect(formatStudyTime(80)).toBe('~1 u 20 min');
    expect(formatStudyTime(60)).toBe('~1 u');
    expect(formatStudyTime(125)).toBe('~2 u 5 min');
  });

  it('matches the label the estimate returns', () => {
    const estimate = estimateStudyTime({
      concepts: 20,
      flashcards: 30,
      practiceQuestions: 15,
      sourceCharacters: 27_000,
    });

    expect(estimate.label).toBe(formatStudyTime(estimate.minutes));
  });
});
