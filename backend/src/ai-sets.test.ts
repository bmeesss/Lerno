import { completionBudget } from './services/ai-completion.js';
/**
 * Lerno AI study-set actions (POST /api/ai/sets/:setId/…).
 *
 * Focus of this suite: data isolation and safe, bounded context handling.
 * Groq is always mocked — no real key, no network.
 */
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { config } from './config.js';
import { buildSetContext } from './services/ai-context.js';
import { AI_TASKS } from './services/ai-prompts.js';

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

let userCounter = 0;

async function signup(): Promise<{ token: string; userId: string }> {
  userCounter += 1;
  const email = `aiset${userCounter}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const res = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'password123', displayName: 'AI Set Student' });
  return { token: res.body.data.accessToken as string, userId: res.body.data.user.id as string };
}

async function createSet(
  token: string,
  body: {
    title: string;
    description?: string;
    level?: string;
    visibility?: 'private' | 'public';
    cards?: { question: string; answer: string }[];
  },
): Promise<string> {
  const res = await request(app)
    .post('/api/sets')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: body.title,
      description: body.description ?? '',
      level: body.level ?? 'havo 4',
      visibility: body.visibility ?? 'private',
      cards: body.cards ?? [
        { question: 'Wat is fotosynthese?', answer: 'Planten maken glucose uit licht.' },
        { question: 'Wat is chlorofyl?', answer: 'De groene kleurstof in bladeren.' },
      ],
    });
  return res.body.data.id as string;
}

function reply(content: string): unknown {
  return { choices: [{ index: 0, message: { role: 'assistant', content } }] };
}

function lastPayload(): { messages: { role: string; content: string }[] } {
  return createCompletion.mock.calls[0]![0] as { messages: { role: string; content: string }[] };
}

beforeEach(() => {
  mutableConfig.groqApiKey = TEST_KEY;
  createCompletion.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/ai/sets/:setId/explain — authentication', () => {
  it('returns 401 without a token and never calls Groq', async () => {
    const res = await request(app).post(
      '/api/ai/sets/00000000-0000-4000-8000-000000000000/explain',
    );
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(createCompletion).not.toHaveBeenCalled();
  });
});

describe('POST /api/ai/sets/:setId/explain — ownership / data isolation', () => {
  it('explains a set the user owns', async () => {
    const { token } = await signup();
    const setId = await createSet(token, { title: 'Fotosynthese' });
    createCompletion.mockResolvedValue(reply('Fotosynthese is hoe planten energie maken.'));

    const res = await request(app)
      .post(`/api/ai/sets/${setId}/explain`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.explanation).toBe('Fotosynthese is hoe planten energie maken.');
    expect(res.body.data.meta).toMatchObject({ setId, totalCards: 2 });
    expect(createCompletion).toHaveBeenCalledTimes(1);

    // The prompt carries the set content and nothing else.
    const userMessage = lastPayload().messages.at(-1)!.content;
    expect(userMessage).toContain('Fotosynthese');
    expect(userMessage).toContain('Wat is fotosynthese?');
  });

  it("reports another user's private set as not found (no data, no leak)", async () => {
    const owner = await signup();
    const other = await signup();
    const setId = await createSet(owner.token, { title: 'Secret set', visibility: 'private' });
    createCompletion.mockResolvedValue(reply('should never be used'));

    const res = await request(app)
      .post(`/api/ai/sets/${setId}/explain`)
      .set('Authorization', `Bearer ${other.token}`)
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toBe('Study set not found');
    expect(JSON.stringify(res.body)).not.toContain('Secret set');
    expect(createCompletion).not.toHaveBeenCalled();
  });

  it('lets another signed-in user use AI on a public set', async () => {
    const owner = await signup();
    const other = await signup();
    const setId = await createSet(owner.token, { title: 'Public biology', visibility: 'public' });
    createCompletion.mockResolvedValue(reply('Iedereen mag dit leren.'));

    const res = await request(app)
      .post(`/api/ai/sets/${setId}/explain`)
      .set('Authorization', `Bearer ${other.token}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.explanation).toBe('Iedereen mag dit leren.');
  });

  it('rejects a manipulated (non-uuid) set id with the same 400 as other set routes', async () => {
    const { token } = await signup();
    const res = await request(app)
      .post('/api/ai/sets/not-a-uuid/explain')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(createCompletion).not.toHaveBeenCalled();
  });

  it('returns 404 for a valid but unknown set id', async () => {
    const { token } = await signup();
    const res = await request(app)
      .post('/api/ai/sets/00000000-0000-4000-8000-000000000123/explain')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(createCompletion).not.toHaveBeenCalled();
  });

  it('refuses a set without cards instead of asking the model to invent one', async () => {
    const { token } = await signup();
    const res = await request(app)
      .post('/api/sets')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Empty set', visibility: 'private' });
    const setId = res.body.data.id as string;

    const ai = await request(app)
      .post(`/api/ai/sets/${setId}/explain`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(ai.status).toBe(400);
    expect(ai.body.error.code).toBe('VALIDATION_ERROR');
    expect(createCompletion).not.toHaveBeenCalled();
  });
});

describe('POST /api/ai/sets/:setId/explain — context handling', () => {
  it('trims huge sets instead of sending everything', async () => {
    const { token } = await signup();
    const cards = Array.from({ length: 120 }, (_, index) => ({
      question: `Vraag ${index} met een lange omschrijving ${'x'.repeat(40)}`,
      answer: `Antwoord ${index}`,
    }));
    const setId = await createSet(token, { title: 'Grote set', cards });
    createCompletion.mockResolvedValue(reply('Samenvatting van de grote set.'));

    const res = await request(app)
      .post(`/api/ai/sets/${setId}/explain`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(200);
    const userMessage = lastPayload().messages.at(-1)!.content;
    expect(userMessage.length).toBeLessThanOrEqual(config.aiContextMaxChars + 400);
    expect(res.body.data.meta.omittedCards).toBeGreaterThan(0);
    expect(userMessage).toContain('more cards in this set are not shown');
  });

  it('caps a single huge card', async () => {
    const { token } = await signup();
    const setId = await createSet(token, {
      title: 'Grote kaart',
      cards: [
        { question: 'Q', answer: 'A'.repeat(3500) },
        { question: 'Q2', answer: 'A2' },
      ],
    });
    createCompletion.mockResolvedValue(reply('Ok.'));

    const res = await request(app)
      .post(`/api/ai/sets/${setId}/explain`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(200);
    // The raw 3500-char answer never reaches the model.
    expect(lastPayload().messages.at(-1)!.content).not.toContain('A'.repeat(600));
  });

  it('uses the compact explanation prompt and budget', async () => {
    const { token } = await signup();
    const setId = await createSet(token, { title: 'Biologie' });
    createCompletion.mockResolvedValue(reply('Korte uitleg.'));

    await request(app)
      .post(`/api/ai/sets/${setId}/explain`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    const payload = createCompletion.mock.calls[0]![0] as {
      messages: { role: string; content: string }[];
      max_completion_tokens: number;
    };
    expect(payload.max_completion_tokens).toBe(
      completionBudget({ action: 'explain', maxOutputTokens: AI_TASKS.explain.maxOutputTokens }),
    );
    expect(payload.messages[0]!.role).toBe('system');
    expect(payload.messages[0]!.content).toContain('Context source: supplied Lerno set.');
    // One system prompt, one payload — no duplicated instructions.
    expect(payload.messages.filter((message) => message.role === 'system')).toHaveLength(1);
  });

  it("adds the student's extra focus to the payload", async () => {
    const { token } = await signup();
    const setId = await createSet(token, { title: 'Biologie' });
    createCompletion.mockResolvedValue(reply('Ok.'));

    await request(app)
      .post(`/api/ai/sets/${setId}/explain`)
      .set('Authorization', `Bearer ${token}`)
      .send({ focus: 'let op de rol van chlorofyl' });

    expect(lastPayload().messages.at(-1)!.content).toContain('let op de rol van chlorofyl');
  });

  it('returns a clean error when the AI is unavailable', async () => {
    const { token } = await signup();
    const setId = await createSet(token, { title: 'Biologie' });
    mutableConfig.groqApiKey = '';

    const res = await request(app)
      .post(`/api/ai/sets/${setId}/explain`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('AI_UNAVAILABLE');
    expect(createCompletion).not.toHaveBeenCalled();
  });

  it('maps upstream timeouts to AI_TIMEOUT without leaking details', async () => {
    const { token } = await signup();
    const setId = await createSet(token, { title: 'Biologie' });
    const timeout = new Error('upstream socket hang');
    timeout.name = 'APIConnectionTimeoutError';
    createCompletion.mockRejectedValue(timeout);

    const res = await request(app)
      .post(`/api/ai/sets/${setId}/explain`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe('AI_TIMEOUT');
    expect(JSON.stringify(res.body)).not.toContain('socket');
  });

  it('never returns an answer that leaks a secret', async () => {
    const { token } = await signup();
    const setId = await createSet(token, { title: 'Biologie' });
    createCompletion.mockResolvedValue(
      reply('Hier is de key: ' + 'gsk_' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
    );

    const res = await request(app)
      .post(`/api/ai/sets/${setId}/explain`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.explanation).not.toContain('gsk_');
  });
});

describe('POST /api/ai/sets/:setId/summarize', () => {
  it('summarizes a set the user owns', async () => {
    const { token } = await signup();
    const setId = await createSet(token, { title: 'Franse Revolutie' });
    createCompletion.mockResolvedValue(reply('- 1789\n- Bestorming van de Bastille'));

    const res = await request(app)
      .post(`/api/ai/sets/${setId}/summarize`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.summary).toContain('1789');
    const payload = createCompletion.mock.calls[0]![0] as { max_completion_tokens: number };
    expect(payload.max_completion_tokens).toBe(
      completionBudget({
        action: 'summarize',
        maxOutputTokens: AI_TASKS.summarize.maxOutputTokens,
      }),
    );
  });

  it("is not available for another user's private set", async () => {
    const owner = await signup();
    const other = await signup();
    const setId = await createSet(owner.token, { title: 'Privé', visibility: 'private' });

    const res = await request(app)
      .post(`/api/ai/sets/${setId}/summarize`)
      .set('Authorization', `Bearer ${other.token}`)
      .send({});

    expect(res.status).toBe(404);
    expect(createCompletion).not.toHaveBeenCalled();
  });
});

describe('buildSetContext', () => {
  const set = {
    id: 'set-1',
    ownerId: 'owner-1',
    subjectId: null,
    subjectName: 'Biologie',
    title: 'Fotosynthese',
    slug: 'fotosynthese',
    description: 'H4',
    level: 'havo 4',
    visibility: 'private' as const,
    tags: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  const card = (id: string, question: string, answer: string, position: number) =>
    ({
      id,
      setId: 'set-1',
      question,
      answer,
      position,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    }) as never;

  it('de-duplicates identical cards', () => {
    const context = buildSetContext(set, [
      card('a', 'Same?', 'Same!', 0),
      card('b', 'Same?', 'Same!', 1),
      card('c', 'Other?', 'Other!', 2),
    ]);

    expect(context.cardCount).toBe(2);
    expect(context.totalCards).toBe(2);
  });

  it('handles empty input without inventing content', () => {
    const context = buildSetContext(set, []);
    expect(context.cardCount).toBe(0);
    expect(context.text).toContain('CARDS: 0');
  });

  it('normalizes whitespace and control characters', () => {
    const context = buildSetContext(set, [card('a', 'Wat  is\n dit?', 'Antwoord', 0)]);
    expect(context.text).not.toMatch(/\n{2,}/);
    expect(context.text).toContain('Wat is dit?');
  });

  it('respects the card and character caps', () => {
    const cards = Array.from({ length: 40 }, (_, index) =>
      card(`c${index}`, `Vraag ${index} ${'y'.repeat(120)}`, `Antwoord ${index}`, index),
    );
    const context = buildSetContext(set, cards, { maxCards: 10, maxChars: 3000 });
    expect(context.cardCount).toBeLessThanOrEqual(10);
    expect(context.omittedCards).toBeGreaterThan(0);
    expect(context.text.length).toBeLessThanOrEqual(3400);
  });
});

describe('AI learning endpoints — rate limiting', () => {
  it('applies the strict per-user AI quota to set actions', async () => {
    const { token } = await signup();
    const setId = await createSet(token, { title: 'Quota set' });
    createCompletion.mockResolvedValue(reply('Antwoord.'));

    // The limiters are enabled outside the test environment; flip the flag so
    // this test exercises the real route-level configuration.
    const mutableTestConfig = config as unknown as { isTest: boolean };
    mutableTestConfig.isTest = false;
    try {
      let limited: number | null = null;
      for (let attempt = 1; attempt <= config.aiRateLimitMax + 2; attempt += 1) {
        const res = await request(app)
          .post(`/api/ai/sets/${setId}/explain`)
          .set('Authorization', `Bearer ${token}`)
          .send({});
        if (res.status === 429) {
          limited = attempt;
          expect(res.body.error.code).toBe('RATE_LIMITED');
          expect(res.body.error.retryAfter).toBeGreaterThan(0);
          break;
        }
        expect(res.status).toBe(200);
      }
      expect(limited).toBe(config.aiRateLimitMax + 1);
    } finally {
      mutableTestConfig.isTest = true;
    }
  });
});
