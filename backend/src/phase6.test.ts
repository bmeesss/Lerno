/**
 * Phase 6 coverage: quiz generation quality, access control, forged-input
 * rejection, large quizzes and cache invalidation.
 */
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { generateQuestions } from './services/quiz-service.js';
import type { CardRecord } from './lib/db/types.js';

const app = createApp();

const MISSING_UUID = '00000000-0000-0000-0000-000000000000';

function card(id: string, question: string, answer: string, position: number): CardRecord {
  return { id, setId: 'set-1', question, answer, position, createdAt: '', updatedAt: '' };
}

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

interface ApiQuestion {
  id: string;
  prompt: string;
  questionType: 'multiple_choice' | 'true_false' | 'short_answer';
  options: string[] | null;
}

async function createSet(
  token: string,
  body: Record<string, unknown>,
): Promise<{ id: string; cards: { id: string }[] }> {
  const res = await request(app).post('/api/sets').set(auth(token)).send(body);
  expect(res.status).toBe(201);
  return { id: res.body.data.id as string, cards: res.body.data.cards as { id: string }[] };
}

/** Solves generated questions from a prompt→answer map (mirrors how a student reads them). */
function solve(questions: ApiQuestion[], answerByPrompt: Record<string, string>) {
  return questions.map((question) => {
    const match = Object.keys(answerByPrompt).find((key) => question.prompt.startsWith(key));
    if (question.questionType === 'true_false') {
      const source = match ? answerByPrompt[match]! : '';
      const shown = /"([^"]+)"/.exec(question.prompt)?.[1] ?? '';
      const holds = shown.trim().toLowerCase() === source.trim().toLowerCase();
      return { questionId: question.id, answer: holds ? 'True' : 'False' };
    }
    return { questionId: question.id, answer: match ? answerByPrompt[match]! : 'unknown' };
  });
}

describe('phase 6: generation quality', () => {
  it('returns no questions for an empty set', () => {
    expect(generateQuestions([])).toEqual([]);
  });

  it('never produces single-option multiple choice', () => {
    const same = [
      card('c1', 'Q1?', 'Same', 0),
      card('c2', 'Q2?', 'Same', 1),
      card('c3', 'Q3?', 'Same', 2),
      card('c4', 'Q4?', 'Same', 3),
    ];
    const questions = generateQuestions(same);
    expect(questions).toHaveLength(4);
    for (const question of questions) {
      if (question.questionType === 'multiple_choice') {
        expect(question.options!.length).toBeGreaterThanOrEqual(2);
      }
    }
    // Index 0 would be multiple choice: without distractors it falls back.
    expect(questions[0]!.questionType).toBe('short_answer');
  });

  it('dedupes distractors by normalized answer', () => {
    const cards = [
      card('c1', 'Capital?', 'Paris', 0),
      card('c2', 'Big city?', 'paris ', 1),
      card('c3', 'Other?', 'Berlin', 2),
      card('c4', 'More?', 'Madrid', 3),
    ];
    const first = generateQuestions(cards)[0]!;
    expect(first.questionType).toBe('multiple_choice');
    const normalized = first.options!.map((option) => option.trim().toLowerCase());
    expect(new Set(normalized).size).toBe(normalized.length);
    expect(normalized.filter((option) => option === 'paris')).toHaveLength(1);
  });

  it('keeps true/false verdicts consistent with the shown content', () => {
    const cards = [
      card('c1', 'Q1?', 'Same', 0),
      card('c2', 'Q2?', 'Same', 1),
      card('c3', 'Q3?', 'Same', 2),
      card('c4', 'Q4?', 'Same', 3),
      card('c5', 'Q5?', 'Same', 4),
    ];
    const questions = generateQuestions(cards).filter((q) => q.questionType === 'true_false');
    expect(questions.length).toBeGreaterThan(0);
    for (const question of questions) {
      const shown = /"([^"]+)"/.exec(question.prompt)?.[1] ?? '';
      const holds = shown.trim().toLowerCase() === 'same';
      expect(question.correctAnswer).toBe(holds ? 'True' : 'False');
    }
  });

  it('rotates the correct option position deterministically', () => {
    const cards = Array.from({ length: 8 }, (_, i) =>
      card(`c${i}`, `Q${i}?`, `answer-${i}`, i),
    );
    const positions = generateQuestions(cards)
      .filter((q) => q.questionType === 'multiple_choice')
      .map((q) => q.options!.indexOf(q.correctAnswer));
    expect(new Set(positions).size).toBeGreaterThan(1);
    expect(generateQuestions(cards)).toEqual(generateQuestions(cards));
  });
});

describe('phase 6: quiz access control', () => {
  it('serves private sets to owners and public sets to everyone', async () => {
    const owner = await signup('Phase6AccessOwner');
    const stranger = await signup('Phase6AccessStranger');
    const { id: setId } = await createSet(owner.token, {
      title: 'Access quiz',
      visibility: 'private',
      cards: [{ question: 'q?', answer: 'a' }],
    });

    const ownerLoad = await request(app).get(`/api/sets/${setId}/quiz`).set(auth(owner.token));
    expect(ownerLoad.status).toBe(200);
    expect(ownerLoad.body.data.questions).toHaveLength(1);

    expect((await request(app).get(`/api/sets/${setId}/quiz`)).status).toBe(404);
    expect(
      (await request(app).get(`/api/sets/${setId}/quiz`).set(auth(stranger.token))).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .post(`/api/sets/${setId}/quiz/attempts`)
          .set(auth(stranger.token))
          .send({ answers: [{ questionId: MISSING_UUID, answer: 'x' }] })
      ).status,
    ).toBe(404);

    await request(app)
      .patch(`/api/sets/${setId}`)
      .set(auth(owner.token))
      .send({ visibility: 'public' });
    expect((await request(app).get(`/api/sets/${setId}/quiz`)).status).toBe(200);
    expect(
      (await request(app).get(`/api/sets/${setId}/quiz`).set(auth(stranger.token))).status,
    ).toBe(200);
  });

  it('validates set ids and handles unknown or empty sets', async () => {
    const { token } = await signup('Phase6QuizParams');
    const badLoad = await request(app).get('/api/sets/not-a-uuid/quiz').set(auth(token));
    expect(badLoad.status).toBe(400);
    expect(badLoad.body.error.code).toBe('VALIDATION_ERROR');

    const badSubmit = await request(app)
      .post('/api/sets/not-a-uuid/quiz/attempts')
      .set(auth(token))
      .send({ answers: [{ questionId: MISSING_UUID, answer: 'x' }] });
    expect(badSubmit.status).toBe(400);

    expect((await request(app).get(`/api/sets/${MISSING_UUID}/quiz`).set(auth(token))).status).toBe(
      404,
    );

    const { id: emptyId } = await createSet(token, { title: 'Empty quiz set' });
    const empty = await request(app).get(`/api/sets/${emptyId}/quiz`).set(auth(token));
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('VALIDATION_ERROR');
    expect(empty.body.error.message).toMatch(/at least one card/i);

    const { id: singleId } = await createSet(token, {
      title: 'Single card set',
      cards: [{ question: 'Only?', answer: 'Yes' }],
    });
    const single = await request(app).get(`/api/sets/${singleId}/quiz`).set(auth(token));
    expect(single.status).toBe(200);
    expect(single.body.data.questions).toHaveLength(1);
    expect(single.body.data.questions[0].questionType).toBe('short_answer');
  });
});

describe('phase 6: scoring integrity', () => {
  async function setupScored(): Promise<{ token: string; setId: string; quiz: { questions: ApiQuestion[] } }> {
    const { token } = await signup('Phase6Scoring');
    const { id: setId } = await createSet(token, {
      title: 'Scoring set',
      cards: [
        { question: 'Capital of France?', answer: 'Paris' },
        { question: 'Capital of Germany?', answer: 'Berlin' },
        { question: 'Capital of Spain?', answer: 'Madrid' },
      ],
    });
    const quiz = await request(app).get(`/api/sets/${setId}/quiz`).set(auth(token));
    return { token, setId, quiz: quiz.body.data as { questions: ApiQuestion[] } };
  }

  const ANSWERS = {
    'Capital of France?': 'Paris',
    'Capital of Germany?': 'Berlin',
    'Capital of Spain?': 'Madrid',
  };

  it('scores correct and incorrect submissions server-side', async () => {
    const { token, setId, quiz } = await setupScored();

    const perfect = await request(app)
      .post(`/api/sets/${setId}/quiz/attempts`)
      .set(auth(token))
      .send({ answers: solve(quiz.questions, ANSWERS) });
    expect(perfect.body.data.score).toBe(perfect.body.data.total);
    expect(perfect.body.data.accuracy).toBe(1);

    const failed = await request(app)
      .post(`/api/sets/${setId}/quiz/attempts`)
      .set(auth(token))
      .send({
        answers: quiz.questions.map((question) => ({ questionId: question.id, answer: 'nope' })),
      });
    expect(failed.body.data.score).toBe(0);
    expect(failed.body.data.incorrect).toBe(failed.body.data.total);
  });

  it('ignores forged scores, users and timestamps', async () => {
    const owner = await signup('Phase6ForgeOwner');
    const stranger = await signup('Phase6ForgeStranger');
    const { id: setId } = await createSet(owner.token, {
      title: 'Forge set',
      visibility: 'public',
      cards: [{ question: 'q?', answer: 'a' }],
    });
    const quiz = await request(app).get(`/api/sets/${setId}/quiz`).set(auth(stranger.token));
    const questionId = (quiz.body.data.questions as ApiQuestion[])[0]!.id;

    const res = await request(app)
      .post(`/api/sets/${setId}/quiz/attempts`)
      .set(auth(stranger.token))
      .send({
        answers: [{ questionId, answer: 'wrong' }],
        score: 100,
        total: 1,
        accuracy: 1,
        userId: owner.userId,
        user_id: owner.userId,
        createdAt: '2020-01-01T00:00:00.000Z',
        created_at: '2020-01-01T00:00:00.000Z',
      });
    expect(res.status).toBe(200);
    expect(res.body.data.score).toBe(0);
    expect(res.body.data.persisted).toBe(true);

    // The attempt belongs to the caller, with a server timestamp.
    const strangerProgress = await request(app).get('/api/progress').set(auth(stranger.token));
    expect(strangerProgress.body.data.quizAttempts).toBe(1);
    expect(strangerProgress.body.data.quizAccuracy).toBe(0);
    const ownerProgress = await request(app).get('/api/progress').set(auth(owner.token));
    expect(ownerProgress.body.data.quizAttempts).toBe(0);

    const today = await request(app).get('/api/progress/today').set(auth(stranger.token));
    expect(today.body.data.streak.current).toBe(1);
  });

  it('rejects malformed submissions', async () => {
    const { token, setId, quiz } = await setupScored();
    const questionId = quiz.questions[0]!.id;
    const badBodies: unknown[] = [
      {},
      { answers: 'not-an-array' },
      { answers: [] },
      { answers: [{ answer: 'x' }] },
      { answers: [{ questionId: 'not-a-uuid', answer: 'x' }] },
      { answers: [{ questionId, answer: 'x'.repeat(1001) }] },
      { answers: [{ questionId, answer: 'x', extra: 'ok' }] }, // unknown answer keys are stripped, valid
    ];
    const expected = [400, 400, 400, 400, 400, 400, 200];
    for (let i = 0; i < badBodies.length; i += 1) {
      const res = await request(app)
        .post(`/api/sets/${setId}/quiz/attempts`)
        .set(auth(token))
        .send(badBodies[i]);
      expect(res.status).toBe(expected[i]);
      if (expected[i] === 400) expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('handles unknown and duplicate question ids deterministically', async () => {
    const { token, setId, quiz } = await setupScored();

    // Unknown ids match nothing: every real question counts as incorrect.
    const unknown = await request(app)
      .post(`/api/sets/${setId}/quiz/attempts`)
      .set(auth(token))
      .send({ answers: [{ questionId: MISSING_UUID, answer: 'x' }] });
    expect(unknown.status).toBe(200);
    expect(unknown.body.data.total).toBe(quiz.questions.length);
    expect(unknown.body.data.score).toBe(0);

    // Duplicate ids: last answer wins.
    const first = quiz.questions[0]!;
    const correct = solve([first], ANSWERS)[0]!.answer;
    const dupes = await request(app)
      .post(`/api/sets/${setId}/quiz/attempts`)
      .set(auth(token))
      .send({
        answers: [
          { questionId: first.id, answer: 'definitely wrong' },
          { questionId: first.id, answer: correct },
        ],
      });
    const reviewed = (dupes.body.data.questions as { questionId: string; correct: boolean }[]).find(
      (q) => q.questionId === first.id,
    );
    expect(reviewed!.correct).toBe(true);
  });

  it('supports quizzes larger than 100 questions', async () => {
    const { token } = await signup('Phase6LargeQuiz');
    const cards = Array.from({ length: 105 }, (_, i) => ({
      question: `Question ${i}?`,
      answer: `answer-${i}`,
    }));
    const { id: setId } = await createSet(token, { title: 'Large set', cards });
    const quiz = await request(app).get(`/api/sets/${setId}/quiz`).set(auth(token));
    expect(quiz.body.data.questions).toHaveLength(105);

    const res = await request(app)
      .post(`/api/sets/${setId}/quiz/attempts`)
      .set(auth(token))
      .send({
        answers: (quiz.body.data.questions as ApiQuestion[]).map((question) => ({
          questionId: question.id,
          answer: 'x',
        })),
      });
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(105);
  });

  it('scores duplicate-answer sets perfectly when answered correctly', async () => {
    const { token } = await signup('Phase6DupAnswers');
    const { id: setId } = await createSet(token, {
      title: 'Echo set',
      cards: [
        { question: 'First?', answer: 'Same' },
        { question: 'Second?', answer: 'Same' },
        { question: 'Third?', answer: 'Same' },
      ],
    });
    const quiz = await request(app).get(`/api/sets/${setId}/quiz`).set(auth(token));
    const questions = quiz.body.data.questions as ApiQuestion[];
    for (const question of questions) {
      if (question.questionType === 'multiple_choice') {
        expect(question.options!.length).toBeGreaterThanOrEqual(2);
      }
      expect(question).not.toHaveProperty('correctAnswer');
    }
    const res = await request(app)
      .post(`/api/sets/${setId}/quiz/attempts`)
      .set(auth(token))
      .send({ answers: solve(questions, { First: 'Same', Second: 'Same', Third: 'Same' }) });
    expect(res.body.data.score).toBe(res.body.data.total);
  });
});

describe('phase 6: quiz freshness and progress integration', () => {
  it('regenerates quizzes after card changes without losing attempts', async () => {
    const { token } = await signup('Phase6Fresh');
    const { id: setId, cards } = await createSet(token, {
      title: 'Fresh set',
      cards: [
        { question: 'Q1?', answer: 'A1' },
        { question: 'Q2?', answer: 'A2' },
      ],
    });
    const first = await request(app).get(`/api/sets/${setId}/quiz`).set(auth(token));
    expect(first.body.data.questions).toHaveLength(2);
    const firstIds = (first.body.data.questions as ApiQuestion[]).map((q) => q.id);

    // A submitted attempt is recorded…
    await request(app)
      .post(`/api/sets/${setId}/quiz/attempts`)
      .set(auth(token))
      .send({
        answers: (first.body.data.questions as ApiQuestion[]).map((q) => ({
          questionId: q.id,
          answer: 'x',
        })),
      });

    // …then adding a card regenerates the quiz with new question ids…
    await request(app)
      .post(`/api/sets/${setId}/cards`)
      .set(auth(token))
      .send({ cards: [{ question: 'Q3?', answer: 'A3' }] });
    const second = await request(app).get(`/api/sets/${setId}/quiz`).set(auth(token));
    expect(second.body.data.questions).toHaveLength(3);
    const secondIds = (second.body.data.questions as ApiQuestion[]).map((q) => q.id);
    expect(secondIds.some((id) => firstIds.includes(id))).toBe(false);

    // …while the attempt history survives.
    const progress = await request(app).get('/api/progress').set(auth(token));
    expect(progress.body.data.quizAttempts).toBe(1);

    // Editing a card answer updates the quiz content as well.
    await request(app)
      .patch(`/api/sets/${setId}/cards/${cards[0]!.id}`)
      .set(auth(token))
      .send({ answer: 'A1-edited' });
    const third = await request(app).get(`/api/sets/${setId}/quiz`).set(auth(token));
    const solved = solve(third.body.data.questions as ApiQuestion[], {
      'Q1?': 'A1-edited',
      'Q2?': 'A2',
      'Q3?': 'A3',
    });
    const retry = await request(app)
      .post(`/api/sets/${setId}/quiz/attempts`)
      .set(auth(token))
      .send({ answers: solved });
    expect(retry.body.data.score).toBe(retry.body.data.total);

    // Removing a card shrinks the quiz again.
    await request(app).delete(`/api/sets/${setId}/cards/${cards[1]!.id}`).set(auth(token));
    const fourth = await request(app).get(`/api/sets/${setId}/quiz`).set(auth(token));
    expect(fourth.body.data.questions).toHaveLength(2);
  });

  it('keeps guest attempts out of everyone’s progress', async () => {
    const owner = await signup('Phase6GuestOwner');
    const { id: setId } = await createSet(owner.token, {
      title: 'Guest quiz set',
      visibility: 'public',
      cards: [{ question: 'q?', answer: 'a' }],
    });
    const quiz = await request(app).get(`/api/sets/${setId}/quiz`);
    const res = await request(app)
      .post(`/api/sets/${setId}/quiz/attempts`)
      .send({
        answers: (quiz.body.data.questions as ApiQuestion[]).map((q) => ({
          questionId: q.id,
          answer: 'a',
        })),
      });
    expect(res.body.data.persisted).toBe(false);
    expect(res.body.data.score).toBe(1);

    const progress = await request(app).get('/api/progress').set(auth(owner.token));
    expect(progress.body.data.quizAttempts).toBe(0);
    const dashboard = await request(app).get('/api/dashboard').set(auth(owner.token));
    expect(dashboard.body.data.quizAccuracy).toBeNull();
  });

  it('reflects attempts in progress accuracy', async () => {
    const { token } = await signup('Phase6Accuracy');
    const { id: setId } = await createSet(token, {
      title: 'Accuracy set',
      cards: [
        { question: 'Q1?', answer: 'A1' },
        { question: 'Q2?', answer: 'A2' },
      ],
    });
    const quiz = await request(app).get(`/api/sets/${setId}/quiz`).set(auth(token));
    const questions = quiz.body.data.questions as ApiQuestion[];
    const solved = solve(questions, { 'Q1?': 'A1', 'Q2?': 'A2' });
    // One right, one wrong.
    solved[1]!.answer = 'wrong';
    await request(app)
      .post(`/api/sets/${setId}/quiz/attempts`)
      .set(auth(token))
      .send({ answers: solved });

    const progress = await request(app).get('/api/progress').set(auth(token));
    expect(progress.body.data.quizAttempts).toBe(1);
    expect(progress.body.data.quizAccuracy).toBeCloseTo(0.5);
  });
});
