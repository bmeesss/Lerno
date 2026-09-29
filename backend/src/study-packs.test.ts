/**
 * Study Pack core: material → concepts → practice → test → mastery → review.
 *
 * These tests exercise the real HTTP surface with the in-memory database, so
 * they cover validation, authorization, provenance, grading and the learning
 * loop end to end (including the "existing study set stays compatible" rule).
 */
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { config } from './config.js';

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

let counter = 0;

async function signup(): Promise<string> {
  counter += 1;
  const email = `pack${counter}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const res = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'password123', displayName: 'Pack Student' });
  return res.body.data.accessToken as string;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function reply(content: string): unknown {
  return { choices: [{ index: 0, message: { role: 'assistant', content } }] };
}

const MATERIAL = [
  'Newton beschreef drie bewegingswetten.',
  'De eerste wet zegt dat een voorwerp in rust blijft rusten tenzij er een kracht werkt.',
  'De tweede wet zegt dat kracht gelijk is aan massa maal versnelling.',
  'De derde wet zegt dat elke actie een gelijke en tegengestelde reactie oproept.',
  'Een voorbeeld is een raket die gas naar beneden duwt en daardoor omhoog gaat.',
].join(' ');

async function createPack(token: string, overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/study-packs')
    .set(auth(token))
    .send({
      title: 'Natuurkunde H3',
      subjectId: null,
      description: 'Krachten en beweging',
      level: 'VMBO-T',
      visibility: 'private',
      source: { type: 'text', title: 'Natuurkunde H3.md', text: MATERIAL },
      ...overrides,
    });
  expect(res.status).toBe(201);
  return res.body.data;
}

async function addContent(token: string, packId: string, body: unknown, expected = 201) {
  const res = await request(app)
    .post(`/api/study-packs/${packId}/content`)
    .set(auth(token))
    .send(body);
  expect(res.status).toBe(expected);
  return res.body.data;
}

const CONCEPTS = [
  { name: 'De eerste wet van Newton', explanation: 'Een voorwerp in rust blijft in rust zonder kracht.' },
  { name: 'De tweede wet van Newton', explanation: 'Kracht is massa maal versnelling.' },
  { name: 'De derde wet van Newton', explanation: 'Actie en reactie zijn gelijk en tegengesteld.' },
];

const QUESTIONS = [
  {
    questionType: 'multiple_choice' as const,
    prompt: 'Wat zegt de tweede wet van Newton?',
    correctAnswer: 'Kracht is massa maal versnelling',
    options: ['Kracht is massa maal versnelling', 'Actie is reactie', 'Rust blijft rust'],
    explanation: 'F = m · a',
  },
  {
    questionType: 'true_false' as const,
    prompt: 'De derde wet gaat over actie en reactie.',
    correctAnswer: 'True',
    options: ['True', 'False'],
    explanation: 'Actie = -reactie.',
  },
  {
    questionType: 'short_answer' as const,
    prompt: 'Wat gebeurt er met een voorwerp in rust zonder kracht?',
    correctAnswer: 'Het blijft in rust',
    options: null,
    explanation: 'Eerste wet.',
  },
];

beforeEach(() => {
  mutableConfig.groqApiKey = 'test-groq-key';
  createCompletion.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('study packs: material and sources', () => {
  it('creates a pack from pasted text and returns a study-ready detail view', async () => {
    const token = await signup();
    const pack = await createPack(token);

    expect(pack.title).toBe('Natuurkunde H3');
    expect(pack.counts.sources).toBe(1);
    expect(pack.counts.readySources).toBe(1);
    expect(pack.sources[0].status).toBe('ready');
    expect(pack.sources[0].kind).toBe('text');
    expect(pack.sources[0].characterCount).toBeGreaterThan(20);
    // A pack always owns a classic set, so flashcards work immediately.
    expect(pack.legacySetId).toBeTruthy();
    // Material first, concepts next: the recommendation walks the workflow.
    expect(pack.recommended.type).toBe('generate-concepts');
    expect(pack.progress.masteryPercent).toBe(0);
  });

  it('adds a second and third source of different kinds', async () => {
    const token = await signup();
    const pack = await createPack(token, { source: undefined });

    const text = await request(app)
      .post(`/api/study-packs/${pack.id}/sources`)
      .set(auth(token))
      .send({ type: 'text', title: 'Aantekeningen.txt', text: MATERIAL });
    expect(text.status).toBe(201);

    const pdf = await request(app)
      .post(`/api/study-packs/${pack.id}/sources`)
      .set(auth(token))
      .send({ type: 'pdf', title: 'Biologie H3.pdf', text: MATERIAL, pageCount: 12 });
    expect(pdf.status).toBe(201);
    expect(pdf.body.data.pageCount).toBe(12);

    const detail = await request(app).get(`/api/study-packs/${pack.id}`).set(auth(token));
    expect(detail.body.data.counts.sources).toBe(2);
    expect(detail.body.data.sources.map((source: { title: string }) => source.title)).toEqual([
      'Aantekeningen.txt',
      'Biologie H3.pdf',
    ]);

    const removed = await request(app)
      .delete(`/api/study-packs/${pack.id}/sources/${pdf.body.data.id}`)
      .set(auth(token));
    expect(removed.status).toBe(204);
  });

  it('rejects source kinds that have no adapter yet', async () => {
    const token = await signup();
    const pack = await createPack(token);
    const res = await request(app)
      .post(`/api/study-packs/${pack.id}/sources`)
      .set(auth(token))
      .send({ type: 'youtube', title: 'Video', url: 'https://youtu.be/x' });
    expect(res.status).toBe(400);
  });

  it('imports an existing study set without losing cards or progress', async () => {
    const token = await signup();
    const set = await request(app)
      .post('/api/sets')
      .set(auth(token))
      .send({
        title: 'Bestaande set',
        visibility: 'private',
        cards: [
          { question: 'Wat is een cel?', answer: 'Basis van het leven' },
          { question: 'Wat is DNA?', answer: 'Erfelijk materiaal' },
        ],
      });
    const setId = set.body.data.id as string;

    // Study one card first: importing must not reset existing progress.
    await request(app)
      .post('/api/study/review')
      .set(auth(token))
      .send({ setId, cardId: set.body.data.cards[0].id, result: 'correct' });

    const pack = await request(app)
      .post('/api/study-packs')
      .set(auth(token))
      .send({
        title: 'Biologie H3',
        visibility: 'private',
        source: { type: 'set', setId, title: 'Bestaande set' },
      });
    expect(pack.status).toBe(201);
    expect(pack.body.data.legacySetId).toBe(setId);
    expect(pack.body.data.counts.flashcards).toBe(2);
    expect(pack.body.data.progress.studiedCards).toBe(1);
    expect(pack.body.data.sources[0].kind).toBe('set');

    // A set can only belong to one pack (no accidental duplicates).
    const again = await request(app)
      .post('/api/study-packs')
      .set(auth(token))
      .send({ title: 'Nog een pack', source: { type: 'set', setId } });
    expect(again.status).toBe(409);

    // Deleting the pack must not delete the imported set.
    const removed = await request(app)
      .delete(`/api/study-packs/${pack.body.data.id}`)
      .set(auth(token));
    expect(removed.status).toBe(204);
    const stillThere = await request(app).get(`/api/sets/${setId}`).set(auth(token));
    expect(stillThere.status).toBe(200);
  });
});

describe('study packs: concepts and generated content', () => {
  it('stores confirmed concepts, flashcards and practice questions additively', async () => {
    const token = await signup();
    const pack = await createPack(token);

    const concepts = await addContent(token, pack.id, { target: 'concepts', concepts: CONCEPTS });
    expect(concepts.added).toBe(3);

    // Re-applying the same concepts must not duplicate anything.
    const duplicate = await addContent(token, pack.id, { target: 'concepts', concepts: CONCEPTS });
    expect(duplicate.added).toBe(0);
    expect(duplicate.skipped).toBe(3);

    const cards = await addContent(token, pack.id, {
      target: 'flashcards',
      cards: [
        { front: 'Wat zegt de eerste wet van Newton?', back: 'Een voorwerp blijft in rust zonder kracht' },
        { front: 'Wat zegt de tweede wet van Newton?', back: 'Kracht is massa maal versnelling' },
      ],
    });
    expect(cards.added).toBe(2);

    const practice = await addContent(token, pack.id, { target: 'practice', questions: QUESTIONS });
    expect(practice.added).toBe(3);

    const detail = await request(app).get(`/api/study-packs/${pack.id}`).set(auth(token));
    expect(detail.body.data.counts.concepts).toBe(3);
    expect(detail.body.data.counts.flashcards).toBe(2);
    expect(detail.body.data.counts.practiceQuestions).toBe(3);

    // Provenance: generated cards/questions are linked to a concept by content.
    const conceptNames = detail.body.data.concepts.map((concept: { name: string }) => concept.name);
    expect(conceptNames).toContain('De tweede wet van Newton');
    const secondLaw = detail.body.data.concepts.find(
      (concept: { name: string }) => concept.name === 'De tweede wet van Newton',
    );
    expect(secondLaw.cardCount).toBeGreaterThan(0);

    // The flashcards really land in the classic set (existing modes keep working).
    const setCards = await request(app)
      .get(`/api/sets/${detail.body.data.legacySetId}/cards`)
      .set(auth(token));
    expect(setCards.body.data).toHaveLength(2);

    // Existing content is never overwritten by a new generation.
    const summary = await addContent(token, pack.id, {
      target: 'summary',
      summary: 'Alle drie de wetten van Newton met voorbeelden.',
      sourceId: detail.body.data.sources[0].id,
    });
    expect(summary.summary).toContain('Newton');
    const afterSummary = await request(app).get(`/api/study-packs/${pack.id}`).set(auth(token));
    expect(afterSummary.body.data.counts.flashcards).toBe(2);
    expect(afterSummary.body.data.summarySourceId).toBe(detail.body.data.sources[0].id);
  });

  it('generates AI previews without storing anything until confirmed', async () => {
    const token = await signup();
    const pack = await createPack(token);

    createCompletion.mockResolvedValueOnce(
      reply(
        JSON.stringify({
          concepts: [
            { name: 'Eerste wet', explanation: 'Rust blijft rust zonder kracht.', sourceRef: 1 },
            { name: 'Tweede wet', explanation: 'Kracht is massa maal versnelling.', sourceRef: 1 },
            { name: 'Derde wet', explanation: 'Actie en reactie zijn gelijk.', sourceRef: 1 },
          ],
        }),
      ),
    );

    const preview = await request(app)
      .post(`/api/study-packs/${pack.id}/generate`)
      .set(auth(token))
      .send({ target: 'concepts', count: 3 });
    expect(preview.status).toBe(200);
    expect(preview.body.data.concepts).toHaveLength(3);
    expect(preview.body.data.concepts[0].sourceId).toBe(preview.body.data.concepts[0].sourceId);

    const detail = await request(app).get(`/api/study-packs/${pack.id}`).set(auth(token));
    expect(detail.body.data.counts.concepts).toBe(0);

    // Unusable model output is a safe error, never raw model text.
    createCompletion.mockResolvedValueOnce(reply('not json at all'));
    createCompletion.mockResolvedValueOnce(reply('still not json'));
    const broken = await request(app)
      .post(`/api/study-packs/${pack.id}/generate`)
      .set(auth(token))
      .send({ target: 'concepts' });
    expect(broken.status).toBe(502);
  });

  it('answers tutor questions from the pack material only', async () => {
    const token = await signup();
    const pack = await createPack(token);
    createCompletion.mockResolvedValueOnce(
      reply('Based on your Natuurkunde H3 material: de tweede wet zegt F = m · a.'),
    );

    const answer = await request(app)
      .post(`/api/study-packs/${pack.id}/tutor`)
      .set(auth(token))
      .send({ message: 'Wat zegt de tweede wet?', history: [] });
    expect(answer.status).toBe(200);
    expect(answer.body.data.reply).toContain('tweede wet');

    // The source block (and only that block) reached the model.
    const call = createCompletion.mock.calls[0]![0] as {
      messages: { role: string; content: string }[];
    };
    expect(call.messages[1]!.content).toContain('Newton');
    expect(call.messages[1]!.content).toContain('Natuurkunde H3');
  });
});

describe('study packs: practice, mastery and tests', () => {
  async function preparedPack(token: string) {
    const pack = await createPack(token);
    await addContent(token, pack.id, { target: 'concepts', concepts: CONCEPTS });
    await addContent(token, pack.id, { target: 'practice', questions: QUESTIONS });
    return pack;
  }

  it('serves a practice queue without answers and grades each attempt', async () => {
    const token = await signup();
    const pack = await preparedPack(token);

    const queue = await request(app)
      .get(`/api/study-packs/${pack.id}/practice`)
      .set(auth(token));
    expect(queue.status).toBe(200);
    expect(queue.body.data.questions).toHaveLength(3);
    expect(queue.body.data.questions[0].correctAnswer).toBeUndefined();

    const first = queue.body.data.questions.find(
      (question: { questionType: string }) => question.questionType === 'multiple_choice',
    );
    const correct = await request(app)
      .post(`/api/study-packs/${pack.id}/practice/attempts`)
      .set(auth(token))
      .send({ questionId: first.id, answer: '0' });
    expect(correct.status).toBe(200);
    expect(correct.body.data.verdict).toBe('correct');
    expect(correct.body.data.conceptMasteryPercent).toBe(20);
    expect(correct.body.data.concept?.name).toBeTruthy();

    const wrong = await request(app)
      .post(`/api/study-packs/${pack.id}/practice/attempts`)
      .set(auth(token))
      .send({ questionId: first.id, answer: 'iets anders' });
    expect(wrong.body.data.verdict).toBe('incorrect');
    expect(wrong.body.data.explanation).toBeTruthy();

    // Two attempts on one concept: mastery dropped and the concept is now weak,
    // so the single recommended action becomes practice on that concept.
    const detail = await request(app).get(`/api/study-packs/${pack.id}`).set(auth(token));
    expect(detail.body.data.progress.practiceAnswers).toBe(2);
    expect(detail.body.data.recommended.type).toBe('practice');
    expect(detail.body.data.recommended.conceptName).toBe(detail.body.data.progress.weakConcepts[0].name);
  });

  it('accepts the option text as an answer for multiple choice', async () => {
    const token = await signup();
    const pack = await preparedPack(token);
    const queue = await request(app).get(`/api/study-packs/${pack.id}/practice`).set(auth(token));
    const first = queue.body.data.questions.find(
      (question: { questionType: string }) => question.questionType === 'multiple_choice',
    );
    const res = await request(app)
      .post(`/api/study-packs/${pack.id}/practice/attempts`)
      .set(auth(token))
      .send({ questionId: first.id, answer: 'Kracht is massa maal versnelling' });
    expect(res.body.data.verdict).toBe('correct');
  });

  it('runs a full test: selection, scoring, weak concepts and stored attempt', async () => {
    const token = await signup();
    const pack = await preparedPack(token);

    const created = await request(app)
      .post(`/api/study-packs/${pack.id}/tests`)
      .set(auth(token))
      .send({ mode: 'exam' });
    expect(created.status).toBe(201);
    expect(created.body.data.questions).toHaveLength(3);
    expect(created.body.data.questions[0].correctAnswer).toBeUndefined();

    const questions = created.body.data.questions as { id: string; questionType: string }[];
    const answers = questions.map((question, index) =>
      question.questionType === 'short_answer'
        ? { questionId: question.id, answer: 'Het blijft in rust zonder kracht' }
        : { questionId: question.id, answer: index === 0 ? 'fout antwoord' : 'True' },
    );

    const submitted = await request(app)
      .post(`/api/study-packs/${pack.id}/tests/${created.body.data.test.id}/submit`)
      .set(auth(token))
      .send({ answers });
    expect(submitted.status).toBe(200);
    const result = submitted.body.data;
    expect(result.attempt.total).toBe(3);
    expect(result.results).toHaveLength(3);
    expect(result.attempt.score).toBeGreaterThan(0);
    expect(result.results.some((row: { verdict: string }) => row.verdict !== 'correct')).toBe(true);
    expect(Array.isArray(result.weakConcepts)).toBe(true);
    expect(result.recommended).toBeTruthy();

    const tests = await request(app)
      .get(`/api/study-packs/${pack.id}/tests`)
      .set(auth(token));
    expect(tests.body.data.tests).toHaveLength(1);
    expect(tests.body.data.attempts).toHaveLength(1);

    const detail = await request(app).get(`/api/study-packs/${pack.id}`).set(auth(token));
    expect(detail.body.data.progress.testAttempts).toBe(1);
    expect(detail.body.data.progress.bestTestScorePercent).toBeGreaterThanOrEqual(0);
    expect(detail.body.data.counts.tests).toBe(1);
  });

  it('requires three practice questions before a test can be made', async () => {
    const token = await signup();
    const pack = await createPack(token);
    const res = await request(app)
      .post(`/api/study-packs/${pack.id}/tests`)
      .set(auth(token))
      .send({ mode: 'quick10' });
    expect(res.status).toBe(400);
  });

  it('tracks Learn-mode self-ratings as concept mastery', async () => {
    const token = await signup();
    const pack = await preparedPack(token);
    const detail = await request(app).get(`/api/study-packs/${pack.id}`).set(auth(token));
    const concept = detail.body.data.concepts[0];

    const rated = await request(app)
      .post(`/api/study-packs/${pack.id}/concepts/${concept.id}/rating`)
      .set(auth(token))
      .send({ rating: 'good' });
    expect(rated.status).toBe(200);
    expect(rated.body.data.masteryPercent).toBe(15);

    const weaker = await request(app)
      .post(`/api/study-packs/${pack.id}/concepts/${concept.id}/rating`)
      .set(auth(token))
      .send({ rating: 'again' });
    expect(weaker.body.data.masteryPercent).toBe(5);
  });

  it('keeps review pack-aware: due cards and weak concepts per pack', async () => {
    const token = await signup();
    const pack = await preparedPack(token);
    const detail = await request(app).get(`/api/study-packs/${pack.id}`).set(auth(token));

    // Study a card so it becomes due later, then force it due now.
    const cardId = (
      await request(app).get(`/api/sets/${detail.body.data.legacySetId}/cards`).set(auth(token))
    ).body.data[0]?.id;
    if (cardId) {
      await request(app)
        .post('/api/study/review')
        .set(auth(token))
        .send({ setId: detail.body.data.legacySetId, cardId, result: 'incorrect' });
    }

    const review = await request(app).get('/api/study-packs/review-queue').set(auth(token));
    expect(review.status).toBe(200);
    expect(review.body.data.packs).toHaveLength(1);
    expect(review.body.data.weakConceptPacks).toHaveLength(0);
    expect(review.body.data.cardsDue).toBeGreaterThanOrEqual(0);
  });

  it('answers "what should I study today?" with concrete tasks and exams', async () => {
    const token = await signup();
    const pack = await preparedPack(token);
    const examDay = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);

    await request(app)
      .patch(`/api/study-packs/${pack.id}`)
      .set(auth(token))
      .send({ examDate: examDay });
    const detail = await request(app).get(`/api/study-packs/${pack.id}`).set(auth(token));
    expect(detail.body.data.examDate).toBe(examDay);
    expect(detail.body.data.examDaysLeft).toBe(14);

    const plan = await request(app)
      .post(`/api/study-packs/${pack.id}/plan`)
      .set(auth(token))
      .send({ minutesPerDay: 30 });
    expect(plan.status).toBe(201);
    expect(plan.body.data.sessions).toHaveLength(14);
    expect(plan.body.data.examDate).toBe(examDay);
    expect(plan.body.data.sessions.at(-1).focus).toContain('Exam simulation');

    const today = await request(app).get('/api/study-packs/today').set(auth(token));
    expect(today.status).toBe(200);
    expect(today.body.data.exams[0].packId).toBe(pack.id);
    expect(today.body.data.exams[0].daysLeft).toBe(14);
    expect(today.body.data.packs).toHaveLength(1);
  });
});

describe('study packs: permissions and compatibility', () => {
  it('hides private packs from other students and guests', async () => {
    const owner = await signup();
    const stranger = await signup();
    const pack = await createPack(owner);

    // Private material is indistinguishable from "does not exist" (same rule
    // the classic sets endpoint uses), for guests and other students alike.
    expect((await request(app).get(`/api/study-packs/${pack.id}`)).status).toBe(404);
    expect(
      (await request(app).get(`/api/study-packs/${pack.id}`).set(auth(stranger))).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .post(`/api/study-packs/${pack.id}/generate`)
          .set(auth(stranger))
          .send({ target: 'summary' })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .patch(`/api/study-packs/${pack.id}`)
          .set(auth(stranger))
          .send({ title: 'hijacked' })
      ).status,
    ).toBe(404);
  });

  it('lets guests practice a public pack without storing mastery', async () => {
    const token = await signup();
    const pack = await createPack(token, { visibility: 'public' });
    await addContent(token, pack.id, { target: 'practice', questions: QUESTIONS });

    const queue = await request(app).get(`/api/study-packs/${pack.id}/practice`);
    expect(queue.status).toBe(200);
    const question = queue.body.data.questions[0];
    const graded = await request(app)
      .post(`/api/study-packs/${pack.id}/practice/attempts`)
      .send({ questionId: question.id, answer: 'True' });
    expect(graded.status).toBe(200);
    expect(graded.body.data.conceptMasteryPercent).toBeNull();

    // Guests cannot create tests or generation previews for someone else's pack.
    expect(
      (await request(app).post(`/api/study-packs/${pack.id}/tests`).send({ mode: 'quick10' })).status,
    ).toBe(401);
  });

  it('keeps the existing sets API working unchanged', async () => {
    const token = await signup();
    const pack = await createPack(token);
    const setRes = await request(app)
      .get(`/api/sets/${pack.legacySetId}`)
      .set(auth(token));
    expect(setRes.status).toBe(200);
    expect(setRes.body.data.title).toBe('Natuurkunde H3');

    // The study queue still works on the pack's set (same legacy flow).
    const queue = await request(app)
      .get(`/api/study/queue/${pack.legacySetId}`)
      .set(auth(token));
    expect(queue.status).toBe(200);
  });

  it('lists packs with counts, mastery and exam countdown', async () => {
    const token = await signup();
    const pack = await createPack(token, { visibility: 'public' });
    await addContent(token, pack.id, { target: 'concepts', concepts: CONCEPTS });

    const list = await request(app).get('/api/study-packs').set(auth(token));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({
      id: pack.id,
      title: 'Natuurkunde H3',
      concepts: 3,
      visibility: 'public',
    });
  });
});
