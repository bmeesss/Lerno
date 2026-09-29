import { describe, expect, it } from 'vitest';
import {
  conceptReasonLabel,
  countLabel,
  difficultyLabel,
  examInLabel,
  improvementSentence,
  masteryBand,
  minutesLong,
  relativeDay,
  startLabel,
} from './sessionCopy';

describe('session copy', () => {
  it('names the button after what it starts', () => {
    expect(startLabel('practice')).toBe('Start practice');
    expect(startLabel('learn')).toBe('Start learning');
    expect(startLabel('review')).toBe('Start review');
    expect(startLabel('test')).toBe('Start test');
  });

  it('counts questions for practice and concepts for learn, singular and plural', () => {
    expect(countLabel('practice', 10)).toBe('10 questions');
    expect(countLabel('test', 1)).toBe('1 question');
    expect(countLabel('learn', 5)).toBe('5 concepts');
    expect(countLabel('learn', 1)).toBe('1 concept');
  });

  it('capitalises difficulty and explains why a concept was picked', () => {
    expect(difficultyLabel('medium')).toBe('Medium');
    expect(conceptReasonLabel('weak')).toBe('Weak');
    expect(conceptReasonLabel('mistake')).toBe('Missed recently');
    expect(conceptReasonLabel('due')).toBe('Due');
    expect(conceptReasonLabel('mixed')).toBeNull();
  });

  it('writes the improvement sentence used after a session', () => {
    expect(improvementSentence('Osmosis', 42, 61)).toBe('Osmosis improved from 42% → 61%');
  });

  it('uses the same mastery bands as the engine (30 / 60 / 85)', () => {
    expect(masteryBand(29)).toBe('weak');
    expect(masteryBand(30)).toBe('learning');
    expect(masteryBand(59)).toBe('learning');
    expect(masteryBand(60)).toBe('good');
    expect(masteryBand(84)).toBe('good');
    expect(masteryBand(85)).toBe('strong');
  });

  it('counts down to an exam in whole days and stays silent after it', () => {
    expect(examInLabel(9)).toBe('Exam in 9 days');
    expect(examInLabel(1)).toBe('Exam tomorrow');
    expect(examInLabel(0)).toBe('Exam today');
    expect(examInLabel(-1)).toBeNull();
    expect(examInLabel(null)).toBeNull();
    expect(examInLabel(undefined)).toBeNull();
  });

  it('spells durations out in words', () => {
    expect(minutesLong(25)).toBe('25 minutes');
    expect(minutesLong(1)).toBe('1 minute');
    expect(minutesLong(60)).toBe('1 hour');
    expect(minutesLong(65)).toBe('1 hour 5 minutes');
    expect(minutesLong(125)).toBe('2 hours 5 minutes');
  });

  it('describes recent activity in calendar days, not hours', () => {
    const now = new Date(2026, 8, 29, 9, 0, 0);
    expect(relativeDay(new Date(2026, 8, 29, 0, 5).toISOString(), now)).toBe('today');
    // 23:55 yesterday is "yesterday" even though it was only hours ago.
    expect(relativeDay(new Date(2026, 8, 28, 23, 55).toISOString(), now)).toBe('yesterday');
    expect(relativeDay(new Date(2026, 8, 26, 12).toISOString(), now)).toBe('3 days ago');
    expect(relativeDay(null, now)).toBeNull();
    expect(relativeDay('not a date', now)).toBeNull();
  });
});
