import { describe, expect, it } from 'vitest';
import { createMemoryDatabase, createMemoryState } from '../lib/db/memory.js';
import type { Database } from '../lib/db/repository.js';
import { seedPack, type SeededPack } from '../test-helpers/pack-fixtures.js';
import { studySessionService } from './study-session-service.js';

// Nothing in a session is a transaction: every write is its own request to the database. These
// tests drop one request half-way through answering, rating or finishing, let the student retry,
// and check that the retry does not count the same answer twice.

const NOW = new Date('2026-09-29T12:00:00.000Z');
const USER = 'student';
const RIGHT = 'Right';
const WRONG = 'Wrong one';

function newDb(): Database {
  return createMemoryDatabase(createMemoryState());
}

/** A database whose first call to `repo.method` fails, like a dropped request. */
function failingOnce(db: Database, repo: keyof Database, method: string) {
  let armed = true;
  let fired = false;
  const wrapped = new Proxy(db, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (prop !== repo || typeof value !== 'object' || value === null) return value;
      return new Proxy(value, {
        get(inner, name, innerReceiver) {
          const member = Reflect.get(inner, name, innerReceiver) as unknown;
          if (name !== method || typeof member !== 'function') return member;
          return (...args: unknown[]) => {
            if (armed) {
              armed = false;
              fired = true;
              return Promise.reject(new Error('connection dropped'));
            }
            return (member as (...a: unknown[]) => unknown).apply(inner, args);
          };
        },
      });
    },
  });
  return { db: wrapped as Database, fired: () => fired };
}

const BIOLOGY = {
  title: 'Biology',
  questionsPerConcept: 3,
  concepts: [
    { name: 'Osmosis', mastery: 0.5, attempts: 3 },
    { name: 'Diffusion', mastery: 0.3, attempts: 3 },
    { name: 'Mitosis', mastery: 0.6, attempts: 3 },
  ],
};

async function masteryByName(db: Database, seeded: SeededPack) {
  const rows = await db.conceptMastery.listByUser(USER);
  return Object.fromEntries(
    seeded.concepts.map((concept) => [
      concept.name,
      Number(
        ((rows.find((row) => row.conceptId === concept.id)?.mastery ?? 0) as number).toFixed(6),
      ),
    ]),
  );
}

describe('answering a question that is retried after a failure', () => {
  it('counts the mastery change once', async () => {
    const db = newDb();
    const seeded = await seedPack(db, USER, BIOLOGY);
    const { session } = await studySessionService.create(
      db,
      USER,
      { packId: seeded.pack.id, type: 'practice', count: 3 },
      NOW,
    );
    const first = (await db.learningSessionItems.listBySession(session.id))[0]!;
    const conceptId = (await db.practiceQuestions.get(first.questionId!))!.conceptId!;
    const before = (await db.conceptMastery.get(USER, conceptId))!.mastery;

    // The request dies after the mastery change, while the attempt is being written.
    const flaky = failingOnce(db, 'practiceAttempts', 'create');
    await expect(
      studySessionService.answer(flaky.db, USER, session.id, first.id, { answer: RIGHT }, NOW),
    ).rejects.toThrow('connection dropped');
    expect(flaky.fired()).toBe(true);
    const afterFailure = (await db.conceptMastery.get(USER, conceptId))!.mastery;
    expect(afterFailure).toBeCloseTo(before + 0.2, 5);

    const retry = await studySessionService.answer(
      flaky.db,
      USER,
      session.id,
      first.id,
      { answer: RIGHT },
      NOW,
    );
    expect(retry.item.feedback).toMatchObject({ verdict: 'correct' });
    expect((await db.conceptMastery.get(USER, conceptId))!.mastery).toBe(afterFailure);
  });

  it('keeps the first verdict, even if the retry sends another answer', async () => {
    const db = newDb();
    const seeded = await seedPack(db, USER, BIOLOGY);
    const { session } = await studySessionService.create(
      db,
      USER,
      { packId: seeded.pack.id, type: 'practice', count: 3 },
      NOW,
    );
    const first = (await db.learningSessionItems.listBySession(session.id))[0]!;
    const flaky = failingOnce(db, 'learningEvents', 'create');
    await expect(
      studySessionService.answer(flaky.db, USER, session.id, first.id, { answer: RIGHT }, NOW),
    ).rejects.toThrow('connection dropped');

    const retry = await studySessionService.answer(
      flaky.db,
      USER,
      session.id,
      first.id,
      { answer: WRONG },
      NOW,
    );
    expect(retry.item.feedback).toMatchObject({ verdict: 'correct' });
  });
});

describe('rating a concept that is retried after a failure', () => {
  it('counts the self-rating once', async () => {
    const db = newDb();
    const seeded = await seedPack(db, USER, BIOLOGY);
    const { session } = await studySessionService.create(
      db,
      USER,
      { packId: seeded.pack.id, type: 'learn', count: 2 },
      NOW,
    );
    const first = (await db.learningSessionItems.listBySession(session.id))[0]!;
    const before = (await db.conceptMastery.get(USER, first.conceptId!))!.mastery;

    const flaky = failingOnce(db, 'learningEvents', 'create');
    await expect(
      studySessionService.rate(flaky.db, USER, session.id, first.id, { rating: 'good' }, NOW),
    ).rejects.toThrow('connection dropped');
    const afterFailure = (await db.conceptMastery.get(USER, first.conceptId!))!.mastery;
    expect(afterFailure).toBeCloseTo(before + 0.15, 5);

    const retry = await studySessionService.rate(
      flaky.db,
      USER,
      session.id,
      first.id,
      { rating: 'good' },
      NOW,
    );
    expect(retry.item.rating).toBe('good');
    expect((await db.conceptMastery.get(USER, first.conceptId!))!.mastery).toBe(afterFailure);
  });
});

describe('finishing a test that is retried after a failure', () => {
  /** The same answers every time: the first two questions of each concept right, the rest wrong. */
  async function startTest(db: Database) {
    const seeded = await seedPack(db, USER, BIOLOGY);
    const { session } = await studySessionService.create(
      db,
      USER,
      { packId: seeded.pack.id, type: 'test', mode: 'quick10' },
      NOW,
    );
    const items = await db.learningSessionItems.listBySession(session.id);
    const answers = await Promise.all(
      items.map(async (item) => {
        const question = (await db.practiceQuestions.get(item.questionId!))!;
        return {
          itemId: item.id,
          answer: /question [12]\?$/.test(question.prompt) ? RIGHT : WRONG,
        };
      }),
    );
    return { seeded, session, items, answers };
  }

  /** What finishing gives without any failure: the numbers a retry has to end up with. */
  async function control() {
    const db = newDb();
    const { seeded, session, answers } = await startTest(db);
    const done = await studySessionService.complete(db, USER, session.id, { answers }, NOW);
    return {
      mastery: await masteryByName(db, seeded),
      percent: done.session.result!.percent,
      correct: done.session.result!.correct,
      total: done.session.result!.total,
    };
  }

  async function trail(db: Database, sessionId: string, packId: string) {
    const events = (await db.learningEvents.listByUser(USER)).filter(
      (event) => event.eventType === 'test' && event.metadata['sessionId'] === sessionId,
    );
    return {
      events: events.length,
      attempts: (await db.testAttempts.listByUserAndPack(USER, packId)).length,
    };
  }

  it.each([
    ['testAttempts', 'create'],
    ['learningEvents', 'createMany'],
    ['packs', 'update'],
  ] as const)('counts every answer once when %s.%s fails the first time', async (repo, method) => {
    const expected = await control();
    const db = newDb();
    const { seeded, session, answers, items } = await startTest(db);
    const flaky = failingOnce(db, repo, method);

    await expect(
      studySessionService.complete(flaky.db, USER, session.id, { answers }, NOW),
    ).rejects.toThrow('connection dropped');
    expect(flaky.fired()).toBe(true);
    // The test is graded and its mastery change is in, but the session is still open.
    expect(await masteryByName(db, seeded)).toEqual(expected.mastery);
    expect((await db.learningSessions.get(session.id))!.status).toBe('active');

    const done = await studySessionService.complete(flaky.db, USER, session.id, { answers }, NOW);
    expect(done.session.status).toBe('completed');
    expect(done.session.result).toMatchObject({
      percent: expected.percent,
      correct: expected.correct,
      total: expected.total,
    });
    // Mastery was not applied a second time, and each record exists exactly once.
    expect(await masteryByName(db, seeded)).toEqual(expected.mastery);
    expect(await trail(db, session.id, seeded.pack.id)).toEqual({
      events: items.length,
      attempts: 1,
    });
  });

  it('keeps the answers the test was graded on, whatever the retry sends', async () => {
    const expected = await control();
    const db = newDb();
    const { seeded, session, answers } = await startTest(db);
    const flaky = failingOnce(db, 'testAttempts', 'create');
    await expect(
      studySessionService.complete(flaky.db, USER, session.id, { answers }, NOW),
    ).rejects.toThrow('connection dropped');

    const allWrong = answers.map((entry) => ({ ...entry, answer: WRONG }));
    const done = await studySessionService.complete(
      flaky.db,
      USER,
      session.id,
      { answers: allWrong },
      NOW,
    );
    expect(done.session.result).toMatchObject({ percent: expected.percent });
    expect(await masteryByName(db, seeded)).toEqual(expected.mastery);
  });

  it('returns the stored result when the test was already finished', async () => {
    const db = newDb();
    const { session, answers } = await startTest(db);
    const first = await studySessionService.complete(db, USER, session.id, { answers }, NOW);
    const again = await studySessionService.complete(db, USER, session.id, { answers }, NOW);
    expect(again.session.result).toEqual(first.session.result);
  });
});
