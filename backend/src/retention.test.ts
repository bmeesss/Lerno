/**
 * Retention layer coverage: streaks, daily goal, upcoming reviews, comeback
 * state, continue-action priority and weekly summaries.
 *
 * Pure scheduling-date logic is tested with fixed dates; service behavior is
 * tested against a seeded in-memory database with an explicit `now`; HTTP
 * tests cover auth, forgery resistance and backward compatibility.
 */
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { createMemoryDatabase, createMemoryState } from './lib/db/memory.js';
import type { Database } from './lib/db/repository.js';
import {
  bucketUpcoming,
  collectActivityDays,
  computeStreaks,
  mondayOf,
  retentionService,
} from './services/retention-service.js';

const app = createApp();

/** Fixed "today": Thursday 2026-03-05, 12:00 UTC (week Mon 03-02 … Sun 03-08). */
const NOW = new Date('2026-03-05T12:00:00.000Z');
const TODAY = '2026-03-05';

async function signup(name: string): Promise<{ token: string; userId: string }> {
  const email = `${name.replace(/[^a-z]/gi, '')}${Date.now()}${Math.floor(
    Math.random() * 1e6,
  )}@example.com`;
  const res = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'password123', displayName: name });
  expect(res.status).toBe(201);
  return {
    token: res.body.data.accessToken as string,
    userId: res.body.data.user.id as string,
  };
}

const auth = (token: string): { Authorization: string } => ({
  Authorization: `Bearer ${token}`,
});

describe('streak calculation', () => {
  it('starts a streak on the first study day', () => {
    expect(computeStreaks(['2026-03-05'], TODAY)).toEqual({
      current: 1,
      longest: 1,
      lastActiveDay: '2026-03-05',
    });
  });

  it('increments on consecutive days', () => {
    expect(computeStreaks(['2026-03-03', '2026-03-04', '2026-03-05'], TODAY)).toEqual({
      current: 3,
      longest: 3,
      lastActiveDay: '2026-03-05',
    });
  });

  it('counts repeated same-day activity once', () => {
    expect(
      computeStreaks(['2026-03-05', '2026-03-05', '2026-03-05'], TODAY).current,
    ).toBe(1);
  });

  it('keeps the streak alive through yesterday', () => {
    expect(computeStreaks(['2026-03-04'], TODAY).current).toBe(1);
  });

  it('resets the current streak after missed days without corruption', () => {
    const streak = computeStreaks(['2026-02-20', '2026-02-21'], TODAY);
    expect(streak.current).toBe(0);
    expect(streak.longest).toBe(2);
    expect(streak.lastActiveDay).toBe('2026-02-21');

    const restarted = computeStreaks(['2026-02-20', '2026-02-21', TODAY], TODAY);
    expect(restarted.current).toBe(1);
    expect(restarted.longest).toBe(2);
  });

  it('tracks the longest run across multiple streaks', () => {
    const streak = computeStreaks(
      ['2026-02-20', '2026-02-21', '2026-02-22', '2026-03-04', '2026-03-05'],
      TODAY,
    );
    expect(streak.current).toBe(2);
    expect(streak.longest).toBe(3);
  });

  it('returns zeros for users with no activity', () => {
    expect(computeStreaks([], TODAY)).toEqual({ current: 0, longest: 0, lastActiveDay: null });
  });
});

describe('activity and upcoming buckets', () => {
  it('counts reviews, attempts and completed sessions only', () => {
    const days = collectActivityDays({
      progress: [
        { lastReviewedAt: '2026-03-05T08:00:00.000Z' },
        { lastReviewedAt: null },
      ] as never,
      attempts: [{ createdAt: '2026-03-03T10:00:00.000Z' }] as never,
      sessions: [
        { startedAt: '2026-03-04T10:00:00.000Z', endedAt: '2026-03-04T10:20:00.000Z', cardsSeen: 5 },
        // Abandoned or empty sessions are not meaningful activity.
        { startedAt: '2026-03-02T10:00:00.000Z', endedAt: null, cardsSeen: 0 },
        { startedAt: '2026-03-01T10:00:00.000Z', endedAt: '2026-03-01T10:01:00.000Z', cardsSeen: 0 },
      ] as never,
    });
    expect([...days].sort()).toEqual(['2026-03-03', '2026-03-04', '2026-03-05']);
  });

  it('buckets upcoming reviews around today', () => {
    expect(
      bucketUpcoming(
        [
          '2026-03-01T00:00:00.000Z', // overdue
          '2026-03-05T12:00:00.000Z', // exactly now
          '2026-03-05T18:00:00.000Z', // later today
          '2026-03-06T09:00:00.000Z', // tomorrow
          '2026-03-08T09:00:00.000Z', // within 7 days
          '2026-04-01T00:00:00.000Z', // beyond the window
          null,
          'not-a-date',
        ],
        NOW,
      ),
    ).toEqual({ dueNow: 2, laterToday: 1, tomorrow: 1, next7Days: 1 });
  });

  it('finds the Monday of any week', () => {
    expect(mondayOf('2026-03-05')).toBe('2026-03-02'); // Thursday
    expect(mondayOf('2026-03-02')).toBe('2026-03-02'); // Monday
    expect(mondayOf('2026-03-08')).toBe('2026-03-02'); // Sunday
  });
});

describe('retention service with seeded data', () => {
  async function seedSet(
    db: Database,
    ownerId: string,
    cardCount: number,
    visibility = 'private',
  ): Promise<{ setId: string; cardIds: string[] }> {
    const set = await db.sets.create({
      ownerId,
      subjectId: null,
      subjectName: null,
      title: 'Retention set',
      slug: `retention-${Math.random().toString(36).slice(2)}`,
      description: '',
      level: '',
      visibility,
      tags: [],
    });
    const cards = await db.cards.createMany(
      set.id,
      Array.from({ length: cardCount }, (_, i) => ({
        question: `q${i}?`,
        answer: `a${i}`,
        position: i,
      })),
    );
    return { setId: set.id, cardIds: cards.map((card) => card.id) };
  }

  async function seedReview(
    db: Database,
    userId: string,
    cardId: string,
    lastReviewedAt: string,
    nextReviewAt: string | null,
  ): Promise<void> {
    await db.progress.upsert({
      userId,
      cardId,
      repetitionCount: 1,
      ease: 2.0,
      lastReviewedAt,
      nextReviewAt,
      correctCount: 1,
      incorrectCount: 0,
    });
  }

  it('reports daily-goal progress for today', async () => {
    const db = createMemoryDatabase(createMemoryState());
    const { cardIds } = await seedSet(db, 'user-goal', 3);
    await seedReview(db, 'user-goal', cardIds[0]!, `${TODAY}T08:00:00.000Z`, '2026-03-06T08:00:00.000Z');
    await seedReview(db, 'user-goal', cardIds[1]!, `${TODAY}T09:00:00.000Z`, '2026-03-06T09:00:00.000Z');
    await seedReview(db, 'user-goal', cardIds[2]!, '2026-03-04T09:00:00.000Z', '2026-03-05T09:00:00.000Z');

    const today = await retentionService.today(db, 'user-goal', NOW);
    expect(today.date).toBe(TODAY);
    expect(today.target).toBe(10);
    expect(today.completedCards).toBe(2);
    expect(today.completionPercentage).toBe(20);
    expect(today.goalReached).toBe(false);
    expect(today.streak.current).toBe(2);
  });

  it('caps the goal percentage without limiting study', async () => {
    const db = createMemoryDatabase(createMemoryState());
    const { cardIds } = await seedSet(db, 'user-unlimited', 12);
    for (const cardId of cardIds) {
      await seedReview(db, 'user-unlimited', cardId, `${TODAY}T08:00:00.000Z`, null);
    }
    const today = await retentionService.today(db, 'user-unlimited', NOW);
    expect(today.completedCards).toBe(12);
    expect(today.completionPercentage).toBe(100);
    expect(today.goalReached).toBe(true);
  });

  it('scopes upcoming reviews to studyable sets', async () => {
    const db = createMemoryDatabase(createMemoryState());
    const mine = await seedSet(db, 'user-upcoming', 5);
    const foreign = await seedSet(db, 'user-other', 1, 'private');
    const times = [
      '2026-03-01T00:00:00.000Z',
      '2026-03-05T18:00:00.000Z',
      '2026-03-06T09:00:00.000Z',
      '2026-03-08T09:00:00.000Z',
      '2026-04-01T00:00:00.000Z',
    ];
    for (let i = 0; i < mine.cardIds.length; i += 1) {
      await seedReview(db, 'user-upcoming', mine.cardIds[i]!, `${TODAY}T08:00:00.000Z`, times[i]!);
    }
    // Overdue card in a set the user can no longer study: excluded.
    await seedReview(db, 'user-upcoming', foreign.cardIds[0]!, '2026-03-01T08:00:00.000Z', '2026-03-01T09:00:00.000Z');

    const today = await retentionService.today(db, 'user-upcoming', NOW);
    expect(today.upcoming).toEqual({ dueNow: 1, laterToday: 1, tomorrow: 1, next7Days: 1 });
    expect(today.cardsDue).toBe(1);
  });

  it('shows a comeback message only after days away', async () => {
    const db = createMemoryDatabase(createMemoryState());
    const { cardIds } = await seedSet(db, 'user-comeback', 1);
    await seedReview(db, 'user-comeback', cardIds[0]!, '2026-02-27T08:00:00.000Z', '2026-02-28T08:00:00.000Z');

    const away = await retentionService.today(db, 'user-comeback', NOW);
    expect(away.streak.current).toBe(0);
    expect(away.comeback).not.toBeNull();
    expect(away.comeback!.awayDays).toBe(6);
    expect(away.comeback!.dueCount).toBe(1);
    expect(away.comeback!.message).toContain('Welcome back');
    expect(away.comeback!.message).not.toMatch(/fail|shame|lost/i);

    // Active users get no comeback message.
    await seedReview(db, 'user-comeback', cardIds[0]!, `${TODAY}T08:00:00.000Z`, null);
    const back = await retentionService.today(db, 'user-comeback', NOW);
    expect(back.comeback).toBeNull();
    expect(back.streak.current).toBe(1);
    expect(back.streak.longest).toBe(1);
  });

  it('prioritizes due reviews first in the continue action', async () => {
    const db = createMemoryDatabase(createMemoryState());
    const { cardIds } = await seedSet(db, 'user-prio', 2);
    await seedReview(db, 'user-prio', cardIds[0]!, '2026-03-04T08:00:00.000Z', '2026-03-04T09:00:00.000Z');

    const today = await retentionService.today(db, 'user-prio', NOW);
    expect(today.continueAction.type).toBe('review');
    if (today.continueAction.type === 'review') {
      expect(today.continueAction.dueCount).toBe(1);
      expect(today.continueAction.setId).toBeTruthy();
    }
  });

  it('falls through the continue-action priority ladder', async () => {
    // Unfinished recent session beats an unfinished set.
    const db = createMemoryDatabase(createMemoryState());
    const { setId, cardIds } = await seedSet(db, 'user-ladder', 2);
    const session = await db.sessions.create({
      userId: 'user-ladder',
      setId,
      startedAt: '2026-03-05T11:00:00.000Z',
    });
    const resumed = await retentionService.today(db, 'user-ladder', NOW);
    expect(resumed.continueAction).toMatchObject({ type: 'continue-session', setId });

    // With the session ended, the unfinished set is next.
    await db.sessions.update(session.id, { endedAt: '2026-03-05T11:30:00.000Z', cardsSeen: 2 });
    const study = await retentionService.today(db, 'user-ladder', NOW);
    expect(study.continueAction).toMatchObject({ type: 'study-set', setId, remaining: 2 });

    // Everything learned but the goal unreached: daily-goal cards.
    for (const cardId of cardIds) {
      await seedReview(db, 'user-ladder', cardId, `${TODAY}T08:00:00.000Z`, '2026-04-01T08:00:00.000Z');
    }
    const goal = await retentionService.today(db, 'user-ladder', NOW);
    expect(goal.continueAction).toMatchObject({ type: 'daily-goal', remaining: 8 });

    // Nothing to do anywhere: discover.
    const emptyWeekUser = await retentionService.today(db, 'user-fresh-sets', NOW);
    expect(emptyWeekUser.continueAction).toEqual({ type: 'create-set' });
  });

  it('summarizes the week deterministically', async () => {
    const db = createMemoryDatabase(createMemoryState());
    const { cardIds } = await seedSet(db, 'user-week', 4);
    await seedReview(db, 'user-week', cardIds[0]!, '2026-03-02T08:00:00.000Z', null);
    await seedReview(db, 'user-week', cardIds[1]!, '2026-03-02T09:00:00.000Z', null);
    await seedReview(db, 'user-week', cardIds[2]!, '2026-03-03T08:00:00.000Z', null);
    await seedReview(db, 'user-week', cardIds[3]!, `${TODAY}T08:00:00.000Z`, null);
    const session = await db.sessions.create({
      userId: 'user-week',
      setId: null,
      startedAt: '2026-03-03T10:00:00.000Z',
    });
    await db.sessions.update(session.id, {
      endedAt: '2026-03-03T10:30:00.000Z',
      cardsSeen: 4,
    });

    const week = await retentionService.week(db, 'user-week', NOW);
    expect(week.weekStart).toBe('2026-03-02');
    expect(week.studyDays).toBe(3);
    expect(week.cardsStudied).toBe(4);
    expect(week.quizzesCompleted).toBe(0);
    expect(week.quizAccuracy).toBeNull();
    expect(week.studyTimeMinutes).toBe(30);
    expect(week.currentStreak).toBe(1);
    expect(week.days).toHaveLength(7);
    expect(week.days[0]).toMatchObject({ day: '2026-03-02', active: true, cardsTouched: 2 });
    expect(week.days[1]).toMatchObject({ day: '2026-03-03', active: true, studyMinutes: 30 });
    expect(week.days[2]).toMatchObject({ day: '2026-03-04', active: false, cardsTouched: 0 });
  });

  it('isolates retention data between users', async () => {
    const db = createMemoryDatabase(createMemoryState());
    const { cardIds } = await seedSet(db, 'user-a', 1);
    await seedReview(db, 'user-a', cardIds[0]!, `${TODAY}T08:00:00.000Z`, null);

    const other = await retentionService.today(db, 'user-b', NOW);
    expect(other.completedCards).toBe(0);
    expect(other.streak).toEqual({ current: 0, longest: 0, lastActiveDay: null });
    expect(other.comeback).toBeNull();

    const otherWeek = await retentionService.week(db, 'user-b', NOW);
    expect(otherWeek.studyDays).toBe(0);
    expect(otherWeek.cardsStudied).toBe(0);
  });
});

describe('retention HTTP API', () => {
  it('requires authentication for today and week', async () => {
    expect((await request(app).get('/api/progress/today')).status).toBe(401);
    expect((await request(app).get('/api/progress/week')).status).toBe(401);
  });

  it('returns zeros and a create-set action for new accounts', async () => {
    const { token } = await signup('RetentionFresh');
    const today = await request(app).get('/api/progress/today').set(auth(token));
    expect(today.status).toBe(200);
    expect(today.body.data.completedCards).toBe(0);
    expect(today.body.data.goalReached).toBe(false);
    expect(today.body.data.streak).toEqual({ current: 0, longest: 0, lastActiveDay: null });
    expect(today.body.data.comeback).toBeNull();
    expect(today.body.data.continueAction).toEqual({ type: 'create-set' });

    const week = await request(app).get('/api/progress/week').set(auth(token));
    expect(week.body.data.studyDays).toBe(0);
    expect(week.body.data.currentStreak).toBe(0);
  });

  it('ignores forged streak and activity fields', async () => {
    const { token } = await signup('RetentionForged');
    const created = await request(app)
      .post('/api/sets')
      .set(auth(token))
      .send({ title: 'Forged set', cards: [{ question: 'q?', answer: 'a' }] });
    const setId = created.body.data.id as string;
    const cardId = (created.body.data.cards as { id: string }[])[0]!.id;

    const review = await request(app)
      .post('/api/study/review')
      .set(auth(token))
      .send({
        setId,
        cardId,
        result: 'correct',
        streak: 99,
        currentStreak: 50,
        longestStreak: 70,
        lastActiveDay: '2020-01-01',
        activityDate: '2020-01-01',
        lastReviewedAt: '2020-01-01T00:00:00.000Z',
      });
    expect(review.status).toBe(200);

    const today = await request(app).get('/api/progress/today').set(auth(token));
    expect(today.body.data.streak.current).toBe(1);
    expect(today.body.data.streak.longest).toBe(1);
    expect(today.body.data.completedCards).toBe(1);

    // Session endpoints accept no activity dates either.
    const session = await request(app)
      .post('/api/study/sessions')
      .set(auth(token))
      .send({ setId, startedAt: '2020-01-01T00:00:00.000Z', endedAt: '2020-01-02T00:00:00.000Z' });
    expect(session.status).toBe(201);
    expect(session.body.data.startedAt.slice(0, 4)).not.toBe('2020');
  });

  it('lets users study unlimited cards beyond the daily goal', async () => {
    const { token } = await signup('RetentionUnlimited');
    const cards = Array.from({ length: 12 }, (_, i) => ({ question: `q${i}?`, answer: `a${i}` }));
    const created = await request(app)
      .post('/api/sets')
      .set(auth(token))
      .send({ title: 'Marathon set', cards });
    const setId = created.body.data.id as string;
    for (const card of created.body.data.cards as { id: string }[]) {
      const res = await request(app)
        .post('/api/study/review')
        .set(auth(token))
        .send({ setId, cardId: card.id, result: 'correct' });
      expect(res.status).toBe(200);
    }

    const today = await request(app).get('/api/progress/today').set(auth(token));
    expect(today.body.data.completedCards).toBe(12);
    expect(today.body.data.completionPercentage).toBe(100);
    expect(today.body.data.goalReached).toBe(true);
  });

  it('counts only completed study activity toward the streak', async () => {
    const { token } = await signup('RetentionMeaningful');
    const created = await request(app)
      .post('/api/sets')
      .set(auth(token))
      .send({ title: 'Meaningful set', cards: [{ question: 'q?', answer: 'a' }] });
    const setId = created.body.data.id as string;

    // Starting a session without studying: no streak.
    const session = await request(app)
      .post('/api/study/sessions')
      .set(auth(token))
      .send({ setId });
    const abandoned = await request(app).get('/api/progress/today').set(auth(token));
    expect(abandoned.body.data.streak.current).toBe(0);

    // Ending it empty-handed: still no streak.
    await request(app)
      .patch(`/api/study/sessions/${session.body.data.id as string}`)
      .set(auth(token))
      .send({ cardsSeen: 0 });
    const empty = await request(app).get('/api/progress/today').set(auth(token));
    expect(empty.body.data.streak.current).toBe(0);

    // One real review: streak day.
    const cardId = (created.body.data.cards as { id: string }[])[0]!.id;
    await request(app)
      .post('/api/study/review')
      .set(auth(token))
      .send({ setId, cardId, result: 'correct' });
    const active = await request(app).get('/api/progress/today').set(auth(token));
    expect(active.body.data.streak.current).toBe(1);
  });

  it('counts a completed quiz toward the streak', async () => {
    const { token } = await signup('RetentionQuizzer');
    const created = await request(app)
      .post('/api/sets')
      .set(auth(token))
      .send({
        title: 'Quiz set',
        cards: [
          { question: 'q1?', answer: 'a1' },
          { question: 'q2?', answer: 'a2' },
        ],
      });
    const setId = created.body.data.id as string;
    const quiz = await request(app).get(`/api/sets/${setId}/quiz`).set(auth(token));
    const answers = (quiz.body.data.questions as { id: string }[]).map((question) => ({
      questionId: question.id,
      answer: 'a1',
    }));
    const attempt = await request(app)
      .post(`/api/sets/${setId}/quiz/attempts`)
      .set(auth(token))
      .send({ answers });
    expect(attempt.status).toBe(200);

    const today = await request(app).get('/api/progress/today').set(auth(token));
    expect(today.body.data.streak.current).toBe(1);
    const week = await request(app).get('/api/progress/week').set(auth(token));
    expect(week.body.data.quizzesCompleted).toBe(1);
  });

  it('keeps /api/progress backward compatible with new streak fields', async () => {
    const { token } = await signup('RetentionCompat');
    const res = await request(app).get('/api/progress').set(auth(token));
    expect(res.status).toBe(200);
    for (const field of [
      'cardsStudied',
      'accuracy',
      'studyTimeMinutes',
      'streakDays',
      'subjectProgress',
      'setProgress',
      'longestStreak',
      'lastActiveDay',
    ]) {
      expect(res.body.data[field]).not.toBeUndefined();
    }
    expect(res.body.data.longestStreak).toBe(0);
    expect(res.body.data.lastActiveDay).toBeNull();
  });

  it('exposes the today summary on the dashboard', async () => {
    const { token } = await signup('RetentionDashboard');
    const res = await request(app).get('/api/dashboard').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.data.today.target).toBe(10);
    expect(res.body.data.today.continueAction.type).toBe('create-set');
    expect(res.body.data.today.streak.current).toBe(0);
  });
});
