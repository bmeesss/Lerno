/**
 * Phase 8A coverage: MCP write tools over Streamable HTTP.
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

async function restGetSet(token: string, setId: string): Promise<request.Response> {
  return request(app).get(`/api/sets/${setId}`).set(authHeader(token));
}

describe('mcp write: tool schemas and annotations', () => {
  it('advertises four non-read-only, non-destructive write tools', async () => {
    const { token } = await signup('McpWriteSchema');
    const envelope = rpc(
      await mcpRaw(token, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    );
    const tools = envelope.result!.tools!;
    expect(tools).toHaveLength(20);
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    for (const name of [
      'lerno_create_set',
      'lerno_add_cards',
      'lerno_update_set',
      'lerno_update_cards',
    ]) {
      const tool = byName.get(name);
      expect(tool).toBeDefined();
      expect(tool!.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      });
      expect(tool!.description?.length).toBeGreaterThan(20);
    }
    // Only the Phase 8B delete tools are destructive; reads stay read-only.
    const readTools = new Set([
      'lerno_list_sets',
      'lerno_start_practice',
      'lerno_start_quiz',
      'lerno_create_study_plan',
    ]);
    for (const tool of tools) {
      const destructive = tool.name === 'lerno_delete_set' || tool.name === 'lerno_delete_card';
      const read = tool.name.startsWith('lerno_get_') || readTools.has(tool.name);
      expect(tool.annotations?.['destructiveHint']).toBe(destructive);
      expect(tool.annotations?.['readOnlyHint']).toBe(read);
      expect(JSON.stringify(tool.inputSchema)).not.toMatch(/userId|user_id|ownerId/i);
    }

    // Required inputs are enforced at the schema level.
    const schemas = new Map(
      tools.map((tool) => [tool.name, tool.inputSchema as { required?: string[] }]),
    );
    expect(schemas.get('lerno_create_set')!.required).toContain('title');
    expect(schemas.get('lerno_add_cards')!.required).toEqual(
      expect.arrayContaining(['setId', 'cards']),
    );
    expect(schemas.get('lerno_update_cards')!.required).toEqual(
      expect.arrayContaining(['setId', 'cards']),
    );
  });

  it('rejects unauthenticated and invalid-token writes at HTTP level', async () => {
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'lerno_create_set', arguments: { title: 'Nope' } },
    };
    const anon = await mcpRaw(null, body);
    expect(anon.status).toBe(401);
    expect(anon.body).not.toHaveProperty('data');
    const bogus = await mcpRaw('bogus-token', body);
    expect(bogus.status).toBe(401);
  });
});

describe('mcp write: lerno_create_set', () => {
  it('creates a private set by default, verified via REST', async () => {
    const { token } = await signup('McpWriteCreate');
    const res = await callTool(token, 'lerno_create_set', {
      title: 'Biologie H1',
      description: 'Celhoofdstuk',
      level: '3 mavo',
    });
    expect(res.isError).toBe(false);
    expect(res.structured).toEqual({
      created: true,
      set: {
        id: expect.any(String),
        title: 'Biologie H1',
        visibility: 'private',
        cardCount: 0,
      },
    });
    const setId = (res.structured!.set as { id: string }).id;
    const rest = await restGetSet(token, setId);
    expect(rest.status).toBe(200);
    expect(rest.body.data.visibility).toBe('private');
    expect(rest.body.data.description).toBe('Celhoofdstuk');
    expect(rest.body.data.isOwner).toBe(true);
  });

  it('creates a set with cards in one action', async () => {
    const { token } = await signup('McpWriteCreateCards');
    const res = await callTool(token, 'lerno_create_set', {
      title: 'Fotosynthese',
      cards: [
        { question: 'Wat is fotosynthese?', answer: 'Omzetting van licht in energie' },
        { question: 'Waar vindt het plaats?', answer: 'In chloroplasten' },
      ],
    });
    expect(res.isError).toBe(false);
    expect(res.structured).toEqual({
      created: true,
      set: {
        id: expect.any(String),
        title: 'Fotosynthese',
        visibility: 'private',
        cardCount: 2,
      },
    });
    const rest = await restGetSet(token, (res.structured!.set as { id: string }).id);
    expect(rest.body.data.cards).toHaveLength(2);
    expect(rest.body.data.cards[0].position).toBe(0);
    expect(rest.body.data.cards[1].position).toBe(1);
  });

  it('creates public sets only when explicitly asked, readable by guests', async () => {
    const { token } = await signup('McpWritePublic');
    const res = await callTool(token, 'lerno_create_set', {
      title: 'Open set',
      visibility: 'public',
      cards: [{ question: 'Q?', answer: 'A' }],
    });
    expect((res.structured!.set as { visibility: string }).visibility).toBe('public');
    const guest = await request(app).get(
      `/api/sets/${(res.structured!.set as { id: string }).id}`,
    );
    expect(guest.status).toBe(200);
    expect(guest.body.data.cards).toHaveLength(1);
  });

  it('ignores forged ownership and metadata fields', async () => {
    const a = await signup('McpWriteForgeA');
    const b = await signup('McpWriteForgeB');
    const res = await callTool(a.token, 'lerno_create_set', {
      title: 'Forged set',
      userId: b.userId,
      ownerId: b.userId,
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
      score: 999,
      role: 'admin',
    });
    expect(res.isError).toBe(false);
    const setId = (res.structured!.set as { id: string }).id;
    // Owned by the caller, invisible to the “forged” user.
    expect((await restGetSet(a.token, setId)).status).toBe(200);
    expect((await restGetSet(b.token, setId)).status).toBe(404);
    const rest = await restGetSet(a.token, setId);
    expect(rest.body.data.createdAt).not.toContain('2020');
    expect(JSON.stringify(res.structured)).not.toMatch(/999|admin|2020/);
  });

  it('enforces subject authorization and writes nothing on failure', async () => {
    const a = await signup('McpWriteSubjectA');
    const b = await signup('McpWriteSubjectB');
    const subject = await request(app)
      .post('/api/subjects')
      .set(authHeader(a.token))
      .send({ name: 'Natuurkunde' });
    const subjectId = subject.body.data.id as string;

    const own = await callTool(a.token, 'lerno_create_set', {
      title: 'Met vak',
      subjectId,
    });
    expect(own.isError).toBe(false);
    const rest = await restGetSet(a.token, (own.structured!.set as { id: string }).id);
    expect(rest.body.data.subjectName).toBe('Natuurkunde');

    const foreign = await callTool(b.token, 'lerno_create_set', {
      title: 'Vreemd vak',
      subjectId,
    });
    expect(foreign.isError).toBe(true);
    expect(foreign.text).toMatch(/^\[NOT_FOUND\]/);

    const ghost = await callTool(a.token, 'lerno_create_set', {
      title: 'Spookvak',
      subjectId: MISSING_UUID,
    });
    expect(ghost.isError).toBe(true);

    // No half-created sets left behind.
    const listA = await request(app).get('/api/sets').set(authHeader(a.token));
    expect(listA.body.data).toHaveLength(1);
    const listB = await request(app).get('/api/sets').set(authHeader(b.token));
    expect(listB.body.data).toHaveLength(0);
  });

  it('validates input strictly and writes nothing on failure', async () => {
    const { token } = await signup('McpWriteCreateValidation');
    const badInputs: Record<string, unknown>[] = [
      {},
      { title: '' },
      { title: 'x'.repeat(161) },
      { title: 'Ok', description: 'x'.repeat(2001) },
      { title: 'Ok', visibility: 'friends-only' },
      { title: 'Ok', subjectId: 'not-a-uuid' },
      { title: 'Ok', cards: [{ question: '', answer: 'A' }] },
      { title: 'Ok', cards: [{ question: 'Q?' }] },
      { title: 'Ok', cards: [{ question: 'Q?', answer: 'x'.repeat(4001) }] },
      {
        title: 'Ok',
        cards: Array.from({ length: 501 }, (_, i) => ({ question: `Q${i}?`, answer: 'A' })),
      },
    ];
    for (const args of badInputs) {
      const res = await callTool(token, 'lerno_create_set', args);
      expect(res.isError).toBe(true);
    }
    const list = await request(app).get('/api/sets').set(authHeader(token));
    expect(list.body.data).toHaveLength(0);
  });
});

describe('mcp write: lerno_add_cards', () => {
  async function setupSet(
    token: string,
    title: string,
    visibility: 'private' | 'public' = 'private',
  ): Promise<{ id: string }> {
    const res = await callTool(token, 'lerno_create_set', {
      title,
      visibility,
      cards: [{ question: 'Bestaat al?', answer: 'Ja' }],
    });
    expect(res.isError).toBe(false);
    return { id: (res.structured!.set as { id: string }).id };
  }

  it('appends cards with sequential positions for the owner', async () => {
    const { token } = await signup('McpWriteAdd');
    const { id } = await setupSet(token, 'Groei-set');
    const res = await callTool(token, 'lerno_add_cards', {
      setId: id,
      cards: [
        { question: 'Q2?', answer: 'A2' },
        { question: 'Q3?', answer: 'A3' },
      ],
    });
    expect(res.isError).toBe(false);
    expect(res.structured).toEqual({ created: 2, setId: id, totalCards: 3 });
    const rest = await restGetSet(token, id);
    expect(rest.body.data.cards.map((card: { position: number }) => card.position)).toEqual([
      0, 1, 2,
    ]);
  });

  it('keeps other users’ sets read-only (private and public)', async () => {
    const a = await signup('McpWriteAddA');
    const b = await signup('McpWriteAddB');
    const priv = await setupSet(a.token, 'A prive');
    const pub = await setupSet(a.token, 'A publiek', 'public');

    for (const setId of [priv.id, pub.id]) {
      const res = await callTool(b.token, 'lerno_add_cards', {
        setId,
        cards: [{ question: 'Hack?', answer: 'Nee' }],
      });
      expect(res.isError).toBe(true);
      expect(res.text).toMatch(/^\[NOT_FOUND\]/);
    }
    for (const setId of [priv.id, pub.id]) {
      const rest = await restGetSet(a.token, setId);
      expect(rest.body.data.cards).toHaveLength(1);
    }
  });

  it('rejects invalid ids and malformed cards without writing', async () => {
    const { token } = await signup('McpWriteAddValidation');
    const { id } = await setupSet(token, 'Validatie-set');
    const badCalls: Record<string, unknown>[] = [
      { setId: 'not-a-uuid', cards: [{ question: 'Q?', answer: 'A' }] },
      { setId: MISSING_UUID, cards: [{ question: 'Q?', answer: 'A' }] },
      { setId: id, cards: [] },
      { setId: id, cards: [{ question: 'Q?' }] },
      { setId: id, cards: [{ question: '', answer: 'A' }] },
      { setId: id, cards: [{ question: 'Q?', answer: 'x'.repeat(4001) }] },
    ];
    for (const args of badCalls) {
      const res = await callTool(token, 'lerno_add_cards', args);
      expect(res.isError).toBe(true);
    }
    const rest = await restGetSet(token, id);
    expect(rest.body.data.cards).toHaveLength(1);
  });

  it('enforces the 500-card cap exactly', async () => {
    const { token } = await signup('McpWriteCap');
    const seed = await callTool(token, 'lerno_create_set', {
      title: 'Bijna vol',
      cards: Array.from({ length: 499 }, (_, i) => ({ question: `Q${i}?`, answer: `A${i}` })),
    });
    expect(seed.isError).toBe(false);
    const setId = (seed.structured!.set as { id: string }).id;

    const over = await callTool(token, 'lerno_add_cards', {
      setId,
      cards: [
        { question: 'Eén te veel?', answer: 'Ja' },
        { question: 'Twee te veel?', answer: 'Ja' },
      ],
    });
    expect(over.isError).toBe(true);
    expect(over.text).toMatch(/500/);

    const exact = await callTool(token, 'lerno_add_cards', {
      setId,
      cards: [{ question: 'Precies vol?', answer: 'Ja' }],
    });
    expect(exact.isError).toBe(false);
    expect(exact.structured).toEqual({ created: 1, setId, totalCards: 500 });

    const full = await callTool(token, 'lerno_add_cards', {
      setId,
      cards: [{ question: 'Nog één?', answer: 'Nee' }],
    });
    expect(full.isError).toBe(true);
    const rest = await restGetSet(token, setId);
    expect(rest.body.data.cards).toHaveLength(500);
  });

  it('rejects exact-duplicate cards within one batch atomically', async () => {
    const { token } = await signup('McpWriteDupes');
    const { id } = await setupSet(token, 'Dupe-set');
    const res = await callTool(token, 'lerno_add_cards', {
      setId: id,
      cards: [
        { question: 'Uniek?', answer: 'Ja' },
        { question: '  uniek? ', answer: 'ja' },
      ],
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/Duplicate card in batch/);
    const rest = await restGetSet(token, id);
    expect(rest.body.data.cards).toHaveLength(1);
  });

  it('allows cards identical to existing ones (no app-wide duplicate policy)', async () => {
    const { token } = await signup('McpWriteDupesAllowed');
    const { id } = await setupSet(token, 'Echo-set');
    const res = await callTool(token, 'lerno_add_cards', {
      setId: id,
      cards: [{ question: 'Bestaat al?', answer: 'Ja' }],
    });
    expect(res.isError).toBe(false);
    expect(res.structured).toEqual({ created: 1, setId: id, totalCards: 2 });
  });
});

describe('mcp write: lerno_update_set', () => {
  it('updates own sets and rejects everyone else', async () => {
    const a = await signup('McpWriteUpdA');
    const b = await signup('McpWriteUpdB');
    const created = await callTool(a.token, 'lerno_create_set', {
      title: 'Oude titel',
      description: 'Oud',
    });
    const setId = (created.structured!.set as { id: string }).id;

    const res = await callTool(a.token, 'lerno_update_set', {
      setId,
      title: 'Nieuwe titel',
      description: 'Nieuw',
      visibility: 'public',
    });
    expect(res.isError).toBe(false);
    expect(res.structured).toEqual({
      updated: true,
      set: {
        id: setId,
        title: 'Nieuwe titel',
        description: 'Nieuw',
        visibility: 'public',
        cardCount: 0,
      },
    });
    const guest = await request(app).get(`/api/sets/${setId}`);
    expect(guest.body.data.title).toBe('Nieuwe titel');

    const foreign = await callTool(b.token, 'lerno_update_set', { setId, title: 'Hack' });
    expect(foreign.isError).toBe(true);
    expect(foreign.text).toMatch(/^\[NOT_FOUND\]/);

    const bad = await callTool(a.token, 'lerno_update_set', { setId, visibility: 'x' });
    expect(bad.isError).toBe(true);
    const empty = await callTool(a.token, 'lerno_update_set', { setId });
    expect(empty.isError).toBe(true);

    const rest = await restGetSet(a.token, setId);
    expect(rest.body.data.title).toBe('Nieuwe titel');
  });
});

describe('mcp write: lerno_update_cards', () => {
  it('edits own cards and validates the whole batch first', async () => {
    const { token } = await signup('McpWriteUpdCards');
    const created = await callTool(token, 'lerno_create_set', {
      title: 'Bewerk-set',
      cards: [
        { question: 'Q1?', answer: 'A1' },
        { question: 'Q2?', answer: 'A2' },
      ],
    });
    const setId = (created.structured!.set as { id: string }).id;
    const before = await restGetSet(token, setId);
    const [c1, c2] = before.body.data.cards as { id: string }[];

    const res = await callTool(token, 'lerno_update_cards', {
      setId,
      cards: [
        { cardId: c1!.id, question: 'Q1 bewerkt?', answer: 'A1 bewerkt' },
        { cardId: c2!.id, answer: 'Alleen antwoord' },
      ],
    });
    expect(res.isError).toBe(false);
    expect(res.structured).toEqual({ updated: 2, setId, totalCards: 2 });
    const after = await restGetSet(token, setId);
    expect(after.body.data.cards[0]).toMatchObject({
      question: 'Q1 bewerkt?',
      answer: 'A1 bewerkt',
    });
    expect(after.body.data.cards[1]).toMatchObject({ question: 'Q2?', answer: 'Alleen antwoord' });
  });

  it('writes nothing when any entry is bad (atomic batches)', async () => {
    const a = await signup('McpWriteUpdAtomA');
    const b = await signup('McpWriteUpdAtomB');
    const created = await callTool(a.token, 'lerno_create_set', {
      title: 'Atoom-set',
      cards: [{ question: 'Vast?', answer: 'Ja' }],
    });
    const setId = (created.structured!.set as { id: string }).id;
    const cardId = (await restGetSet(a.token, setId)).body.data.cards[0].id as string;
    const other = await callTool(b.token, 'lerno_create_set', {
      title: 'B set',
      cards: [{ question: 'BQ?', answer: 'BA' }],
    });
    const otherCardId = (
      await restGetSet(b.token, (other.structured!.set as { id: string }).id)
    ).body.data.cards[0].id as string;

    const badBatches: Record<string, unknown>[] = [
      // Unknown card id.
      { setId, cards: [{ cardId: MISSING_UUID, answer: 'X' }] },
      // Card from another set.
      { setId, cards: [{ cardId: otherCardId, answer: 'X' }] },
      // Same card twice.
      {
        setId,
        cards: [
          { cardId, answer: 'Eén' },
          { cardId, answer: 'Twee' },
        ],
      },
      // Entry changing nothing.
      { setId, cards: [{ cardId }] },
      // Entry with empty answer.
      { setId, cards: [{ cardId, answer: '' }] },
      // Malformed card id.
      { setId, cards: [{ cardId: 'nope', answer: 'X' }] },
    ];
    for (const args of badBatches) {
      const res = await callTool(a.token, 'lerno_update_cards', args);
      expect(res.isError).toBe(true);
    }
    // Foreign user rejected too.
    const foreign = await callTool(b.token, 'lerno_update_cards', {
      setId,
      cards: [{ cardId, answer: 'Hack' }],
    });
    expect(foreign.isError).toBe(true);

    const rest = await restGetSet(a.token, setId);
    expect(rest.body.data.cards).toEqual([
      expect.objectContaining({ id: cardId, question: 'Vast?', answer: 'Ja' }),
    ]);
  });
});

describe('mcp write: hygiene and downstream effects', () => {
  it('keeps outputs compact and secret-free', async () => {
    const { token } = await signup('McpWriteHygiene');
    const created = await callTool(token, 'lerno_create_set', {
      title: 'Hygiëne',
      cards: [{ question: 'Q?', answer: 'A' }],
    });
    const setId = (created.structured!.set as { id: string }).id;
    const cardId = (await restGetSet(token, setId)).body.data.cards[0].id as string;
    const outputs = [
      created.text,
      (await callTool(token, 'lerno_add_cards', { setId, cards: [{ question: 'Q2?', answer: 'A2' }] }))
        .text,
      (await callTool(token, 'lerno_update_set', { setId, title: 'Hygiëne 2' })).text,
      (
        await callTool(token, 'lerno_update_cards', {
          setId,
          cards: [{ cardId, answer: 'B' }],
        })
      ).text,
    ];
    const blob = outputs.join('\n').toLowerCase();
    for (const secret of [
      'password',
      'accesstoken',
      'refresh_token',
      'service_role',
      'supabase',
      'secret',
      'private_key',
      'hash',
      'stack',
    ]) {
      expect(blob).not.toContain(secret);
    }
    // Compact shapes only.
    expect(Object.keys(created.structured!)).toEqual(['created', 'set']);
    expect(Object.keys(created.structured!.set as object)).toEqual([
      'id',
      'title',
      'visibility',
      'cardCount',
    ]);
  });

  it('regenerates quizzes after MCP card writes (REST-visible)', async () => {
    const { token } = await signup('McpWriteQuiz');
    const created = await callTool(token, 'lerno_create_set', {
      title: 'Quiz-set',
      cards: [
        { question: 'Q1?', answer: 'A1' },
        { question: 'Q2?', answer: 'A2' },
      ],
    });
    const setId = (created.structured!.set as { id: string }).id;
    const quiz1 = await request(app).get(`/api/sets/${setId}/quiz`).set(authHeader(token));
    expect(quiz1.body.data.questions).toHaveLength(2);

    await callTool(token, 'lerno_add_cards', {
      setId,
      cards: [{ question: 'Q3?', answer: 'A3' }],
    });
    const quiz2 = await request(app).get(`/api/sets/${setId}/quiz`).set(authHeader(token));
    expect(quiz2.body.data.questions).toHaveLength(3);
  });
});
