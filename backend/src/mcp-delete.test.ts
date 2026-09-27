/**
 * Phase 8B coverage: MCP delete tools over Streamable HTTP.
 *
 * Real JSON-RPC requests through the Express app (supertest); results are
 * cross-checked against the normal REST API to prove the same services and
 * rules apply. Both schema-level failures (bad ids, missing/wrong
 * confirmation) and service failures (foreign or nonexistent resources)
 * surface as tool errors with isError; the texts distinguish input validation
 * ("MCP error -32602 …") from service codes ("[NOT_FOUND] …"). No mocks of
 * the MCP surface.
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

interface DeleteResult {
  protocolError?: { code: number; message: string };
  text: string;
  isError: boolean;
  structured?: Record<string, unknown>;
}

async function callDelete(
  token: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<DeleteResult> {
  const envelope = rpc(
    await mcpRaw(token, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  );
  if (envelope.error) {
    return { protocolError: envelope.error, text: envelope.error.message, isError: true };
  }
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
): Promise<{ setId: string; cards: { id: string; question: string; answer: string; position: number }[] }> {
  const res = await request(app)
    .post('/api/sets')
    .set(authHeader(token))
    .send({ title, cards });
  expect(res.status).toBe(201);
  const setId = res.body.data.id as string;
  const detail = await request(app).get(`/api/sets/${setId}`).set(authHeader(token));
  expect(detail.status).toBe(200);
  return {
    setId,
    cards: detail.body.data.cards as {
      id: string;
      question: string;
      answer: string;
      position: number;
    }[],
  };
}

async function restCardIds(token: string, setId: string): Promise<string[]> {
  const res = await request(app).get(`/api/sets/${setId}`).set(authHeader(token));
  expect(res.status).toBe(200);
  return (res.body.data.cards as { id: string }[]).map((card) => card.id);
}

describe('mcp delete: tool schemas and annotations', () => {
  it('advertises two destructive delete tools with confirmation required', async () => {
    const { token } = await signup('McpDeleteSchema');
    const envelope = rpc(
      await mcpRaw(token, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    );
    const tools = envelope.result!.tools!;
    expect(tools).toHaveLength(20);
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    for (const name of ['lerno_delete_set', 'lerno_delete_card']) {
      const tool = byName.get(name);
      expect(tool).toBeDefined();
      expect(tool!.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
      });
      expect(tool!.description).toMatch(/destructive/i);
      expect(tool!.description).toMatch(/DELETE/);
      expect(tool!.description).toMatch(/cannot be undone/i);
      expect(JSON.stringify(tool!.inputSchema)).not.toMatch(/userId|user_id|ownerId/i);
    }
    const schemas = new Map(
      tools.map((tool) => [tool.name, tool.inputSchema as { required?: string[] }]),
    );
    expect(schemas.get('lerno_delete_set')!.required).toEqual(
      expect.arrayContaining(['setId', 'confirmation']),
    );
    expect(schemas.get('lerno_delete_card')!.required).toEqual(
      expect.arrayContaining(['setId', 'cardId', 'confirmation']),
    );
    // Nothing else is destructive.
    for (const tool of tools) {
      if (tool.name === 'lerno_delete_set' || tool.name === 'lerno_delete_card') continue;
      expect(tool.annotations?.['destructiveHint']).toBe(false);
    }
  });

  it('rejects unauthenticated and invalid-token deletes at HTTP level', async () => {
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'lerno_delete_set', arguments: { setId: MISSING_UUID, confirmation: 'DELETE' } },
    };
    const guest = await mcpRaw(null, body);
    expect(guest.status).toBe(401);
    const bogus = await mcpRaw('bogus-token', body);
    expect(bogus.status).toBe(401);
  });
});

describe('mcp delete: lerno_delete_card', () => {
  it('deletes one card for the owner; other cards and positions stay intact', async () => {
    const { token } = await signup('McpDeleteCardOwner');
    const { setId, cards } = await restCreateSet(token, 'Carddoel', [
      { question: 'Q1?', answer: 'A1' },
      { question: 'Q2?', answer: 'A2' },
      { question: 'Q3?', answer: 'A3' },
    ]);
    const victim = cards[1]!.id;

    const result = await callDelete(token, 'lerno_delete_card', {
      setId,
      cardId: victim,
      confirmation: 'DELETE',
    });
    expect(result.isError).toBe(false);
    expect(result.structured).toEqual({ deleted: true, setId, cardId: victim });

    const detail = await request(app).get(`/api/sets/${setId}`).set(authHeader(token));
    expect(detail.status).toBe(200);
    expect(detail.body.data.isOwner).toBe(true);
    const remaining = detail.body.data.cards as { id: string; position: number }[];
    expect(remaining.map((card) => card.id).sort()).toEqual(
      [cards[0]!.id, cards[2]!.id].sort(),
    );
    // Existing behavior: positions are not renumbered (same as REST).
    expect(remaining.map((card) => card.position).sort()).toEqual([0, 2]);
  });

  it('requires confirmation and deletes nothing without it', async () => {
    const { token } = await signup('McpDeleteCardConfirm');
    const { setId, cards } = await restCreateSet(token, 'Bevestig', [
      { question: 'Q?', answer: 'A' },
    ]);

    const result = await callDelete(token, 'lerno_delete_card', {
      setId,
      cardId: cards[0]!.id,
    });
    expect(result.isError).toBe(true);
    expect(result.protocolError).toBeUndefined();
    expect(result.text).toMatch(/confirmation is required/i);
    expect(await restCardIds(token, setId)).toHaveLength(1);
  });

  it('rejects wrong confirmations without deleting anything', async () => {
    const { token } = await signup('McpDeleteCardMismatch');
    const { setId, cards } = await restCreateSet(token, 'Mismatch', [
      { question: 'Q?', answer: 'A' },
    ]);
    const cardId = cards[0]!.id;

    for (const confirmation of ['yes', 'delete', 'DELETE ', ' DELETE', true, 1]) {
      const result = await callDelete(token, 'lerno_delete_card', {
        setId,
        cardId,
        confirmation: confirmation as unknown as string,
      });
      expect(result.isError).toBe(true);
      expect(result.text).toMatch(/confirmation mismatch/i);
    }
    expect(await restCardIds(token, setId)).toEqual([cardId]);
  });

  it('rejects invalid ids and foreign cards without writing', async () => {
    const { token } = await signup('McpDeleteCardIds');
    const { setId, cards } = await restCreateSet(token, 'Ids', [
      { question: 'Q?', answer: 'A' },
    ]);
    const other = await restCreateSet(token, 'Ander', [{ question: 'Q?', answer: 'A' }]);

    const malformed = await callDelete(token, 'lerno_delete_card', {
      setId: 'not-a-uuid',
      cardId: cards[0]!.id,
      confirmation: 'DELETE',
    });
    expect(malformed.isError).toBe(true);
    expect(malformed.text).toMatch(/-32602|Invalid set id/);

    const missingSet = await callDelete(token, 'lerno_delete_card', {
      setId: MISSING_UUID,
      cardId: cards[0]!.id,
      confirmation: 'DELETE',
    });
    expect(missingSet.isError).toBe(true);
    expect(missingSet.text).toMatch(/\[NOT_FOUND\]/);

    const missingCard = await callDelete(token, 'lerno_delete_card', {
      setId,
      cardId: MISSING_UUID,
      confirmation: 'DELETE',
    });
    expect(missingCard.isError).toBe(true);
    expect(missingCard.text).toMatch(/\[NOT_FOUND\]/);

    // Card exists but belongs to another set.
    const foreignCard = await callDelete(token, 'lerno_delete_card', {
      setId,
      cardId: other.cards[0]!.id,
      confirmation: 'DELETE',
    });
    expect(foreignCard.isError).toBe(true);
    expect(foreignCard.text).toMatch(/\[NOT_FOUND\]/);

    expect(await restCardIds(token, setId)).toEqual([cards[0]!.id]);
    expect(await restCardIds(token, other.setId)).toEqual([other.cards[0]!.id]);
  });

  it('keeps other users’ sets read-only, private and public', async () => {
    const owner = await signup('McpDeleteCardOwnerB');
    const stranger = await signup('McpDeleteCardStranger');
    const { setId, cards } = await restCreateSet(owner.token, 'Van een ander', [
      { question: 'Q?', answer: 'A' },
    ]);
    const args = { setId, cardId: cards[0]!.id, confirmation: 'DELETE' };

    const privateAttempt = await callDelete(stranger.token, 'lerno_delete_card', args);
    expect(privateAttempt.isError).toBe(true);
    expect(privateAttempt.text).toMatch(/\[NOT_FOUND\]/);

    const published = await request(app)
      .patch(`/api/sets/${setId}`)
      .set(authHeader(owner.token))
      .send({ visibility: 'public' });
    expect(published.status).toBe(200);

    const publicAttempt = await callDelete(stranger.token, 'lerno_delete_card', args);
    expect(publicAttempt.isError).toBe(true);
    expect(publicAttempt.text).toMatch(/\[NOT_FOUND\]/);
    expect(await restCardIds(owner.token, setId)).toEqual([cards[0]!.id]);
  });

  it('invalidates the quiz cache but keeps quiz attempts', async () => {
    const { token } = await signup('McpDeleteCardQuiz');
    const { setId, cards } = await restCreateSet(token, 'Quizdoel', [
      { question: 'Q1?', answer: 'A1' },
      { question: 'Q2?', answer: 'A2' },
      { question: 'Q3?', answer: 'A3' },
    ]);
    const quiz1 = await request(app).get(`/api/sets/${setId}/quiz`).set(authHeader(token));
    expect(quiz1.body.data.questions).toHaveLength(3);
    const questions = quiz1.body.data.questions as { id: string }[];
    const attempt = await request(app)
      .post(`/api/sets/${setId}/quiz/attempts`)
      .set(authHeader(token))
      .send({ answers: [{ questionId: questions[0]!.id, answer: 'A1' }] });
    expect(attempt.status).toBe(200);

    const deleted = await callDelete(token, 'lerno_delete_card', {
      setId,
      cardId: cards[0]!.id,
      confirmation: 'DELETE',
    });
    expect(deleted.isError).toBe(false);

    const quiz2 = await request(app).get(`/api/sets/${setId}/quiz`).set(authHeader(token));
    expect(quiz2.status).toBe(200);
    expect(quiz2.body.data.questions).toHaveLength(2);

    const progress = await request(app).get('/api/progress').set(authHeader(token));
    expect(progress.status).toBe(200);
    expect(progress.body.data.quizAttempts).toBe(1);
    const row = (progress.body.data.setProgress as { setId: string; totalCards: number }[]).find(
      (entry) => entry.setId === setId,
    );
    expect(row?.totalCards).toBe(2);
  });

  it('ignores forged ownership and role fields', async () => {
    const owner = await signup('McpDeleteCardForge');
    const stranger = await signup('McpDeleteCardForgeB');
    const mine = await restCreateSet(owner.token, 'Van mij', [
      { question: 'Q?', answer: 'A' },
    ]);
    const theirs = await restCreateSet(stranger.token, 'Van ander', [
      { question: 'Q?', answer: 'A' },
    ]);

    const result = await callDelete(owner.token, 'lerno_delete_card', {
      setId: mine.setId,
      cardId: mine.cards[0]!.id,
      confirmation: 'DELETE',
      userId: stranger.userId,
      ownerId: stranger.userId,
      role: 'admin',
    });
    expect(result.isError).toBe(false);
    expect(await restCardIds(owner.token, mine.setId)).toHaveLength(0);
    // The stranger's card is untouched: forged identity has no effect.
    expect(await restCardIds(stranger.token, theirs.setId)).toHaveLength(1);
  });

  it('answers NOT_FOUND when deleting the same card twice', async () => {
    const { token } = await signup('McpDeleteCardTwice');
    const { setId, cards } = await restCreateSet(token, 'Tweemaal', [
      { question: 'Q1?', answer: 'A1' },
      { question: 'Q2?', answer: 'A2' },
    ]);
    const args = { setId, cardId: cards[0]!.id, confirmation: 'DELETE' };
    expect((await callDelete(token, 'lerno_delete_card', args)).isError).toBe(false);

    const repeat = await callDelete(token, 'lerno_delete_card', args);
    expect(repeat.isError).toBe(true);
    expect(repeat.text).toMatch(/\[NOT_FOUND\]/);
    // No silent deletion of another object.
    expect(await restCardIds(token, setId)).toEqual([cards[1]!.id]);
  });
});

describe('mcp delete: lerno_delete_set', () => {
  it('deletes the whole set for the owner; other sets remain', async () => {
    const { token } = await signup('McpDeleteSetOwner');
    const doomed = await restCreateSet(token, 'Weg ermee', [
      { question: 'Q1?', answer: 'A1' },
      { question: 'Q2?', answer: 'A2' },
    ]);
    const kept = await restCreateSet(token, 'Blijft', [{ question: 'Q?', answer: 'A' }]);

    const result = await callDelete(token, 'lerno_delete_set', {
      setId: doomed.setId,
      confirmation: 'DELETE',
    });
    expect(result.isError).toBe(false);
    expect(result.structured).toEqual({
      deleted: true,
      setId: doomed.setId,
      title: 'Weg ermee',
    });

    expect((await request(app).get(`/api/sets/${doomed.setId}`).set(authHeader(token))).status).toBe(
      404,
    );
    expect(
      (await request(app).get(`/api/sets/${doomed.setId}/cards`).set(authHeader(token))).status,
    ).toBe(404);
    expect(await restCardIds(token, kept.setId)).toEqual([kept.cards[0]!.id]);
  });

  it('requires the exact confirmation and deletes nothing without it', async () => {
    const { token } = await signup('McpDeleteSetConfirm');
    const { setId } = await restCreateSet(token, 'Bevestig set', [
      { question: 'Q?', answer: 'A' },
    ]);

    const missing = await callDelete(token, 'lerno_delete_set', { setId });
    expect(missing.isError).toBe(true);
    expect(missing.protocolError).toBeUndefined();
    expect(missing.text).toMatch(/confirmation is required/i);

    for (const confirmation of ['yes', 'delete', 'Bevestig set', true]) {
      const result = await callDelete(token, 'lerno_delete_set', {
        setId,
        confirmation: confirmation as unknown as string,
      });
      expect(result.isError).toBe(true);
      expect(result.text).toMatch(/confirmation mismatch/i);
    }
    // The set title itself is not accepted as confirmation.
    expect((await request(app).get(`/api/sets/${setId}`).set(authHeader(token))).status).toBe(200);
  });

  it('rejects invalid ids without writing', async () => {
    const { token } = await signup('McpDeleteSetIds');
    const { setId } = await restCreateSet(token, 'Ids set', [
      { question: 'Q?', answer: 'A' },
    ]);

    const malformed = await callDelete(token, 'lerno_delete_set', {
      setId: 'not-a-uuid',
      confirmation: 'DELETE',
    });
    expect(malformed.isError).toBe(true);
    expect(malformed.text).toMatch(/-32602|Invalid set id/);

    const missing = await callDelete(token, 'lerno_delete_set', {
      setId: MISSING_UUID,
      confirmation: 'DELETE',
    });
    expect(missing.isError).toBe(true);
    expect(missing.text).toMatch(/\[NOT_FOUND\]/);

    expect((await request(app).get(`/api/sets/${setId}`).set(authHeader(token))).status).toBe(200);
  });

  it('refuses foreign sets, private and public', async () => {
    const owner = await signup('McpDeleteSetOwnerB');
    const stranger = await signup('McpDeleteSetStranger');
    const { setId } = await restCreateSet(owner.token, 'Niet van jou', [
      { question: 'Q?', answer: 'A' },
    ]);
    const args = { setId, confirmation: 'DELETE' };

    const privateAttempt = await callDelete(stranger.token, 'lerno_delete_set', args);
    expect(privateAttempt.isError).toBe(true);
    expect(privateAttempt.text).toMatch(/\[NOT_FOUND\]/);

    const published = await request(app)
      .patch(`/api/sets/${setId}`)
      .set(authHeader(owner.token))
      .send({ visibility: 'public' });
    expect(published.status).toBe(200);

    const publicAttempt = await callDelete(stranger.token, 'lerno_delete_set', args);
    expect(publicAttempt.isError).toBe(true);
    expect(publicAttempt.text).toMatch(/\[NOT_FOUND\]/);
    expect((await request(app).get(`/api/sets/${setId}`).set(authHeader(owner.token))).status).toBe(
      200,
    );
  });

  it('cleans up derived data: quiz gone, progress row gone, subject kept', async () => {
    const { token } = await signup('McpDeleteSetCascade');
    const subject = await request(app)
      .post('/api/subjects')
      .set(authHeader(token))
      .send({ name: 'Biologie' });
    expect(subject.status).toBe(201);
    const subjectId = subject.body.data.id as string;

    const created = await request(app)
      .post('/api/sets')
      .set(authHeader(token))
      .send({
        title: 'Cascade',
        subjectId,
        cards: [
          { question: 'Q1?', answer: 'A1' },
          { question: 'Q2?', answer: 'A2' },
        ],
      });
    expect(created.status).toBe(201);
    const setId = created.body.data.id as string;

    const quiz1 = await request(app).get(`/api/sets/${setId}/quiz`).set(authHeader(token));
    expect(quiz1.body.data.questions).toHaveLength(2);

    const deleted = await callDelete(token, 'lerno_delete_set', {
      setId,
      confirmation: 'DELETE',
    });
    expect(deleted.isError).toBe(false);

    expect((await request(app).get(`/api/sets/${setId}/quiz`).set(authHeader(token))).status).toBe(
      404,
    );
    const progress = await request(app).get('/api/progress').set(authHeader(token));
    expect(progress.status).toBe(200);
    expect(
      (progress.body.data.setProgress as { setId: string }[]).some(
        (entry) => entry.setId === setId,
      ),
    ).toBe(false);
    // Subjects are never deleted with a set (existing REST behavior).
    expect((await request(app).get('/api/subjects').set(authHeader(token))).status).toBe(200);
    const subjects = (await request(app).get('/api/subjects').set(authHeader(token))).body.data as {
      id: string;
    }[];
    expect(subjects.map((entry) => entry.id)).toContain(subjectId);
  });

  it('ignores forged ownership and role fields', async () => {
    const owner = await signup('McpDeleteSetForge');
    const stranger = await signup('McpDeleteSetForgeB');
    const mine = await restCreateSet(owner.token, 'Van mij', [
      { question: 'Q?', answer: 'A' },
    ]);
    const theirs = await restCreateSet(stranger.token, 'Van ander', [
      { question: 'Q?', answer: 'A' },
    ]);

    const result = await callDelete(owner.token, 'lerno_delete_set', {
      setId: mine.setId,
      confirmation: 'DELETE',
      userId: stranger.userId,
      ownerId: stranger.userId,
      role: 'admin',
    });
    expect(result.isError).toBe(false);
    expect((await request(app).get(`/api/sets/${mine.setId}`).set(authHeader(owner.token))).status).toBe(
      404,
    );
    expect(
      (await request(app).get(`/api/sets/${theirs.setId}`).set(authHeader(stranger.token))).status,
    ).toBe(200);
  });

  it('answers NOT_FOUND when deleting the same set twice', async () => {
    const { token } = await signup('McpDeleteSetTwice');
    const doomed = await restCreateSet(token, 'Eenmaal', [{ question: 'Q?', answer: 'A' }]);
    const kept = await restCreateSet(token, 'Blijft', [{ question: 'Q?', answer: 'A' }]);
    const args = { setId: doomed.setId, confirmation: 'DELETE' };
    expect((await callDelete(token, 'lerno_delete_set', args)).isError).toBe(false);

    const repeat = await callDelete(token, 'lerno_delete_set', args);
    expect(repeat.isError).toBe(true);
    expect(repeat.text).toMatch(/\[NOT_FOUND\]/);
    expect((await request(app).get(`/api/sets/${kept.setId}`).set(authHeader(token))).status).toBe(
      200,
    );
  });
});

describe('mcp delete: REST parity', () => {
  it('card delete via MCP ends in the same state as via REST', async () => {
    const { token } = await signup('McpDeleteParityCard');
    const cards = [
      { question: 'PQ1?', answer: 'PA1' },
      { question: 'PQ2?', answer: 'PA2' },
      { question: 'PQ3?', answer: 'PA3' },
    ];
    const viaRest = await restCreateSet(token, 'Pariteit REST', cards);
    const viaMcp = await restCreateSet(token, 'Pariteit MCP', cards);

    const restDelete = await request(app)
      .delete(`/api/sets/${viaRest.setId}/cards/${viaRest.cards[0]!.id}`)
      .set(authHeader(token));
    expect(restDelete.status).toBe(204);
    const mcpDelete = await callDelete(token, 'lerno_delete_card', {
      setId: viaMcp.setId,
      cardId: viaMcp.cards[0]!.id,
      confirmation: 'DELETE',
    });
    expect(mcpDelete.isError).toBe(false);

    const strip = (list: { question: string; answer: string; position: number }[]): string =>
      JSON.stringify(list.map((card) => [card.question, card.answer, card.position]));
    const restDetail = await request(app).get(`/api/sets/${viaRest.setId}`).set(authHeader(token));
    const mcpDetail = await request(app).get(`/api/sets/${viaMcp.setId}`).set(authHeader(token));
    expect(strip(mcpDetail.body.data.cards)).toBe(strip(restDetail.body.data.cards));

    const restQuiz = await request(app).get(`/api/sets/${viaRest.setId}/quiz`).set(authHeader(token));
    const mcpQuiz = await request(app).get(`/api/sets/${viaMcp.setId}/quiz`).set(authHeader(token));
    expect(mcpQuiz.body.data.questions).toHaveLength(restQuiz.body.data.questions.length);

    const progress = await request(app).get('/api/progress').set(authHeader(token));
    const rows = new Map(
      (progress.body.data.setProgress as { setId: string; totalCards: number; learnedCards: number }[]).map(
        (entry) => [entry.setId, entry],
      ),
    );
    expect(rows.get(viaMcp.setId)?.totalCards).toBe(rows.get(viaRest.setId)?.totalCards);
    expect(rows.get(viaMcp.setId)?.learnedCards).toBe(rows.get(viaRest.setId)?.learnedCards);
  });

  it('set delete via MCP ends in the same state as via REST', async () => {
    const { token } = await signup('McpDeleteParitySet');
    const cards = [
      { question: 'SQ1?', answer: 'SA1' },
      { question: 'SQ2?', answer: 'SA2' },
    ];
    const viaRest = await restCreateSet(token, 'Pariteit REST', cards);
    const viaMcp = await restCreateSet(token, 'Pariteit MCP', cards);
    // Prime both quiz caches so cleanup parity is covered too.
    await request(app).get(`/api/sets/${viaRest.setId}/quiz`).set(authHeader(token));
    await request(app).get(`/api/sets/${viaMcp.setId}/quiz`).set(authHeader(token));

    const restDelete = await request(app)
      .delete(`/api/sets/${viaRest.setId}`)
      .set(authHeader(token));
    expect(restDelete.status).toBe(204);
    const mcpDelete = await callDelete(token, 'lerno_delete_set', {
      setId: viaMcp.setId,
      confirmation: 'DELETE',
    });
    expect(mcpDelete.isError).toBe(false);

    for (const setId of [viaRest.setId, viaMcp.setId]) {
      expect((await request(app).get(`/api/sets/${setId}`).set(authHeader(token))).status).toBe(404);
      expect((await request(app).get(`/api/sets/${setId}/cards`).set(authHeader(token))).status).toBe(
        404,
      );
      expect((await request(app).get(`/api/sets/${setId}/quiz`).set(authHeader(token))).status).toBe(
        404,
      );
    }
    const mine = await request(app).get('/api/sets').set(authHeader(token));
    expect(mine.body.data).toHaveLength(0);
    const progress = await request(app).get('/api/progress').set(authHeader(token));
    expect(progress.body.data.setProgress).toHaveLength(0);
  });
});

describe('mcp delete: hygiene', () => {
  it('keeps outputs compact and secret-free', async () => {
    const { token } = await signup('McpDeleteHygiene');
    const { setId, cards } = await restCreateSet(token, 'Hygiëne', [
      { question: 'Q1?', answer: 'A1' },
      { question: 'Q2?', answer: 'A2' },
    ]);

    const deletedCard = await callDelete(token, 'lerno_delete_card', {
      setId,
      cardId: cards[0]!.id,
      confirmation: 'DELETE',
    });
    const deletedSet = await callDelete(token, 'lerno_delete_set', {
      setId,
      confirmation: 'DELETE',
    });
    const failed = await callDelete(token, 'lerno_delete_set', {
      setId,
      confirmation: 'DELETE',
    });
    expect(failed.isError).toBe(true);

    expect(Object.keys(deletedCard.structured!)).toEqual(['deleted', 'setId', 'cardId']);
    expect(Object.keys(deletedSet.structured!)).toEqual(['deleted', 'setId', 'title']);

    const blob = [deletedCard.text, deletedSet.text, failed.text].join('\n').toLowerCase();
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
      'select ',
      ' at ',
    ]) {
      expect(blob).not.toContain(secret);
    }
  });
});
