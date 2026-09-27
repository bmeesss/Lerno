/**
 * Master Build coverage: MCP learning-action tools over Streamable HTTP.
 *
 * Real JSON-RPC requests through the Express app (supertest); results are
 * cross-checked against the normal REST API to prove the same services and
 * rules apply. No mocks of the MCP surface.
 */
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

const app = createApp();
const ACCEPT = 'application/json, text/event-stream';
const MISSING_UUID = '00000000-0000-0000-0000-000000000000';

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

const authHeader = (token: string): { Authorization: string } => ({
  Authorization: `Bearer ${token}`,
});

interface RpcTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: Record<string, unknown>;
}

interface RpcEnvelope {
  result?: {
    tools?: RpcTool[];
    content?: { type: string; text: string }[];
    isError?: boolean;
    structuredContent?: unknown;
  };
  error?: { code: number; message: string };
}

async function mcpRaw(token: string | null, body: unknown): Promise<request.Response> {
  const req = request(app).post('/api/mcp').set('Accept', ACCEPT).send(body);
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req;
}

function rpc(res: request.Response): RpcEnvelope {
  expect(res.status).toBe(200);
  const line = res.text
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith('data: '));
  expect(line).toBeDefined();
  return JSON.parse(line!.slice('data: '.length)) as RpcEnvelope;
}

async function callTool(token: string, name: string, args: Record<string, unknown> = {}) {
  const envelope = rpc(
    await mcpRaw(token, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  );
  expect(envelope.error).toBeUndefined();
  const content = envelope.result!.content!;
  return {
    text: content[0]!.text,
    isError: envelope.result!.isError ?? false,
    structured: envelope.result!.structuredContent as Record<string, unknown> | undefined,
  };
}

async function restCreateSet(
  token: string,
  title: string,
  cards: { question: string; answer: string }[] = [],
  extra: Record<string, unknown> = {},
): Promise<{ setId: string; cards: { id: string }[] }> {
  const res = await request(app)
    .post('/api/sets')
    .set(authHeader(token))
    .send({ title, cards, ...extra });
  expect(res.status).toBe(201);
  const setId = res.body.data.id as string;
  const detail = await request(app).get(`/api/sets/${setId}`).set(authHeader(token));
  expect(detail.status).toBe(200);
  return { setId, cards: detail.body.data.cards as { id: string }[] };
}

async function review(
  token: string,
  setId: string,
  cardId: string,
  result: 'correct' | 'incorrect',
): Promise<void> {
  const res = await request(app)
    .post('/api/study/review')
    .set(authHeader(token))
    .send({ setId, cardId, result });
  expect(res.status).toBe(200);
}

describe('mcp learn: tool schemas and annotations', () => {
  it('advertises five read-only, non-destructive learning tools', async () => {
    const { token } = await signup('McpLearnSchema');
    const envelope = rpc(
      await mcpRaw(token, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    );
    const tools = envelope.result!.tools!;
    expect(tools).toHaveLength(20);
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    for (const name of [
      'lerno_start_practice',
      'lerno_start_quiz',
      'lerno_get_wrong_cards',
      'lerno_get_study_recommendation',
      'lerno_create_study_plan',
    ]) {
      const tool = byName.get(name);
      expect(tool).toBeDefined();
      expect(tool!.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      });
      expect(tool!.description?.length).toBeGreaterThan(20);
      expect(JSON.stringify(tool!.inputSchema)).not.toMatch(/userId|user_id|ownerId/i);
    }

    const schemas = new Map(
      tools.map((tool) => [tool.name, tool.inputSchema as { required?: string[] }]),
    );
    expect(schemas.get('lerno_start_practice')!.required).toContain('setId');
    expect(schemas.get('lerno_start_quiz')!.required).toContain('setId');
    // Filters are optional; identity always comes from auth.
    for (const name of [
      'lerno_get_wrong_cards',
      'lerno_get_study_recommendation',
      'lerno_create_study_plan',
    ]) {
      expect(schemas.get(name)!.required ?? []).not.toContain('userId');
    }
  });

  it('rejects unauthenticated learning calls at HTTP level', async () => {
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'lerno_get_study_recommendation', arguments: {} },
    };
    expect((await mcpRaw(null, body)).status).toBe(401);
    expect((await mcpRaw('bogus-token', body)).status).toBe(401);
  });
});

describe('mcp learn: lerno_start_practice', () => {
  it('returns the website-identical practice queue', async () => {
    const { token } = await signup('McpLearnPractice');
    const { setId } = await restCreateSet(token, 'Oefenstof', [
      { question: 'Q1?', answer: 'A1' },
      { question: 'Q2?', answer: 'A2' },
      { question: 'Q3?', answer: 'A3' },
    ]);

    const viaMcp = await callTool(token, 'lerno_start_practice', { setId });
    expect(viaMcp.isError).toBe(false);
    const viaRest = await request(app).get(`/api/study/practice/${setId}`).set(authHeader(token));
    expect(viaRest.status).toBe(200);

    expect(viaMcp.structured!.totalCards).toBe(3);
    expect(viaMcp.structured!.returned).toBe(3);
    const mcpIds = ((viaMcp.structured!.cards as { id: string }[]) ?? []).map((card) => card.id);
    const restIds = (viaRest.body.data.cards as { card: { id: string } }[]).map(
      (entry) => entry.card.id,
    );
    expect(mcpIds).toEqual(restIds);
    // The AI needs answers to check the student, like lerno_get_cards.
    for (const card of viaMcp.structured!.cards as { question: string; answer: string }[]) {
      expect(card.question.length).toBeGreaterThan(0);
      expect(card.answer.length).toBeGreaterThan(0);
    }
  });

  it('honors a smaller limit and enforces visibility', async () => {
    const owner = await signup('McpLearnPracticeLimit');
    const stranger = await signup('McpLearnPracticeStranger');
    const { setId } = await restCreateSet(owner.token, 'Limiet', [
      { question: 'Q1?', answer: 'A1' },
      { question: 'Q2?', answer: 'A2' },
      { question: 'Q3?', answer: 'A3' },
    ]);

    const limited = await callTool(owner.token, 'lerno_start_practice', { setId, limit: 2 });
    expect(limited.isError).toBe(false);
    expect(limited.structured!.totalCards).toBe(3);
    expect(limited.structured!.returned).toBe(2);

    const badLimit = await callTool(owner.token, 'lerno_start_practice', { setId, limit: 0 });
    expect(badLimit.isError).toBe(true);

    const foreign = await callTool(stranger.token, 'lerno_start_practice', { setId });
    expect(foreign.isError).toBe(true);
    expect(foreign.text).toMatch(/\[NOT_FOUND\]/);

    const missing = await callTool(owner.token, 'lerno_start_practice', { setId: MISSING_UUID });
    expect(missing.isError).toBe(true);
    expect(missing.text).toMatch(/\[NOT_FOUND\]/);
  });

  it('lets anyone practice public sets', async () => {
    const owner = await signup('McpLearnPracticePublic');
    const stranger = await signup('McpLearnPracticeGuest');
    const { setId } = await restCreateSet(
      owner.token,
      'Openbaar oefenen',
      [{ question: 'Q?', answer: 'A' }],
      { visibility: 'public' },
    );
    const res = await callTool(stranger.token, 'lerno_start_practice', { setId });
    expect(res.isError).toBe(false);
    expect(res.structured!.returned).toBe(1);
  });
});

describe('mcp learn: lerno_start_quiz', () => {
  it('returns the website quiz without correct answers', async () => {
    const { token } = await signup('McpLearnQuiz');
    const { setId } = await restCreateSet(token, 'Quizstof', [
      { question: 'Q1?', answer: 'A1' },
      { question: 'Q2?', answer: 'A2' },
    ]);

    const res = await callTool(token, 'lerno_start_quiz', { setId });
    expect(res.isError).toBe(false);
    expect(res.structured!.questionCount).toBe(2);
    const quiz = res.structured!.quiz as {
      questions: Record<string, unknown>[];
      setId: string;
    };
    expect(quiz.setId).toBe(setId);
    expect(quiz.questions).toHaveLength(2);
    for (const question of quiz.questions) {
      expect(question).not.toHaveProperty('correctAnswer');
      expect(question).toHaveProperty('prompt');
    }
  });

  it('matches website behavior for empty and foreign sets', async () => {
    const owner = await signup('McpLearnQuizEdge');
    const stranger = await signup('McpLearnQuizEdgeB');
    const { setId } = await restCreateSet(owner.token, 'Lege quizset');

    const empty = await callTool(owner.token, 'lerno_start_quiz', { setId });
    expect(empty.isError).toBe(true);
    expect(empty.text).toMatch(/at least one card/);

    const foreign = await callTool(stranger.token, 'lerno_start_quiz', { setId });
    expect(foreign.isError).toBe(true);
    expect(foreign.text).toMatch(/\[NOT_FOUND\]/);
  });
});

describe('mcp learn: lerno_get_wrong_cards', () => {
  it('returns recently failed cards, most recent first', async () => {
    const { token } = await signup('McpLearnWrong');
    const { setId, cards } = await restCreateSet(token, 'Foutjes', [
      { question: 'Q1?', answer: 'A1' },
      { question: 'Q2?', answer: 'A2' },
      { question: 'Q3?', answer: 'A3' },
    ]);
    await review(token, setId, cards[0]!.id, 'incorrect');
    await review(token, setId, cards[1]!.id, 'correct');
    await review(token, setId, cards[2]!.id, 'incorrect');
    await review(token, setId, cards[2]!.id, 'incorrect');

    const res = await callTool(token, 'lerno_get_wrong_cards', {});
    expect(res.isError).toBe(false);
    expect(res.structured!.total).toBe(2);
    const wrong = res.structured!.cards as {
      cardId: string;
      question: string;
      answer: string;
      setTitle: string;
      incorrectCount: number;
    }[];
    expect(wrong.map((card) => card.cardId)).toEqual([cards[2]!.id, cards[0]!.id]);
    expect(wrong[0]!.incorrectCount).toBe(2);
    expect(wrong[0]!.setTitle).toBe('Foutjes');
    expect(wrong[0]!.answer).toBe('A3');
  });

  it('filters by set, limits the output and isolates users', async () => {
    const first = await signup('McpLearnWrongA');
    const second = await signup('McpLearnWrongB');
    const setA = await restCreateSet(first.token, 'Set A', [
      { question: 'QA1?', answer: 'AA1' },
      { question: 'QA2?', answer: 'AA2' },
    ]);
    const setB = await restCreateSet(first.token, 'Set B', [{ question: 'QB?', answer: 'AB' }]);
    const other = await restCreateSet(second.token, 'Ander', [{ question: 'Q?', answer: 'A' }]);
    await review(first.token, setA.setId, setA.cards[0]!.id, 'incorrect');
    await review(first.token, setA.setId, setA.cards[1]!.id, 'incorrect');
    await review(first.token, setB.setId, setB.cards[0]!.id, 'incorrect');
    await review(second.token, other.setId, other.cards[0]!.id, 'incorrect');

    const filtered = await callTool(first.token, 'lerno_get_wrong_cards', {
      setId: setA.setId,
    });
    expect(filtered.isError).toBe(false);
    expect(filtered.structured!.total).toBe(2);

    const limited = await callTool(first.token, 'lerno_get_wrong_cards', { limit: 1 });
    expect(limited.isError).toBe(false);
    expect(limited.structured!.total).toBe(3);
    expect((limited.structured!.cards as unknown[])).toHaveLength(1);

    // The second user only ever sees their own mistakes.
    const isolated = await callTool(second.token, 'lerno_get_wrong_cards', {});
    expect(isolated.structured!.total).toBe(1);

    const foreign = await callTool(second.token, 'lerno_get_wrong_cards', { setId: setA.setId });
    expect(foreign.isError).toBe(true);
    expect(foreign.text).toMatch(/\[NOT_FOUND\]/);
  });
});

describe('mcp learn: lerno_get_study_recommendation', () => {
  it('returns the exact website recommendation with context', async () => {
    const { token } = await signup('McpLearnReco');
    const { setId, cards } = await restCreateSet(token, 'Advies', [
      { question: 'Q?', answer: 'A' },
    ]);
    await review(token, setId, cards[0]!.id, 'incorrect');

    const res = await callTool(token, 'lerno_get_study_recommendation', {});
    expect(res.isError).toBe(false);
    const today = await request(app).get('/api/progress/today').set(authHeader(token));
    expect(today.status).toBe(200);
    expect(res.structured!.action).toEqual(today.body.data.continueAction);
    const context = res.structured!.context as Record<string, unknown>;
    expect(context.cardsDue).toBe(today.body.data.cardsDue);
    expect(context.streak).toEqual(today.body.data.streak);
  });
});

describe('mcp learn: lerno_create_study_plan', () => {
  it('plans due cards first across the requested days', async () => {
    const { token } = await signup('McpLearnPlan');
    const cards = Array.from({ length: 12 }, (_, i) => ({
      question: `PQ${i}?`,
      answer: `PA${i}`,
    }));
    const { setId, cards: created } = await restCreateSet(token, 'Planning', cards);
    // 3 due (incorrect → due immediately), 2 scheduled ahead, 7 new.
    await review(token, setId, created[0]!.id, 'incorrect');
    await review(token, setId, created[1]!.id, 'incorrect');
    await review(token, setId, created[2]!.id, 'incorrect');
    await review(token, setId, created[3]!.id, 'correct');
    await review(token, setId, created[4]!.id, 'correct');

    const res = await callTool(token, 'lerno_create_study_plan', { days: 2 });
    expect(res.isError).toBe(false);
    expect(res.structured!.days).toBe(2);
    expect(res.structured!.totals).toEqual({
      sets: 1,
      dueCards: 3,
      wrongCards: 0,
      newCards: 7,
    });
    const plan = res.structured!.plan as {
      day: string;
      focus: { action: string; cards: number }[];
    }[];
    expect(plan).toHaveLength(1);
    expect(plan[0]!.focus[0]).toMatchObject({ action: 'review-due', cards: 3 });
    // Day capacity is one daily goal: 3 due + 7 new fills day one.
    expect(plan[0]!.focus.reduce((sum, entry) => sum + entry.cards, 0)).toBe(10);
  });

  it('scopes to the requested sets and rejects foreign ones', async () => {
    const owner = await signup('McpLearnPlanScope');
    const stranger = await signup('McpLearnPlanScopeB');
    const first = await restCreateSet(owner.token, 'Eerste', [{ question: 'Q?', answer: 'A' }]);
    await restCreateSet(owner.token, 'Tweede', [{ question: 'Q?', answer: 'A' }]);

    const scoped = await callTool(owner.token, 'lerno_create_study_plan', {
      days: 3,
      setIds: [first.setId],
    });
    expect(scoped.isError).toBe(false);
    expect((scoped.structured!.totals as { sets: number }).sets).toBe(1);

    const foreign = await callTool(stranger.token, 'lerno_create_study_plan', {
      setIds: [first.setId],
    });
    expect(foreign.isError).toBe(true);
    expect(foreign.text).toMatch(/\[NOT_FOUND\]/);

    const missing = await callTool(owner.token, 'lerno_create_study_plan', {
      setIds: [MISSING_UUID],
    });
    expect(missing.isError).toBe(true);
    expect(missing.text).toMatch(/\[NOT_FOUND\]/);

    const badDays = await callTool(owner.token, 'lerno_create_study_plan', { days: 99 });
    expect(badDays.isError).toBe(true);
  });

  it('is deterministic and honest when there is nothing to plan', async () => {
    const { token } = await signup('McpLearnPlanEmpty');
    const first = await callTool(token, 'lerno_create_study_plan', {});
    const second = await callTool(token, 'lerno_create_study_plan', {});
    expect(first.isError).toBe(false);
    expect(first.structured).toEqual(second.structured);
    expect(first.structured!.plan).toEqual([]);
    expect(first.structured!.note).toMatch(/nothing due/i);
  });

  it('ignores forged identity fields', async () => {
    const owner = await signup('McpLearnPlanForge');
    const stranger = await signup('McpLearnPlanForgeB');
    await restCreateSet(owner.token, 'Van mij', [{ question: 'Q?', answer: 'A' }]);
    const res = await callTool(owner.token, 'lerno_create_study_plan', {
      userId: stranger.userId,
      role: 'admin',
    });
    expect(res.isError).toBe(false);
    expect((res.structured!.totals as { sets: number }).sets).toBe(1);
  });
});
