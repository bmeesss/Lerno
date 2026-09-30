import type {
  LearningSession,
  ResumeCard,
  SessionItem,
  SessionMistakes,
  SessionPreview,
  SessionResult,
  StudyPackSummary,
  StudyPackToday,
  StudyProgressOverview,
  SubjectOverview,
  TodayStep,
} from '../types';

/** Builders for the study-session API shapes, shared by the frontend tests. */

export function questionItem(
  id: string,
  overrides: Partial<SessionItem> & { prompt?: string; options?: string[] | null } = {},
): SessionItem {
  const { prompt, options, ...rest } = overrides;
  return {
    id,
    position: 0,
    kind: 'question',
    status: 'pending',
    conceptId: 'c1',
    conceptName: 'Osmosis',
    question: {
      id: `q-${id}`,
      prompt: prompt ?? `Question ${id}?`,
      questionType: 'multiple_choice',
      options: options === undefined ? ['Option A', 'Option B', 'Option C'] : options,
      conceptId: 'c1',
      conceptName: 'Osmosis',
      sourceTitle: 'Biology.pdf',
    },
    learn: null,
    answer: null,
    rating: null,
    feedback: null,
    ...rest,
  };
}

export function conceptItem(
  id: string,
  name: string,
  overrides: Partial<SessionItem> = {},
): SessionItem {
  return {
    id,
    position: 0,
    kind: 'concept',
    status: 'pending',
    conceptId: `concept-${id}`,
    conceptName: name,
    question: {
      id: `q-${id}`,
      prompt: `What does ${name} describe?`,
      questionType: 'multiple_choice',
      options: ['The right answer', 'A wrong answer'],
      conceptId: `concept-${id}`,
      conceptName: name,
      sourceTitle: null,
    },
    learn: {
      explanation: `${name} is explained in plain words.`,
      example: {
        text: `An example of ${name} from your notes.`,
        kind: 'source',
        sourceId: 'source-1',
        sourceTitle: 'Biology.pdf',
      },
      sourceTitle: 'Biology.pdf',
      refLabel: 'page 2',
      origin: 'user',
      masteryPercent: 20,
      reason: 'weak',
    },
    answer: null,
    rating: null,
    feedback: null,
    ...overrides,
  };
}

export function session(overrides: Partial<LearningSession> = {}): LearningSession {
  const items = overrides.items ?? [questionItem('i1'), questionItem('i2'), questionItem('i3')];
  return {
    id: 's1',
    packId: 'pack-1',
    packTitle: 'Biology',
    isOwner: true,
    type: 'practice',
    mode: null,
    status: 'active',
    title: 'Practice Biology',
    label: 'Biology Practice',
    focusConceptId: null,
    focusConceptName: null,
    itemCount: items.length,
    answeredCount: 0,
    currentPosition: 0,
    progress: { position: 0, total: items.length, answered: 0, skipped: 0, percent: 0 },
    startedAt: '2026-09-29T09:00:00.000Z',
    completedAt: null,
    lastActivityAt: '2026-09-29T09:05:00.000Z',
    durationSeconds: 0,
    hideFeedback: false,
    result: null,
    items: items.map((item, index) => ({ ...item, position: index })),
    ...overrides,
  };
}

export function result(overrides: Partial<SessionResult> = {}): SessionResult {
  return {
    total: 3,
    answered: 3,
    skipped: 0,
    correct: 2,
    partial: 0,
    incorrect: 1,
    score: 2,
    percent: 67,
    durationSeconds: 420,
    concepts: [
      {
        conceptId: 'c1',
        name: 'Osmosis',
        beforePercent: 42,
        afterPercent: 61,
        answered: 3,
        correct: 2,
        incorrect: 1,
      },
    ],
    stillWeak: [
      { conceptId: 'c2', name: 'Diffusion', masteryPercent: 18 },
      { conceptId: 'c3', name: 'Membranes', masteryPercent: 25 },
    ],
    packWeakCount: 2,
    packMasteryPercent: 48,
    knownWell: [
      {
        conceptId: 'c1',
        name: 'Osmosis',
        correct: 2,
        partial: 0,
        incorrect: 0,
        total: 2,
        percent: 100,
        masteryPercent: 61,
      },
    ],
    needsPractice: [
      {
        conceptId: 'c2',
        name: 'Diffusion',
        correct: 0,
        partial: 0,
        incorrect: 1,
        total: 1,
        percent: 0,
        masteryPercent: 18,
      },
    ],
    mistakeCount: 1,
    next: {
      type: 'practice',
      label: 'Practice Diffusion',
      description: 'You missed 1 question on it.',
      conceptId: 'c2',
      conceptName: 'Diffusion',
    },
    testAttemptId: null,
    ...overrides,
  };
}

export function preview(overrides: Partial<SessionPreview> = {}): SessionPreview {
  return {
    packId: 'pack-1',
    packTitle: 'Biology',
    type: 'practice',
    mode: null,
    title: 'Practice Biology',
    count: 10,
    minutes: 12,
    difficulty: 'medium',
    focus: { label: 'Focus: weak concepts', conceptId: null, conceptName: null },
    concepts: [
      { id: 'c1', name: 'Osmosis', masteryPercent: 42, reason: 'weak' },
      { id: 'c2', name: 'Diffusion', masteryPercent: 18, reason: 'mistake' },
    ],
    availableQuestions: 24,
    availableConcepts: 8,
    examDaysLeft: null,
    canStart: true,
    blockedReason: null,
    resume: null,
    modes: null,
    ...overrides,
  };
}

export function testModes(available = true): NonNullable<SessionPreview['modes']> {
  return [
    {
      mode: 'quick10',
      label: '10 questions',
      description: 'A quick check of 10 questions.',
      count: 10,
      minutes: 12,
      available,
    },
    {
      mode: 'quick20',
      label: '20 questions',
      description: 'A quick check of 20 questions.',
      count: 20,
      minutes: 24,
      available,
    },
    {
      mode: 'exam',
      label: 'Exam simulation',
      description: 'The whole pack, up to 25 questions, without hints.',
      count: 24,
      minutes: 29,
      available,
    },
  ];
}

export function resumeCard(overrides: Partial<ResumeCard> = {}): ResumeCard {
  return {
    sessionId: 's1',
    packId: 'pack-1',
    packTitle: 'Biology',
    type: 'practice',
    mode: null,
    status: 'active',
    label: 'Biology Practice',
    positionLabel: 'Question 6 of 10',
    position: 6,
    total: 10,
    answeredCount: 5,
    lastActivityAt: '2026-09-29T09:05:00.000Z',
    ...overrides,
  };
}

export function mistakes(overrides: Partial<SessionMistakes> = {}): SessionMistakes {
  return {
    sessionId: 's1',
    packId: 'pack-1',
    packTitle: 'Biology',
    type: 'practice',
    total: 1,
    mistakes: [
      {
        itemId: 'i3',
        position: 2,
        verdict: 'incorrect',
        question: {
          id: 'q-i3',
          prompt: 'Which way does water move in osmosis?',
          questionType: 'multiple_choice',
          options: ['Towards more solute', 'Towards less solute'],
        },
        yourAnswer: 'Towards less solute',
        correctAnswer: 'Towards more solute',
        explanation: 'Water follows the solute across the membrane.',
        concept: { id: 'c1', name: 'Osmosis' },
        source: { title: 'Biology.pdf', ref: 'page 3' },
      },
    ],
    ...overrides,
  };
}

export function step(
  overrides: Partial<TodayStep> & { order?: number } = {},
): TodayStep & { order: number } {
  return {
    type: 'practice',
    label: 'Practice Osmosis',
    description: 'You answered 3 questions incorrectly recently.',
    reasonText: 'You missed 3 recent questions.',
    reason: 'mistakes',
    packId: 'pack-1',
    packTitle: 'Biology',
    subjectId: 'sub-1',
    subjectName: 'Biology',
    conceptId: 'c1',
    conceptName: 'Osmosis',
    sessionType: 'practice',
    sessionId: null,
    mode: null,
    count: 5,
    minutes: 4,
    examDaysLeft: null,
    order: 1,
    ...overrides,
  };
}

export function packSummary(overrides: Partial<StudyPackSummary> = {}): StudyPackSummary {
  return {
    id: 'pack-1',
    ownerId: 'u1',
    subjectId: 'sub-1',
    subjectName: 'Biology',
    title: 'Biology H3',
    description: '',
    level: '3 MAVO',
    visibility: 'private',
    examDate: null,
    examDaysLeft: null,
    legacySetId: null,
    sources: 1,
    flashcards: 12,
    concepts: 8,
    practiceQuestions: 6,
    masteryPercent: 0,
    weakConcepts: 0,
    learningConcepts: 0,
    masteredConcepts: 0,
    dueCards: 0,
    lastStudiedAt: null,
    cardsReviewed: 0,
    practiceAnswers: 0,
    testsCompleted: 0,
    summaryUpdatedAt: null,
    createdAt: '2026-09-27T09:00:00.000Z',
    updatedAt: '2026-09-27T09:05:00.000Z',
    ...overrides,
  };
}

/** A full `today` payload: the plan, the nearest exam, resume cards, subjects and streak. */
export function today(overrides: Partial<StudyPackToday> = {}): StudyPackToday {
  const first = step();
  const second = step({
    order: 2,
    type: 'review',
    label: 'Review 8 cards · Biology',
    description: '8 cards are due today according to spaced repetition.',
    reasonText: '8 cards are due today.',
    reason: 'due-cards',
    conceptId: null,
    conceptName: null,
    sessionType: null,
    count: 8,
    minutes: 6,
  });
  const third = step({
    order: 3,
    type: 'test',
    label: 'Prepare for a test · Biology',
    description: 'Your concepts look strong.',
    reasonText: 'Your concepts look strong — a test can confirm it.',
    reason: 'ready',
    conceptId: null,
    conceptName: null,
    sessionType: 'test',
    mode: 'quick10',
    count: 10,
    minutes: 15,
  });
  return {
    date: '2026-09-29',
    recommended: first,
    tasks: [first, second, third],
    exams: [],
    totalDue: 8,
    packs: [
      packSummary({
        masteryPercent: 40,
        dueCards: 8,
        weakConcepts: 2,
        lastStudiedAt: '2026-09-28T09:00:00.000Z',
      }),
    ],
    plan: { budgetMinutes: 25, minutes: 25, steps: [first, second, third], adjustedForExam: false },
    primary: first,
    exam: null,
    subjects: [],
    resume: [],
    streak: { current: 0, longest: 0, lastActiveDay: null, todayDone: false },
    ...overrides,
  };
}

export function studyProgress(
  overrides: Partial<StudyProgressOverview> = {},
): StudyProgressOverview {
  return {
    today: '2026-09-29',
    timeZone: 'Europe/Amsterdam',
    hasActivity: true,
    overall: {
      masteryPercent: 62,
      conceptsTotal: 40,
      conceptsMastered: 12,
      conceptsWeak: 6,
      studySeconds: 3900,
      studyMinutes: 65,
      questionsAnswered: 132,
      cardsReviewed: 48,
      testsCompleted: 3,
      sessionsCompleted: 14,
      recentImprovement: { changePercent: 8, windowDays: 7, packs: 2 },
      improvedConcepts: [
        {
          conceptId: 'c1',
          name: 'Osmosis',
          beforePercent: 42,
          afterPercent: 61,
          changePercent: 19,
        },
      ],
    },
    trendMinDays: 3,
    streak: { current: 3, longest: 5, lastActiveDay: '2026-09-29', todayDone: true },
    packs: [
      {
        packId: 'pack-1',
        title: 'Biology H3',
        subjectId: 'sub-1',
        subjectName: 'Biology',
        masteryPercent: 62,
        conceptsTotal: 20,
        trend: {
          hasEnoughData: true,
          daysRecorded: 4,
          minDays: 3,
          points: [
            { day: '2026-09-22', masteryPercent: 48 },
            { day: '2026-09-25', masteryPercent: 55 },
            { day: '2026-09-27', masteryPercent: 58 },
            { day: '2026-09-29', masteryPercent: 62 },
          ],
          changePercent: 14,
          direction: 'up',
        },
        weakConcepts: [{ id: 'c2', name: 'Diffusion', masteryPercent: 18 }],
        strongConcepts: [{ id: 'c1', name: 'Osmosis', masteryPercent: 90 }],
        dueCards: 4,
        lastActivityAt: '2026-09-29T08:00:00.000Z',
        sessionsCompleted: 9,
        questionsAnswered: 88,
        activeDaysLast7: 4,
        examDate: '2026-10-08',
        examDaysLeft: 9,
      },
    ],
    ...overrides,
  };
}

export function subjectOverview(overrides: Partial<SubjectOverview> = {}): SubjectOverview {
  const next = step({ label: 'Practice Diffusion', conceptId: 'c2', conceptName: 'Diffusion' });
  return {
    subject: { id: 'sub-1', name: 'Biology' },
    totals: { packs: 2, concepts: 12, masteryPercent: 62, dueCards: 12, weakConcepts: 4 },
    packs: [
      {
        packId: 'pack-1',
        title: 'Biology H3',
        masteryPercent: 70,
        concepts: 8,
        dueCards: 8,
        weakConcepts: [{ id: 'c2', name: 'Diffusion', masteryPercent: 18 }],
        lastStudiedAt: '2026-09-28T10:00:00.000Z',
        examDate: '2026-10-08',
        examDaysLeft: 9,
        next,
        resume: null,
      },
      {
        packId: 'pack-2',
        title: 'Biology H4',
        masteryPercent: 30,
        concepts: 4,
        dueCards: 4,
        weakConcepts: [],
        lastStudiedAt: null,
        examDate: null,
        examDaysLeft: null,
        next: null,
        resume: resumeCard({ packId: 'pack-2', sessionId: 's9' }),
      },
    ],
    exams: [{ packId: 'pack-1', title: 'Biology H3', examDate: '2026-10-08', daysLeft: 9 }],
    recentActivity: [
      {
        sessionId: 's7',
        packId: 'pack-1',
        label: 'Biology Practice',
        type: 'practice',
        completedAt: '2026-09-28T10:00:00.000Z',
        percent: 80,
        answered: 10,
      },
    ],
    next,
    ...overrides,
  };
}
