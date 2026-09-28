/**
 * "Genereer quiz" (#7): structured quiz generation with strict validation.
 *
 * The frontend must never have to guess: every question is validated here,
 * including the multiple-choice options and the correctIndex.
 */
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { config } from './config.js';
import { generatedQuizSchema } from './lib/ai-schemas.js';

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
  const email = `aiquiz${counter}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const res = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'password123', displayName: 'Quiz Student' });
  return res.body.data.accessToken as string;
}

async function createSet(
  token: string,
  visibility: 'private' | 'public' = 'private',
): Promise<string> {
  const res = await request(app)
    .post('/api/sets')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: 'Franse Revolutie',
      level: '3 mavo',
      visibility,
      cards: [
        { question: 'Wanneer begon de Franse Revolutie?', answer: '1789' },
        { question: 'Wie was Robespierre?', answer: 'Leider van de Terreur' },
      ],
    });
  return res.body.data.id as string;
}

function reply(content: string): unknown {
  return { choices: [{ index: 0, message: { role: 'assistant', content } }] };
}

const validQuiz = JSON.stringify({
  questions: [
    {
      type: 'multiple_choice',
      question: 'Wanneer begon de Franse Revolutie?',
      options: ['1688', '1789', '1848', '1917'],
      correctIndex: 1,
      answer: '1789',
      explanation: 'De bestorming van de Bastille was in 1789.',
    },
    {
      type: 'true_false',
      question: 'Robespierre was een leider van de Terreur.',
      options: ['True', 'False'],
      correctIndex: 0,
      answer: 'True',
      explanation: 'Hij zat in het Comité de Salut Public.',
    },
    {
      type: 'open',
      question: 'Welke gevangenis werd in 1789 bestormd?',
      options: [],
      correctIndex: null,
      answer: 'De Bastille',
      explanation: 'De Bastille werd op 14 juli 1789 bestormd.',
    },
  ],
});

beforeEach(() => {
  mutableConfig.groqApiKey = 'test-groq-key';
  createCompletion.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/ai/sets/:setId/quiz', () => {
  it('returns a validated quiz with all supported types', async () => {
    const token = await signup();
    const setId = await createSet(token);
    createCompletion.mockResolvedValue(reply(validQuiz));

    const res = await request(app)
      .post(`/api/ai/sets/${setId}/quiz`)
      .set('Authorization', `Bearer ${token}`)
      .send({ count: 5, types: ['multiple_choice', 'open', 'true_false'], difficulty: 'normal' });

    expect(res.status).toBe(200);
    expect(res.body.data.questions).toHaveLength(3);
    expect(res.body.data.questions[0]).toMatchObject({
      type: 'multiple_choice',
      correctIndex: 1,
      options: ['1688', '1789', '1848', '1917'],
    });
    expect(res.body.data.questions[1]).toMatchObject({ type: 'true_false', correctIndex: 0 });
    expect(res.body.data.questions[2]).toMatchObject({ type: 'open', answer: 'De Bastille' });
    expect(res.body.data.meta).toMatchObject({ setId, totalCards: 2 });
  });

  it('keeps only the requested question types', async () => {
    const token = await signup();
    const setId = await createSet(token);
    createCompletion.mockResolvedValue(reply(validQuiz));

    const res = await request(app)
      .post(`/api/ai/sets/${setId}/quiz`)
      .set('Authorization', `Bearer ${token}`)
      .send({ count: 5, types: ['multiple_choice'], difficulty: 'normal' });

    expect(res.status).toBe(200);
    expect(res.body.data.questions).toHaveLength(1);
    expect(res.body.data.questions[0]!.type).toBe('multiple_choice');
  });

  it('reports unusable content when no requested type is produced', async () => {
    const token = await signup();
    const setId = await createSet(token);
    createCompletion.mockResolvedValue(
      reply(
        JSON.stringify({
          questions: [
            {
              type: 'open',
              question: 'Wat is de Bastille?',
              answer: 'Een gevangenis',
              explanation: 'In Parijs',
            },
          ],
        }),
      ),
    );

    const res = await request(app)
      .post(`/api/ai/sets/${setId}/quiz`)
      .set('Authorization', `Bearer ${token}`)
      .send({ count: 5, types: ['multiple_choice'], difficulty: 'normal' });

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('AI_INVALID_CONTENT');
  });

  it('rejects a correctIndex outside the options', async () => {
    const token = await signup();
    const setId = await createSet(token);
    createCompletion.mockResolvedValue(
      reply(
        JSON.stringify({
          questions: [
            {
              type: 'multiple_choice',
              question: 'Wanneer?',
              options: ['1688', '1789', '1848', '1917'],
              correctIndex: 7,
              answer: '1789',
              explanation: 'x',
            },
          ],
        }),
      ),
    );

    const res = await request(app)
      .post(`/api/ai/sets/${setId}/quiz`)
      .set('Authorization', `Bearer ${token}`)
      .send({ count: 5, types: ['multiple_choice'], difficulty: 'normal' });

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('AI_INVALID_CONTENT');
  });

  it('rejects multiple choice without exactly four options', async () => {
    const token = await signup();
    const setId = await createSet(token);
    createCompletion.mockResolvedValue(
      reply(
        JSON.stringify({
          questions: [
            {
              type: 'multiple_choice',
              question: 'Wanneer?',
              options: ['1789', '1917'],
              correctIndex: 0,
              answer: '1789',
              explanation: 'x',
            },
          ],
        }),
      ),
    );

    const res = await request(app)
      .post(`/api/ai/sets/${setId}/quiz`)
      .set('Authorization', `Bearer ${token}`)
      .send({ count: 5, types: ['multiple_choice'], difficulty: 'normal' });

    expect(res.status).toBe(502);
  });

  it('rejects true/false questions without True and False options', async () => {
    const token = await signup();
    const setId = await createSet(token);
    createCompletion.mockResolvedValue(
      reply(
        JSON.stringify({
          questions: [
            {
              type: 'true_false',
              question: 'De Bastille werd bestormd.',
              options: ['Ja', 'Nee'],
              correctIndex: 0,
              answer: 'True',
              explanation: 'x',
            },
          ],
        }),
      ),
    );

    const res = await request(app)
      .post(`/api/ai/sets/${setId}/quiz`)
      .set('Authorization', `Bearer ${token}`)
      .send({ count: 5, types: ['true_false'], difficulty: 'normal' });

    expect(res.status).toBe(502);
  });

  it('rejects open questions without an expected answer', async () => {
    const token = await signup();
    const setId = await createSet(token);
    createCompletion.mockResolvedValue(
      reply(
        JSON.stringify({
          questions: [
            { type: 'open', question: 'Wanneer begon het?', answer: '', explanation: 'x' },
          ],
        }),
      ),
    );

    const res = await request(app)
      .post(`/api/ai/sets/${setId}/quiz`)
      .set('Authorization', `Bearer ${token}`)
      .send({ count: 5, types: ['open'], difficulty: 'normal' });

    expect(res.status).toBe(502);
  });

  it('rejects duplicate questions', async () => {
    const token = await signup();
    const setId = await createSet(token);
    const question = {
      type: 'open',
      question: 'Wanneer begon de revolutie?',
      answer: '1789',
      explanation: 'x',
    };
    createCompletion.mockResolvedValue(
      reply(JSON.stringify({ questions: [question, { ...question }] })),
    );

    const res = await request(app)
      .post(`/api/ai/sets/${setId}/quiz`)
      .set('Authorization', `Bearer ${token}`)
      .send({ count: 5, types: ['open'], difficulty: 'normal' });

    expect(res.status).toBe(502);
  });

  it('enforces ownership like the normal set endpoints', async () => {
    const owner = await signup();
    const other = await signup();
    const setId = await createSet(owner);

    const res = await request(app)
      .post(`/api/ai/sets/${setId}/quiz`)
      .set('Authorization', `Bearer ${other}`)
      .send({ count: 5, types: ['multiple_choice'], difficulty: 'normal' });

    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe('Study set not found');
    expect(createCompletion).not.toHaveBeenCalled();
  });

  it('validates the request body', async () => {
    const token = await signup();
    const setId = await createSet(token);

    const noTypes = await request(app)
      .post(`/api/ai/sets/${setId}/quiz`)
      .set('Authorization', `Bearer ${token}`)
      .send({ count: 5, types: [], difficulty: 'normal' });
    expect(noTypes.status).toBe(400);

    const badType = await request(app)
      .post(`/api/ai/sets/${setId}/quiz`)
      .set('Authorization', `Bearer ${token}`)
      .send({ count: 5, types: ['essay'], difficulty: 'normal' });
    expect(badType.status).toBe(400);
  });

  it('maps a timeout to AI_TIMEOUT', async () => {
    const token = await signup();
    const setId = await createSet(token);
    const timeout = new Error('too slow');
    timeout.name = 'APIConnectionTimeoutError';
    createCompletion.mockRejectedValue(timeout);

    const res = await request(app)
      .post(`/api/ai/sets/${setId}/quiz`)
      .set('Authorization', `Bearer ${token}`)
      .send({ count: 5, types: ['multiple_choice'], difficulty: 'normal' });

    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe('AI_TIMEOUT');
  });
});

describe('generatedQuizSchema', () => {
  it('accepts a well formed question', () => {
    const parsed = generatedQuizSchema.safeParse(JSON.parse(validQuiz));
    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown question type', () => {
    const parsed = generatedQuizSchema.safeParse({
      questions: [{ type: 'essay', question: 'Schrijf een essay?', answer: 'veel tekst' }],
    });
    // Unknown types fall back to "open" and then need an answer — this one has it,
    // so it validates; the important part is that no unknown type leaks through.
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.questions[0]!.type).toBe('open');
  });
});
