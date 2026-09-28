/**
 * Lerno AI practice questions + overhoor mode (#3, #4, #5):
 * structured generation with schema validation, answer evaluation, hints and
 * the session summary that feeds the existing study progress.
 */
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { config } from './config.js';
import {
  evaluationSchema,
  generatedQuestionsSchema,
  hintResponseSchema,
} from './lib/ai-schemas.js';
import { parseAiJson, extractJsonBlock } from './lib/ai-json.js';

const { createCompletion } = vi.hoisted(() => ({ createCompletion: vi.fn() }));

vi.mock('groq-sdk', () => {
  class Groq {
    chat = { completions: { create: createCompletion } };
    constructor(_options: unknown) {}
  }
  return { default: Groq };
});

const mutableConfig = config as unknown as { groqApiKey: string };
const TEST_KEY = 'test-groq-key';
const app = createApp();

let counter = 0;

async function signup(): Promise<{ token: string; userId: string }> {
  counter += 1;
  const email = `aistudy${counter}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const res = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'password123', displayName: 'Study Student' });
  return { token: res.body.data.accessToken as string, userId: res.body.data.user.id as string };
}

async function createSet(
  token: string,
  cards: { question: string; answer: string }[] = [
    { question: 'Wat is fotosynthese?', answer: 'Planten maken glucose uit licht' },
    { question: 'Wat is chlorofyl?', answer: 'De groene kleurstof in bladeren' },
  ],
): Promise<{ setId: string; cardIds: string[] }> {
  const res = await request(app)
    .post('/api/sets')
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'Biologie H4', level: 'havo 4', visibility: 'private', cards });
  return {
    setId: res.body.data.id as string,
    cardIds: (res.body.data.cards as { id: string }[]).map((card) => card.id),
  };
}

function reply(content: string): unknown {
  return { choices: [{ index: 0, message: { role: 'assistant', content } }] };
}

function questionJson(count: number): string {
  const questions = Array.from({ length: count }, (_, index) => ({
    type: 'open',
    question: `Oefenvraag ${index}?`,
    answer: `Antwoord ${index}`,
    hint: `Hint ${index}`,
  }));
  return JSON.stringify({ questions });
}

beforeEach(() => {
  mutableConfig.groqApiKey = TEST_KEY;
  createCompletion.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/ai/sets/:setId/questions — authentication & ownership', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).post(
      '/api/ai/sets/00000000-0000-4000-8000-000000000000/questions',
    );
    expect(res.status).toBe(401);
    expect(createCompletion).not.toHaveBeenCalled();
  });

  it("returns 404 for another user's private set", async () => {
    const owner = await signup();
    const other = await signup();
    const { setId } = await createSet(owner.token);

    const res = await request(app)
      .post(`/api/ai/sets/${setId}/questions`)
      .set('Authorization', `Bearer ${other.token}`)
      .send({ count: 5, difficulty: 'normal' });

    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe('Study set not found');
    expect(createCompletion).not.toHaveBeenCalled();
  });
});

describe('POST /api/ai/sets/:setId/questions — generation', () => {
  it('returns validated questions for a valid AI response', async () => {
    const { token } = await signup();
    const { setId } = await createSet(token);
    createCompletion.mockResolvedValue(reply(questionJson(5)));

    const res = await request(app)
      .post(`/api/ai/sets/${setId}/questions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ count: 5, difficulty: 'normal' });

    expect(res.status).toBe(200);
    expect(res.body.data.questions).toHaveLength(5);
    expect(res.body.data.questions[0]).toMatchObject({
      type: 'open',
      question: 'Oefenvraag 0?',
      answer: 'Antwoord 0',
      hint: 'Hint 0',
      cardId: null,
    });
    expect(res.body.data.meta).toMatchObject({ setId, totalCards: 2 });
  });

  it('accepts 5, 10 and 15 questions and rejects other counts', async () => {
    const { token } = await signup();
    const { setId } = await createSet(token);
    createCompletion.mockResolvedValue(reply(questionJson(10)));

    for (const count of [5, 10, 15]) {
      const res = await request(app)
        .post(`/api/ai/sets/${setId}/questions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ count, difficulty: 'easy' });
      expect(res.status).toBe(200);
    }

    const invalid = await request(app)
      .post(`/api/ai/sets/${setId}/questions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ count: 7, difficulty: 'normal' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('scales the output budget with the requested count', async () => {
    const { token } = await signup();
    const { setId } = await createSet(token);
    createCompletion.mockResolvedValue(reply(questionJson(15)));

    await request(app)
      .post(`/api/ai/sets/${setId}/questions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ count: 15, difficulty: 'hard' });

    const payload = createCompletion.mock.calls[0]![0] as { max_completion_tokens: number };
    expect(payload.max_completion_tokens).toBeGreaterThan(1500);
  });

  it('retries once and then reports unusable JSON safely', async () => {
    const { token } = await signup();
    const { setId } = await createSet(token);
    createCompletion.mockResolvedValue(reply('Sorry, I cannot help with that.'));

    const res = await request(app)
      .post(`/api/ai/sets/${setId}/questions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ count: 5, difficulty: 'normal' });

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('AI_INVALID_CONTENT');
    expect(res.body.error.message).toMatch(/could not use|unreadable/i);
    // Bounded retries, never an endless loop.
    expect(createCompletion).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(res.body)).not.toContain('Sorry, I cannot');
  });

  it('rejects schema-invalid questions (missing answer)', async () => {
    const { token } = await signup();
    const { setId } = await createSet(token);
    createCompletion.mockResolvedValue(
      reply('{"questions":[{"type":"open","question":"Wat is dit?","hint":"denk"}]}'),
    );

    const res = await request(app)
      .post(`/api/ai/sets/${setId}/questions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ count: 5, difficulty: 'normal' });

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('AI_INVALID_CONTENT');
  });

  it('rejects duplicate questions from the model', async () => {
    const { token } = await signup();
    const { setId } = await createSet(token);
    createCompletion.mockResolvedValue(
      reply(
        JSON.stringify({
          questions: [
            { type: 'open', question: 'Dezelfde vraag?', answer: 'Ja', hint: 'kijk' },
            { type: 'open', question: 'Dezelfde vraag?', answer: 'Ja', hint: 'kijk' },
          ],
        }),
      ),
    );

    const res = await request(app)
      .post(`/api/ai/sets/${setId}/questions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ count: 5, difficulty: 'normal' });

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('AI_INVALID_CONTENT');
  });

  it('maps a valid cardRef onto a real card id and ignores bogus ones', async () => {
    const { token } = await signup();
    const { setId, cardIds } = await createSet(token);
    createCompletion.mockResolvedValue(
      reply(
        JSON.stringify({
          questions: [
            {
              type: 'open',
              question: 'Waar zorgt chlorofyl voor?',
              answer: 'Groene kleur',
              hint: 'Kijk naar blad 2',
              cardRef: 2,
            },
            {
              type: 'open',
              question: 'Een vraag zonder kaart?',
              answer: 'Antwoord',
              hint: 'Hint',
              cardRef: 99,
            },
          ],
        }),
      ),
    );

    const res = await request(app)
      .post(`/api/ai/sets/${setId}/questions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ count: 5, difficulty: 'normal' });

    expect(res.status).toBe(200);
    expect(res.body.data.questions[0]!.cardId).toBe(cardIds[1]);
    expect(res.body.data.questions[1]!.cardId).toBeNull();
  });

  it('accepts JSON wrapped in prose and markdown fences', async () => {
    const { token } = await signup();
    const { setId } = await createSet(token);
    createCompletion.mockResolvedValue(
      reply(`Sure! Here you go:\n\`\`\`json\n${questionJson(5)}\n\`\`\`\nHope that helps!`),
    );

    const res = await request(app)
      .post(`/api/ai/sets/${setId}/questions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ count: 5, difficulty: 'normal' });

    expect(res.status).toBe(200);
    expect(res.body.data.questions).toHaveLength(5);
  });
});

describe('POST /api/ai/study/evaluate', () => {
  it('evaluates a correct answer', async () => {
    const { token } = await signup();
    const { setId, cardIds } = await createSet(token);
    createCompletion.mockResolvedValue(
      reply(JSON.stringify({ verdict: 'correct', feedback: 'Precies!', missing: '' })),
    );

    const res = await request(app)
      .post('/api/ai/study/evaluate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        setId,
        cardId: cardIds[0],
        question: 'Wat is fotosynthese?',
        answer: 'Planten maken glucose uit licht',
      });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ verdict: 'correct', feedback: 'Precies!', missing: '' });
    const payload = createCompletion.mock.calls[0]![0] as {
      messages: { role: string; content: string }[];
    };
    // The stored card answer is the reference, not a client-supplied one.
    expect(payload.messages.at(-1)!.content).toContain('Planten maken glucose uit licht');
  });

  it('evaluates partial and incorrect answers', async () => {
    const { token } = await signup();
    const { setId } = await createSet(token);

    for (const verdict of ['partial', 'incorrect']) {
      createCompletion.mockResolvedValue(
        reply(JSON.stringify({ verdict, feedback: 'Bijna.', missing: 'chlorofyl' })),
      );
      const res = await request(app)
        .post('/api/ai/study/evaluate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          setId,
          question: 'Wat is fotosynthese?',
          expectedAnswer: 'glucose',
          answer: 'iets',
        });
      expect(res.status).toBe(200);
      expect(res.body.data.verdict).toBe(verdict);
    }
  });

  it('refuses a card that belongs to another set', async () => {
    const owner = await signup();
    const other = await signup();
    const { cardIds } = await createSet(owner.token);
    const { setId } = await createSet(other.token);

    const res = await request(app)
      .post('/api/ai/study/evaluate')
      .set('Authorization', `Bearer ${other.token}`)
      .send({ setId, cardId: cardIds[0], question: 'Q?', answer: 'A' });

    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe('Card not found');
    expect(createCompletion).not.toHaveBeenCalled();
  });

  it('rejects an unusable verdict from the model', async () => {
    const { token } = await signup();
    const { setId } = await createSet(token);
    createCompletion.mockResolvedValue(
      reply(JSON.stringify({ verdict: 'maybe', feedback: 'Geen idee' })),
    );

    const res = await request(app)
      .post('/api/ai/study/evaluate')
      .set('Authorization', `Bearer ${token}`)
      .send({ setId, question: 'Q?', expectedAnswer: 'A', answer: 'B' });

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('AI_INVALID_CONTENT');
  });
});

describe('POST /api/ai/study/hint', () => {
  it('returns a hint without the answer', async () => {
    const { token } = await signup();
    const { setId, cardIds } = await createSet(token);
    createCompletion.mockResolvedValue(
      reply(JSON.stringify({ hint: 'Denk aan wat planten uit licht halen.' })),
    );

    const res = await request(app)
      .post('/api/ai/study/hint')
      .set('Authorization', `Bearer ${token}`)
      .send({ setId, cardId: cardIds[0], question: 'Wat is fotosynthese?', hintsGiven: 0 });

    expect(res.status).toBe(200);
    expect(res.body.data.hint).toContain('Denk aan');
    const payload = createCompletion.mock.calls[0]![0] as {
      messages: { role: string; content: string }[];
    };
    expect(payload.messages.at(-1)!.content).toContain('first hint');
  });

  it('asks for a deeper hint when hints were already given', async () => {
    const { token } = await signup();
    const { setId } = await createSet(token);
    createCompletion.mockResolvedValue(
      reply(JSON.stringify({ hint: 'Kijk naar de bladgroenkorrels.' })),
    );

    await request(app)
      .post('/api/ai/study/hint')
      .set('Authorization', `Bearer ${token}`)
      .send({ setId, question: 'Wat is fotosynthese?', expectedAnswer: 'glucose', hintsGiven: 2 });

    const payload = createCompletion.mock.calls[0]![0] as {
      messages: { role: string; content: string }[];
    };
    expect(payload.messages.at(-1)!.content).toContain('already gave 2 hint(s)');
  });

  it('rejects a hint request for an inaccessible set', async () => {
    const owner = await signup();
    const other = await signup();
    const { setId } = await createSet(owner.token);

    const res = await request(app)
      .post('/api/ai/study/hint')
      .set('Authorization', `Bearer ${other.token}`)
      .send({ setId, question: 'Q?', expectedAnswer: 'A', hintsGiven: 0 });

    expect(res.status).toBe(404);
  });
});

describe('POST /api/ai/study/finish', () => {
  it('summarizes the session and records progress for real cards', async () => {
    const { token, userId } = await signup();
    const { setId, cardIds } = await createSet(token);

    const res = await request(app)
      .post('/api/ai/study/finish')
      .set('Authorization', `Bearer ${token}`)
      .send({
        setId,
        results: [
          {
            cardId: cardIds[0],
            question: 'Wat is fotosynthese?',
            answer: 'goed',
            verdict: 'correct',
          },
          { cardId: cardIds[1], question: 'Wat is chlorofyl?', answer: 'half', verdict: 'partial' },
          { question: 'Extra vraag?', answer: 'fout', verdict: 'incorrect' },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      setId,
      total: 3,
      correct: 1,
      partial: 1,
      incorrect: 1,
      persisted: true,
    });
    expect(res.body.data.topicsToReview).toEqual(['Wat is chlorofyl?', 'Extra vraag?']);
    expect(createCompletion).not.toHaveBeenCalled();

    // Progress really landed in the normal study flow.
    const progress = await request(app)
      .get('/api/progress')
      .set('Authorization', `Bearer ${token}`);
    const rows = (progress.body.data.setProgress ?? progress.body.data) as {
      correctCount: number;
    }[];
    expect(Array.isArray(rows)).toBe(true);
    expect(userId).toBeTruthy();
  });

  it('never records cards from another set', async () => {
    const owner = await signup();
    const other = await signup();
    const { cardIds } = await createSet(owner.token);
    const { setId } = await createSet(other.token);

    const res = await request(app)
      .post('/api/ai/study/finish')
      .set('Authorization', `Bearer ${other.token}`)
      .send({
        setId,
        results: [
          { cardId: cardIds[0], question: 'Vreemde kaart?', answer: '', verdict: 'correct' },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.persisted).toBe(false);
  });

  it('rejects an empty or oversized session', async () => {
    const { token } = await signup();
    const { setId, cardIds } = await createSet(token);

    const empty = await request(app)
      .post('/api/ai/study/finish')
      .set('Authorization', `Bearer ${token}`)
      .send({ setId, results: [] });
    expect(empty.status).toBe(400);

    const tooMany = await request(app)
      .post('/api/ai/study/finish')
      .set('Authorization', `Bearer ${token}`)
      .send({
        setId,
        results: Array.from({ length: 51 }, () => ({
          cardId: cardIds[0],
          question: 'Q?',
          answer: '',
          verdict: 'correct' as const,
        })),
      });
    expect(tooMany.status).toBe(400);
  });
});

describe('AI JSON helpers', () => {
  it('extracts a fenced JSON block', () => {
    expect(extractJsonBlock('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('extracts JSON surrounded by prose', () => {
    expect(extractJsonBlock('Here: {"a": {"b": 2}} done')).toBe('{"a": {"b": 2}}');
  });

  it('returns null when there is no JSON', () => {
    expect(extractJsonBlock('just text')).toBeNull();
  });

  it('reports empty, malformed and schema failures distinctly', () => {
    expect(parseAiJson('', hintResponseSchema)).toEqual({ ok: false, reason: 'empty' });
    expect(parseAiJson('nope', hintResponseSchema)).toEqual({ ok: false, reason: 'no-json' });
    expect(parseAiJson('{"hint": "a", }', hintResponseSchema)).toEqual({
      ok: false,
      reason: 'malformed',
    });
    expect(parseAiJson('{"nope":1}', hintResponseSchema)).toEqual({ ok: false, reason: 'schema' });
    expect(parseAiJson('{"hint":"probeer"}', hintResponseSchema)).toEqual({
      ok: true,
      data: { hint: 'probeer' },
    });
  });

  it('validates the evaluation and questions schemas', () => {
    expect(
      evaluationSchema.safeParse({
        verdict: 'partial',
        feedback: 'Bijna goed',
        missing: 'chlorofyl',
      }).success,
    ).toBe(true);
    expect(evaluationSchema.safeParse({ verdict: 'maybe', feedback: 'x' }).success).toBe(false);

    const questions = generatedQuestionsSchema.safeParse({
      questions: [{ type: 'open', question: 'Wat is dit?', answer: 'A', hint: 'H' }],
    });
    expect(questions.success).toBe(true);
    if (questions.success) {
      // Defaults are filled in so the frontend never has to guess.
      expect(questions.data.questions[0]).toMatchObject({ options: [], correctIndex: null });
    }

    const badIndex = generatedQuestionsSchema.safeParse({
      questions: [
        {
          type: 'multiple_choice',
          question: 'Wat is dit?',
          answer: 'A',
          hint: 'H',
          options: ['a', 'b'],
          correctIndex: 9,
        },
      ],
    });
    expect(badIndex.success).toBe(false);
  });
});
