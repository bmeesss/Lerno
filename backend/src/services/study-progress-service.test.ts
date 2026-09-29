import { describe, expect, it } from 'vitest';
import { createMemoryDatabase, createMemoryState } from '../lib/db/memory.js';
import type { Database } from '../lib/db/repository.js';
import type {
  LearningSessionResult,
  LearningSessionStat,
  SessionConceptChange,
  StudySessionRecord,
} from '../lib/db/types.js';
import { seedPack } from './pack-fixtures.js';
import {
  buildStudyStreak,
  collectImprovedConcepts,
  collectStudyDays,
  flashcardSessionSeconds,
  studyProgressService,
} from './study-progress-service.js';

const NOW = new Date('2026-09-29T12:00:00.000Z');
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();
const USER = 'student';

function newDb(): Database {
  return createMemoryDatabase(createMemoryState());
}

const stat = (overrides: Partial<LearningSessionStat> = {}): LearningSessionStat => ({
  packId: 'p1',
  type: 'practice',
  status: 'completed',
  answeredCount: 5,
  durationSeconds: 300,
  completedAt: NOW.toISOString(),
  lastActivityAt: NOW.toISOString(),
  ...overrides,
});

const flash = (overrides: Partial<StudySessionRecord> = {}): StudySessionRecord => ({
  id: 'f1',
  userId: USER,
  setId: 's1',
  startedAt: daysAgo(0),
  endedAt: NOW.toISOString(),
  cardsSeen: 10,
  ...overrides,
});

describe('study streak', () => {
  it('counts only completed sessions that answered something', () => {
    const days = collectStudyDays(
      {
        sessions: [
          stat({ completedAt: daysAgo(0) }),
          stat({ status: 'active', completedAt: null }), // open, not a streak
          stat({ status: 'abandoned', completedAt: null }),
          stat({ answeredCount: 0, completedAt: daysAgo(1) }), // opened and left
        ],
        flashcardSessions: [flash({ endedAt: null }), flash({ cardsSeen: 0, endedAt: daysAgo(2) })],
      },
      'UTC',
    );
    expect([...days]).toEqual(['2026-09-29']);
  });

  it('counts a finished flashcard session too, and builds a run from consecutive days', () => {
    const days = collectStudyDays(
      {
        sessions: [stat({ completedAt: daysAgo(0) }), stat({ completedAt: daysAgo(1) })],
        flashcardSessions: [flash({ endedAt: daysAgo(2) })],
      },
      'UTC',
    );
    const streak = buildStudyStreak(days, '2026-09-29');
    expect(streak).toMatchObject({ current: 3, longest: 3, todayDone: true });
  });

  it('keeps the streak alive until the end of the next day, then resets it', () => {
    const yesterday = collectStudyDays(
      { sessions: [stat({ completedAt: daysAgo(1) })], flashcardSessions: [] },
      'UTC',
    );
    expect(buildStudyStreak(yesterday, '2026-09-29')).toMatchObject({
      current: 1,
      todayDone: false,
    });
    const lastWeek = collectStudyDays(
      { sessions: [stat({ completedAt: daysAgo(5) })], flashcardSessions: [] },
      'UTC',
    );
    expect(buildStudyStreak(lastWeek, '2026-09-29')).toMatchObject({ current: 0, longest: 1 });
  });

  it("groups days by the student's timezone", () => {
    const late = {
      sessions: [stat({ completedAt: '2026-09-29T23:30:00.000Z' })],
      flashcardSessions: [],
    };
    expect([...collectStudyDays(late, 'UTC')]).toEqual(['2026-09-29']);
    expect([...collectStudyDays(late, 'Europe/Amsterdam')]).toEqual(['2026-09-30']);
  });

  it('caps a flashcard session at half an hour because it has no idle tracking', () => {
    expect(
      flashcardSessionSeconds(
        flash({ startedAt: '2026-09-29T11:50:00.000Z', endedAt: '2026-09-29T12:00:00.000Z' }),
      ),
    ).toBe(600);
    expect(
      flashcardSessionSeconds(
        flash({ startedAt: '2026-09-29T08:00:00.000Z', endedAt: '2026-09-29T12:00:00.000Z' }),
      ),
    ).toBe(1800);
    expect(flashcardSessionSeconds(flash({ endedAt: null }))).toBe(0);
    expect(flashcardSessionSeconds(flash({ cardsSeen: 0 }))).toBe(0);
  });
});

describe('improved concepts', () => {
  /** Only the before and after matter here; the answer counts are filled in. */
  type Change = Pick<SessionConceptChange, 'conceptId' | 'name' | 'beforePercent' | 'afterPercent'>;
  const result = (changes: Change[]): { completedAt: string; result: LearningSessionResult } => ({
    completedAt: NOW.toISOString(),
    result: {
      kind: 'practice',
      total: 5,
      answered: 5,
      correct: 3,
      partial: 0,
      incorrect: 2,
      percent: 60,
      concepts: changes.map((change) => ({ ...change, answered: 1, correct: 1, incorrect: 0 })),
      weakConcepts: [],
      next: null,
    } as unknown as LearningSessionResult,
  });

  it('reports the net change per concept across sessions, largest first', () => {
    const improved = collectImprovedConcepts([
      {
        ...result([{ conceptId: 'a', name: 'Osmosis', beforePercent: 42, afterPercent: 50 }]),
        completedAt: daysAgo(3),
      },
      {
        ...result([
          { conceptId: 'a', name: 'Osmosis', beforePercent: 50, afterPercent: 61 },
          { conceptId: 'b', name: 'Diffusion', beforePercent: 10, afterPercent: 12 },
        ]),
        completedAt: daysAgo(1),
      },
    ]);
    expect(improved).toEqual([
      { conceptId: 'a', name: 'Osmosis', beforePercent: 42, afterPercent: 61, changePercent: 19 },
    ]);
  });

  it('ignores drops and tiny moves', () => {
    expect(
      collectImprovedConcepts([
        result([{ conceptId: 'a', name: 'A', beforePercent: 50, afterPercent: 40 }]),
      ]),
    ).toEqual([]);
  });
});

describe('progress overview', () => {
  async function setup() {
    const db = newDb();
    const bio = await seedPack(db, USER, {
      title: 'Biology',
      subject: { id: 'sub-bio', name: 'Biology' },
      concepts: [
        { name: 'Osmosis', mastery: 0.9, attempts: 5, lastPracticedAt: daysAgo(1) },
        { name: 'Diffusion', mastery: 0.2, attempts: 3, lastPracticedAt: daysAgo(1) },
      ],
    });
    return { db, bio };
  }

  it('is an honest empty state for a student without any activity', async () => {
    const db = newDb();
    const overview = await studyProgressService.overview(db, USER, NOW);
    expect(overview.hasActivity).toBe(false);
    expect(overview.overall).toMatchObject({
      masteryPercent: null,
      studySeconds: 0,
      questionsAnswered: 0,
      cardsReviewed: 0,
      testsCompleted: 0,
      recentImprovement: null,
    });
    expect(overview.streak).toMatchObject({ current: 0, todayDone: false });
    expect(overview.packs).toEqual([]);
  });

  it('reports real totals: time from sessions, exact question counts, concept counts', async () => {
    const { db, bio } = await setup();
    const session = await db.learningSessions.create({
      userId: USER,
      packId: bio.pack.id,
      type: 'practice',
      status: 'active',
      title: 'Practice Biology',
      itemCount: 3,
      startedAt: NOW.toISOString(),
    });
    await db.learningSessions.update(session.id, {
      status: 'completed',
      answeredCount: 3,
      durationSeconds: 540,
      completedAt: new Date().toISOString(),
    });
    await db.practiceAttempts.createMany(
      bio.questions.slice(0, 4).map((question) => ({
        userId: USER,
        packId: bio.pack.id,
        questionId: question.id,
        conceptId: question.conceptId,
        answer: 'x',
        verdict: 'incorrect' as const,
      })),
    );

    const overview = await studyProgressService.overview(db, USER, new Date());
    expect(overview.hasActivity).toBe(true);
    expect(overview.overall).toMatchObject({
      studySeconds: 540,
      studyMinutes: 9,
      questionsAnswered: 4,
      sessionsCompleted: 1,
      conceptsTotal: 2,
      conceptsMastered: 1,
      conceptsWeak: 1,
      masteryPercent: 55,
    });
    const pack = overview.packs[0]!;
    expect(pack).toMatchObject({ title: 'Biology', masteryPercent: 55, sessionsCompleted: 1 });
    expect(pack.weakConcepts.map((c) => c.name)).toEqual(['Diffusion']);
    expect(pack.strongConcepts.map((c) => c.name)).toEqual(['Osmosis']);
    expect(overview.streak).toMatchObject({ current: 1, todayDone: true });
  });

  it('shows no trend and no recent improvement without enough real data', async () => {
    const { db, bio } = await setup();
    await db.masterySnapshots.upsertMany([
      {
        userId: USER,
        packId: bio.pack.id,
        day: '2026-09-28',
        masteryPercent: 40,
        conceptsTotal: 2,
        weakConcepts: 1,
        masteredConcepts: 0,
      },
    ]);
    const overview = await studyProgressService.overview(db, USER, NOW);
    expect(overview.packs[0]!.trend).toMatchObject({
      hasEnoughData: false,
      points: [],
      daysRecorded: 2,
    });
    // One stored day plus today's live value are two real days: a change, but too little for a line.
    expect(overview.overall.recentImprovement).toEqual({
      changePercent: 15,
      windowDays: 14,
      packs: 1,
    });
  });

  it('draws the trend from three or more real days', async () => {
    const { db, bio } = await setup();
    await db.masterySnapshots.upsertMany(
      [
        ['2026-09-26', 30],
        ['2026-09-27', 40],
        ['2026-09-28', 50],
      ].map(([day, masteryPercent]) => ({
        userId: USER,
        packId: bio.pack.id,
        day: day as string,
        masteryPercent: masteryPercent as number,
        conceptsTotal: 2,
        weakConcepts: 1,
        masteredConcepts: 0,
      })),
    );
    const trend = (await studyProgressService.overview(db, USER, NOW)).packs[0]!.trend;
    expect(trend.hasEnoughData).toBe(true);
    expect(trend.points.map((point) => point.masteryPercent)).toEqual([30, 40, 50, 55]);
    expect(trend).toMatchObject({ changePercent: 25, direction: 'up' });
  });

  it("never mixes in another student's data", async () => {
    const { db } = await setup();
    const other = await studyProgressService.overview(db, 'someone-else', NOW);
    expect(other.packs).toEqual([]);
    expect(other.hasActivity).toBe(false);
  });
});

describe('subject overview', () => {
  it("shows the subject's packs, weak concepts, exams and the best next step", async () => {
    const db = newDb();
    const subject = await db.subjects.create({ ownerId: USER, name: 'Biology' });
    const other = await db.subjects.create({ ownerId: USER, name: 'History' });
    await seedPack(db, USER, {
      title: 'Cells',
      subject: { id: subject.id, name: 'Biology' },
      examDate: '2026-10-06',
      questionsPerConcept: 2,
      concepts: [
        {
          name: 'Osmosis',
          mastery: 0.2,
          attempts: 3,
          lastPracticedAt: daysAgo(1),
          nextReviewAt: daysAgo(-1),
        },
      ],
    });
    await seedPack(db, USER, {
      title: 'Genetics',
      subject: { id: subject.id, name: 'Biology' },
      concepts: [{ name: 'DNA' }],
    });
    await seedPack(db, USER, {
      title: 'Rome',
      subject: { id: other.id, name: 'History' },
      concepts: [{ name: 'Republic' }],
    });

    const overview = await studyProgressService.subjectOverview(db, USER, subject.id, NOW);
    expect(overview.subject).toEqual({ id: subject.id, name: 'Biology' });
    expect(overview.packs.map((pack) => pack.title).sort()).toEqual(['Cells', 'Genetics']);
    expect(overview.totals).toMatchObject({ packs: 2, concepts: 2, weakConcepts: 1 });
    expect(overview.exams).toEqual([
      { packId: expect.any(String), title: 'Cells', examDate: '2026-10-06', daysLeft: 7 },
    ]);
    const cells = overview.packs.find((pack) => pack.title === 'Cells')!;
    expect(cells.weakConcepts.map((c) => c.name)).toEqual(['Osmosis']);
    expect(cells.next).toMatchObject({ packTitle: 'Cells' });
    // The subject's CTA is the engine's best activity across its packs (the exam pack wins).
    expect(overview.next).toMatchObject({ packTitle: 'Cells' });
  });

  it('answers 404 for a subject that is not yours', async () => {
    const db = newDb();
    const subject = await db.subjects.create({ ownerId: USER, name: 'Biology' });
    await expect(
      studyProgressService.subjectOverview(db, 'someone-else', subject.id, NOW),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      studyProgressService.subjectOverview(db, USER, 'missing', NOW),
    ).rejects.toMatchObject({ status: 404 });
  });
});
