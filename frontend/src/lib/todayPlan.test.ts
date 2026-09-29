import { describe, expect, it } from 'vitest';
import { packSummary, resumeCard, step, today } from '../test-fixtures/study';
import {
  normalizeToday,
  plannedMinutesSentence,
  stepAmount,
  stepMeta,
  stepReason,
  stepTitle,
} from './todayPlan';

describe('normalizeToday', () => {
  it('uses the planner output when the server sends one', () => {
    const normalized = normalizeToday(
      today({
        exam: {
          packId: 'pack-1',
          title: 'Biology',
          examDate: '2026-10-08',
          daysLeft: 9,
          message: 'Biology exam in 9 days',
          note: 'Your plan is adjusted for the exam.',
        },
        plan: {
          budgetMinutes: 30,
          minutes: 27,
          adjustedForExam: true,
          steps: [
            step({ order: 1 }),
            step({ order: 2, type: 'review', label: 'Review 8 cards · Biology' }),
          ],
        },
        resume: [resumeCard()],
        streak: { current: 3, longest: 5, lastActiveDay: '2026-09-29', todayDone: true },
      }),
    );
    expect(normalized.steps.map((entry) => entry.order)).toEqual([1, 2]);
    expect(normalized.primary?.label).toBe('Practice Osmosis');
    expect(normalized.minutes).toBe(27);
    expect(normalized.budgetMinutes).toBe(30);
    expect(normalized.adjustedForExam).toBe(true);
    expect(normalized.exam?.message).toBe('Biology exam in 9 days');
    expect(normalized.resume).toHaveLength(1);
    expect(normalized.streak?.current).toBe(3);
  });

  it('still works for an older response that only has tasks and exams', () => {
    const {
      plan: _plan,
      primary: _primary,
      exam: _exam,
      resume: _resume,
      streak: _streak,
      subjects: _subjects,
      ...legacy
    } = today({
      exams: [
        {
          packId: 'pack-1',
          title: 'Biologie H3',
          examDate: '2026-10-08',
          daysLeft: 9,
          masteryPercent: 40,
          weakConcepts: 2,
          dueCards: 8,
        },
      ],
    });
    const normalized = normalizeToday(legacy);
    expect(normalized.steps).toHaveLength(3);
    expect(normalized.steps.map((entry) => entry.order)).toEqual([1, 2, 3]);
    expect(normalized.primary?.label).toBe('Practice Osmosis');
    // Minutes are summed from the tasks that carry them.
    expect(normalized.minutes).toBe(4 + 6 + 15);
    expect(normalized.exam?.message).toBe('Biologie H3 exam in 9 days');
    expect(normalized.exam?.note).toBeNull();
    expect(normalized.resume).toEqual([]);
    expect(normalized.streak).toBeNull();
  });

  it('says "tomorrow" and "today" for an exam that is that close, and ignores past exams', () => {
    const base = today();
    const legacy = { ...base, plan: undefined, exam: undefined };
    const tomorrow = normalizeToday({
      ...legacy,
      exams: [
        {
          packId: 'p',
          title: 'Maths',
          examDate: '2026-09-30',
          daysLeft: 1,
          masteryPercent: 0,
          weakConcepts: 0,
          dueCards: 0,
        },
      ],
    });
    expect(tomorrow.exam?.message).toBe('Maths exam is tomorrow');
    const past = normalizeToday({
      ...legacy,
      exams: [
        {
          packId: 'p',
          title: 'Maths',
          examDate: '2026-09-20',
          daysLeft: -9,
          masteryPercent: 0,
          weakConcepts: 0,
          dueCards: 0,
        },
      ],
    });
    expect(past.exam).toBeNull();
  });

  it('returns an empty plan when today could not be loaded', () => {
    const normalized = normalizeToday(null);
    expect(normalized.steps).toEqual([]);
    expect(normalized.primary).toBeNull();
    expect(normalized.minutes).toBeNull();
    expect(normalized.exam).toBeNull();
  });

  it('does not invent minutes when the tasks have none', () => {
    const empty = today({ plan: undefined, tasks: [step({ minutes: undefined })] });
    expect(normalizeToday(empty).minutes).toBeNull();
  });
});

describe('plan step copy', () => {
  it('drops the pack title the engine appends, because the page shows it separately', () => {
    expect(stepTitle({ label: 'Review 8 cards · Biology', packTitle: 'Biology' })).toBe(
      'Review 8 cards',
    );
    expect(stepTitle({ label: 'Practice Osmosis', packTitle: 'Biology' })).toBe('Practice Osmosis');
    expect(stepTitle({ label: 'Add study material', packTitle: null })).toBe('Add study material');
  });

  it('says how much a step contains', () => {
    expect(stepAmount({ type: 'practice', sessionType: 'practice', count: 10 })).toBe(
      '10 questions',
    );
    expect(stepAmount({ type: 'review', sessionType: null, count: 8 })).toBe('8 cards');
    expect(stepAmount({ type: 'review', sessionType: 'review', count: 1 })).toBe('1 concept');
    expect(stepAmount({ type: 'learn', sessionType: 'learn', count: 3 })).toBe('3 concepts');
    expect(stepAmount({ type: 'test', sessionType: 'test', count: 10 })).toBe('10 questions');
    expect(stepAmount({ type: 'add-material', sessionType: null, count: 2 })).toBeNull();
    expect(stepAmount({ type: 'practice', sessionType: 'practice', count: null })).toBeNull();
  });

  it('builds the quiet line under a step', () => {
    const practice = step({ count: 10, minutes: 8 });
    expect(stepMeta(practice)).toBe('Biology · 10 questions · 8 min');
    expect(stepMeta(practice, { showPack: false })).toBe('10 questions · 8 min');
    expect(stepMeta(step({ count: null, minutes: undefined, packTitle: null }))).toBe('');
  });

  it('prefers the short reason and falls back to the long description', () => {
    expect(
      stepReason({ reasonText: 'You missed 3 recent questions.', description: 'Long text.' }),
    ).toBe('You missed 3 recent questions.');
    expect(stepReason({ reasonText: undefined, description: 'Long text.' })).toBe('Long text.');
  });

  it('tells the student how long today is, honestly', () => {
    expect(plannedMinutesSentence(25)).toBe('You have 25 minutes planned.');
    expect(plannedMinutesSentence(null)).toBe('Nothing is planned yet.');
    expect(plannedMinutesSentence(0)).toBe('Nothing is planned yet.');
  });

  it('keeps the pack summary fixture honest about a fresh pack', () => {
    const fresh = packSummary();
    expect(fresh.masteryPercent).toBe(0);
    expect(fresh.lastStudiedAt).toBeNull();
  });
});
