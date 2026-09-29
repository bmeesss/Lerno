/**
 * Study sessions: create / resume / answer / complete, adaptive selection, Learn,
 * Test analysis and "Review mistakes" — through the real HTTP surface with the
 * in-memory database, and without Groq: every rule in here is deterministic.
 */
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { config } from './config.js';
import {
  RIGHT,
  WRONG,
  answerItem,
  auth,
  completeSession,
  createPack,
  getSession,
  memoryDb,
  rateItem,
  setMastery,
  signup,
  startSession,
  type SessionItem,
  type Student,
  type TestPack,
} from './test-helpers/study-experience.js';

const { createCompletion } = vi.hoisted(() => ({ createCompletion: vi.fn() }));

vi.mock('groq-sdk', () => {
  class Groq {
    chat = { completions: { create: createCompletion } };
    constructor(_options: unknown) {}
  }
  return { default: Groq };
});

const mutableConfig = config as unknown as { groqApiKey: string };
const app = createApp();

beforeEach(() => {
  mutableConfig.groqApiKey = 'test-groq-key';
  createCompletion.mockReset();
});

async function ready(options: Parameters<typeof createPack>[2] = {}) {
  const student = await signup(app);
  const pack = await createPack(app, student, options);
  return { student, pack };
}

const conceptId = (pack: TestPack, name: string) => pack.concepts.find((c) => c.name === name)!.id;

/** Answers every open question item of a session with `pick(item)`. */
async function answerAll(
  student: Student,
  sessionId: string,
  items: SessionItem[],
  pick: (item: SessionItem, index: number) => string,
) {
  for (const [index, item] of items.entries()) {
    await answerItem(app, student, sessionId, item.id, pick(item, index));
  }
}

describe('study sessions: create, resume, complete', () => {
  it('creates an active practice session with server-side items and no solutions', async () => {
    const { student, pack } = await ready();
    const { session, resumed } = await startSession(app, student, {
      packId: pack.id,
      type: 'practice',
    });

    expect(resumed).toBe(false);
    expect(session).toMatchObject({
      type: 'practice',
      status: 'active',
      label: 'Biology Practice',
      itemCount: 10,
      answeredCount: 0,
      currentPosition: 0,
      hideFeedback: false,
    });
    expect(session.progress).toEqual({
      position: 1,
      total: 10,
      answered: 0,
      skipped: 0,
      percent: 0,
    });
    expect(session.items).toHaveLength(10);

    const first = session.items[0]!;
    expect(first.question!.options).toEqual([RIGHT, WRONG, 'Wrong B']);
    expect(first.feedback).toBeNull();
    // Nothing about the solution before answering.
    const raw = JSON.stringify(session);
    expect(raw).not.toContain('correctAnswer');
    expect(raw).not.toContain('Because that is how');
  });

  it('is idempotent: a second start resumes the same session, restart abandons it', async () => {
    const { student, pack } = await ready();
    const first = await startSession(app, student, { packId: pack.id, type: 'practice' });
    const again = await startSession(app, student, { packId: pack.id, type: 'practice' }, 200);
    expect(again.resumed).toBe(true);
    expect(again.session.id).toBe(first.session.id);

    const fresh = await startSession(app, student, {
      packId: pack.id,
      type: 'practice',
      restart: true,
    });
    expect(fresh.resumed).toBe(false);
    expect(fresh.session.id).not.toBe(first.session.id);
    expect((await getSession(app, student, first.session.id)).status).toBe('abandoned');
  });

  it('keeps different kinds of sessions apart (a focus concept is its own session)', async () => {
    const { student, pack } = await ready();
    const general = await startSession(app, student, { packId: pack.id, type: 'practice' });
    const focused = await startSession(app, student, {
      packId: pack.id,
      type: 'practice',
      conceptId: conceptId(pack, 'Osmosis'),
    });
    expect(focused.session.id).not.toBe(general.session.id);
    const learn = await startSession(app, student, { packId: pack.id, type: 'learn' });
    expect(learn.session.id).not.toBe(general.session.id);
  });

  it('can be created without starting and starts on demand', async () => {
    const { student, pack } = await ready();
    const { session } = await startSession(app, student, {
      packId: pack.id,
      type: 'practice',
      start: false,
    });
    expect(session.status).toBe('not_started');
    const started = await request(app)
      .post(`/api/study-sessions/${session.id}/start`)
      .set(auth(student.token));
    expect(started.status).toBe(200);
    expect(started.body.data.session.status).toBe('active');
    expect(started.body.data.session.durationSeconds).toBe(0);
  });

  it('survives a reload: answers, progress and position come back from the server', async () => {
    const { student, pack } = await ready();
    const { session } = await startSession(app, student, { packId: pack.id, type: 'practice' });
    for (const item of session.items.slice(0, 5)) {
      await answerItem(app, student, session.id, item.id, RIGHT);
    }

    const reloaded = await getSession(app, student, session.id);
    expect(reloaded.answeredCount).toBe(5);
    expect(reloaded.currentPosition).toBe(5);
    expect(reloaded.progress).toMatchObject({ position: 6, answered: 5, total: 10, percent: 50 });
    expect(reloaded.items.filter((item) => item.status === 'answered')).toHaveLength(5);
    expect(reloaded.items[0]!.feedback).toMatchObject({ verdict: 'correct', correctAnswer: RIGHT });
    expect(reloaded.items[5]!.feedback).toBeNull();

    // The resume card: "Biology Practice — Question 6 of 10".
    const active = await request(app).get('/api/study-sessions/active').set(auth(student.token));
    expect(active.body.data.sessions).toEqual([
      expect.objectContaining({
        sessionId: session.id,
        label: 'Biology Practice',
        positionLabel: 'Question 6 of 10',
        position: 6,
        total: 10,
      }),
    ]);
  });

  it('shows the resume card on My Study as well', async () => {
    const { student, pack } = await ready();
    const { session } = await startSession(app, student, { packId: pack.id, type: 'practice' });
    for (const item of session.items.slice(0, 5))
      await answerItem(app, student, session.id, item.id, RIGHT);
    const today = await request(app).get('/api/study-packs/today').set(auth(student.token));
    expect(today.body.data.resume[0]).toMatchObject({
      label: 'Biology Practice',
      positionLabel: 'Question 6 of 10',
    });
    // An open session is what "Continue studying" leads back to.
    expect(today.body.data.primary).toMatchObject({ type: 'continue', sessionId: session.id });
  });

  it('completes with a stored result: score, concept change, still weak and the next step', async () => {
    const { student, pack } = await ready({ questionsPerConcept: 3 });
    const osmosis = conceptId(pack, 'Osmosis');
    await setMastery(student.id, osmosis, 0.42, { attempts: 4 });

    const { session } = await startSession(app, student, {
      packId: pack.id,
      type: 'practice',
      conceptId: osmosis,
      count: 5,
    });
    // Two right, then wrong on the rest.
    await answerAll(student, session.id, session.items, (_, index) => (index < 2 ? RIGHT : WRONG));

    const done = await completeSession(app, student, session.id);
    expect(done.status).toBe('completed');
    expect(done.result).toMatchObject({
      total: 5,
      answered: 5,
      correct: 2,
      incorrect: 3,
      percent: 40,
    });
    const osmosisChange = done.result!.concepts.find((change) => change.name === 'Osmosis')!;
    expect(osmosisChange.beforePercent).toBe(42);
    // The focus concept has three questions: right, right, wrong = 0.42 + 0.2 + 0.2 − 0.15.
    expect(osmosisChange.afterPercent).toBe(67);
    // Three questions were missed (one on Osmosis, two on other concepts): the weakest of them is next.
    expect(done.result!.next).toMatchObject({
      type: 'practice',
      description: 'You missed 1 question on it.',
    });
    expect(done.result!.next.conceptName).not.toBeNull();
    expect(done.durationSeconds).toBeGreaterThanOrEqual(0);

    // The result is stored on the server: a reload shows the same summary.
    const reloaded = await getSession(app, student, session.id);
    expect(reloaded.result).toEqual(done.result);
  });

  it('completing twice is safe and returns the stored result', async () => {
    const { student, pack } = await ready();
    const { session } = await startSession(app, student, {
      packId: pack.id,
      type: 'practice',
      count: 3,
    });
    await answerAll(student, session.id, session.items, () => RIGHT);
    const first = await completeSession(app, student, session.id);
    const second = await completeSession(app, student, session.id);
    expect(second.result).toEqual(first.result);
  });

  it('refuses to finish empty-handed, and to answer once finished or abandoned', async () => {
    const { student, pack } = await ready();
    const { session } = await startSession(app, student, {
      packId: pack.id,
      type: 'practice',
      count: 3,
    });
    await completeSession(app, student, session.id, {}, 400);

    await answerItem(app, student, session.id, session.items[0]!.id, RIGHT);
    await completeSession(app, student, session.id);
    await answerItem(app, student, session.id, session.items[1]!.id, RIGHT, 409);
    const abandon = await request(app)
      .post(`/api/study-sessions/${session.id}/abandon`)
      .set(auth(student.token));
    expect(abandon.status).toBe(409);

    const other = await startSession(app, student, {
      packId: pack.id,
      type: 'practice',
      restart: true,
    });
    const left = await request(app)
      .post(`/api/study-sessions/${other.session.id}/abandon`)
      .set(auth(student.token));
    expect(left.status).toBe(200);
    expect(left.body.data.session.status).toBe('abandoned');
    await answerItem(app, student, other.session.id, other.session.items[0]!.id, RIGHT, 409);
  });

  it('keeps answers given before abandoning: mastery is never silently lost', async () => {
    const { student, pack } = await ready();
    const { session } = await startSession(app, student, {
      packId: pack.id,
      type: 'practice',
      count: 4,
    });
    await answerItem(app, student, session.id, session.items[0]!.id, RIGHT);
    await request(app).post(`/api/study-sessions/${session.id}/abandon`).set(auth(student.token));
    const rows = await memoryDb().conceptMastery.listByUserAndPack(student.id, pack.id);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.attempts).toBe(1);
  });

  it('skips a question without touching mastery', async () => {
    const { student, pack } = await ready();
    const { session } = await startSession(app, student, {
      packId: pack.id,
      type: 'practice',
      count: 3,
    });
    const res = await request(app)
      .post(`/api/study-sessions/${session.id}/items/${session.items[0]!.id}/skip`)
      .set(auth(student.token));
    expect(res.status).toBe(200);
    expect(res.body.data.item.status).toBe('skipped');
    expect(res.body.data.progress).toMatchObject({ skipped: 1, position: 2 });
    expect(await memoryDb().conceptMastery.listByUserAndPack(student.id, pack.id)).toEqual([]);
  });
});

describe('practice: instant feedback and mastery', () => {
  it('returns verdict, solution, explanation, concept, provenance and the mastery change', async () => {
    const { student, pack } = await ready();
    const osmosis = conceptId(pack, 'Osmosis');
    await setMastery(student.id, osmosis, 0.42, { attempts: 4 });
    const { session } = await startSession(app, student, {
      packId: pack.id,
      type: 'practice',
      conceptId: osmosis,
      count: 3,
    });

    const result = await answerItem(app, student, session.id, session.items[0]!.id, RIGHT);
    expect(result.item.feedback).toMatchObject({
      verdict: 'correct',
      correctAnswer: RIGHT,
      explanation: 'Because that is how Osmosis works.',
      masteryBeforePercent: 42,
      masteryAfterPercent: 62,
    });
    expect(result.item.conceptName).toBe('Osmosis');
    expect(result.item.feedback!.source).toMatchObject({ title: 'Biology.md', ref: 'section 2' });
    expect(result.progress).toMatchObject({ answered: 1, position: 2 });

    const wrong = await answerItem(app, student, session.id, session.items[1]!.id, WRONG);
    expect(wrong.item.feedback).toMatchObject({
      verdict: 'incorrect',
      masteryBeforePercent: 62,
      masteryAfterPercent: 47,
    });
  });

  it('never counts an answer twice', async () => {
    const { student, pack } = await ready();
    const { session } = await startSession(app, student, {
      packId: pack.id,
      type: 'practice',
      count: 3,
    });
    const item = session.items[0]!;
    const first = await answerItem(app, student, session.id, item.id, RIGHT);
    const second = await answerItem(app, student, session.id, item.id, WRONG);
    expect(second.item.feedback).toEqual(first.item.feedback);

    const db = memoryDb();
    const rows = await db.conceptMastery.listByUserAndPack(student.id, pack.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.attempts).toBe(1);
    expect(await db.practiceAttempts.countByUser(student.id)).toBe(1);
  });

  it('writes attempts and learning events that point back to the session', async () => {
    const { student, pack } = await ready();
    const { session } = await startSession(app, student, {
      packId: pack.id,
      type: 'practice',
      count: 2,
    });
    await answerItem(app, student, session.id, session.items[0]!.id, RIGHT);
    const events = await memoryDb().learningEvents.listByUser(student.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ eventType: 'practice', isCorrect: true });
    expect(events[0]!.metadata).toMatchObject({ sessionId: session.id, sessionType: 'practice' });
  });

  it('accepts an option index like the classic practice endpoint, and shows the chosen text', async () => {
    const { student, pack } = await ready();
    const { session } = await startSession(app, student, {
      packId: pack.id,
      type: 'practice',
      count: 2,
    });
    const res = await answerItem(app, student, session.id, session.items[0]!.id, '0');
    expect(res.item.feedback!.verdict).toBe('correct');
    expect(res.item.answer).toBe(RIGHT);
  });
});

describe('adaptive selection', () => {
  it('starts with the weak concept, not the mastered one', async () => {
    const { student, pack } = await ready();
    await setMastery(student.id, conceptId(pack, 'Osmosis'), 0.1, { attempts: 4 });
    await setMastery(student.id, conceptId(pack, 'Mitosis'), 0.95, { attempts: 8 });
    await setMastery(student.id, conceptId(pack, 'Diffusion'), 0.9, { attempts: 6 });
    await setMastery(student.id, conceptId(pack, 'Meiosis'), 0.9, { attempts: 6 });

    const { session } = await startSession(app, student, {
      packId: pack.id,
      type: 'practice',
      count: 6,
    });
    const names = session.items.map((item) => item.conceptName);
    expect(names.slice(0, 3)).toEqual(['Osmosis', 'Osmosis', 'Osmosis']);
    // Diversity: the weak concept does not take every seat while others wait.
    expect(names.filter((name) => name === 'Osmosis').length).toBeLessThan(6);
  });

  it('does not repeat questions from the last session while there are fresh ones', async () => {
    const { student, pack } = await ready({ questionsPerConcept: 4 });
    const first = await startSession(app, student, { packId: pack.id, type: 'practice', count: 8 });
    const seen = new Set(first.session.items.map((item) => item.question!.id));
    await answerAll(student, first.session.id, first.session.items, () => RIGHT);
    await completeSession(app, student, first.session.id);

    const second = await startSession(app, student, {
      packId: pack.id,
      type: 'practice',
      count: 8,
    });
    const overlap = second.session.items.filter((item) => seen.has(item.question!.id));
    // 16 questions exist: the second session takes the 8 unseen ones.
    expect(overlap).toHaveLength(0);
  });

  it('asks a missed question again the next day, before an unseen one — not straight away', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-09-29T10:00:00.000Z'));
      const { student, pack } = await ready({ questionsPerConcept: 3 });
      const osmosis = conceptId(pack, 'Osmosis');
      const first = await startSession(app, student, {
        packId: pack.id,
        type: 'practice',
        conceptId: osmosis,
        count: 1,
      });
      const missed = first.session.items[0]!.question!.id;
      await answerItem(app, student, first.session.id, first.session.items[0]!.id, WRONG);
      await completeSession(app, student, first.session.id);

      // Straight away the student has just seen the explanation: a fresh question comes first.
      const soon = await startSession(app, student, {
        packId: pack.id,
        type: 'practice',
        conceptId: osmosis,
        count: 1,
      });
      expect(soon.session.items[0]!.question!.id).not.toBe(missed);
      await request(app)
        .post(`/api/study-sessions/${soon.session.id}/abandon`)
        .set(auth(student.token));

      // Two days later the missed question is the one worth asking again.
      vi.setSystemTime(new Date('2026-10-01T10:00:00.000Z'));
      const later = await startSession(app, student, {
        packId: pack.id,
        type: 'practice',
        conceptId: osmosis,
        count: 1,
      });
      expect(later.session.items[0]!.question!.id).toBe(missed);
    } finally {
      vi.useRealTimers();
    }
  });

  it('puts the requested concept first and validates it', async () => {
    const { student, pack } = await ready();
    const meiosis = conceptId(pack, 'Meiosis');
    const { session } = await startSession(app, student, {
      packId: pack.id,
      type: 'practice',
      conceptId: meiosis,
      count: 5,
    });
    expect(session.items[0]!.conceptId).toBe(meiosis);
    expect(
      session.items.filter((item) => item.conceptId === meiosis).length,
    ).toBeGreaterThanOrEqual(3);

    const unknown = await request(app)
      .post('/api/study-sessions')
      .set(auth(student.token))
      .send({
        packId: pack.id,
        type: 'practice',
        conceptId: '11111111-1111-4111-8111-111111111111',
      });
    expect(unknown.status).toBe(404);
  });

  it('refuses a concept without practice questions instead of practising something else', async () => {
    const { student, pack } = await ready();
    const extra = await request(app)
      .post(`/api/study-packs/${pack.id}/content`)
      .set(auth(student.token))
      .send({
        target: 'concepts',
        concepts: [{ name: 'Enzymes', explanation: 'Proteins that speed up reactions.' }],
      });
    const enzymes = extra.body.data.concepts[0].id as string;
    const res = await request(app)
      .post('/api/study-sessions')
      .set(auth(student.token))
      .send({ packId: pack.id, type: 'practice', conceptId: enzymes });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/no practice questions/);
  });

  it('a review session only contains concepts that are due, and says so when none are', async () => {
    const { student, pack } = await ready({ questionsPerConcept: 3 });
    const empty = await request(app)
      .post('/api/study-sessions')
      .set(auth(student.token))
      .send({ packId: pack.id, type: 'review' });
    expect(empty.status).toBe(400);

    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const lastWeek = new Date(Date.now() - 8 * 86_400_000).toISOString();
    await setMastery(student.id, conceptId(pack, 'Diffusion'), 0.7, {
      attempts: 4,
      nextReviewAt: yesterday,
      lastPracticedAt: lastWeek,
    });
    const { session } = await startSession(app, student, { packId: pack.id, type: 'review' });
    expect(session.label).toBe('Biology Review');
    expect(new Set(session.items.map((item) => item.conceptName))).toEqual(new Set(['Diffusion']));
  });

  it('previews what the session would contain, without creating anything', async () => {
    const { student, pack } = await ready();
    await setMastery(student.id, conceptId(pack, 'Osmosis'), 0.1, { attempts: 4 });
    const res = await request(app)
      .get('/api/study-sessions/preview')
      .query({ packId: pack.id, type: 'practice' })
      .set(auth(student.token));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      title: 'Practice Biology',
      count: 10,
      minutes: 12,
      canStart: true,
      focus: { label: 'Focus: weak concepts' },
      resume: null,
    });
    expect(res.body.data.concepts.map((c: { name: string }) => c.name)).toContain('Osmosis');
    expect(res.body.data.concepts[0]).toMatchObject({
      name: 'Osmosis',
      masteryPercent: 10,
      reason: 'weak',
    });
    expect(res.body.data.difficulty).toMatch(/easy|medium|hard/);
    // Previews never write.
    const active = await request(app).get('/api/study-sessions/active').set(auth(student.token));
    expect(active.body.data.sessions).toEqual([]);

    await startSession(app, student, { packId: pack.id, type: 'practice' });
    const again = await request(app)
      .get('/api/study-sessions/preview')
      .query({ packId: pack.id, type: 'practice' })
      .set(auth(student.token));
    expect(again.body.data.resume).toMatchObject({ label: 'Biology Practice' });
  });
});

describe('learn sessions', () => {
  it('goes weak → new and gives each concept an explanation, an example and a check', async () => {
    const { student, pack } = await ready({ questionsPerConcept: 2 });
    await setMastery(student.id, conceptId(pack, 'Meiosis'), 0.1, { attempts: 3 });
    await setMastery(student.id, conceptId(pack, 'Mitosis'), 0.95, { attempts: 6 });

    const { session } = await startSession(app, student, {
      packId: pack.id,
      type: 'learn',
      count: 3,
    });
    expect(session.label).toBe('Biology Learn');
    expect(session.items.map((item) => [item.conceptName, item.learn!.reason])).toEqual([
      ['Meiosis', 'weak'],
      ['Osmosis', 'new'],
      ['Diffusion', 'new'],
    ]);

    const osmosis = session.items.find((item) => item.conceptName === 'Osmosis')!;
    expect(osmosis.learn!.explanation).toBe('Osmosis in one clear sentence.');
    // The example comes from the student's own material, not from a model.
    expect(osmosis.learn!.example).toMatchObject({ kind: 'source', sourceTitle: 'Biology.md' });
    expect(osmosis.learn!.example!.text).toMatch(/raisin swells/);
    expect(osmosis.question).toMatchObject({ questionType: 'multiple_choice' });
    expect(osmosis.feedback).toBeNull();
    expect(JSON.stringify(osmosis)).not.toContain('correctAnswer');
    expect(createCompletion).not.toHaveBeenCalled();
  });

  it('runs check → self-rating and moves mastery with both', async () => {
    const { student, pack } = await ready({ questionsPerConcept: 2 });
    const { session } = await startSession(app, student, {
      packId: pack.id,
      type: 'learn',
      count: 2,
    });
    const item = session.items[0]!;

    const checked = await answerItem(app, student, session.id, item.id, RIGHT);
    expect(checked.item.feedback).toMatchObject({
      verdict: 'correct',
      masteryBeforePercent: 0,
      masteryAfterPercent: 20,
    });
    // The concept is only finished by its self-rating.
    expect(checked.item.status).toBe('pending');
    expect(checked.progress.answered).toBe(0);

    const rated = await rateItem(app, student, session.id, item.id, 'good');
    expect(rated.item.status).toBe('answered');
    expect(rated.item.rating).toBe('good');
    expect(rated.item.feedback).toMatchObject({ masteryBeforePercent: 0, masteryAfterPercent: 35 });
    expect(rated.progress).toMatchObject({ answered: 1, position: 2 });

    const stored = (await memoryDb().conceptMastery.listByUserAndPack(student.id, pack.id))[0]!;
    expect(stored.mastery).toBe(0.35);
    expect(stored.attempts).toBe(2);

    // Rating again does not count twice.
    await rateItem(app, student, session.id, item.id, 'again');
    const after = (await memoryDb().conceptMastery.listByUserAndPack(student.id, pack.id))[0]!;
    expect(after.mastery).toBe(0.35);
  });

  it('"again" leaves a concept weak; a right check plus "easy" lifts another — the summary says which', async () => {
    const { student, pack } = await ready({ questionsPerConcept: 1 });
    const { session } = await startSession(app, student, {
      packId: pack.id,
      type: 'learn',
      count: 2,
    });
    const [again, easy] = session.items as [SessionItem, SessionItem];
    await rateItem(app, student, session.id, again.id, 'again');
    await answerItem(app, student, session.id, easy.id, RIGHT);
    await rateItem(app, student, session.id, easy.id, 'easy');
    const done = await completeSession(app, student, session.id);

    expect(done.result!.answered).toBe(2);
    expect(done.result!.stillWeak.map((entry) => entry.name)).toEqual([again.conceptName]);
    const changes = done.result!.concepts.map((change) => [
      change.name,
      change.beforePercent,
      change.afterPercent,
    ]);
    expect(changes).toContainEqual([again.conceptName, 0, 0]);
    // +0.2 for the check, +0.25 for the rating.
    expect(changes).toContainEqual([easy.conceptName, 0, 45]);
  });

  it('works for concepts without a practice question (no check step)', async () => {
    const student = await signup(app);
    const pack = await createPack(app, student, { concepts: ['Osmosis'], questionsPerConcept: 1 });
    const extra = await request(app)
      .post(`/api/study-packs/${pack.id}/content`)
      .set(auth(student.token))
      .send({
        target: 'concepts',
        concepts: [{ name: 'Enzymes', explanation: 'Speed up reactions.' }],
      });
    expect(extra.status).toBe(201);
    const { session } = await startSession(app, student, {
      packId: pack.id,
      type: 'learn',
      count: 5,
    });
    const enzymes = session.items.find((item) => item.conceptName === 'Enzymes')!;
    expect(enzymes.question).toBeNull();
    const rated = await rateItem(app, student, session.id, enzymes.id, 'good');
    expect(rated.item.status).toBe('answered');
  });
});

describe('tests: no feedback until the end, then a full analysis', () => {
  async function testSession(student: Student, pack: TestPack, mode = 'quick10') {
    return startSession(app, student, { packId: pack.id, type: 'test', mode });
  }

  it('hides every hint while the test runs and answers in batches', async () => {
    const { student, pack } = await ready({ questionsPerConcept: 3 });
    const { session } = await testSession(student, pack);
    expect(session).toMatchObject({
      type: 'test',
      mode: 'quick10',
      hideFeedback: true,
      itemCount: 10,
    });

    const raw = JSON.stringify(session);
    for (const forbidden of [
      'correctAnswer',
      'explanation',
      'verdict',
      'masteryAfter',
      'masteryBefore',
      'Because that is how',
    ]) {
      expect(raw).not.toContain(forbidden);
    }
    expect(session.items.every((item) => item.feedback === null)).toBe(true);

    // The instant-feedback endpoint is closed for tests.
    await answerItem(app, student, session.id, session.items[0]!.id, RIGHT, 400);

    // One request saves many answers, and says nothing about correctness.
    const saved = await request(app)
      .put(`/api/study-sessions/${session.id}/answers`)
      .set(auth(student.token))
      .send({
        answers: session.items.slice(0, 6).map((item) => ({ itemId: item.id, answer: RIGHT })),
        currentPosition: 6,
      });
    expect(saved.status).toBe(200);
    expect(saved.body.data.saved).toBe(6);
    expect(saved.body.data.progress).toMatchObject({ answered: 6, position: 7, total: 10 });
    expect(JSON.stringify(saved.body.data)).not.toMatch(/verdict|correct/i);

    // Mid-test the server still reveals nothing, but remembers the student's own answers.
    const midway = await getSession(app, student, session.id);
    expect(midway.hideFeedback).toBe(true);
    expect(midway.items[0]!.answer).toBe(RIGHT);
    expect(midway.items[0]!.feedback).toBeNull();
    expect(JSON.stringify(midway)).not.toContain('correctAnswer');
    // Nothing was graded: mastery is untouched until the test is handed in.
    expect(await memoryDb().conceptMastery.listByUserAndPack(student.id, pack.id)).toEqual([]);
    expect(midway.currentPosition).toBe(6);
  });

  it('grades everything at the end: "18 / 25"-style score, known well vs needs practice, next step', async () => {
    const { student, pack } = await ready({ questionsPerConcept: 3 });
    const osmosis = conceptId(pack, 'Osmosis');
    const { session } = await testSession(student, pack, 'quick10');

    // Osmosis: all wrong. Everything else: right. Two questions stay unanswered.
    const answers = session.items.slice(0, 8).map((item) => ({
      itemId: item.id,
      answer: item.conceptId === osmosis ? WRONG : RIGHT,
    }));
    const done = await completeSession(app, student, session.id, { answers });
    const result = done.result!;

    expect(done.status).toBe('completed');
    expect(done.hideFeedback).toBe(false);
    expect(result.total).toBe(10);
    // Right answers minus the unanswered ones; every miss (wrong or blank) is incorrect.
    expect(result.correct + result.incorrect).toBe(10);
    expect(result.percent).toBe(Math.round((result.correct / 10) * 100));
    expect(result.needsPractice.map((entry) => entry.name)).toContain('Osmosis');
    expect(result.needsPractice.find((entry) => entry.name === 'Osmosis')!.percent).toBe(0);
    expect(result.knownWell.every((entry) => entry.percent >= 75)).toBe(true);
    expect(result.next).toMatchObject({
      type: 'practice',
      conceptName: 'Osmosis',
      label: 'Practice Osmosis',
    });
    expect(result.next.description).toMatch(/You missed \d+ questions? on it/);
    expect(result.testAttemptId).toBeTruthy();

    // Now — and only now — the feedback is visible.
    expect(done.items[0]!.feedback).not.toBeNull();
    const reloaded = await getSession(app, student, session.id);
    expect(reloaded.items.some((item) => item.feedback?.correctAnswer === RIGHT)).toBe(true);
  });

  it('stores the attempt where the classic flow keeps it and updates mastery in one batch', async () => {
    const { student, pack } = await ready({ questionsPerConcept: 3 });
    const { session } = await testSession(student, pack, 'quick10');
    const answers = session.items.map((item) => ({ itemId: item.id, answer: RIGHT }));
    const done = await completeSession(app, student, session.id, { answers });
    expect(done.result).toMatchObject({ correct: 10, incorrect: 0, percent: 100 });

    const attempts = await request(app)
      .get(`/api/study-packs/${pack.id}/tests`)
      .set(auth(student.token));
    expect(attempts.body.data.attempts).toHaveLength(1);
    expect(attempts.body.data.attempts[0]).toMatchObject({ total: 10, correctCount: 10 });
    const rows = await memoryDb().conceptMastery.listByUserAndPack(student.id, pack.id);
    expect(rows.length).toBe(4);
    const events = await memoryDb().learningEvents.listByUser(student.id);
    expect(events.filter((event) => event.eventType === 'test')).toHaveLength(10);
    expect(events[0]!.metadata).toMatchObject({ sessionId: session.id });
  });

  it('scores a blank test as unfinished work instead of failing every concept', async () => {
    const { student, pack } = await ready({ questionsPerConcept: 3 });
    const { session } = await testSession(student, pack);
    await completeSession(app, student, session.id, {}, 400);
    expect(await memoryDb().conceptMastery.listByUserAndPack(student.id, pack.id)).toEqual([]);
  });

  it('offers 10 questions, 20 questions and an exam simulation', async () => {
    const { student, pack } = await ready({ questionsPerConcept: 4 }); // 16 questions
    const preview = await request(app)
      .get('/api/study-sessions/preview')
      .query({ packId: pack.id, type: 'test' })
      .set(auth(student.token));
    expect(
      preview.body.data.modes.map((mode: { mode: string; count: number }) => [
        mode.mode,
        mode.count,
      ]),
    ).toEqual([
      ['quick10', 10],
      ['quick20', 16],
      ['exam', 16],
    ]);
    const exam = await testSession(student, pack, 'exam');
    expect(exam.session).toMatchObject({
      mode: 'exam',
      label: 'Biology Exam simulation',
      itemCount: 16,
    });
  });

  it('needs three questions, and only the owner can take a test', async () => {
    const student = await signup(app);
    const thin = await createPack(app, student, { concepts: ['Osmosis'], questionsPerConcept: 2 });
    const tooFew = await request(app)
      .post('/api/study-sessions')
      .set(auth(student.token))
      .send({ packId: thin.id, type: 'test' });
    expect(tooFew.status).toBe(400);

    const owner = await signup(app);
    const shared = await createPack(app, owner, { visibility: 'public' });
    const guest = await signup(app);
    const denied = await request(app)
      .post('/api/study-sessions')
      .set(auth(guest.token))
      .send({ packId: shared.id, type: 'test' });
    expect([403, 404]).toContain(denied.status);
    // Anyone who can see a public pack can practise it, with their own sessions.
    const practice = await startSession(app, guest, {
      packId: shared.id,
      type: 'practice',
      count: 3,
    });
    expect(practice.session.status).toBe('active');
    // The session says who owns the pack, so the app can hide owner-only actions (AI Tutor).
    expect((practice.session as unknown as { isOwner: boolean }).isOwner).toBe(false);
  });
});

describe('review mistakes', () => {
  it('lists only the wrong questions with everything needed to learn from them', async () => {
    const { student, pack } = await ready({ questionsPerConcept: 3 });
    const { session } = await startSession(app, student, {
      packId: pack.id,
      type: 'practice',
      count: 6,
    });
    await answerAll(student, session.id, session.items, (_, index) =>
      index % 3 === 0 ? WRONG : RIGHT,
    );
    await completeSession(app, student, session.id);

    const res = await request(app)
      .get(`/api/study-sessions/${session.id}/mistakes`)
      .set(auth(student.token));
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(2);
    const [first] = res.body.data.mistakes;
    expect(first).toMatchObject({
      verdict: 'incorrect',
      yourAnswer: WRONG,
      correctAnswer: RIGHT,
      concept: { name: expect.any(String) },
      source: { title: 'Biology.md' },
    });
    expect(first.explanation).toMatch(/Because that is how/);
    expect(first.question.prompt).toMatch(/Which statement about/);
    // Only wrong questions: every listed prompt belongs to a wrong item.
    const wrongPrompts = session.items
      .filter((_, index) => index % 3 === 0)
      .map((item) => item.question!.prompt);
    expect(
      res.body.data.mistakes.map((m: { question: { prompt: string } }) => m.question.prompt).sort(),
    ).toEqual(wrongPrompts.sort());
  });

  it('works for a finished test, counts unanswered questions, and is closed while the test runs', async () => {
    const { student, pack } = await ready({ questionsPerConcept: 3 });
    const { session } = await startSession(app, student, {
      packId: pack.id,
      type: 'test',
      mode: 'quick10',
    });
    const during = await request(app)
      .get(`/api/study-sessions/${session.id}/mistakes`)
      .set(auth(student.token));
    expect(during.status).toBe(409);

    const answers = session.items
      .slice(0, 4)
      .map((item, index) => ({ itemId: item.id, answer: index === 0 ? WRONG : RIGHT }));
    await completeSession(app, student, session.id, { answers });
    const res = await request(app)
      .get(`/api/study-sessions/${session.id}/mistakes`)
      .set(auth(student.token));
    // 1 wrong answer + 6 unanswered questions.
    expect(res.body.data.total).toBe(7);
    const blank = res.body.data.mistakes.find((m: { yourAnswer: string }) => m.yourAnswer === '');
    expect(blank).toMatchObject({ verdict: 'incorrect', correctAnswer: RIGHT });
  });

  it('is empty after a perfect session', async () => {
    const { student, pack } = await ready();
    const { session } = await startSession(app, student, {
      packId: pack.id,
      type: 'practice',
      count: 3,
    });
    await answerAll(student, session.id, session.items, () => RIGHT);
    await completeSession(app, student, session.id);
    const res = await request(app)
      .get(`/api/study-sessions/${session.id}/mistakes`)
      .set(auth(student.token));
    expect(res.body.data).toMatchObject({ total: 0, mistakes: [] });
  });
});

describe('study sessions: permissions', () => {
  it("never shows, changes or completes another student's session", async () => {
    const { student, pack } = await ready();
    const { session } = await startSession(app, student, {
      packId: pack.id,
      type: 'practice',
      count: 3,
    });
    const intruder = await signup(app);
    const item = session.items[0]!;

    const attempts = [
      request(app).get(`/api/study-sessions/${session.id}`).set(auth(intruder.token)),
      request(app).post(`/api/study-sessions/${session.id}/start`).set(auth(intruder.token)),
      request(app)
        .post(`/api/study-sessions/${session.id}/items/${item.id}/answer`)
        .set(auth(intruder.token))
        .send({ answer: RIGHT }),
      request(app)
        .post(`/api/study-sessions/${session.id}/items/${item.id}/rating`)
        .set(auth(intruder.token))
        .send({ rating: 'good' }),
      request(app)
        .post(`/api/study-sessions/${session.id}/items/${item.id}/skip`)
        .set(auth(intruder.token)),
      request(app)
        .put(`/api/study-sessions/${session.id}/answers`)
        .set(auth(intruder.token))
        .send({ answers: [] }),
      request(app)
        .post(`/api/study-sessions/${session.id}/complete`)
        .set(auth(intruder.token))
        .send({}),
      request(app).post(`/api/study-sessions/${session.id}/abandon`).set(auth(intruder.token)),
      request(app).get(`/api/study-sessions/${session.id}/mistakes`).set(auth(intruder.token)),
    ];
    for (const response of await Promise.all(attempts)) expect(response.status).toBe(404);

    // The owner's session is untouched.
    const still = await getSession(app, student, session.id);
    expect(still.status).toBe('active');
    expect(still.answeredCount).toBe(0);
    const active = await request(app).get('/api/study-sessions/active').set(auth(intruder.token));
    expect(active.body.data.sessions).toEqual([]);
  });

  it('cannot start a session on a private pack that is not yours', async () => {
    const { student, pack } = await ready();
    const intruder = await signup(app);
    for (const type of ['learn', 'practice', 'review', 'test'] as const) {
      const res = await request(app)
        .post('/api/study-sessions')
        .set(auth(intruder.token))
        .send({ packId: pack.id, type });
      expect([403, 404]).toContain(res.status);
    }
    const preview = await request(app)
      .get('/api/study-sessions/preview')
      .query({ packId: pack.id, type: 'practice' })
      .set(auth(intruder.token));
    expect([403, 404]).toContain(preview.status);
    expect(student.id).not.toBe(intruder.id);
  });

  it('rejects an item that belongs to a different session of the same student', async () => {
    const { student, pack } = await ready();
    const a = await startSession(app, student, { packId: pack.id, type: 'practice', count: 3 });
    const b = await startSession(app, student, { packId: pack.id, type: 'learn', count: 2 });
    const res = await request(app)
      .post(`/api/study-sessions/${a.session.id}/items/${b.session.items[0]!.id}/answer`)
      .set(auth(student.token))
      .send({ answer: RIGHT });
    expect(res.status).toBe(404);
  });

  it('stops serving a session once the pack is no longer visible to its student', async () => {
    const owner = await signup(app);
    const pack = await createPack(app, owner, { visibility: 'public' });
    const guest = await signup(app);
    const { session } = await startSession(app, guest, {
      packId: pack.id,
      type: 'practice',
      count: 3,
    });
    const hide = await request(app)
      .patch(`/api/study-packs/${pack.id}`)
      .set(auth(owner.token))
      .send({ visibility: 'private' });
    expect(hide.status).toBe(200);
    const res = await request(app).get(`/api/study-sessions/${session.id}`).set(auth(guest.token));
    expect(res.status).toBe(404);
  });

  it('requires a signed-in student and valid input', async () => {
    const { student, pack } = await ready();
    expect((await request(app).get('/api/study-sessions/active')).status).toBe(401);
    expect(
      (await request(app).post('/api/study-sessions').send({ packId: pack.id, type: 'practice' }))
        .status,
    ).toBe(401);
    expect((await request(app).get('/api/progress/study')).status).toBe(401);

    const post = (body: unknown) =>
      request(app)
        .post('/api/study-sessions')
        .set(auth(student.token))
        .send(body as object);
    expect((await post({ packId: 'nope', type: 'practice' })).status).toBe(400);
    expect((await post({ packId: pack.id, type: 'exam' })).status).toBe(400);
    expect((await post({ packId: pack.id, type: 'practice', count: 500 })).status).toBe(400);
    expect((await post({ packId: pack.id, type: 'test', mode: 'sprint' })).status).toBe(400);
    expect(
      (await request(app).get('/api/study-sessions/not-a-uuid').set(auth(student.token))).status,
    ).toBe(400);

    const { session } = await startSession(app, student, {
      packId: pack.id,
      type: 'practice',
      count: 2,
    });
    const empty = await request(app)
      .post(`/api/study-sessions/${session.id}/items/${session.items[0]!.id}/answer`)
      .set(auth(student.token))
      .send({ answer: '   ' });
    expect(empty.status).toBe(400);
  });
});

describe('study sessions work without AI and in single requests', () => {
  it('never calls the model for any session flow', async () => {
    const { student, pack } = await ready({ questionsPerConcept: 3 });
    const learn = await startSession(app, student, { packId: pack.id, type: 'learn', count: 2 });
    await rateItem(app, student, learn.session.id, learn.session.items[0]!.id, 'good');
    const practice = await startSession(app, student, {
      packId: pack.id,
      type: 'practice',
      count: 3,
    });
    await answerAll(student, practice.session.id, practice.session.items, () => RIGHT);
    await completeSession(app, student, practice.session.id);
    const test = await startSession(app, student, {
      packId: pack.id,
      type: 'test',
      mode: 'quick10',
    });
    await completeSession(app, student, test.session.id, {
      answers: test.session.items.map((item) => ({ itemId: item.id, answer: RIGHT })),
    });
    await request(app).get('/api/study-packs/today').set(auth(student.token));
    await request(app).get('/api/progress/study').set(auth(student.token));
    expect(createCompletion).not.toHaveBeenCalled();
  });

  it('returns a whole session in one request, including every item', async () => {
    const { student, pack } = await ready({ questionsPerConcept: 4 });
    const { session } = await startSession(app, student, {
      packId: pack.id,
      type: 'practice',
      count: 12,
    });
    const res = await request(app)
      .get(`/api/study-sessions/${session.id}`)
      .set(auth(student.token));
    expect(res.body.data.session.items).toHaveLength(12);
    expect(res.body.data.session.items.every((item: SessionItem) => item.question?.prompt)).toBe(
      true,
    );
  });
});
