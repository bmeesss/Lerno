import { describe, expect, it } from 'vitest';
import { createMemoryDatabase, createMemoryState } from '../lib/db/memory.js';
import type { Database } from '../lib/db/repository.js';
import type { ConceptRecord } from '../lib/db/types.js';
import { loadPackSnapshots } from './pack-data.js';
import { seedPack, type PackSpec, type SeededPack } from '../test-helpers/pack-fixtures.js';
import {
  addMaterialTask,
  emptyContext,
  packCandidates,
  rankTasks,
  toTask,
  type RecommendationTask,
} from './recommendation-service.js';
import {
  buildSubjectsToday,
  buildTodayPlan,
  dailyBudgetMinutes,
  DEFAULT_DAILY_MINUTES,
  examMessage,
  fitToBudget,
  nearestExam,
  planStudyDays,
  studyPlanService,
  toPlanTask,
  type PlanInput,
} from './study-plan-service.js';
import { emptyMastery, rankRecommendations, type MasteryState } from './study-pack-rules.js';

const NOW = new Date('2026-09-29T12:00:00.000Z');
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();
const daysAhead = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString();
const USER = 'student';

function newDb(): Database {
  return createMemoryDatabase(createMemoryState());
}

function task(overrides: Partial<RecommendationTask> = {}): RecommendationTask {
  return {
    type: 'practice',
    label: 'Practice Osmosis',
    description: '',
    reasonText: '',
    reason: 'weak',
    packId: 'p1',
    packTitle: 'Biology',
    subjectId: 's1',
    subjectName: 'Biology',
    conceptId: 'c1',
    conceptName: 'Osmosis',
    sessionType: 'practice',
    sessionId: null,
    mode: null,
    count: 5,
    minutes: 6,
    examDaysLeft: null,
    ...overrides,
  };
}

describe('daily budget', () => {
  it('is 25 minutes, and grows as the exam gets close', () => {
    expect(DEFAULT_DAILY_MINUTES).toBe(25);
    expect(dailyBudgetMinutes(null)).toBe(25);
    expect(dailyBudgetMinutes(-3)).toBe(25);
    expect(dailyBudgetMinutes(40)).toBe(25);
    expect(dailyBudgetMinutes(14)).toBe(30);
    expect(dailyBudgetMinutes(7)).toBe(35);
    expect(dailyBudgetMinutes(2)).toBe(45);
    expect(dailyBudgetMinutes(0)).toBe(45);
  });

  it('fits activities to the budget, keeping the first one and skipping what does not fit', () => {
    const items = [
      { id: 'a', minutes: 30 },
      { id: 'b', minutes: 12 },
      { id: 'c', minutes: 3 },
      { id: 'd', minutes: 2 },
    ];
    // The first item is always kept, even when it alone is over budget.
    expect(fitToBudget(items, 25).map((item) => item.id)).toEqual(['a']);
    const small = [
      { id: 'a', minutes: 9 },
      { id: 'b', minutes: 20 },
      { id: 'c', minutes: 6 },
      { id: 'd', minutes: 4 },
    ];
    expect(fitToBudget(small, 25).map((item) => item.id)).toEqual(['a', 'c', 'd']);
    expect(fitToBudget(small, 25, 2).map((item) => item.id)).toEqual(['a', 'c']);
    expect(fitToBudget([], 25)).toEqual([]);
  });
});

describe("today's numbered plan", () => {
  it('numbers the steps, sums the minutes and never exceeds the budget by much', () => {
    const plan = buildTodayPlan(
      [
        task({ label: 'Practice Osmosis', minutes: 6 }),
        task({
          type: 'learn',
          label: 'Learn Diffusion',
          sessionType: 'learn',
          conceptId: 'c2',
          minutes: 9,
        }),
        task({ type: 'test', label: 'Test', sessionType: 'test', conceptId: null, minutes: 14 }),
        task({ type: 'practice', label: 'Practice Mitosis', conceptId: 'c3', minutes: 6 }),
      ],
      25,
    );
    expect(plan.steps.map((step) => [step.order, step.label])).toEqual([
      [1, 'Practice Osmosis'],
      [2, 'Learn Diffusion'],
      [3, 'Practice Mitosis'],
    ]);
    expect(plan.minutes).toBe(21);
    expect(plan.budgetMinutes).toBe(25);
    expect(plan.adjustedForExam).toBe(false);
  });

  it('drops duplicates and only shows "add material" when there is nothing else', () => {
    const duplicated = buildTodayPlan([task(), task()], 25);
    expect(duplicated.steps).toHaveLength(1);
    expect(buildTodayPlan([addMaterialTask()], 25).steps[0]!.type).toBe('add-material');
    expect(buildTodayPlan([addMaterialTask(), task()], 25).steps.map((step) => step.type)).toEqual([
      'practice',
    ]);
  });

  it('flags the plan as adjusted for the exam only when an exam within a month shaped it', () => {
    expect(buildTodayPlan([task({ examDaysLeft: 9 })], 30).adjustedForExam).toBe(true);
    expect(buildTodayPlan([task({ examDaysLeft: 45 })], 25).adjustedForExam).toBe(false);
    expect(buildTodayPlan([task({ examDaysLeft: -2 })], 25).adjustedForExam).toBe(false);
  });
});

describe('exam banner', () => {
  const packs = [
    { id: 'a', title: 'Biology', examDate: '2026-10-08' },
    { id: 'b', title: 'History', examDate: '2026-11-20' },
    { id: 'c', title: 'Chemistry', examDate: '2026-09-01' },
    { id: 'd', title: 'Physics', examDate: null },
  ];

  it('finds the nearest exam that has not passed and words it as the student reads it', () => {
    const banner = nearestExam(packs, NOW, 'UTC')!;
    expect(banner).toMatchObject({ packId: 'a', daysLeft: 9, message: 'Biology exam in 9 days' });
    expect(banner.note).toBe('Your plan is adjusted for the exam.');
  });

  it('does not claim an adjusted plan for a distant exam', () => {
    const banner = nearestExam([packs[1]!], NOW, 'UTC')!;
    expect(banner.daysLeft).toBe(52);
    expect(banner.note).toBeNull();
  });

  it('returns null without an upcoming exam and words today/tomorrow', () => {
    expect(nearestExam([packs[2]!, packs[3]!], NOW, 'UTC')).toBeNull();
    expect(examMessage('Biology', 0)).toBe('Biology exam is today');
    expect(examMessage('Biology', 1)).toBe('Biology exam is tomorrow');
  });

  it("counts days by the student's calendar, not by UTC", () => {
    const lateUtc = new Date('2026-10-07T23:30:00.000Z');
    expect(nearestExam([packs[0]!], lateUtc, 'UTC')!.daysLeft).toBe(1);
    expect(nearestExam([packs[0]!], lateUtc, 'Europe/Amsterdam')!.daysLeft).toBe(0);
  });
});

describe('Today by subject', () => {
  async function twoSubjects(examSubject: 'Biology' | 'History' | null) {
    const db = newDb();
    const spec = (title: string, subjectName: string, exam: boolean): PackSpec => ({
      title,
      subject: { id: `subject-${subjectName}`, name: subjectName },
      examDate: exam ? '2026-10-06' : null,
      concepts: [{ name: `${title} idea`, mastery: 0.2, attempts: 3, lastPracticedAt: daysAgo(1) }],
    });
    const biology = await seedPack(db, USER, spec('Cells', 'Biology', examSubject === 'Biology'));
    const history = await seedPack(db, USER, spec('Rome', 'History', examSubject === 'History'));
    const snapshots = await loadPackSnapshots(db, USER, [history.pack, biology.pack], NOW, 'UTC');
    const ranked = rankTasks(snapshots, emptyContext(NOW, 'UTC'));
    const plan = buildTodayPlan(ranked, 25);
    return buildSubjectsToday(snapshots, ranked, plan, NOW, 'UTC');
  }

  it('orders subjects by the engine ranking: the one with the exam first', async () => {
    expect((await twoSubjects('Biology')).map((row) => row.subjectName)).toEqual([
      'Biology',
      'History',
    ]);
    // Swap the exam: the order follows, nothing is hardcoded.
    expect((await twoSubjects('History')).map((row) => row.subjectName)).toEqual([
      'History',
      'Biology',
    ]);
  });

  it('describes each subject with its own steps, mastery and exam', async () => {
    const [first, second] = await twoSubjects('Biology');
    expect(first).toMatchObject({
      subjectName: 'Biology',
      packs: 1,
      weakConcepts: 1,
      masteryPercent: 20,
      examDaysLeft: 7,
    });
    expect(first!.steps.map((step) => step.order)).toEqual([1]);
    expect(second).toMatchObject({ subjectName: 'History', examDaysLeft: null });
    expect(second!.steps.map((step) => step.order)).toEqual([2]);
    expect(first!.next?.packTitle).toBe('Cells');
  });
});

describe('exam planner', () => {
  const concept = (
    name: string,
    position: number,
    importance: number | null = null,
  ): ConceptRecord => ({
    id: name,
    packId: 'p',
    sourceId: null,
    name,
    explanation: '',
    origin: 'user',
    position,
    refLabel: null,
    importance,
    difficulty: null,
    conflictWith: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  });
  const state = (
    mastery: number,
    attempts = 3,
    nextReviewAt: string | null = daysAhead(3),
  ): MasteryState => ({
    ...emptyMastery(),
    mastery,
    attempts,
    nextReviewAt,
  });

  function input(overrides: Partial<PlanInput> = {}): PlanInput {
    const concepts = [
      concept('Osmosis', 1),
      concept('Diffusion', 2),
      concept('Mitosis', 3),
      concept('Meiosis', 4),
      concept('Enzymes', 5),
      concept('Membranes', 6),
      concept('Respiration', 7),
      concept('Photosynthesis', 8),
    ];
    const states = new Map<string, MasteryState>([
      ['Osmosis', state(0.15)], // weak
      ['Diffusion', state(0.2)], // weak
      ['Mitosis', state(0.45)], // learning
      ['Photosynthesis', state(0.95, 6)], // mastered
    ]);
    return {
      title: 'Biology',
      startDay: '2026-09-29',
      days: 9,
      budgetMinutes: 30,
      examDaysLeft: 9,
      concepts,
      states,
      questionCountByConcept: new Map(concepts.map((c) => [c.id, 3])),
      cardCount: 20,
      questionCount: 24,
      dueCards: 0,
      daysSinceStudied: 1,
      recentMistakes: new Map(),
      liveTasks: [
        task({
          label: 'Practice Osmosis',
          conceptId: 'Osmosis',
          conceptName: 'Osmosis',
          minutes: 6,
        }),
        task({
          type: 'learn',
          label: 'Learn Meiosis',
          sessionType: 'learn',
          conceptId: 'Meiosis',
          conceptName: 'Meiosis',
          count: 3,
          minutes: 9,
        }),
      ],
      now: NOW,
      ...overrides,
    };
  }

  it('makes one entry per day, on consecutive calendar days, with concrete tasks', () => {
    const plan = planStudyDays(input());
    expect(plan.sessions).toHaveLength(9);
    expect(plan.sessions.map((session) => session.day)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(plan.sessions[0]!.date).toBe('2026-09-29');
    expect(plan.sessions[8]!.date).toBe('2026-10-07'); // the day before the exam
    for (const session of plan.sessions) {
      expect(session.tasks!.length).toBeGreaterThan(0);
      expect(session.activities.length).toBeGreaterThanOrEqual(session.tasks!.length);
      expect(session.minutes).toBe(session.tasks!.reduce((sum, t) => sum + t.minutes, 0));
      expect(session.budgetMinutes).toBe(30);
    }
  });

  it("starts from today's live plan, so the plan and Today agree", () => {
    const plan = planStudyDays(input());
    expect(plan.sessions[0]!.tasks!.map((t) => t.label)).toEqual([
      'Practice Osmosis',
      'Learn Meiosis',
    ]);
  });

  it('teaches every concept that is not known yet exactly once before the exam', () => {
    const plan = planStudyDays(input());
    const learned: string[] = [];
    for (const session of plan.sessions) {
      for (const t of session.tasks!) {
        if (t.type === 'learn') {
          // Learn tasks name their first concept and how many follow.
          learned.push(t.conceptName!);
        }
      }
    }
    expect(new Set(learned).size).toBe(learned.length);
    const learnedCount = plan.sessions
      .flatMap((s) => s.tasks!)
      .filter((t) => t.type === 'learn')
      .reduce((sum, t) => sum + (t.count ?? 1), 0);
    // 2 weak + 1 learning + 5 new = 8 concepts, minus the mastered one = 7 to learn.
    expect(learnedCount).toBe(7);
  });

  it('ends with an exam simulation and a mistakes review the day before the exam', () => {
    const plan = planStudyDays(input());
    const last = plan.sessions.at(-1)!;
    expect(last.focus).toBe('Exam simulation and final review');
    expect(last.tasks!.some((t) => t.type === 'test' && t.mode === 'exam')).toBe(true);
    expect(last.activities.some((line) => /Review every mistake/.test(line))).toBe(true);
  });

  it('keeps ordinary days inside the daily budget (with a small slack)', () => {
    const plan = planStudyDays(input());
    for (const session of plan.sessions.slice(0, -1)) {
      // The first task is always kept, so only multi-task days are bounded.
      if (session.tasks!.length > 1) expect(session.minutes).toBeLessThanOrEqual(30 + 3);
    }
  });

  it('adds a checkpoint test in the middle of longer plans, not in short ones', () => {
    const long = planStudyDays(input());
    expect(
      long.sessions
        .slice(1, -1)
        .some((s) => s.tasks!.some((t) => t.type === 'test' && t.mode === 'quick10')),
    ).toBe(true);
    const short = planStudyDays(input({ days: 3, examDaysLeft: 3 }));
    expect(short.sessions.slice(1, -1).some((s) => s.tasks!.some((t) => t.type === 'test'))).toBe(
      false,
    );
  });

  it('puts the exam simulation in a one-day plan (exam tomorrow) but not on exam day itself', () => {
    const tomorrow = planStudyDays(input({ days: 1, examDaysLeft: 1 }));
    expect(tomorrow.sessions).toHaveLength(1);
    expect(tomorrow.sessions[0]!.tasks!.some((t) => t.mode === 'exam')).toBe(true);

    const today = planStudyDays(input({ days: 1, examDaysLeft: 0 }));
    expect(today.sessions[0]!.focus).toBe('Exam day — a light warm-up');
    expect(today.sessions[0]!.tasks!.some((t) => t.mode === 'exam')).toBe(false);
  });

  it('is honest when there is more to learn than time: weakest and most important first', () => {
    const concepts = Array.from({ length: 12 }, (_, index) =>
      concept(`Topic ${index + 1}`, index + 1, index === 11 ? 1 : 0.2),
    );
    const plan = planStudyDays(
      input({
        days: 3,
        examDaysLeft: 3,
        concepts,
        states: new Map(),
        questionCountByConcept: new Map(concepts.map((c) => [c.id, 2])),
        liveTasks: [],
        questionCount: 24,
      }),
    );
    expect(plan.overview).toMatch(/do not fit before the exam/);
    // The most important concept is not left for last.
    const learnLabels = plan.sessions
      .flatMap((s) => s.tasks!)
      .filter((t) => t.type === 'learn')
      .map((t) => t.label);
    expect(learnLabels.join(' ')).toContain('Topic 12');
  });

  it('starts lighter after a break and says so', () => {
    const plan = planStudyDays(
      input({
        daysSinceStudied: 6,
        liveTasks: [
          task({ type: 'learn', label: 'Learn A', sessionType: 'learn', minutes: 12 }),
          task({ label: 'Practice B', minutes: 10 }),
          task({ label: 'Practice C', minutes: 6 }),
        ],
      }),
    );
    expect(plan.overview).toMatch(/not studied for 6 days/);
    // 80% of 30 minutes = 24: the third step does not fit.
    expect(plan.sessions[0]!.tasks!.map((t) => t.label)).toEqual(['Learn A', 'Practice B']);
  });

  it('plans no simulation without enough questions, and no test tasks it cannot fill', () => {
    const plan = planStudyDays(input({ questionCount: 3, questionCountByConcept: new Map() }));
    const all = plan.sessions.flatMap((s) => s.tasks!);
    expect(all.some((t) => t.type === 'test')).toBe(false);
  });

  it('describes the plan in words, including exam-driven adjustments', () => {
    const plan = planStudyDays(input());
    expect(plan.overview).toContain('9 days of study at 30 minutes per day.');
    expect(plan.overview).toContain('Weakest right now: Osmosis, Diffusion.');
    expect(plan.overview).toContain('4 new concepts to learn.');
    expect(plan.overview).toContain('The exam is in 9 days');
  });

  it('turns engine tasks into plan tasks and skips setup chores', () => {
    expect(
      toPlanTask(task({ type: 'review', sessionType: null, label: 'Review 12 cards' }))!.type,
    ).toBe('cards');
    expect(toPlanTask(task({ type: 'review', sessionType: 'review' }))!.type).toBe('review');
    expect(toPlanTask(task({ type: 'generate-concepts', sessionType: null }))).toBeNull();
    expect(toPlanTask(task({ type: 'add-material', sessionType: null }))).toBeNull();
  });
});

describe('studyPlanService.today', () => {
  async function setup() {
    const db = newDb();
    const biology = await seedPack(db, USER, {
      title: 'Biology',
      subject: { id: 'sb', name: 'Biology' },
      examDate: '2026-10-08',
      questionsPerConcept: 3,
      concepts: [
        {
          name: 'Osmosis',
          mastery: 0.42,
          attempts: 4,
          lastPracticedAt: daysAgo(1),
          nextReviewAt: daysAhead(2),
        },
        { name: 'Diffusion' },
        {
          name: 'Mitosis',
          mastery: 0.1,
          attempts: 2,
          lastPracticedAt: daysAgo(2),
          nextReviewAt: daysAhead(1),
        },
      ],
    });
    const history = await seedPack(db, USER, {
      title: 'History',
      subject: { id: 'sh', name: 'History' },
      questionsPerConcept: 2,
      concepts: [{ name: 'Rome' }, { name: 'Greece' }],
    });
    return { db, biology, history };
  }

  it('builds one plan with a single primary action and the exam banner', async () => {
    const { db } = await setup();
    const today = await studyPlanService.today(db, USER, NOW);
    expect(today.date).toBe('2026-09-29');
    expect(today.plan.budgetMinutes).toBe(30); // exam in 9 days → 30 minutes
    expect(today.plan.steps.length).toBeGreaterThan(1);
    expect(today.plan.steps.map((step) => step.order)).toEqual(
      today.plan.steps.map((_, index) => index + 1),
    );
    expect(today.primary).toEqual(today.plan.steps[0]);
    expect(today.recommended.label).toBe(today.plan.steps[0]!.label);
    expect(today.exam).toMatchObject({
      title: 'Biology',
      daysLeft: 9,
      message: 'Biology exam in 9 days',
      note: 'Your plan is adjusted for the exam.',
    });
    expect(today.plan.adjustedForExam).toBe(true);
    // Legacy fields stay.
    expect(today.exams).toHaveLength(1);
    expect(today.tasks.length).toBeGreaterThan(0);
  });

  it('lists every subject with tasks, ranked by the engine', async () => {
    const { db } = await setup();
    const today = await studyPlanService.today(db, USER, NOW);
    expect(today.subjects.map((subject) => subject.subjectName)).toEqual(['Biology', 'History']);
    expect(today.subjects[1]!.next).toMatchObject({ type: 'learn', packTitle: 'History' });
  });

  it('keeps the exam plan up to date without being asked', async () => {
    const { db, biology, history } = await setup();
    expect(await db.studyPlans.getByPack(biology.pack.id)).toBeNull();
    await studyPlanService.today(db, USER, NOW);
    const plan = await db.studyPlans.getByPack(biology.pack.id);
    expect(plan).not.toBeNull();
    expect(plan!.sessions).toHaveLength(9);
    expect(plan!.sessions[0]!.date).toBe('2026-09-29');
    // Packs without an exam date get no automatic plan.
    expect(await db.studyPlans.getByPack(history.pack.id)).toBeNull();

    // The next day the plan is rebuilt from that day on (8 days left now).
    const tomorrow = new Date(NOW.getTime() + DAY);
    await studyPlanService.today(db, USER, tomorrow);
    const rebuilt = await db.studyPlans.getByPack(biology.pack.id);
    expect(rebuilt!.sessions[0]!.date).toBe('2026-09-30');
    expect(rebuilt!.sessions).toHaveLength(8);
  });

  it('keeps a budget the student chose when the plan is rebuilt', async () => {
    const { db, biology } = await setup();
    await studyPlanService.build(db, USER, biology.pack, { minutesPerDay: 60 }, NOW);
    const tomorrow = new Date(NOW.getTime() + DAY);
    await studyPlanService.today(db, USER, tomorrow);
    const plan = await db.studyPlans.getByPack(biology.pack.id);
    expect(plan!.sessions.every((session) => session.budgetMinutes === 60)).toBe(true);
  });

  it('rebuilds the plan when the exam date changes', async () => {
    const { db, biology } = await setup();
    await studyPlanService.today(db, USER, NOW);
    await db.packs.update(biology.pack.id, { examDate: '2026-10-03' });
    await studyPlanService.today(db, USER, NOW);
    const plan = await db.studyPlans.getByPack(biology.pack.id);
    expect(plan!.examDate).toBe('2026-10-03');
    expect(plan!.sessions).toHaveLength(4);
  });

  it('shows the resumable session and a streak built only from completed sessions', async () => {
    const { db, biology } = await setup();
    const open = await db.learningSessions.create({
      userId: USER,
      packId: biology.pack.id,
      type: 'practice',
      status: 'active',
      title: 'Practice Biology',
      itemCount: 10,
      startedAt: NOW.toISOString(),
    });
    await db.learningSessions.update(open.id, { currentPosition: 5, answeredCount: 5 });

    let today = await studyPlanService.today(db, USER, new Date());
    expect(today.resume).toHaveLength(1);
    expect(today.resume[0]).toMatchObject({
      label: 'Biology Practice',
      positionLabel: 'Question 6 of 10',
    });
    // An open session is not a streak.
    expect(today.streak).toMatchObject({ current: 0, todayDone: false });

    const done = await db.learningSessions.create({
      userId: USER,
      packId: biology.pack.id,
      type: 'practice',
      status: 'active',
      title: 'Practice Biology',
      itemCount: 3,
      startedAt: new Date().toISOString(),
    });
    await db.learningSessions.update(done.id, {
      status: 'completed',
      answeredCount: 3,
      completedAt: new Date().toISOString(),
    });
    today = await studyPlanService.today(db, USER, new Date());
    expect(today.streak).toMatchObject({ current: 1, todayDone: true });
  });

  it('tells a new student to add material, with nothing to plan', async () => {
    const db = newDb();
    const today = await studyPlanService.today(db, USER, NOW);
    expect(today.recommended.type).toBe('add-material');
    expect(today.plan.minutes).toBe(0);
    expect(today.subjects).toEqual([]);
    expect(today.exam).toBeNull();
  });

  it("does not show another student's packs", async () => {
    const { db } = await setup();
    const other = await studyPlanService.today(db, 'someone-else', NOW);
    expect(other.recommended.type).toBe('add-material');
    expect(other.packs).toEqual([]);
  });
});

describe('plan tasks match the live engine', () => {
  it('uses the same ranking as Today for day 1', async () => {
    const db = newDb();
    const bio: SeededPack = await seedPack(db, USER, {
      title: 'Biology',
      examDate: '2026-10-08',
      questionsPerConcept: 3,
      concepts: [
        {
          name: 'Osmosis',
          mastery: 0.2,
          attempts: 3,
          lastPracticedAt: daysAgo(1),
          nextReviewAt: daysAhead(1),
        },
        { name: 'Diffusion' },
      ],
    });
    const [snapshot] = await loadPackSnapshots(db, USER, [bio.pack], NOW, 'UTC');
    const live = rankRecommendations(packCandidates(snapshot!, emptyContext(NOW, 'UTC'))).map(
      toTask,
    );
    await studyPlanService.build(db, USER, bio.pack, {}, NOW);
    const plan = await db.studyPlans.getByPack(bio.pack.id);
    const dayOne = plan!.sessions[0]!.tasks!.map((t) => t.label);
    expect(dayOne[0]).toBe(live[0]!.label);
  });
});
