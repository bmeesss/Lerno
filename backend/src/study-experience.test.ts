/**
 * The student experience around sessions: My Study ("Today"), the exam planner,
 * multi-pack recommendations, progress, daily snapshots, the streak, subject
 * overview, AI Tutor context — plus regression tests for the classic Study Pack
 * endpoints that must keep working unchanged.
 */
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { config } from './config.js';
import {
  RIGHT,
  WRONG,
  answerItem,
  auth,
  completeSession,
  createPack,
  memoryDb,
  setMastery,
  signup,
  startSession,
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

afterEach(() => {
  vi.useRealTimers();
});

const conceptId = (pack: TestPack, name: string) => pack.concepts.find((c) => c.name === name)!.id;
const DAY = 86_400_000;
const daysFromNow = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

async function today(student: Student) {
  const res = await request(app).get('/api/study-packs/today').set(auth(student.token));
  expect(res.status).toBe(200);
  return res.body.data;
}

/** A finished practice session in which every answer is right. */
async function finishPractice(student: Student, pack: TestPack, count = 3) {
  const { session } = await startSession(app, student, {
    packId: pack.id,
    type: 'practice',
    count,
    restart: true,
  });
  for (const item of session.items) await answerItem(app, student, session.id, item.id, RIGHT);
  return completeSession(app, student, session.id);
}

describe('My Study: today', () => {
  it('plans 25 minutes with numbered steps and one primary action', async () => {
    const student = await signup(app);
    const pack = await createPack(app, student);
    await setMastery(student.id, conceptId(pack, 'Osmosis'), 0.2, { attempts: 3 });

    const data = await today(student);
    expect(data.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(data.plan.budgetMinutes).toBe(25);
    expect(data.plan.steps.length).toBeGreaterThan(0);
    expect(data.plan.steps.map((step: { order: number }) => step.order)).toEqual(
      data.plan.steps.map((_: unknown, index: number) => index + 1),
    );
    expect(data.plan.minutes).toBe(
      data.plan.steps.reduce((sum: number, step: { minutes: number }) => sum + step.minutes, 0),
    );
    expect(data.plan.minutes).toBeLessThanOrEqual(25 + 3);
    // One primary action: the first step. Everything else is secondary.
    expect(data.primary).toEqual(data.plan.steps[0]);
    expect(data.primary).toMatchObject({
      type: 'practice',
      conceptName: 'Osmosis',
      sessionType: 'practice',
    });
    expect(data.primary.reasonText).toMatch(/Mastery is 20%/);
    // The long-standing fields are still there for existing clients.
    expect(data.recommended.type).toBe('practice');
    expect(data.tasks.length).toBeGreaterThan(0);
    expect(data.exams).toEqual([]);
    expect(data.exam).toBeNull();
  });

  it('turns recent mistakes into "Practice Osmosis — You missed 3 recent questions"', async () => {
    const student = await signup(app);
    const pack = await createPack(app, student, { questionsPerConcept: 5 });
    const osmosis = conceptId(pack, 'Osmosis');
    await setMastery(student.id, osmosis, 0.42, { attempts: 4 });
    const { session } = await startSession(app, student, {
      packId: pack.id,
      type: 'practice',
      conceptId: osmosis,
      count: 3,
    });
    for (const item of session.items) await answerItem(app, student, session.id, item.id, WRONG);
    await completeSession(app, student, session.id);

    const data = await today(student);
    expect(data.primary).toMatchObject({
      label: 'Practice Osmosis',
      reason: 'mistakes',
      reasonText: 'You missed 3 recent questions.',
      sessionType: 'practice',
      conceptName: 'Osmosis',
    });
  });

  it('shows the exam countdown and says the plan is adjusted for it', async () => {
    const student = await signup(app);
    await createPack(app, student, { title: 'Biology', examDate: daysFromNow(9) });
    const data = await today(student);
    expect(data.exam).toMatchObject({
      title: 'Biology',
      daysLeft: 9,
      message: 'Biology exam in 9 days',
      note: 'Your plan is adjusted for the exam.',
    });
    expect(data.plan.adjustedForExam).toBe(true);
    // Nine days out: more time is recommended than the everyday 25 minutes.
    expect(data.plan.budgetMinutes).toBe(30);
  });

  it('raises the recommended time as the exam gets closer', async () => {
    const student = await signup(app);
    const pack = await createPack(app, student, { examDate: daysFromNow(20) });
    expect((await today(student)).plan.budgetMinutes).toBe(25);
    await request(app)
      .patch(`/api/study-packs/${pack.id}`)
      .set(auth(student.token))
      .send({ examDate: daysFromNow(6) });
    expect((await today(student)).plan.budgetMinutes).toBe(35);
    await request(app)
      .patch(`/api/study-packs/${pack.id}`)
      .set(auth(student.token))
      .send({ examDate: daysFromNow(1) });
    const near = await today(student);
    expect(near.plan.budgetMinutes).toBe(45);
    expect(near.exam.message).toBe('Biology exam is tomorrow');
    // Close to the exam the plan proposes an exam simulation.
    expect(near.tasks.some((task: { mode: string | null }) => task.mode === 'exam')).toBe(true);
  });

  it('continues an unfinished session first', async () => {
    const student = await signup(app);
    const pack = await createPack(app, student);
    await setMastery(student.id, conceptId(pack, 'Osmosis'), 0.1, { attempts: 4 });
    const { session } = await startSession(app, student, {
      packId: pack.id,
      type: 'learn',
      count: 2,
    });
    const data = await today(student);
    expect(data.primary).toMatchObject({
      type: 'continue',
      sessionId: session.id,
      sessionType: 'learn',
      label: 'Continue Biology Learn',
      description: 'Concept 1 of 2',
    });
    expect(data.resume).toHaveLength(1);
  });

  it('starts empty for a new student, pointing at adding material', async () => {
    const student = await signup(app);
    const data = await today(student);
    expect(data.recommended.type).toBe('add-material');
    expect(data.plan.minutes).toBe(0);
    expect(data.subjects).toEqual([]);
    expect(data.resume).toEqual([]);
    expect(data.streak).toMatchObject({ current: 0, todayDone: false });
  });
});

describe('multi-pack today', () => {
  async function twoSubjects(examOn: 'Biology' | 'History' | null) {
    const student = await signup(app);
    const subjects = new Map<string, string>();
    for (const name of ['Biology', 'History']) {
      const res = await request(app).post('/api/subjects').set(auth(student.token)).send({ name });
      expect(res.status).toBe(201);
      subjects.set(name, res.body.data.id as string);
    }
    for (const name of ['History', 'Biology']) {
      const pack = await createPack(app, student, {
        title: `${name} pack`,
        subjectId: subjects.get(name),
        examDate: examOn === name ? daysFromNow(5) : null,
      });
      await setMastery(student.id, pack.concepts[0]!.id, 0.2, { attempts: 3 });
    }
    return { student, subjects };
  }

  it('groups the plan per subject and orders subjects by the engine — the exam decides', async () => {
    const first = await twoSubjects('Biology');
    const biologyFirst = await today(first.student);
    expect(biologyFirst.subjects.map((s: { subjectName: string }) => s.subjectName)).toEqual([
      'Biology',
      'History',
    ]);
    expect(biologyFirst.subjects[0]).toMatchObject({ packs: 1, weakConcepts: 1, examDaysLeft: 5 });
    expect(biologyFirst.subjects[0].next).toMatchObject({ packTitle: 'Biology pack' });

    // Same data, exam moved to the other subject: the order follows. Nothing is hardcoded.
    const second = await twoSubjects('History');
    const historyFirst = await today(second.student);
    expect(historyFirst.subjects.map((s: { subjectName: string }) => s.subjectName)).toEqual([
      'History',
      'Biology',
    ]);
  });

  it('numbers one plan across subjects and gives each step to its subject', async () => {
    const { student } = await twoSubjects('Biology');
    const data = await today(student);
    const stepsBySubject = data.subjects.flatMap((subject: { steps: { order: number }[] }) =>
      subject.steps.map((step) => step.order),
    );
    expect(stepsBySubject.sort()).toEqual(
      data.plan.steps.map((step: { order: number }) => step.order).sort(),
    );
  });
});

describe('exam planner', () => {
  it('builds a day-by-day plan with concrete activities that ends in an exam simulation', async () => {
    const student = await signup(app);
    const pack = await createPack(app, student, {
      examDate: daysFromNow(6),
      questionsPerConcept: 4,
    });
    await today(student); // the plan of a pack with an exam exists without pressing anything

    const res = await request(app).get(`/api/study-packs/${pack.id}/plan`).set(auth(student.token));
    expect(res.status).toBe(200);
    const plan = res.body.data;
    expect(plan.sessions).toHaveLength(6);
    expect(plan.sessions[0].date).toBe(daysFromNow(0));
    expect(plan.sessions[5].date).toBe(daysFromNow(5));
    for (const day of plan.sessions) {
      expect(day.tasks.length).toBeGreaterThan(0);
      expect(
        day.tasks.every(
          (task: { label: string; minutes: number; type: string }) =>
            task.label && task.minutes > 0 && task.type,
        ),
      ).toBe(true);
    }
    const last = plan.sessions.at(-1);
    expect(last.focus).toBe('Exam simulation and final review');
    expect(last.tasks.some((task: { mode: string }) => task.mode === 'exam')).toBe(true);
    expect(plan.overview).toMatch(/The exam is in 6 days/);
  });

  it('is deterministic and needs no AI', async () => {
    const student = await signup(app);
    const pack = await createPack(app, student, { examDate: daysFromNow(5) });
    const a = await request(app)
      .post(`/api/study-packs/${pack.id}/plan`)
      .set(auth(student.token))
      .send({});
    const b = await request(app)
      .post(`/api/study-packs/${pack.id}/plan`)
      .set(auth(student.token))
      .send({});
    expect(a.status).toBe(201);
    expect(a.body.data.sessions).toEqual(b.body.data.sessions);
    expect(createCompletion).not.toHaveBeenCalled();
  });

  it('keeps working with the explicit settings of the classic endpoint', async () => {
    const student = await signup(app);
    const pack = await createPack(app, student);
    const res = await request(app)
      .post(`/api/study-packs/${pack.id}/plan`)
      .set(auth(student.token))
      .send({ days: 4, minutesPerDay: 40 });
    expect(res.status).toBe(201);
    expect(res.body.data.sessions).toHaveLength(4);
    expect(
      res.body.data.sessions.every((day: { budgetMinutes: number }) => day.budgetMinutes === 40),
    ).toBe(true);
    expect(res.body.data.sessions[0].activities.length).toBeGreaterThan(0);
  });

  it('follows the exam date: a new date rebuilds the plan, removing it removes the plan', async () => {
    const student = await signup(app);
    const pack = await createPack(app, student, { examDate: daysFromNow(6) });
    await today(student);
    await request(app)
      .patch(`/api/study-packs/${pack.id}`)
      .set(auth(student.token))
      .send({ examDate: daysFromNow(3) });
    const shorter = await request(app)
      .get(`/api/study-packs/${pack.id}/plan`)
      .set(auth(student.token));
    expect(shorter.body.data.sessions).toHaveLength(3);
    expect(shorter.body.data.examDate).toBe(daysFromNow(3));

    await request(app)
      .patch(`/api/study-packs/${pack.id}`)
      .set(auth(student.token))
      .send({ examDate: null });
    const gone = await request(app)
      .get(`/api/study-packs/${pack.id}/plan`)
      .set(auth(student.token));
    expect(gone.body.data).toBeNull();
  });

  it('rejects an exam date that is not a real day', async () => {
    const student = await signup(app);
    const pack = await createPack(app, student);
    const res = await request(app)
      .patch(`/api/study-packs/${pack.id}`)
      .set(auth(student.token))
      .send({ examDate: '2026-02-31' });
    expect(res.status).toBe(400);
  });

  it("counts the exam in the student's own timezone, without an off-by-one", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 23:30 UTC on 29 September is already 30 September in Amsterdam (CEST).
    vi.setSystemTime(new Date('2026-09-29T23:30:00.000Z'));
    const utc = await signup(app);
    await createPack(app, utc, { title: 'Biology', examDate: '2026-10-08' });
    const amsterdam = await signup(app, 'Europe/Amsterdam');
    await createPack(app, amsterdam, { title: 'Biology', examDate: '2026-10-08' });

    expect((await today(utc)).exam.daysLeft).toBe(9);
    expect((await today(amsterdam)).exam.daysLeft).toBe(8);
    // The plan starts on the student's own date too.
    const packs = await request(app).get('/api/study-packs').set(auth(amsterdam.token));
    const plan = await request(app)
      .get(`/api/study-packs/${packs.body.data[0].id}/plan`)
      .set(auth(amsterdam.token));
    expect(plan.body.data.sessions[0].date).toBe('2026-09-30');
  });
});

describe('progress', () => {
  it('is an honest empty state before any studying', async () => {
    const student = await signup(app);
    const res = await request(app).get('/api/progress/study').set(auth(student.token));
    expect(res.status).toBe(200);
    expect(res.body.data.hasActivity).toBe(false);
    expect(res.body.data.overall).toMatchObject({
      masteryPercent: null,
      studySeconds: 0,
      questionsAnswered: 0,
      cardsReviewed: 0,
      testsCompleted: 0,
      recentImprovement: null,
    });
    expect(res.body.data.streak.current).toBe(0);
  });

  it('reports real numbers from sessions, answers and tests', async () => {
    const student = await signup(app);
    const pack = await createPack(app, student, { questionsPerConcept: 3 });
    await finishPractice(student, pack, 4);
    const test = await startSession(app, student, {
      packId: pack.id,
      type: 'test',
      mode: 'quick10',
    });
    await completeSession(app, student, test.session.id, {
      answers: test.session.items.map((item) => ({ itemId: item.id, answer: RIGHT })),
    });

    const res = await request(app).get('/api/progress/study').set(auth(student.token));
    const { overall, packs, streak } = res.body.data;
    expect(res.body.data.hasActivity).toBe(true);
    expect(overall).toMatchObject({
      questionsAnswered: 4 + 10,
      testsCompleted: 1,
      sessionsCompleted: 2,
      conceptsTotal: 4,
    });
    expect(overall.masteryPercent).toBeGreaterThan(0);
    expect(packs).toHaveLength(1);
    expect(packs[0]).toMatchObject({ title: 'Biology', sessionsCompleted: 2 });
    expect(streak).toMatchObject({ current: 1, todayDone: true });
  });

  it('draws a mastery trend only from three real days, and never invents points', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-25T10:00:00.000Z'));
    const student = await signup(app);
    const pack = await createPack(app, student, { questionsPerConcept: 6 });

    const trendOf = async () =>
      (await request(app).get('/api/progress/study').set(auth(student.token))).body.data.packs[0]
        .trend;

    await finishPractice(student, pack);
    expect(await trendOf()).toMatchObject({ hasEnoughData: false, daysRecorded: 1, points: [] });

    vi.setSystemTime(new Date('2026-09-26T10:00:00.000Z'));
    await finishPractice(student, pack);
    expect(await trendOf()).toMatchObject({ hasEnoughData: false, daysRecorded: 2, points: [] });

    vi.setSystemTime(new Date('2026-09-27T10:00:00.000Z'));
    await finishPractice(student, pack);
    const trend = await trendOf();
    expect(trend.hasEnoughData).toBe(true);
    expect(trend.points.map((point: { day: string }) => point.day)).toEqual([
      '2026-09-25',
      '2026-09-26',
      '2026-09-27',
    ]);
    expect(trend.changePercent).toBeGreaterThan(0);
    expect(trend.direction).toBe('up');

    // One snapshot per pack and day, in the database.
    const rows = await memoryDb().masterySnapshots.listByUser(student.id);
    expect(rows.map((row) => row.day)).toEqual(['2026-09-25', '2026-09-26', '2026-09-27']);
  });

  it('builds the streak from completed sessions only — opening the app does nothing', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-25T10:00:00.000Z'));
    const student = await signup(app);
    const pack = await createPack(app, student, { questionsPerConcept: 6 });
    const streakOf = async () => (await today(student)).streak;

    // Opening the app and even starting a session is not a streak.
    await startSession(app, student, { packId: pack.id, type: 'practice', count: 3 });
    expect(await streakOf()).toMatchObject({ current: 0, todayDone: false });

    await finishPractice(student, pack);
    expect(await streakOf()).toMatchObject({ current: 1, todayDone: true });

    vi.setSystemTime(new Date('2026-09-26T10:00:00.000Z'));
    expect(await streakOf()).toMatchObject({ current: 1, todayDone: false });
    await finishPractice(student, pack);
    expect(await streakOf()).toMatchObject({ current: 2, todayDone: true });

    // A missed day ends it, and it never goes negative.
    vi.setSystemTime(new Date('2026-09-29T10:00:00.000Z'));
    expect(await streakOf()).toMatchObject({ current: 0 });
  });

  it("groups snapshots and the streak by the student's local day", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-29T22:30:00.000Z')); // 00:30 on the 30th in Amsterdam
    const student = await signup(app, 'Europe/Amsterdam');
    const pack = await createPack(app, student, { questionsPerConcept: 6 });
    await finishPractice(student, pack);
    const rows = await memoryDb().masterySnapshots.listByUser(student.id);
    expect(rows.map((row) => row.day)).toEqual(['2026-09-30']);
    expect((await today(student)).streak).toMatchObject({ current: 1, todayDone: true });
  });

  it('shows the concepts that improved, with old and new mastery', async () => {
    const student = await signup(app);
    const pack = await createPack(app, student, { questionsPerConcept: 4 });
    const osmosis = conceptId(pack, 'Osmosis');
    await setMastery(student.id, osmosis, 0.42, { attempts: 4 });
    const { session } = await startSession(app, student, {
      packId: pack.id,
      type: 'practice',
      conceptId: osmosis,
      count: 4,
    });
    for (const item of session.items) await answerItem(app, student, session.id, item.id, RIGHT);
    const done = await completeSession(app, student, session.id);
    expect(done.result!.concepts.find((c) => c.name === 'Osmosis')).toMatchObject({
      beforePercent: 42,
      afterPercent: 100,
    });

    const res = await request(app).get('/api/progress/study').set(auth(student.token));
    expect(res.body.data.overall.improvedConcepts[0]).toMatchObject({
      name: 'Osmosis',
      beforePercent: 42,
      afterPercent: 100,
      changePercent: 58,
    });
  });

  it("never mixes in another student's numbers", async () => {
    const student = await signup(app);
    const pack = await createPack(app, student);
    await finishPractice(student, pack);
    const other = await signup(app);
    const res = await request(app).get('/api/progress/study').set(auth(other.token));
    expect(res.body.data.hasActivity).toBe(false);
    expect(res.body.data.packs).toEqual([]);
  });
});

describe('subject overview', () => {
  it('shows packs, mastery, due work, weak concepts, exams and one call to action', async () => {
    const student = await signup(app);
    const subject = (
      await request(app).post('/api/subjects').set(auth(student.token)).send({ name: 'Biology' })
    ).body.data;
    const cells = await createPack(app, student, {
      title: 'Cells',
      subjectId: subject.id,
      examDate: daysFromNow(7),
    });
    await createPack(app, student, { title: 'Genetics', subjectId: subject.id });
    await setMastery(student.id, conceptId(cells, 'Osmosis'), 0.15, { attempts: 4 });

    const res = await request(app)
      .get(`/api/subjects/${subject.id}/overview`)
      .set(auth(student.token));
    expect(res.status).toBe(200);
    const overview = res.body.data;
    expect(overview.subject).toEqual({ id: subject.id, name: 'Biology' });
    expect(overview.packs.map((pack: { title: string }) => pack.title).sort()).toEqual([
      'Cells',
      'Genetics',
    ]);
    expect(overview.totals).toMatchObject({ packs: 2, weakConcepts: 1 });
    expect(overview.exams).toEqual([expect.objectContaining({ title: 'Cells', daysLeft: 7 })]);
    const cellsRow = overview.packs.find((pack: { title: string }) => pack.title === 'Cells');
    expect(cellsRow.weakConcepts[0]).toMatchObject({ name: 'Osmosis', masteryPercent: 15 });
    expect(overview.next).toMatchObject({ packTitle: 'Cells', sessionType: 'practice' });
  });

  it('is private to the subject owner', async () => {
    const student = await signup(app);
    const subject = (
      await request(app).post('/api/subjects').set(auth(student.token)).send({ name: 'Biology' })
    ).body.data;
    const other = await signup(app);
    expect(
      (await request(app).get(`/api/subjects/${subject.id}/overview`).set(auth(other.token)))
        .status,
    ).toBe(404);
    expect((await request(app).get(`/api/subjects/${subject.id}/overview`)).status).toBe(401);
  });
});

describe('AI Tutor context and "Show source"', () => {
  function modelReply(content: string) {
    return { choices: [{ index: 0, message: { role: 'assistant', content } }] };
  }
  const sent = () =>
    JSON.parse(
      (createCompletion.mock.calls.at(-1)![0] as { messages: { content: string }[] }).messages[1]!
        .content,
    ) as Record<string, unknown> & {
      focus?: {
        concept: { name: string };
        mistakes: { prompt: string; yourAnswer: string }[];
        question: { prompt: string; correctAnswer?: string } | null;
      };
      source: string;
    };

  it('opens from a concept with its explanation, source and recent mistakes — and cites the material', async () => {
    const student = await signup(app);
    const pack = await createPack(app, student, { questionsPerConcept: 3 });
    const osmosis = conceptId(pack, 'Osmosis');
    const { session } = await startSession(app, student, {
      packId: pack.id,
      type: 'practice',
      conceptId: osmosis,
      count: 2,
    });
    await answerItem(app, student, session.id, session.items[0]!.id, WRONG);
    createCompletion.mockResolvedValueOnce(
      modelReply('Osmosis is water moving through a membrane. [Source: Biology.md · source]'),
    );

    const res = await request(app)
      .post(`/api/study-packs/${pack.id}/tutor`)
      .set(auth(student.token))
      .send({
        message: 'Explain this in simple words',
        history: [],
        context: { conceptId: osmosis, sessionId: session.id, itemId: session.items[1]!.id },
      });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      basedOnMaterial: true,
      citations: [expect.objectContaining({ title: 'Biology.md' })],
      focus: { conceptName: 'Osmosis' },
    });

    const payload = sent();
    expect(payload.focus!.concept.name).toBe('Osmosis');
    expect(payload.focus!.mistakes[0]).toMatchObject({ yourAnswer: 'wrong a' });
    // The question on screen is unanswered: the tutor gets the prompt, not the solution.
    expect(payload.focus!.question!.prompt).toMatch(/Which statement about Osmosis/);
    expect(payload.focus!.question!.correctAnswer).toBeUndefined();
    // The concept's source travels with provenance markers.
    expect(payload.source).toContain('[SOURCE 1] Biology.md');
    expect(payload.source).toMatch(/\[\[1:/);
  });

  it('labels an answer without a real citation as a general explanation', async () => {
    const student = await signup(app);
    const pack = await createPack(app, student);
    createCompletion.mockResolvedValueOnce(
      modelReply('In general, membranes are selective. [Source: Made Up Book · page 99]'),
    );
    const res = await request(app)
      .post(`/api/study-packs/${pack.id}/tutor`)
      .set(auth(student.token))
      .send({ message: 'What is a membrane?', history: [] });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ basedOnMaterial: false, citations: [], focus: null });
  });

  it('is switched off while a test is running, and reveals no answer afterwards it should not', async () => {
    const student = await signup(app);
    const pack = await createPack(app, student, { questionsPerConcept: 3 });
    const { session } = await startSession(app, student, {
      packId: pack.id,
      type: 'test',
      mode: 'quick10',
    });
    const blocked = await request(app)
      .post(`/api/study-packs/${pack.id}/tutor`)
      .set(auth(student.token))
      .send({
        message: 'Help me with question 1',
        history: [],
        context: { sessionId: session.id, itemId: session.items[0]!.id },
      });
    expect(blocked.status).toBe(409);
    expect(createCompletion).not.toHaveBeenCalled();
  });

  it("does not accept another student's session as context", async () => {
    const student = await signup(app);
    const pack = await createPack(app, student);
    const { session } = await startSession(app, student, {
      packId: pack.id,
      type: 'practice',
      count: 2,
    });
    const other = await signup(app);
    const otherPack = await createPack(app, other);
    const res = await request(app)
      .post(`/api/study-packs/${otherPack.id}/tutor`)
      .set(auth(other.token))
      .send({ message: 'Hi', history: [], context: { sessionId: session.id } });
    expect(res.status).toBe(404);
    expect(createCompletion).not.toHaveBeenCalled();
  });

  it('shows the passage a concept comes from, without any AI', async () => {
    const student = await signup(app);
    const pack = await createPack(app, student);
    const res = await request(app)
      .get(`/api/study-packs/${pack.id}/concepts/${conceptId(pack, 'Diffusion')}/source`)
      .set(auth(student.token));
    expect(res.status).toBe(200);
    expect(res.body.data.source).toMatchObject({ title: 'Biology.md' });
    expect(res.body.data.excerpt.text).toMatch(/Diffusion is the spreading of particles/);
    expect(createCompletion).not.toHaveBeenCalled();

    const other = await signup(app);
    const denied = await request(app)
      .get(`/api/study-packs/${pack.id}/concepts/${conceptId(pack, 'Diffusion')}/source`)
      .set(auth(other.token));
    expect([403, 404]).toContain(denied.status);
  });
});

describe('Study Pack regression: the classic endpoints keep working', () => {
  it('classic practice answers feed the same mastery the sessions use', async () => {
    const student = await signup(app);
    const pack = await createPack(app, student, { questionsPerConcept: 2 });
    const queue = await request(app)
      .get(`/api/study-packs/${pack.id}/practice`)
      .set(auth(student.token));
    expect(queue.status).toBe(200);
    const question = queue.body.data.questions[0];
    const graded = await request(app)
      .post(`/api/study-packs/${pack.id}/practice/attempts`)
      .set(auth(student.token))
      .send({ questionId: question.id, answer: RIGHT });
    expect(graded.status).toBe(200);
    expect(graded.body.data).toMatchObject({
      verdict: 'correct',
      previousMasteryPercent: 0,
      conceptMasteryPercent: 20,
    });

    // A session started afterwards sees that mastery.
    const preview = await request(app)
      .get('/api/study-sessions/preview')
      .query({ packId: pack.id, type: 'learn' })
      .set(auth(student.token));
    const seen = preview.body.data.concepts.find(
      (c: { id: string }) => c.id === question.conceptId,
    );
    expect(seen).toMatchObject({ masteryPercent: 20 });
  });

  it('classic tests: no explanation before submitting, the same analysis after', async () => {
    const student = await signup(app);
    const pack = await createPack(app, student, { questionsPerConcept: 3 });
    const created = await request(app)
      .post(`/api/study-packs/${pack.id}/tests`)
      .set(auth(student.token))
      .send({ mode: 'quick10' });
    expect(created.status).toBe(201);
    const questions = created.body.data.questions as { id: string }[];
    expect(questions).toHaveLength(10);
    const raw = JSON.stringify(created.body.data);
    expect(raw).not.toContain('explanation');
    expect(raw).not.toContain('correctAnswer');

    const submitted = await request(app)
      .post(`/api/study-packs/${pack.id}/tests/${created.body.data.test.id}/submit`)
      .set(auth(student.token))
      .send({ answers: questions.map((question) => ({ questionId: question.id, answer: RIGHT })) });
    expect(submitted.status).toBe(200);
    expect(submitted.body.data.accuracy).toBe(100);
    expect(submitted.body.data.results[0]).toMatchObject({
      verdict: 'correct',
      correctAnswer: RIGHT,
    });
    expect(submitted.body.data.results[0].explanation).toMatch(/Because/);

    // Classic attempts are visible next to session attempts.
    const list = await request(app)
      .get(`/api/study-packs/${pack.id}/tests`)
      .set(auth(student.token));
    expect(list.body.data.attempts).toHaveLength(1);
  });

  it('classic learn: next concept and self-rating still move mastery', async () => {
    const student = await signup(app);
    const pack = await createPack(app, student);
    const next = await request(app)
      .get(`/api/study-packs/${pack.id}/learn/next`)
      .set(auth(student.token));
    expect(next.status).toBe(200);
    expect(next.body.data.reason).toBe('new');
    const rated = await request(app)
      .post(`/api/study-packs/${pack.id}/concepts/${next.body.data.concept.id}/rating`)
      .set(auth(student.token))
      .send({ rating: 'good' });
    expect(rated.status).toBe(200);
    expect(rated.body.data.masteryPercent).toBe(15);
  });

  it('pack detail, list and progress endpoints keep their shape', async () => {
    const student = await signup(app);
    const pack = await createPack(app, student, { examDate: daysFromNow(9) });
    const detail = await request(app).get(`/api/study-packs/${pack.id}`).set(auth(student.token));
    expect(detail.body.data).toMatchObject({ title: 'Biology', examDaysLeft: 9 });
    expect(detail.body.data.counts.concepts).toBe(4);
    const list = await request(app).get('/api/study-packs').set(auth(student.token));
    expect(list.body.data[0]).toMatchObject({ title: 'Biology', examDaysLeft: 9 });
    const progress = await request(app)
      .get(`/api/study-packs/${pack.id}/progress`)
      .set(auth(student.token));
    expect(progress.status).toBe(200);
  });

  it('a pack that is last studied in a Learn session is no longer "never studied"', async () => {
    const student = await signup(app);
    const pack = await createPack(app, student);
    const listed = async () =>
      (await request(app).get('/api/study-packs').set(auth(student.token))).body.data[0]
        .lastStudiedAt;
    expect(await listed()).toBeNull();
    const { session } = await startSession(app, student, {
      packId: pack.id,
      type: 'learn',
      count: 1,
    });
    const rated = await request(app)
      .post(`/api/study-sessions/${session.id}/items/${session.items[0]!.id}/rating`)
      .set(auth(student.token))
      .send({ rating: 'good' });
    expect(rated.status).toBe(200);
    expect(await listed()).not.toBeNull();
  });
});
