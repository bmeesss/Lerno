/**
 * Phase 7 coverage: MCP v1 read-only tools over Streamable HTTP.
 *
 * All calls go through the real Express app (supertest) with JSON-RPC
 * payloads — no mocks of the MCP surface. Responses arrive SSE-wrapped.
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

interface RpcEnvelope {
  result?: {
    tools?: { name: string; description?: string; inputSchema?: { properties?: unknown } }[];
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

function toolResult(res: request.Response): {
  text: string;
  isError: boolean;
  structured: unknown;
} {
  const envelope = rpc(res);
  expect(envelope.error).toBeUndefined();
  const content = envelope.result!.content!;
  expect(content).toHaveLength(1);
  return {
    text: content[0]!.text,
    isError: envelope.result!.isError ?? false,
    structured: envelope.result!.structuredContent,
  };
}

function callBody(name: string, args: Record<string, unknown> = {}): Record<string, unknown> {
  return { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } };
}

async function callTool(token: string, name: string, args: Record<string, unknown> = {}) {
  return toolResult(await mcpRaw(token, callBody(name, args)));
}

async function createSet(
  token: string,
  body: Record<string, unknown>,
): Promise<{ id: string; cards: { id: string }[] }> {
  const res = await request(app)
    .post('/api/sets')
    .set('Authorization', `Bearer ${token}`)
    .send(body);
  expect(res.status).toBe(201);
  return { id: res.body.data.id as string, cards: res.body.data.cards as { id: string }[] };
}

describe('mcp: authentication', () => {
  it('rejects unauthenticated requests without data', async () => {
    const res = await mcpRaw(null, callBody('lerno_get_profile'));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(res.body).not.toHaveProperty('data');
    expect(res.text).not.toContain('displayName');
  });

  it('rejects invalid tokens', async () => {
    const res = await mcpRaw('bogus-token', callBody('lerno_get_profile'));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('lists all tools with descriptions and no user identity inputs', async () => {
    const { token } = await signup('McpAuthList');
    const envelope = rpc(
      await mcpRaw(token, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    );
    const tools = envelope.result!.tools!;
    expect(tools.map((tool) => tool.name).sort()).toEqual(
      [
        'lerno_add_cards',
        'lerno_create_set',
        'lerno_create_study_plan',
        'lerno_delete_card',
        'lerno_delete_set',
        'lerno_get_cards',
        'lerno_get_due_reviews',
        'lerno_get_next_action',
        'lerno_get_profile',
        'lerno_get_progress',
        'lerno_get_quiz',
        'lerno_get_set',
        'lerno_get_study_recommendation',
        'lerno_get_today',
        'lerno_get_wrong_cards',
        'lerno_list_sets',
        'lerno_start_practice',
        'lerno_start_quiz',
        'lerno_update_cards',
        'lerno_update_set',
      ].sort(),
    );
    for (const tool of tools) {
      expect(tool.description?.length).toBeGreaterThan(20);
      // Identity must come from auth context, never from tool arguments.
      expect(JSON.stringify(tool.inputSchema)).not.toMatch(/userId|user_id/i);
    }
  });

  it('derives identity exclusively from the auth context', async () => {
    const a = await signup('McpAuthA');
    const b = await signup('McpAuthB');
    const profileA = await callTool(a.token, 'lerno_get_profile');
    const profileB = await callTool(b.token, 'lerno_get_profile');
    expect(profileA.isError).toBe(false);
    expect((profileA.structured as { profile: { id: string } }).profile.id).toBe(a.userId);
    expect((profileB.structured as { profile: { id: string } }).profile.id).toBe(b.userId);
    // Extra identity arguments are ignored, not trusted.
    const forged = await callTool(a.token, 'lerno_get_profile', { userId: b.userId });
    expect((forged.structured as { profile: { id: string } }).profile.id).toBe(a.userId);
  });
});

describe('mcp: sets', () => {
  async function setupSets(): Promise<{
    a: { token: string; userId: string };
    b: { token: string; userId: string };
    privateId: string;
    publicId: string;
    foreignPrivateId: string;
    foreignPublicId: string;
  }> {
    const a = await signup('McpSetsA');
    const b = await signup('McpSetsB');
    const priv = await createSet(a.token, {
      title: 'A private',
      subjectName: 'Biology',
      visibility: 'private',
      cards: [{ question: 'Q?', answer: 'A' }],
    });
    const pub = await createSet(a.token, {
      title: 'A public',
      visibility: 'public',
      cards: [
        { question: 'Q1?', answer: 'A1' },
        { question: 'Q2?', answer: 'A2' },
      ],
    });
    const foreignPriv = await createSet(b.token, {
      title: 'B private',
      visibility: 'private',
      cards: [{ question: 'BQ?', answer: 'BA' }],
    });
    const foreignPub = await createSet(b.token, {
      title: 'B public',
      visibility: 'public',
      cards: [{ question: 'BQ?', answer: 'BA' }],
    });
    return {
      a,
      b,
      privateId: priv.id,
      publicId: pub.id,
      foreignPrivateId: foreignPriv.id,
      foreignPublicId: foreignPub.id,
    };
  }

  it('lists only the caller’s own sets in compact form', async () => {
    const { a, b } = await setupSets();
    const res = await callTool(a.token, 'lerno_list_sets');
    expect(res.isError).toBe(false);
    const body = res.structured as {
      count: number;
      sets: Record<string, unknown>[];
    };
    expect(body.count).toBe(2);
    expect(body.sets.map((set) => set['title']).sort()).toEqual(['A private', 'A public']);
    for (const set of body.sets) {
      expect(Object.keys(set).sort()).toEqual(
        ['cardCount', 'createdAt', 'id', 'subjectName', 'title', 'updatedAt', 'visibility'].sort(),
      );
    }
    const counts = new Map(body.sets.map((set) => [set['title'], set['cardCount']]));
    expect(counts.get('A private')).toBe(1);
    expect(counts.get('A public')).toBe(2);

    const other = await callTool(b.token, 'lerno_list_sets');
    const otherBody = other.structured as { count: number };
    expect(otherBody.count).toBe(2);
  });

  it('serves only owned sets, including when another set is public', async () => {
    const { a, privateId, publicId, foreignPrivateId, foreignPublicId } = await setupSets();

    const own = await callTool(a.token, 'lerno_get_set', { setId: privateId });
    expect(own.isError).toBe(false);
    const ownBody = own.structured as { set: Record<string, unknown> };
    expect(ownBody.set['title']).toBe('A private');
    expect(ownBody.set['isOwner']).toBe(true);
    expect(ownBody.set).not.toHaveProperty('cards');
    expect(ownBody.set).not.toHaveProperty('ownerId');

    const pub = await callTool(a.token, 'lerno_get_set', { setId: publicId });
    expect(pub.isError).toBe(false);

    const foreignPub = await callTool(a.token, 'lerno_get_set', { setId: foreignPublicId });
    expect(foreignPub.isError).toBe(true);
    expect(foreignPub.text).toMatch(/^\[NOT_FOUND\]/);

    const foreignPriv = await callTool(a.token, 'lerno_get_set', { setId: foreignPrivateId });
    expect(foreignPriv.isError).toBe(true);
    expect(foreignPriv.text).toMatch(/^\[NOT_FOUND\]/);
    expect(foreignPriv.text).not.toContain('B private');
  });

  it('rejects invalid and nonexistent set ids', async () => {
    const { a } = await setupSets();
    const invalid = await callTool(a.token, 'lerno_get_set', { setId: 'not-a-uuid' });
    expect(invalid.isError).toBe(true);
    expect(invalid.text).toMatch(/Invalid set id|-32602/);

    const missing = await callTool(a.token, 'lerno_get_set', {});
    expect(missing.isError).toBe(true);

    const ghost = await callTool(a.token, 'lerno_get_set', { setId: MISSING_UUID });
    expect(ghost.isError).toBe(true);
    expect(ghost.text).toMatch(/^\[NOT_FOUND\]/);
  });
});

describe('mcp: cards', () => {
  it('enforces set visibility and validates input', async () => {
    const a = await signup('McpCardsA');
    const b = await signup('McpCardsB');
    const own = await createSet(a.token, {
      title: 'Card set',
      visibility: 'private',
      cards: [
        { question: 'Q1?', answer: 'A1' },
        { question: 'Q2?', answer: 'A2' },
      ],
    });
    const foreignPublic = await createSet(b.token, {
      title: 'Open cards',
      visibility: 'public',
      cards: [{ question: 'BQ?', answer: 'BA' }],
    });
    const foreignPrivate = await createSet(b.token, {
      title: 'Closed cards',
      visibility: 'private',
      cards: [{ question: 'BQ?', answer: 'BA' }],
    });

    const res = await callTool(a.token, 'lerno_get_cards', { setId: own.id });
    expect(res.isError).toBe(false);
    const body = res.structured as {
      setId: string;
      count: number;
      cards: { id: string; question: string; answer: string; position: number }[];
    };
    expect(body.setId).toBe(own.id);
    expect(body.count).toBe(2);
    expect(body.cards.map((card) => card.question)).toEqual(['Q1?', 'Q2?']);
    expect(body.cards[0]).toEqual({
      id: expect.any(String),
      question: 'Q1?',
      answer: 'A1',
      position: 0,
    });

    const pub = await callTool(a.token, 'lerno_get_cards', { setId: foreignPublic.id });
    expect(pub.isError).toBe(true);

    const priv = await callTool(a.token, 'lerno_get_cards', { setId: foreignPrivate.id });
    expect(priv.isError).toBe(true);
    expect(priv.text).toMatch(/^\[NOT_FOUND\]/);
    expect(priv.text).not.toContain('BA');

    const invalid = await callTool(a.token, 'lerno_get_cards', { setId: 123 });
    expect(invalid.isError).toBe(true);
  });
});

describe('mcp: progress, today, due reviews, next action', () => {
  async function setupActivity(): Promise<{ token: string; setId: string; cardId: string }> {
    const { token } = await signup('McpActivity');
    const { id: setId, cards } = await createSet(token, {
      title: 'Activity set',
      visibility: 'private',
      cards: [
        { question: 'Q1?', answer: 'A1' },
        { question: 'Q2?', answer: 'A2' },
      ],
    });
    // One incorrect review: card stays in the learning queue (due immediately).
    const review = await request(app)
      .post('/api/study/review')
      .set('Authorization', `Bearer ${token}`)
      .send({ setId, cardId: cards[0]!.id, result: 'incorrect' });
    expect(review.status).toBe(200);
    return { token, setId, cardId: cards[0]!.id };
  }

  it('reports zeros for a new user', async () => {
    const { token } = await signup('McpFreshUser');
    const progress = await callTool(token, 'lerno_get_progress');
    const body = progress.structured as {
      cardsStudied: number;
      quizAttempts: number;
      accuracy: null;
      streakDays: number;
    };
    expect(body.cardsStudied).toBe(0);
    expect(body.quizAttempts).toBe(0);
    expect(body.accuracy).toBeNull();
    expect(body.streakDays).toBe(0);

    const next = await callTool(token, 'lerno_get_next_action');
    expect((next.structured as { action: { type: string } }).action.type).toBe('create-set');
  });

  it('matches the REST progress values exactly', async () => {
    const { token } = await setupActivity();
    const rest = await request(app).get('/api/progress').set('Authorization', `Bearer ${token}`);
    expect(rest.status).toBe(200);
    const mcp = await callTool(token, 'lerno_get_progress');
    expect(mcp.isError).toBe(false);
    expect(mcp.structured).toEqual(rest.body.data);
  });

  it('isolates progress between users', async () => {
    const { token } = await setupActivity();
    const other = await signup('McpIsolated');
    const mine = (await callTool(token, 'lerno_get_progress')).structured as {
      cardsStudied: number;
    };
    const theirs = (await callTool(other.token, 'lerno_get_progress')).structured as {
      cardsStudied: number;
    };
    expect(mine.cardsStudied).toBe(1);
    expect(theirs.cardsStudied).toBe(0);
  });

  it('matches the website Today summary', async () => {
    const { token } = await setupActivity();
    const rest = await request(app)
      .get('/api/progress/today')
      .set('Authorization', `Bearer ${token}`);
    expect(rest.status).toBe(200);
    const mcp = await callTool(token, 'lerno_get_today');
    expect(mcp.isError).toBe(false);
    expect(mcp.structured).toEqual(rest.body.data);
  });

  it('reports due reviews grouped by set, matching REST', async () => {
    const { token, setId } = await setupActivity();
    const rest = await request(app).get('/api/reviews').set('Authorization', `Bearer ${token}`);
    expect(rest.status).toBe(200);
    const mcp = await callTool(token, 'lerno_get_due_reviews');
    expect(mcp.isError).toBe(false);
    const body = mcp.structured as {
      totalDue: number;
      groups: { setId: string; dueCount: number }[];
    };
    expect(body.totalDue).toBe(1);
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0]!.setId).toBe(setId);
    expect(body.groups).toEqual(rest.body.data);
  });

  it('isolates due reviews between users', async () => {
    const { token } = await setupActivity();
    const other = await signup('McpDueIsolated');
    const mine = (await callTool(token, 'lerno_get_due_reviews')).structured as {
      totalDue: number;
    };
    const theirs = (await callTool(other.token, 'lerno_get_due_reviews')).structured as {
      totalDue: number;
    };
    expect(mine.totalDue).toBe(1);
    expect(theirs.totalDue).toBe(0);
  });

  it('matches the dashboard next action', async () => {
    const { token } = await setupActivity();
    const rest = await request(app)
      .get('/api/progress/today')
      .set('Authorization', `Bearer ${token}`);
    const mcp = await callTool(token, 'lerno_get_next_action');
    expect(mcp.isError).toBe(false);
    expect((mcp.structured as { action: unknown }).action).toEqual(
      (rest.body.data as { continueAction: unknown }).continueAction,
    );
    // One due card → the review action for this set.
    expect((mcp.structured as { action: { type: string } }).action.type).toBe('review');
  });
});

describe('mcp: quiz', () => {
  it('serves quizzes for viewable sets without leaking answers', async () => {
    const a = await signup('McpQuizA');
    const b = await signup('McpQuizB');
    const own = await createSet(a.token, {
      title: 'Quiz set',
      visibility: 'private',
      cards: [
        { question: 'Q1?', answer: 'A1' },
        { question: 'Q2?', answer: 'A2' },
      ],
    });
    const foreignPrivate = await createSet(b.token, {
      title: 'Closed quiz',
      visibility: 'private',
      cards: [{ question: 'BQ?', answer: 'BA' }],
    });

    const res = await callTool(a.token, 'lerno_get_quiz', { setId: own.id });
    expect(res.isError).toBe(false);
    const body = res.structured as {
      quiz: { id: string; setId: string; title: string; questions: { id: string }[] };
    };
    expect(body.quiz.setId).toBe(own.id);
    expect(body.quiz.questions).toHaveLength(2);
    expect(res.text).not.toContain('correctAnswer');

    const priv = await callTool(a.token, 'lerno_get_quiz', { setId: foreignPrivate.id });
    expect(priv.isError).toBe(true);
    expect(priv.text).toMatch(/^\[NOT_FOUND\]/);

    const invalid = await callTool(a.token, 'lerno_get_quiz', { setId: 'nope' });
    expect(invalid.isError).toBe(true);
  });

  it('reports a clear error for sets without cards', async () => {
    const { token } = await signup('McpQuizEmpty');
    const { id } = await createSet(token, { title: 'Empty quiz set' });
    const res = await callTool(token, 'lerno_get_quiz', { setId: id });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/^\[VALIDATION_ERROR\]/);
  });
});

describe('mcp: protocol errors and secret hygiene', () => {
  it('rejects GET and DELETE with 405', async () => {
    const { token } = await signup('McpMethod');
    const auth = { Authorization: `Bearer ${token}` };
    const get = await request(app).get('/api/mcp').set(auth);
    expect(get.status).toBe(405);
    expect(get.body.error.code).toBe('METHOD_NOT_ALLOWED');
    const del = await request(app).delete('/api/mcp').set(auth);
    expect(del.status).toBe(405);
  });

  it('answers unknown methods and tools without leaking internals', async () => {
    const { token } = await signup('McpUnknown');
    const badMethod = rpc(
      await mcpRaw(token, { jsonrpc: '2.0', id: 1, method: 'nope', params: {} }),
    );
    expect(badMethod.error).toBeDefined();
    expect(JSON.stringify(badMethod)).not.toMatch(/stack|at \/|\.ts:|node_modules/i);

    const badTool = await callTool(token, 'lerno_delete_everything');
    expect(badTool.isError).toBe(true);
    expect(badTool.text).not.toMatch(/stack|\.ts:|node_modules/i);
  });

  it('never exposes secrets in any tool output', async () => {
    const { token } = await signup('McpHygiene');
    const { id } = await createSet(token, {
      title: 'Hygiene set',
      visibility: 'private',
      cards: [{ question: 'What is the capital?', answer: 'A calm city' }],
    });
    const outputs: string[] = [];
    outputs.push((await callTool(token, 'lerno_get_profile')).text);
    outputs.push((await callTool(token, 'lerno_list_sets')).text);
    outputs.push((await callTool(token, 'lerno_get_set', { setId: id })).text);
    outputs.push((await callTool(token, 'lerno_get_cards', { setId: id })).text);
    outputs.push((await callTool(token, 'lerno_get_progress')).text);
    outputs.push((await callTool(token, 'lerno_get_today')).text);
    outputs.push((await callTool(token, 'lerno_get_due_reviews')).text);
    outputs.push((await callTool(token, 'lerno_get_next_action')).text);
    outputs.push((await callTool(token, 'lerno_get_quiz', { setId: id })).text);
    const blob = outputs.join('\n').toLowerCase();
    for (const secret of [
      'password',
      'accesstoken',
      'refresh_token',
      'service_role',
      'supabase',
      'secret',
      'private_key',
      'passwd',
      'hash',
    ]) {
      expect(blob).not.toContain(secret);
    }
  });
});
