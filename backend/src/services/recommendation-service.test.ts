import { describe, expect, it } from 'vitest';
import { createMemoryDatabase, createMemoryState } from '../lib/db/memory.js';
import type { Database } from '../lib/db/repository.js';
import type { PracticeQuestionRecord } from '../lib/db/types.js';
import { loadPackSnapshots } from './pack-data.js';
import { seedPack, type PackSpec, type SeededPack } from './pack-fixtures.js';
import {
  addMaterialTask,
  bestTaskForPack,
  buildQuestionHistory,
  collectRecentMistakes,
  describeDifficulty,
  emptyContext,
  nextStepAfterSession,
  packCandidates,
  rankTasks,
  scoreQuestion,
  selectAdaptiveQuestions,
  selectLearnConcepts,
  selectTestQuestions,
  targetDifficultyLevel,
  testQuestionCount,
  type QuestionHistory,
  type RecommendationContext,
} from './recommendation-service.js';
import { emptyMastery, type MasteryState } from './study-pack-rules.js';

const NOW = new Date('2026-09-29T12:00:00.000Z');
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();
const daysAhead = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString();
const USER = 'student';

function newDb(): Database {
  return createMemoryDatabase(createMemoryState());
}

/** Loads the packs fresh from the repository, so edits made after seeding are seen. */
async function snapshotsOf(db: Database, packs: SeededPack[], now = NOW) {
  const fresh = await db.packs.listByIds(packs.map((entry) => entry.pack.id));
  const ordered = packs.map((entry) => fresh.find((pack) => pack.id === entry.pack.id)!);
  return loadPackSnapshots(db, USER, ordered, now, 'UTC');
}

function ctxWith(overrides: Partial<RecommendationContext> = {}): RecommendationContext {
  return { ...emptyContext(NOW, 'UTC'), ...overrides };
}

const history = (overrides: Partial<QuestionHistory> = {}): QuestionHistory => ({
  lastVerdict: null,
  lastAnsweredAt: null,
  lastSeenAt: null,
  timesSeen: 0,
  ...overrides,
});

describe('pack recommendations', () => {
  it('ranks a weak concept above a new one, and tells the student why', async () => {
    const db = newDb();
    const bio = await seedPack(db, USER, {
      title: 'Biology',
      concepts: [
        { name: 'Osmosis', mastery: 0.2, attempts: 3, lastPracticedAt: daysAgo(1), nextReviewAt: daysAhead(1) },
        { name: 'Diffusion' },
      ],
    });
    const snapshots = await snapshotsOf(db, [bio]);
    const ranked = rankTasks(snapshots, ctxWith());
    expect(ranked[0]).toMatchObject({
      type: 'practice',
      sessionType: 'practice',
      conceptName: 'Osmosis',
      reason: 'weak',
      packTitle: 'Biology',
    });
    expect(ranked[0]!.description).toMatch(/Mastery is 20%/);
    expect(ranked.find((task) => task.type === 'learn')).toMatchObject({
      conceptName: 'Diffusion',
      reason: 'new',
      sessionType: 'learn',
    });
  });

  it('turns recent mistakes into a specific recommendation — even for a concept that is not weak yet', async () => {
    const db = newDb();
    const bio = await seedPack(db, USER, {
      title: 'Biology',
      concepts: [
        { name: 'Osmosis', mastery: 0.42, attempts: 4, lastPracticedAt: daysAgo(1), nextReviewAt: daysAhead(2) },
        { name: 'Diffusion', mastery: 0.9, attempts: 6, lastPracticedAt: daysAgo(1), nextReviewAt: daysAhead(9) },
      ],
    });
    const snapshots = await snapshotsOf(db, [bio]);
    const osmosis = bio.conceptByName('Osmosis');
    const best = bestTaskForPack(snapshots[0]!, ctxWith({ recentMistakes: new Map([[osmosis.id, 3]]) }));
    expect(best).toMatchObject({
      label: 'Practice Osmosis',
      reason: 'mistakes',
      reasonText: 'You missed 3 recent questions.',
    });
    // The long-standing sentence keeps its wording for existing clients.
    expect(best!.description).toBe('You answered 3 questions incorrectly recently.');
  });

  it('offers a review session for concepts whose review date has passed', async () => {
    const db = newDb();
    const bio = await seedPack(db, USER, {
      title: 'Biology',
      concepts: [
        { name: 'Osmosis', mastery: 0.7, attempts: 4, lastPracticedAt: daysAgo(8), nextReviewAt: daysAgo(1) },
        { name: 'Diffusion', mastery: 0.7, attempts: 4, lastPracticedAt: daysAgo(9), nextReviewAt: daysAgo(2) },
      ],
    });
    const candidates = packCandidates((await snapshotsOf(db, [bio]))[0]!, ctxWith());
    const review = candidates.find((candidate) => candidate.reason === 'due-concepts');
    expect(review).toMatchObject({ type: 'review', sessionType: 'review', count: 4 });
    expect(review!.label).toBe('Review 2 concepts · Biology');
    // Longest overdue first.
    expect(review!.conceptName).toBe('Diffusion');
  });

  it('puts an unfinished study session first', async () => {
    const db = newDb();
    const bio = await seedPack(db, USER, {
      title: 'Biology',
      concepts: [{ name: 'Osmosis', mastery: 0.1, attempts: 2 }],
    });
    const session = await db.learningSessions.create({
      userId: USER,
      packId: bio.pack.id,
      type: 'practice',
      status: 'active',
      title: 'Practice Biology',
      itemCount: 10,
      startedAt: NOW.toISOString(),
    });
    await db.learningSessions.update(session.id, {
      currentPosition: 5,
      answeredCount: 5,
      lastActivityAt: daysAgo(0),
    });
    const open = await db.learningSessions.listByUser(USER);
    const ranked = rankTasks(await snapshotsOf(db, [bio]), ctxWith({ openSessions: open }));
    expect(ranked[0]).toMatchObject({
      type: 'continue',
      sessionId: session.id,
      sessionType: 'practice',
      label: 'Continue Biology Practice',
      description: 'Question 6 of 10',
    });
  });

  it('lets a nearer exam lift its pack — and no fixed subject order', async () => {
    const db = newDb();
    const spec = (title: string, examDate: string | null): PackSpec => ({
      title,
      examDate,
      concepts: [{ name: `${title} concept`, mastery: 0.2, attempts: 3, lastPracticedAt: daysAgo(1) }],
    });
    const biology = await seedPack(db, USER, spec('Biology', '2026-10-04')); // 5 days
    const history = await seedPack(db, USER, spec('History', null));
    const first = rankTasks(await snapshotsOf(db, [history, biology]), ctxWith());
    expect(first[0]!.packTitle).toBe('Biology');
    expect(first[0]!.examDaysLeft).toBe(5);

    // Move the exam to the other subject: the order follows the engine, not a list.
    await db.packs.update(biology.pack.id, { examDate: null });
    await db.packs.update(history.pack.id, { examDate: '2026-10-02' });
    const second = rankTasks(await snapshotsOf(db, [history, biology]), ctxWith());
    expect(second[0]!.packTitle).toBe('History');
    expect(second[0]!.examDaysLeft).toBe(3);
  });

  it('counts the exam day in the student\'s own timezone', async () => {
    const db = newDb();
    const bio = await seedPack(db, USER, {
      title: 'Biology',
      examDate: '2026-10-08',
      concepts: [{ name: 'Osmosis', mastery: 0.2, attempts: 2 }],
    });
    const lateUtc = new Date('2026-09-29T23:30:00.000Z');
    const utc = await loadPackSnapshots(db, USER, [bio.pack], lateUtc, 'UTC');
    const amsterdam = await loadPackSnapshots(db, USER, [bio.pack], lateUtc, 'Europe/Amsterdam');
    expect(rankTasks(utc, { ...emptyContext(lateUtc, 'UTC') })[0]!.examDaysLeft).toBe(9);
    expect(
      rankTasks(amsterdam, { ...emptyContext(lateUtc, 'Europe/Amsterdam') })[0]!.examDaysLeft,
    ).toBe(8);
  });

  it('suggests an exam simulation in the last days, unless one was just taken', async () => {
    const db = newDb();
    const bio = await seedPack(db, USER, {
      title: 'Biology',
      examDate: '2026-10-01',
      concepts: [{ name: 'Osmosis', mastery: 0.5, attempts: 2, lastPracticedAt: daysAgo(1) }],
      questionsPerConcept: 6,
    });
    const before = await snapshotsOf(db, [bio]);
    const simulation = packCandidates(before[0]!, ctxWith()).find((c) => c.reason === 'exam');
    expect(simulation).toMatchObject({ type: 'test', sessionType: 'test', mode: 'exam' });

    const test = await db.tests.createTest({
      packId: bio.pack.id,
      ownerId: USER,
      title: 'Exam',
      mode: 'exam',
      questionIds: bio.questions.slice(0, 3).map((question) => question.id),
    });
    await db.testAttempts.create({
      testId: test.test.id,
      packId: bio.pack.id,
      userId: USER,
      score: 2,
      total: 3,
      correctCount: 2,
      partialCount: 0,
      incorrectCount: 1,
      answers: [],
      strongConceptIds: [],
      weakConceptIds: [],
    });
    const after = await snapshotsOf(db, [bio]);
    expect(packCandidates(after[0]!, ctxWith()).some((c) => c.reason === 'exam')).toBe(false);
  });

  it('falls back to "add material" when there is nothing to study', () => {
    expect(rankTasks([], ctxWith())).toEqual([addMaterialTask()]);
  });
});

describe('recent mistakes', () => {
  it('counts wrong practice answers and wrong test answers inside the window only', async () => {
    const db = newDb();
    const bio = await seedPack(db, USER, {
      title: 'Biology',
      concepts: [{ name: 'Osmosis' }],
    });
    const concept = bio.concepts[0]!;
    const question = bio.questions[0]!;
    await db.practiceAttempts.createMany([
      { userId: USER, packId: bio.pack.id, questionId: question.id, conceptId: concept.id, answer: 'x', verdict: 'incorrect' },
      { userId: USER, packId: bio.pack.id, questionId: question.id, conceptId: concept.id, answer: 'Right', verdict: 'correct' },
    ]);
    const snapshots = await snapshotsOf(db, [bio]);
    expect(collectRecentMistakes(snapshots, NOW).get(concept.id)).toBe(1);
    // A week later the same mistake no longer counts as recent.
    expect(collectRecentMistakes(snapshots, new Date(NOW.getTime() + 8 * DAY)).get(concept.id)).toBeUndefined();
  });
});

describe('learn selection', () => {
  const concepts = ['a', 'b', 'c', 'd', 'e', 'f'].map((name, index) => ({
    id: name,
    packId: 'p',
    sourceId: null,
    name,
    explanation: '',
    origin: 'user' as const,
    position: index + 1,
    refLabel: null,
    importance: null,
    difficulty: null,
    conflictWith: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  }));
  const state = (mastery: number, attempts = 3, nextReviewAt: string | null = daysAhead(3)): MasteryState => ({
    ...emptyMastery(),
    mastery,
    attempts,
    nextReviewAt,
  });

  it('orders weak → new → learning → due → mastered confirmation', () => {
    const states = new Map<string, MasteryState>([
      ['a', state(0.9, 5)], // mastered
      ['b', state(0.7, 4, daysAgo(1))], // due
      ['c', state(0.45)], // learning
      ['d', emptyMastery()], // new
      ['e', state(0.1)], // weak
      ['f', state(0.95, 6)], // mastered
    ]);
    const selection = selectLearnConcepts({ concepts, states, limit: 10, now: NOW });
    expect(selection.map((entry) => `${entry.concept.id}:${entry.reason}`)).toEqual([
      'e:weak',
      'd:new',
      'c:learning',
      'b:due',
      'a:confirmation',
      'f:confirmation',
    ]);
  });

  it('starts with the requested concept and only confirms a couple of mastered ones', () => {
    const mastered = new Map<string, MasteryState>(
      concepts.map((concept) => [concept.id, state(0.95, 6)] as const),
    );
    const selection = selectLearnConcepts({
      concepts,
      states: mastered,
      limit: 10,
      focusConceptId: 'd',
      now: NOW,
    });
    expect(selection[0]!.concept.id).toBe('d');
    expect(selection).toHaveLength(3); // the focus plus at most two confirmations
  });

  it('respects the limit', () => {
    expect(selectLearnConcepts({ concepts, states: new Map(), limit: 3, now: NOW })).toHaveLength(3);
  });
});

describe('adaptive question selection', () => {
  async function setup() {
    const db = newDb();
    const bio = await seedPack(db, USER, {
      title: 'Biology',
      questionsPerConcept: 4,
      concepts: [
        { name: 'Osmosis', mastery: 0.15, attempts: 4, lastPracticedAt: daysAgo(2), nextReviewAt: daysAgo(1) },
        { name: 'Diffusion', mastery: 0.2, attempts: 3, lastPracticedAt: daysAgo(2), nextReviewAt: daysAgo(1) },
        { name: 'Mitosis', mastery: 0.95, attempts: 8, lastPracticedAt: daysAgo(3), nextReviewAt: daysAhead(9) },
        { name: 'Meiosis' },
      ],
    });
    const states = new Map<string, MasteryState>(
      (await db.conceptMastery.listByUserAndPack(USER, bio.pack.id)).map((row) => [
        row.conceptId,
        {
          ...emptyMastery(),
          mastery: row.mastery,
          attempts: row.attempts,
          lastPracticedAt: row.lastPracticedAt,
          nextReviewAt: row.nextReviewAt,
        },
      ]),
    );
    return { bio, states };
  }

  const base = (bio: SeededPack, states: Map<string, MasteryState>) => ({
    questions: bio.questions,
    concepts: bio.concepts,
    states,
    history: new Map<string, QuestionHistory>(),
    now: NOW,
  });

  it('picks questions of weak concepts before strong ones', async () => {
    const { bio, states } = await setup();
    const picked = selectAdaptiveQuestions({ ...base(bio, states), count: 4 });
    const names = picked.map((entry) => bio.concepts.find((c) => c.id === entry.question.conceptId)!.name);
    expect(names).not.toContain('Mitosis');
    expect(new Set(names)).toEqual(new Set(['Osmosis', 'Diffusion']));
    expect(picked.every((entry) => ['weak', 'due'].includes(entry.reason))).toBe(true);
  });

  it('never repeats a question inside a session and stops when the pool is empty', async () => {
    const { bio, states } = await setup();
    const picked = selectAdaptiveQuestions({ ...base(bio, states), count: 50 });
    const ids = picked.map((entry) => entry.question.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(bio.questions.length);
  });

  it('mixes concepts instead of filling the session with one weak concept', async () => {
    const { bio, states } = await setup();
    const picked = selectAdaptiveQuestions({ ...base(bio, states), count: 4 });
    const perConcept = new Map<string | null, number>();
    for (const entry of picked) {
      perConcept.set(entry.question.conceptId, (perConcept.get(entry.question.conceptId) ?? 0) + 1);
    }
    expect(Math.max(...perConcept.values())).toBeLessThanOrEqual(2);
  });

  it('asks a recently missed question again, before an unseen one', async () => {
    const { bio, states } = await setup();
    const osmosisQuestions = bio.questions.filter((q) => q.conceptId === bio.conceptByName('Osmosis').id);
    const missed = osmosisQuestions[2]!;
    const picked = selectAdaptiveQuestions({
      ...base(bio, states),
      onlyConceptIds: new Set([bio.conceptByName('Osmosis').id]),
      history: new Map([
        [missed.id, history({ lastVerdict: 'incorrect', lastAnsweredAt: Date.parse(daysAgo(2)), lastSeenAt: Date.parse(daysAgo(2)), timesSeen: 1 })],
      ]),
      count: 1,
    });
    expect(picked[0]!.question.id).toBe(missed.id);
    expect(picked[0]!.reason).toBe('weak');
  });

  it('does not repeat a question the student answered correctly moments ago', async () => {
    const { bio, states } = await setup();
    const concept = bio.conceptByName('Osmosis');
    const osmosisQuestions = bio.questions.filter((q) => q.conceptId === concept.id);
    const justCorrect = osmosisQuestions[0]!;
    const picked = selectAdaptiveQuestions({
      ...base(bio, states),
      onlyConceptIds: new Set([concept.id]),
      history: new Map([
        [justCorrect.id, history({ lastVerdict: 'correct', lastAnsweredAt: NOW.getTime() - 3_600_000, lastSeenAt: NOW.getTime() - 3_600_000, timesSeen: 2 })],
      ]),
      count: 3,
    });
    expect(picked.map((entry) => entry.question.id)).not.toContain(justCorrect.id);
  });

  it('avoids questions that were skipped or shown recently, using question history', async () => {
    const { bio, states } = await setup();
    const concept = bio.conceptByName('Diffusion');
    const [first, ...rest] = bio.questions.filter((q) => q.conceptId === concept.id);
    const seen = buildQuestionHistory({
      attempts: [],
      testAttempts: [],
      seenItems: [
        { questionId: first!.id, verdict: null, answeredAt: NOW.toISOString(), createdAt: NOW.toISOString(), status: 'skipped' },
      ],
    });
    expect(seen.get(first!.id)).toMatchObject({ timesSeen: 1, lastVerdict: null });
    const picked = selectAdaptiveQuestions({
      ...base(bio, states),
      onlyConceptIds: new Set([concept.id]),
      history: seen,
      count: 3,
    });
    expect(picked.map((entry) => entry.question.id).sort()).toEqual(rest.map((q) => q.id).sort());
  });

  it('puts the focus concept first', async () => {
    const { bio, states } = await setup();
    const focus = bio.conceptByName('Meiosis');
    const picked = selectAdaptiveQuestions({ ...base(bio, states), count: 5, focusConceptId: focus.id });
    expect(picked[0]!.question.conceptId).toBe(focus.id);
    expect(picked[0]!.reason).toBe('focus');
    expect(picked.filter((entry) => entry.question.conceptId === focus.id).length).toBeGreaterThanOrEqual(2);
  });

  it('is deterministic for identical input', async () => {
    const { bio, states } = await setup();
    const a = selectAdaptiveQuestions({ ...base(bio, states), count: 6 }).map((e) => e.question.id);
    const b = selectAdaptiveQuestions({ ...base(bio, states), count: 6 }).map((e) => e.question.id);
    expect(a).toEqual(b);
  });

  it('raises unmastered concepts and lowers mastered ones when the exam is close', async () => {
    const { bio, states } = await setup();
    const learning = bio.conceptByName('Meiosis');
    const mastered = bio.conceptByName('Mitosis');
    const scoreOf = (concept: typeof learning, examDaysLeft: number | null) =>
      scoreQuestion({
        question: bio.questions.find((q) => q.conceptId === concept.id)!,
        concept,
        state: states.get(concept.id) ?? emptyMastery(),
        history: history(),
        now: NOW,
        examDaysLeft,
      }).score;
    expect(scoreOf(learning, 2)).toBeGreaterThan(scoreOf(learning, null));
    expect(scoreOf(mastered, 2)).toBeLessThan(scoreOf(mastered, null));
  });

  it('matches difficulty to mastery: easier formats for weak concepts, harder for strong ones', async () => {
    const db = newDb();
    const pack = await seedPack(db, USER, {
      title: 'Mixed',
      concepts: [
        { name: 'Weak', mastery: 0.1, attempts: 3, questions: 1, questionType: 'true_false' },
        { name: 'Strong', mastery: 0.7, attempts: 5, questions: 1, questionType: 'short_answer' },
      ],
    });
    const weak = pack.conceptByName('Weak');
    const strong = pack.conceptByName('Strong');
    expect(targetDifficultyLevel({ ...emptyMastery(), mastery: 0.1, attempts: 3 }, weak)).toBe(1);
    expect(targetDifficultyLevel({ ...emptyMastery(), mastery: 0.7, attempts: 5 }, strong)).toBe(3);
    // A hard concept starts one level easier, an easy one one level harder.
    expect(targetDifficultyLevel({ ...emptyMastery(), mastery: 0.7 }, { ...strong, difficulty: 'hard' })).toBe(2);
    expect(targetDifficultyLevel({ ...emptyMastery(), mastery: 0.1 }, { ...weak, difficulty: 'easy' })).toBe(2);

    const picked = selectAdaptiveQuestions({
      questions: pack.questions,
      concepts: pack.concepts,
      states: new Map([
        [weak.id, { ...emptyMastery(), mastery: 0.1, attempts: 3 }],
        [strong.id, { ...emptyMastery(), mastery: 0.7, attempts: 5 }],
      ]),
      history: new Map(),
      now: NOW,
      count: 2,
    });
    expect(describeDifficulty(picked, new Map(), new Map(pack.concepts.map((c) => [c.id, c])))).toMatch(/easy|medium|hard/);
  });
});

describe('test question selection', () => {
  const question = (id: string, conceptId: string | null, position: number): PracticeQuestionRecord => ({
    id,
    packId: 'p',
    conceptId,
    sourceId: null,
    prompt: id,
    questionType: 'multiple_choice',
    correctAnswer: 'a',
    options: ['a', 'b'],
    explanation: '',
    origin: 'user',
    position,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  });

  it('covers every concept round-robin and starts with the weak ones', () => {
    const questions = [
      question('a1', 'a', 1),
      question('a2', 'a', 2),
      question('b1', 'b', 3),
      question('b2', 'b', 4),
      question('c1', 'c', 5),
    ];
    const picked = selectTestQuestions({
      questions,
      weakConceptIds: new Set(['b']),
      history: new Map(),
      count: 4,
    });
    expect(picked.map((entry) => entry.id)).toEqual(['b1', 'a1', 'c1', 'b2']);
  });

  it('prefers questions the student has not seen recently inside a concept', () => {
    const questions = [question('a1', 'a', 1), question('a2', 'a', 2)];
    const picked = selectTestQuestions({
      questions,
      weakConceptIds: new Set(),
      history: new Map([['a1', history({ lastSeenAt: NOW.getTime(), timesSeen: 1 })]]),
      count: 1,
    });
    expect(picked[0]!.id).toBe('a2');
  });

  it('sizes tests by mode and never asks for more questions than exist', () => {
    expect(testQuestionCount('quick10', 40)).toBe(10);
    expect(testQuestionCount('quick20', 40)).toBe(20);
    expect(testQuestionCount('quick20', 12)).toBe(12);
    expect(testQuestionCount('exam', 40)).toBe(25);
    expect(testQuestionCount('exam', 8)).toBe(8);
  });
});

describe('what to do after a session', () => {
  it('recommends the concept missed most: "Practice Osmosis — You missed 3 questions on it"', async () => {
    const db = newDb();
    const bio = await seedPack(db, USER, {
      title: 'Biology',
      concepts: [
        { name: 'Osmosis', mastery: 0.42, attempts: 4, lastPracticedAt: daysAgo(0), nextReviewAt: daysAhead(1) },
        { name: 'Diffusion', mastery: 0.3, attempts: 3, lastPracticedAt: daysAgo(0), nextReviewAt: daysAhead(1) },
      ],
    });
    const snapshot = (await snapshotsOf(db, [bio]))[0]!;
    const step = nextStepAfterSession({
      snapshot,
      ctx: ctxWith(),
      missed: new Map([
        [bio.conceptByName('Osmosis').id, 3],
        [bio.conceptByName('Diffusion').id, 1],
      ]),
    });
    expect(step).toMatchObject({
      type: 'practice',
      label: 'Practice Osmosis',
      description: 'You missed 3 questions on it.',
      conceptName: 'Osmosis',
    });
  });

  it('falls back to the engine ranking when nothing was missed', async () => {
    const db = newDb();
    const bio = await seedPack(db, USER, {
      title: 'Biology',
      concepts: [
        { name: 'Osmosis', mastery: 0.9, attempts: 5, lastPracticedAt: daysAgo(0), nextReviewAt: daysAhead(7) },
        { name: 'Diffusion' },
      ],
    });
    const step = nextStepAfterSession({
      snapshot: (await snapshotsOf(db, [bio]))[0]!,
      ctx: ctxWith(),
      missed: new Map(),
    });
    expect(step).toMatchObject({ type: 'learn', conceptName: 'Diffusion' });
  });
});
