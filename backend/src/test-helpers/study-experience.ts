/**
 * Shared helpers for the study-session integration tests: sign up students,
 * build a study pack with known concepts/questions through the real API, and
 * drive sessions the way the app does.
 */
import type { Express } from 'express';
import request from 'supertest';
import { expect } from 'vitest';
import { getMemoryState } from '../lib/db/index.js';
import { createMemoryDatabase } from '../lib/db/memory.js';
import type { Database } from '../lib/db/repository.js';

export interface Student {
  token: string;
  id: string;
  email: string;
}

export interface TestPack {
  id: string;
  title: string;
  concepts: { id: string; name: string }[];
  questionsByConcept: Record<string, { id: string; prompt: string }[]>;
}

export const RIGHT = 'Right answer';
export const WRONG = 'Wrong A';

export const MATERIAL =
  'Osmosis is the movement of water through a semi-permeable membrane. ' +
  'For example, a raisin swells when it is placed in water because water moves into the raisin by osmosis. ' +
  'Diffusion is the spreading of particles from a crowded place to an empty place. ' +
  'Mitosis is cell division that produces two identical cells. ' +
  'Meiosis is cell division that produces four different sex cells.';

export const CONCEPT_NAMES = ['Osmosis', 'Diffusion', 'Mitosis', 'Meiosis'] as const;

let counter = 0;

export function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export function memoryDb(): Database {
  return createMemoryDatabase(getMemoryState());
}

export async function signup(app: Express, timezone?: string): Promise<Student> {
  counter += 1;
  const email = `session${counter}-${Math.floor(Math.random() * 1e7)}@example.com`;
  const res = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'password123', displayName: 'Session Student' });
  expect(res.status).toBe(201);
  const token = res.body.data.accessToken as string;
  if (timezone) {
    const patched = await request(app).patch('/api/profile').set(auth(token)).send({ timezone });
    expect(patched.status).toBe(200);
  }
  const profile = await request(app).get('/api/profile').set(auth(token));
  return { token, id: profile.body.data.id as string, email };
}

/**
 * Fresh access token at the current (possibly faked) time. Tests that move the
 * clock by days need it, because a token issued earlier would have expired.
 */
export async function relogin(app: Express, student: Student): Promise<void> {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: student.email, password: 'password123' });
  expect(res.status).toBe(200);
  student.token = res.body.data.accessToken as string;
}

/**
 * Creates a pack with the four biology concepts and `questionsPerConcept`
 * multiple-choice questions each. The right answer is always RIGHT.
 */
export async function createPack(
  app: Express,
  student: Student,
  options: {
    title?: string;
    subjectId?: string | null;
    examDate?: string | null;
    concepts?: readonly string[];
    questionsPerConcept?: number;
    visibility?: 'private' | 'public';
  } = {},
): Promise<TestPack> {
  const title = options.title ?? 'Biology';
  const created = await request(app)
    .post('/api/study-packs')
    .set(auth(student.token))
    .send({
      title,
      subjectId: options.subjectId ?? null,
      description: '',
      level: '',
      visibility: options.visibility ?? 'private',
      ...(options.examDate ? { examDate: options.examDate } : {}),
      source: { type: 'text', title: `${title}.md`, text: MATERIAL },
    });
  expect(created.status).toBe(201);
  const packId = created.body.data.id as string;
  const sources = await request(app)
    .get(`/api/study-packs/${packId}/sources`)
    .set(auth(student.token));
  const sourceId = (sources.body.data as { id: string }[])[0]?.id ?? null;

  const names = options.concepts ?? CONCEPT_NAMES;
  const conceptRes = await request(app)
    .post(`/api/study-packs/${packId}/content`)
    .set(auth(student.token))
    .send({
      target: 'concepts',
      sourceId,
      concepts: names.map((name) => ({
        name,
        explanation: `${name} in one clear sentence.`,
        refLabel: 'section 2',
      })),
    });
  expect(conceptRes.status).toBe(201);
  const concepts = ((conceptRes.body.data.concepts ?? []) as { id: string; name: string }[]).map(
    (concept) => ({ id: concept.id, name: concept.name }),
  );
  expect(concepts).toHaveLength(names.length);

  const perConcept = options.questionsPerConcept ?? 4;
  const questionsByConcept: TestPack['questionsByConcept'] = {};
  for (const concept of concepts) {
    const res = await request(app)
      .post(`/api/study-packs/${packId}/content`)
      .set(auth(student.token))
      .send({
        target: 'practice',
        questions: Array.from({ length: perConcept }, (_, index) => ({
          questionType: 'multiple_choice',
          prompt: `Which statement about ${concept.name} is correct? (variant ${index + 1})`,
          correctAnswer: RIGHT,
          options: [RIGHT, WRONG, 'Wrong B'],
          explanation: `Because that is how ${concept.name} works.`,
          conceptId: concept.id,
          sourceId,
        })),
      });
    expect(res.status).toBe(201);
    questionsByConcept[concept.id] = (
      res.body.data.questions as { id: string; prompt: string }[]
    ).map((question) => ({ id: question.id, prompt: question.prompt }));
  }
  return { id: packId, title, concepts, questionsByConcept };
}

export interface SessionItem {
  id: string;
  position: number;
  kind: 'concept' | 'question';
  status: string;
  conceptId: string | null;
  conceptName: string | null;
  question: { id: string; prompt: string; options: string[] | null; questionType: string } | null;
  learn: {
    explanation: string;
    example: { text: string; kind: string; sourceTitle: string | null } | null;
    reason: string;
    masteryPercent: number;
  } | null;
  answer: string | null;
  rating: string | null;
  feedback: {
    verdict: string;
    correctAnswer: string;
    explanation: string;
    masteryBeforePercent: number | null;
    masteryAfterPercent: number | null;
    source: { title: string | null; ref: string | null } | null;
  } | null;
}

export interface SessionDetail {
  id: string;
  packId: string;
  type: string;
  mode: string | null;
  status: string;
  label: string;
  itemCount: number;
  answeredCount: number;
  currentPosition: number;
  hideFeedback: boolean;
  durationSeconds: number;
  progress: { position: number; total: number; answered: number; skipped: number; percent: number };
  items: SessionItem[];
  result: {
    total: number;
    answered: number;
    correct: number;
    incorrect: number;
    partial: number;
    percent: number;
    score: number;
    concepts: { conceptId: string; name: string; beforePercent: number; afterPercent: number }[];
    stillWeak: { conceptId: string; name: string; masteryPercent: number }[];
    knownWell: { conceptId: string; name: string; percent: number }[];
    needsPractice: { conceptId: string; name: string; percent: number }[];
    mistakeCount: number;
    next: {
      type: string;
      label: string;
      description: string;
      conceptName: string | null;
      conceptId: string | null;
    };
    testAttemptId: string | null;
    packWeakCount: number;
    packMasteryPercent: number;
  } | null;
}

export async function startSession(
  app: Express,
  student: Student,
  body: Record<string, unknown>,
  expectedStatus = 201,
) {
  const res = await request(app).post('/api/study-sessions').set(auth(student.token)).send(body);
  expect(res.status).toBe(expectedStatus);
  return res.body.data as { session: SessionDetail; resumed: boolean };
}

export async function getSession(
  app: Express,
  student: Student,
  id: string,
): Promise<SessionDetail> {
  const res = await request(app).get(`/api/study-sessions/${id}`).set(auth(student.token));
  expect(res.status).toBe(200);
  return (res.body.data as { session: SessionDetail }).session;
}

export async function answerItem(
  app: Express,
  student: Student,
  sessionId: string,
  itemId: string,
  answer: string,
  expectedStatus = 200,
) {
  const res = await request(app)
    .post(`/api/study-sessions/${sessionId}/items/${itemId}/answer`)
    .set(auth(student.token))
    .send({ answer });
  expect(res.status).toBe(expectedStatus);
  return res.body.data as {
    item: SessionItem;
    progress: SessionDetail['progress'];
    session: { status: string; currentPosition: number; answeredCount: number };
  };
}

export async function rateItem(
  app: Express,
  student: Student,
  sessionId: string,
  itemId: string,
  rating: 'again' | 'hard' | 'good' | 'easy',
  expectedStatus = 200,
) {
  const res = await request(app)
    .post(`/api/study-sessions/${sessionId}/items/${itemId}/rating`)
    .set(auth(student.token))
    .send({ rating });
  expect(res.status).toBe(expectedStatus);
  return res.body.data as { item: SessionItem; progress: SessionDetail['progress'] };
}

export async function completeSession(
  app: Express,
  student: Student,
  sessionId: string,
  body: Record<string, unknown> = {},
  expectedStatus = 200,
): Promise<SessionDetail> {
  const res = await request(app)
    .post(`/api/study-sessions/${sessionId}/complete`)
    .set(auth(student.token))
    .send(body);
  expect(res.status).toBe(expectedStatus);
  return (res.body.data?.session ?? res.body.data) as SessionDetail;
}

/** Writes mastery straight into the repository to set up a scenario. */
export async function setMastery(
  studentId: string,
  conceptId: string,
  mastery: number,
  extra: { attempts?: number; nextReviewAt?: string | null; lastPracticedAt?: string | null } = {},
) {
  await memoryDb().conceptMastery.upsert({
    userId: studentId,
    conceptId,
    mastery,
    confidence: 0.5,
    attempts: extra.attempts ?? 3,
    correctCount: 0,
    incorrectCount: 0,
    lastPracticedAt: extra.lastPracticedAt ?? new Date().toISOString(),
    nextReviewAt: extra.nextReviewAt ?? new Date(Date.now() + 86_400_000).toISOString(),
  });
}
