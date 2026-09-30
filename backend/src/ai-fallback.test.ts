/**
 * Groq → Cerebras fallback (docs/AI.md → "Providers").
 *
 * Groq stays the primary provider; a *transient* Groq failure is retried once at
 * Cerebras with the exact same request, context and sampling settings. These
 * tests prove the whole decision table, that the fallback cannot become a retry
 * loop, and that neither the key nor the provider choice ever reaches the
 * client, the logs or the frontend bundle.
 *
 * No test touches a real provider: the Groq SDK is mocked and the Cerebras HTTP
 * call is intercepted at `fetch`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createApp } from './app.js';
import { config } from './config.js';
import { guardSecretLeak, SAFE_REFUSAL } from './lib/ai-guard.js';
import { requestChat, type ChatRequest } from './services/ai-completion.js';
import { buildChatRequest } from './services/ai-service.js';
import { runStructuredAiTask } from './services/ai-tasks.js';
import { classifyProviderError, isTransientProviderError } from './services/ai-providers.js';
import type { AiChatMessage } from './validators/ai.validators.js';

// --- Groq: the existing SDK, mocked at module level -------------------------

const { groqSdk, cerebras } = vi.hoisted(() => ({
  groqSdk: {
    calls: [] as Array<Record<string, unknown>>,
    value: null as unknown,
    error: null as unknown,
  },
  cerebras: {
    calls: [] as Array<{
      url: string;
      authorization: string | null;
      body: Record<string, unknown>;
    }>,
    /** Answers per call, in order; the last one repeats. */
    values: [] as unknown[],
    error: null as unknown,
    status: 200,
  },
}));

vi.mock('groq-sdk', () => {
  class Groq {
    // Only the primary provider uses this client; the fallback speaks HTTP.
    chat = {
      completions: {
        create: async (params: Record<string, unknown>) => {
          groqSdk.calls.push(params);
          if (groqSdk.error) throw groqSdk.error;
          return groqSdk.value;
        },
      },
    };
    constructor(_options: unknown) {}
  }
  return { default: Groq };
});

const app = createApp();
const GROQ_KEY = 'test-groq-key';
const CEREBRAS_KEY = 'test-cerebras-key-material';
const CEREBRAS_MODEL = 'gpt-oss-120b';
const CEREBRAS_URL = 'https://api.cerebras.ai/v1/chat/completions';

const mutableConfig = config as unknown as {
  groqApiKey: string;
  cerebrasApiKey: string;
  cerebrasModel: string;
  cerebrasBaseUrl: string;
  cerebrasTimeoutMs: number;
  cerebrasMaxRetries: number;
};

// --- fixtures ---------------------------------------------------------------

function groqReply(content: string): unknown {
  return {
    choices: [{ index: 0, message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
  };
}

function cerebrasReply(content: string): unknown {
  return {
    choices: [{ index: 0, message: { role: 'assistant', content } }],
    usage: {
      prompt_tokens: 11,
      completion_tokens: 7,
      total_tokens: 18,
      completion_tokens_details: { reasoning_tokens: 3 },
    },
  };
}

/** An upstream HTTP failure shaped like the ones the Groq SDK throws. */
function httpError(status: number): Error {
  const error = new Error(`upstream responded ${status}`) as Error & { status: number };
  error.status = status;
  return error;
}

function namedError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

const chatRequest = (overrides: Partial<ChatRequest> = {}): ChatRequest => ({
  action: 'chat',
  messages: [
    { role: 'system', content: 'You are Lerno AI, a study assistant.' },
    { role: 'user', content: 'Leg fotosynthese uit op mavo 3.' },
  ],
  maxOutputTokens: 128,
  temperature: 0.4,
  ...overrides,
});

beforeEach(() => {
  mutableConfig.groqApiKey = GROQ_KEY;
  mutableConfig.cerebrasApiKey = CEREBRAS_KEY;
  mutableConfig.cerebrasModel = CEREBRAS_MODEL;
  mutableConfig.cerebrasBaseUrl = 'https://api.cerebras.ai/v1';
  mutableConfig.cerebrasTimeoutMs = 5_000;
  mutableConfig.cerebrasMaxRetries = 0;

  groqSdk.calls = [];
  groqSdk.value = groqReply('Groq antwoord');
  groqSdk.error = null;
  cerebras.calls = [];
  cerebras.values = [cerebrasReply('Cerebras antwoord')];
  cerebras.error = null;
  cerebras.status = 200;

  // The fallback client is the only part of Lerno AI that uses `fetch`.
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    cerebras.calls.push({
      url,
      authorization: headers.authorization ?? null,
      body: JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>,
    });
    if (cerebras.error) throw cerebras.error;
    const answer = cerebras.values[Math.min(cerebras.calls.length - 1, cerebras.values.length - 1)];
    return new Response(JSON.stringify(answer ?? {}), {
      status: cerebras.status,
      headers: { 'content-type': 'application/json' },
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function signup(): Promise<string> {
  const email = `aifallback${Math.floor(Math.random() * 1e6)}@example.com`;
  const res = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'password123', displayName: 'Fallback Student' });
  return res.body.data.accessToken as string;
}

// --- 1. Groq success --------------------------------------------------------

describe('1. Groq success keeps everything exactly as it was', () => {
  it('answers from Groq and never calls the fallback provider', async () => {
    const result = await requestChat(chatRequest());

    expect(result.text).toBe('Groq antwoord');
    expect(result.provider).toBe('groq');
    expect(result.model).toBe(config.groqModel);
    expect(groqSdk.calls).toHaveLength(1);
    expect(cerebras.calls).toHaveLength(0);
  });

  it('returns the Groq answer over the API without touching Cerebras', async () => {
    const token = await signup();
    groqSdk.value = groqReply('Fotosynthese in drie stappen');

    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Leg fotosynthese uit' });

    expect(res.status).toBe(200);
    expect(res.body.data.reply).toBe('Fotosynthese in drie stappen');
    expect(groqSdk.calls).toHaveLength(1);
    expect(cerebras.calls).toHaveLength(0);
  });
});

// --- 2 & 3. transient Groq failures go to the fallback ----------------------

describe('2/3. transient Groq failures are retried once at Cerebras', () => {
  it('2. Groq rate limit (429) → Cerebras answers the same request', async () => {
    groqSdk.error = httpError(429);
    cerebras.values = [cerebrasReply('Cerebras antwoord')];

    const result = await requestChat(chatRequest());

    expect(result.text).toBe('Cerebras antwoord');
    expect(result.provider).toBe('cerebras');
    expect(result.model).toBe(CEREBRAS_MODEL);
    // Exactly one attempt per provider: no retry loop.
    expect(groqSdk.calls).toHaveLength(1);
    expect(cerebras.calls).toHaveLength(1);
    expect(cerebras.calls[0]!.url).toBe(CEREBRAS_URL);
  });

  it.each([
    ['timeout', namedError('APIConnectionTimeoutError', 'Request timed out.')],
    ['network failure', namedError('APIConnectionError', 'Connection error.')],
    ['upstream 503', httpError(503)],
    ['rejected credentials (401)', httpError(401)],
    ['retired model (404)', httpError(404)],
  ])('3. Groq %s → Cerebras is called', async (_label, error) => {
    groqSdk.error = error;

    const result = await requestChat(chatRequest());

    expect(result.provider).toBe('cerebras');
    expect(groqSdk.calls).toHaveLength(1);
    expect(cerebras.calls).toHaveLength(1);
    expect(isTransientProviderError(error)).toBe(true);
  });

  it('serves a student question through the fallback over the API', async () => {
    const token = await signup();
    groqSdk.error = httpError(429);
    cerebras.values = [cerebrasReply('Antwoord uit de fallback')];

    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Wat is DNA?' });

    expect(res.status).toBe(200);
    expect(res.body.data.reply).toBe('Antwoord uit de fallback');
  });
});

// --- 4. the fallback answer is returned correctly ---------------------------

describe('4. the Cerebras answer is returned like any other answer', () => {
  it('maps text, tokens and reasoning tokens from the fallback response', async () => {
    groqSdk.error = httpError(429);

    const result = await requestChat(chatRequest());

    expect(result.text).toBe('Cerebras antwoord');
    expect(result.provider).toBe('cerebras');
    expect(result.inputTokens).toBe(11);
    expect(result.outputTokens).toBe(7);
    expect(result.reasoningTokens).toBe(3);
    expect(result.totalTokens).toBe(18);
  });

  it('sends the Cerebras key as a server-side bearer token, never the Groq key', async () => {
    groqSdk.error = httpError(429);

    await requestChat(chatRequest());

    expect(cerebras.calls[0]!.authorization).toBe(`Bearer ${CEREBRAS_KEY}`);
    expect(cerebras.calls[0]!.authorization).not.toContain(GROQ_KEY);
  });

  it('accepts an OpenAI-compatible message with content parts', async () => {
    groqSdk.error = httpError(429);
    cerebras.values = [
      {
        choices: [
          {
            message: {
              content: [
                { type: 'text', text: 'Deel één' },
                { type: 'text', text: 'deel twee' },
              ],
            },
          },
        ],
      },
    ];

    const result = await requestChat(chatRequest());

    expect(result.text).toBe('Deel één deel twee');
  });
});

// --- 5. both providers fail -------------------------------------------------

describe('5. when both providers fail the existing clean error is returned', () => {
  it('reports the Groq error, not the upstream detail', async () => {
    const token = await signup();
    groqSdk.error = httpError(429);
    cerebras.status = 500;

    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Hallo' });

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('upstream responded');
    expect(serialized).not.toContain(CEREBRAS_KEY);
    expect(groqSdk.calls).toHaveLength(1);
    expect(cerebras.calls).toHaveLength(1);
  });

  it('maps the primary error, whatever the fallback failed with', async () => {
    groqSdk.error = namedError('APIConnectionTimeoutError', 'Request timed out.');
    cerebras.status = 401;

    await expect(requestChat(chatRequest())).rejects.toMatchObject({
      code: 'AI_TIMEOUT',
      status: 504,
    });
  });

  it('gives the fallback its own hard timeout (never a hanging request)', async () => {
    mutableConfig.cerebrasTimeoutMs = 30;
    groqSdk.error = httpError(429);
    vi.stubEnv('LOG_IN_TESTS', 'true');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // A provider that never answers: only the timeout ends this request.
    vi.stubGlobal(
      'fetch',
      (_url: string, init: RequestInit = {}) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(namedError('AbortError', 'The operation was aborted')),
          );
        }),
    );

    const started = Date.now();
    // Both providers failed, so the student still gets the primary's clean error.
    await expect(requestChat(chatRequest())).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(JSON.stringify(warn.mock.calls)).toContain('AI_TIMEOUT');
  });
});

// --- 6. no Cerebras key -----------------------------------------------------

describe('6. without CEREBRAS_API_KEY Lerno works exactly as before', () => {
  beforeEach(() => {
    mutableConfig.cerebrasApiKey = '';
  });

  it('still answers through Groq', async () => {
    const result = await requestChat(chatRequest());

    expect(result.text).toBe('Groq antwoord');
    expect(result.provider).toBe('groq');
    expect(cerebras.calls).toHaveLength(0);
  });

  it('reports the Groq failure instead of pretending a fallback exists', async () => {
    groqSdk.error = httpError(429);

    await expect(requestChat(chatRequest())).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(cerebras.calls).toHaveLength(0);
  });

  it('is the shipped default: the key is optional and empty in .env.example', () => {
    const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
    expect(example).toMatch(/^CEREBRAS_API_KEY=\s*$/m);
    expect(example).not.toMatch(/^CEREBRAS_API_KEY=.+$/m);
  });
});

// --- 7. no exposure to the client -------------------------------------------

describe('7. the Cerebras key never reaches the client', () => {
  function filesUnder(directory: string, found: string[] = []): string[] {
    for (const entry of readdirSync(directory)) {
      if (entry === 'node_modules' || entry === 'dist' || entry === 'coverage') continue;
      const full = path.join(directory, entry);
      if (statSync(full).isDirectory()) filesUnder(full, found);
      else found.push(full);
    }
    return found;
  }

  it('is not mentioned anywhere in the frontend', () => {
    const frontend = new URL('../../frontend/', import.meta.url);
    for (const file of filesUnder(frontend.pathname)) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/cerebras/i);
    }
  });

  it('is not part of the public API responses (success or failure)', async () => {
    const token = await signup();
    groqSdk.error = httpError(429);

    const served = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Wat is DNA?' });
    expect(served.status).toBe(200);
    expect(JSON.stringify(served.body)).not.toContain(CEREBRAS_KEY);
    expect(JSON.stringify(served.body)).not.toContain('cerebras');

    cerebras.status = 500;
    const failed = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'En mitose?' });
    expect(JSON.stringify(failed.body)).not.toContain(CEREBRAS_KEY);
  });

  it('treats a Cerebras key or config name in an answer as a leak', () => {
    // Built at runtime so no key-shaped literal ever lands in the repository.
    const key = 'csk-' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234';
    expect(guardSecretLeak(`Hier is de sleutel: ${key}`)).toBe(SAFE_REFUSAL);
    expect(guardSecretLeak('Zet CEREBRAS_API_KEY in je .env')).toBe(SAFE_REFUSAL);
  });

  it('logs the provider but never the key, the prompt or the answer', async () => {
    const token = await signup();
    vi.stubEnv('LOG_IN_TESTS', 'true');
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    groqSdk.error = httpError(429);
    cerebras.values = [cerebrasReply('Het geheime antwoord')];

    await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'De geheime vraag' });

    const lines = JSON.stringify([...info.mock.calls, ...warn.mock.calls]);
    expect(lines).toContain('ai.provider.fallback');
    expect(lines).toContain('provider');
    expect(lines).not.toContain(CEREBRAS_KEY);
    expect(lines).not.toContain(GROQ_KEY);
    expect(lines).not.toContain('De geheime vraag');
    expect(lines).not.toContain('Het geheime antwoord');
  });

  it('does not log a failed action when the fallback answered', async () => {
    const token = await signup();
    vi.stubEnv('LOG_IN_TESTS', 'true');
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    groqSdk.error = httpError(429);

    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Wat is DNA?' });

    expect(res.status).toBe(200);
    expect(JSON.stringify(info.mock.calls)).toContain('ai.provider.fallback.completed');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('ai.action.failed');
  });

  it('logs one failed action (and the fallback reason) when both providers fail', async () => {
    const token = await signup();
    vi.stubEnv('LOG_IN_TESTS', 'true');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    groqSdk.error = httpError(429);
    cerebras.status = 500;

    await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Wat is DNA?' });

    const lines = JSON.stringify(warn.mock.calls);
    expect(lines.match(/ai\.action\.failed/g)).toHaveLength(1);
    expect(lines).toContain('ai.provider.fallback.failed');
    expect(lines).toContain('RATE_LIMITED');
  });
});

// --- 8. prompt parity -------------------------------------------------------

describe('8. the fallback receives the identical request', () => {
  const history: AiChatMessage[] = [
    { role: 'user', content: 'Ik zit in havo 4.' },
    { role: 'assistant', content: 'Oké, daar ga ik op letten.' },
  ];

  it('sends the same system prompt, history, context and settings', async () => {
    const request = buildChatRequest('Leg osmose uit met een voorbeeld', history);
    groqSdk.error = httpError(429);

    await requestChat(request);

    const groqBody = groqSdk.calls[0]!;
    const cerebrasBody = cerebras.calls[0]!.body;

    expect(cerebrasBody.messages).toEqual(groqBody.messages);
    expect(cerebrasBody.temperature).toEqual(groqBody.temperature);
    expect(cerebrasBody.max_completion_tokens).toEqual(groqBody.max_completion_tokens);
    expect(cerebrasBody.reasoning_effort).toEqual(groqBody.reasoning_effort);
    expect(cerebrasBody.response_format).toEqual(groqBody.response_format);
    expect(cerebrasBody.stream).toBe(false);
    // Only the model name differs: each provider serves its own.
    expect(groqBody.model).toBe(config.groqModel);
    expect(cerebrasBody.model).toBe(CEREBRAS_MODEL);
    // And the first message really is the Lerno system prompt.
    expect(String((cerebrasBody.messages as { role: string }[])[0]!.role)).toBe('system');
  });

  it('keeps JSON mode for structured tasks', async () => {
    groqSdk.error = httpError(429);
    const request: ChatRequest = {
      action: 'quiz',
      messages: [
        { role: 'system', content: 'Return JSON.' },
        { role: 'user', content: 'Maak een quiz.' },
      ],
      maxOutputTokens: 256,
      jsonMode: true,
    };

    await requestChat(request);

    expect(groqSdk.calls[0]!.response_format).toEqual({ type: 'json_object' });
    expect(cerebras.calls[0]!.body.response_format).toEqual({ type: 'json_object' });
  });
});

// --- 9. retry safety --------------------------------------------------------

describe('9. one user action never produces a second generation', () => {
  it('makes exactly one attempt per provider for one API call', async () => {
    const token = await signup();
    groqSdk.error = httpError(429);
    cerebras.values = [cerebrasReply('Eén antwoord')];

    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Wat is een cel?' });

    expect(res.status).toBe(200);
    expect(res.body.data.reply).toBe('Eén antwoord');
    expect(groqSdk.calls).toHaveLength(1);
    expect(cerebras.calls).toHaveLength(1);
  });

  it('never re-tries a failed primary once a task switched provider', async () => {
    groqSdk.error = httpError(429);
    // First fallback answer is unusable, the second one is valid: the task
    // retries the *answer*, not the dead provider.
    cerebras.values = [
      { choices: [{ message: { content: 'geen json' } }] },
      cerebrasReply('{"items":[1]}'),
    ];

    const { data } = await runStructuredAiTask({
      task: 'quiz',
      payload: 'Maak één item.',
      schema: z.object({ items: z.array(z.number()) }),
    });

    expect(data).toEqual({ items: [1] });
    expect(groqSdk.calls).toHaveLength(1);
    expect(cerebras.calls).toHaveLength(2);
  });

  it('does not switch provider for our own request/validation failures', async () => {
    groqSdk.error = httpError(400);

    await expect(requestChat(chatRequest())).rejects.toMatchObject({ code: 'AI_ERROR' });
    expect(cerebras.calls).toHaveLength(0);
    expect(classifyProviderError(httpError(400))).toBe('invalid_request');
  });

  it('does not switch provider for unknown errors from our own code', async () => {
    groqSdk.error = new TypeError('cannot read properties of undefined');

    await expect(requestChat(chatRequest())).rejects.toMatchObject({ code: 'AI_ERROR' });
    expect(cerebras.calls).toHaveLength(0);
    expect(isTransientProviderError(new TypeError('boom'))).toBe(false);
  });

  it('does not switch provider when the primary answered, even with empty text', async () => {
    // An empty completion is a *successful* call with unusable content: the
    // caller reports it as an AI error, and burning a second provider for it
    // would spend tokens on a request the student already paid for.
    groqSdk.value = { choices: [{ message: { content: '   ' } }] };

    const result = await requestChat(chatRequest());

    expect(result.text).toBe('');
    expect(result.provider).toBe('groq');
    expect(cerebras.calls).toHaveLength(0);
  });

  it('does not switch provider when the request explicitly opts out', async () => {
    groqSdk.error = httpError(429);

    await expect(requestChat(chatRequest({ fallback: false }))).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    expect(cerebras.calls).toHaveLength(0);
  });
});
