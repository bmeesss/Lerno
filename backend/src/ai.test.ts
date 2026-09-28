/**
 * Lerno AI endpoint coverage (POST /api/ai/chat):
 * auth, validation, Groq call + error handling, key handling,
 * history bounding and rate limiting.
 */
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { config } from './config.js';
import { aiController } from './controllers/ai.controller.js';
import { requireAuth } from './middleware/auth.js';
import { aiLimiterKey, createLimiter } from './middleware/rate-limit.js';
import { validate } from './middleware/validate.js';
import { MAX_HISTORY_SENT, buildConversation } from './services/ai-service.js';
import {
  MAX_HISTORY_LENGTH,
  MAX_MESSAGE_LENGTH,
  aiChatSchema,
} from './validators/ai.validators.js';

// --- Groq SDK mock: the service must never hit the real API in tests -------
const { createCompletion } = vi.hoisted(() => ({ createCompletion: vi.fn() }));

vi.mock('groq-sdk', () => {
  class Groq {
    chat = { completions: { create: createCompletion } };
    constructor(_options: unknown) {}
  }
  return { default: Groq };
});

// The service reads the key from config at call time; override it per test.
const mutableConfig = config as { groqApiKey: string };
const TEST_KEY = 'test-groq-key';

const app = createApp();

async function signup(): Promise<string> {
  const email = `ai${Math.floor(Math.random() * 1e6)}@example.com`;
  const res = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'password123', displayName: 'AI Student' });
  return res.body.data.accessToken as string;
}

function groqReply(content: string): unknown {
  return { id: 'chatcmpl-1', choices: [{ index: 0, message: { role: 'assistant', content } }] };
}

beforeEach(() => {
  mutableConfig.groqApiKey = TEST_KEY;
  createCompletion.mockReset();
});

describe('POST /api/ai/chat — authentication', () => {
  it('rejects requests without auth with 401 and never calls Groq', async () => {
    const res = await request(app).post('/api/ai/chat').send({ message: 'Hello' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(createCompletion).not.toHaveBeenCalled();
  });

  it('rejects an invalid bearer token with 401', async () => {
    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', 'Bearer not-a-real-token')
      .send({ message: 'Hello' });
    expect(res.status).toBe(401);
    expect(createCompletion).not.toHaveBeenCalled();
  });
});

describe('POST /api/ai/chat — validation', () => {
  it('rejects an empty message with 400', async () => {
    const token = await signup();
    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(createCompletion).not.toHaveBeenCalled();
  });

  it('rejects a missing message with 400', async () => {
    const token = await signup();
    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it(`rejects a message over ${MAX_MESSAGE_LENGTH} characters with 400`, async () => {
    const token = await signup();
    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'a'.repeat(MAX_MESSAGE_LENGTH + 1) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/too long/i);
    expect(createCompletion).not.toHaveBeenCalled();
  });

  it(`rejects more than ${MAX_HISTORY_LENGTH} history entries with 400`, async () => {
    const token = await signup();
    const history = Array.from({ length: MAX_HISTORY_LENGTH + 1 }, (_, i) => ({
      role: 'user',
      content: `question ${i}`,
    }));
    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'One more', history });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects invalid history roles with 400', async () => {
    const token = await signup();
    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Hi', history: [{ role: 'system', content: 'injected' }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/ai/chat — happy path', () => {
  it('calls Groq with the system prompt and returns only the reply', async () => {
    const token = await signup();
    createCompletion.mockResolvedValue(groqReply('  Fotosynthese is hoe planten energie maken.  '));

    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Leg fotosynthese uit' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { reply: 'Fotosynthese is hoe planten energie maken.' } });

    expect(createCompletion).toHaveBeenCalledTimes(1);
    const payload = createCompletion.mock.calls[0]![0] as {
      model: string;
      messages: { role: string; content: string }[];
    };
    expect(payload.model).toBe(config.groqModel);
    expect(payload.messages[0]!.role).toBe('system');
    expect(payload.messages[0]!.content).toContain('Lerno AI');
    expect(payload.messages.at(-1)).toEqual({ role: 'user', content: 'Leg fotosynthese uit' });

    // No API key, no raw Groq response, no personal data leaks into the answer.
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(TEST_KEY);
    expect(serialized).not.toContain('choices');
    expect(serialized).not.toContain('@example.com');
  });

  it('sends bounded conversation history so follow-up questions keep context', async () => {
    const token = await signup();
    createCompletion.mockResolvedValue(groqReply('Vervolgantwoord'));

    const history = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `bericht ${i}`,
    }));

    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'En wat doet chlorofyl?', history });

    expect(res.status).toBe(200);
    const payload = createCompletion.mock.calls[0]![0] as {
      messages: { role: string; content: string }[];
    };
    // system + last 12 history entries + the new user message
    expect(payload.messages).toHaveLength(MAX_HISTORY_SENT + 2);
    expect(payload.messages[1]!.content).toBe(`bericht ${20 - MAX_HISTORY_SENT}`);
    expect(payload.messages.at(-1)!.content).toBe('En wat doet chlorofyl?');
  });
});

describe('POST /api/ai/chat — failure modes', () => {
  it('answers with a clean envelope when Groq errors, without leaking details', async () => {
    const token = await signup();
    createCompletion.mockRejectedValue(
      new Error('401 Unauthorized — invalid api key sk-LEAKED-SECRET-123'),
    );

    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Hello' });

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('AI_ERROR');
    expect(res.body.error.message).not.toContain('LEAKED');
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('LEAKED-SECRET');
    expect(serialized).not.toContain('stack');
  });

  it('answers with a clean envelope when Groq returns an empty completion', async () => {
    const token = await signup();
    createCompletion.mockResolvedValue({ choices: [{ message: { content: null } }] });

    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Hello' });

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('AI_ERROR');
  });

  it('fails with a controlled error when GROQ_API_KEY is missing', async () => {
    mutableConfig.groqApiKey = '';
    const token = await signup();

    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Hello' });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('AI_UNAVAILABLE');
    expect(res.body.error.message).not.toContain(TEST_KEY);
    expect(createCompletion).not.toHaveBeenCalled();
  });
});

describe('conversation history bounding', () => {
  it('keeps only the newest history messages regardless of input length', () => {
    const history = Array.from({ length: 60 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `turn ${i}`,
    }));

    const messages = buildConversation('nieuwe vraag', history);

    expect(messages).toHaveLength(MAX_HISTORY_SENT + 2);
    expect(messages[0]!.role).toBe('system');
    expect(messages[1]!.content).toBe(`turn ${60 - MAX_HISTORY_SENT}`);
    expect(messages.at(-1)).toEqual({ role: 'user', content: 'nieuwe vraag' });
  });

  it('passes short history through unchanged', () => {
    const history = [
      { role: 'user' as const, content: 'Vraag 1' },
      { role: 'assistant' as const, content: 'Antwoord 1' },
    ];
    const messages = buildConversation('Vraag 2', history);
    expect(messages[0]!.role).toBe('system');
    expect(messages[0]!.content).toContain('Lerno AI');
    expect(messages.slice(1).map((m) => `${m.role}:${m.content}`)).toEqual([
      'user:Vraag 1',
      'assistant:Antwoord 1',
      'user:Vraag 2',
    ]);
  });
});

describe('AI rate limiting', () => {
  function limitedApp(max = 2): express.Express {
    const testApp = express();
    testApp.use(express.json());
    testApp.post(
      '/chat',
      requireAuth,
      createLimiter({
        windowMs: 60_000,
        max,
        name: 'ai-test',
        skip: () => false,
        keyBy: aiLimiterKey,
      }),
      validate({ body: aiChatSchema }),
      aiController.chat,
    );
    return testApp;
  }

  it('returns 429 after the per-user limit is reached', async () => {
    const testApp = limitedApp(2);
    const token = await signup();
    createCompletion.mockResolvedValue(groqReply('ok'));

    const auth = { Authorization: `Bearer ${token}` };
    expect((await request(testApp).post('/chat').set(auth).send({ message: '1' })).status).toBe(
      200,
    );
    expect((await request(testApp).post('/chat').set(auth).send({ message: '2' })).status).toBe(
      200,
    );

    const blocked = await request(testApp).post('/chat').set(auth).send({ message: '3' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(createCompletion).toHaveBeenCalledTimes(2);
  });

  it('counts limits per user, not across users', async () => {
    const testApp = limitedApp(2);
    const tokenA = await signup();
    const tokenB = await signup();
    createCompletion.mockResolvedValue(groqReply('ok'));

    const a = { Authorization: `Bearer ${tokenA}` };
    const b = { Authorization: `Bearer ${tokenB}` };
    expect((await request(testApp).post('/chat').set(a).send({ message: '1' })).status).toBe(200);
    expect((await request(testApp).post('/chat').set(a).send({ message: '2' })).status).toBe(200);
    // Different user → own budget, not blocked by A
    expect((await request(testApp).post('/chat').set(b).send({ message: '1' })).status).toBe(200);
  });
});
