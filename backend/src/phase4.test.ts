/**
 * Phase 4 coverage: subjects, study sets and cards.
 *
 * Focuses on the rules from the task brief that the lifecycle tests in
 * sets.test.ts do not pin down: ownership enforcement, public/private read
 * matrix, input validation, cross-set card access and unauthenticated access.
 */
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

const app = createApp();

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

const auth = (token: string): { Authorization: string } => ({
  Authorization: `Bearer ${token}`,
});

async function createSubject(token: string, name: string): Promise<string> {
  const res = await request(app).post('/api/subjects').set(auth(token)).send({ name });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

async function createSet(
  token: string,
  body: Record<string, unknown>,
): Promise<{ id: string; body: Record<string, unknown> }> {
  const res = await request(app).post('/api/sets').set(auth(token)).send(body);
  expect(res.status).toBe(201);
  return { id: res.body.data.id as string, body: res.body.data as Record<string, unknown> };
}

function expectError(res: { status: number; body: unknown }, status: number, code: string): void {
  expect(res.status).toBe(status);
  const payload = res.body as { error?: { code?: string; message?: string }; data?: unknown };
  expect(payload.error?.code).toBe(code);
  expect(typeof payload.error?.message).toBe('string');
  expect(payload.data).toBeUndefined();
  // Never leak internals (spec §14): no stack traces or provider details.
  const serialized = JSON.stringify(payload);
  expect(serialized).not.toContain('Supabase');
  expect(serialized).not.toContain('node_modules');
  expect(serialized).not.toMatch(/\n\s*at\s/);
}

describe('phase 4: subjects', () => {
  it('rejects invalid subject names', async () => {
    const { token } = await signup('Phase4SubjectValidation');
    for (const name of ['', '   ', '\t\n ', 'x'.repeat(81)]) {
      const res = await request(app).post('/api/subjects').set(auth(token)).send({ name });
      expectError(res, 400, 'VALIDATION_ERROR');
    }
    const missing = await request(app).post('/api/subjects').set(auth(token)).send({});
    expectError(missing, 400, 'VALIDATION_ERROR');

    const subjectId = await createSubject(token, 'Valid name');
    const rename = await request(app)
      .patch(`/api/subjects/${subjectId}`)
      .set(auth(token))
      .send({ name: '  ' });
    expectError(rename, 400, 'VALIDATION_ERROR');
  });

  it('requires authentication for every subject route', async () => {
    const { token } = await signup('Phase4SubjectAuth');
    const subjectId = await createSubject(token, 'Auth check');

    expectError(await request(app).get('/api/subjects'), 401, 'UNAUTHORIZED');
    expectError(await request(app).post('/api/subjects').send({ name: 'x' }), 401, 'UNAUTHORIZED');
    expectError(
      await request(app).patch(`/api/subjects/${subjectId}`).send({ name: 'x' }),
      401,
      'UNAUTHORIZED',
    );
    expectError(await request(app).delete(`/api/subjects/${subjectId}`), 401, 'UNAUTHORIZED');
  });

  it('rejects malformed subject ids', async () => {
    const { token } = await signup('Phase4SubjectParams');
    expectError(
      await request(app).patch('/api/subjects/not-a-uuid').set(auth(token)).send({ name: 'x' }),
      400,
      'VALIDATION_ERROR',
    );
    expectError(
      await request(app).delete('/api/subjects/not-a-uuid').set(auth(token)),
      400,
      'VALIDATION_ERROR',
    );
  });

  it('keeps subjects strictly per-owner', async () => {
    const owner = await signup('Phase4SubjectOwner');
    const stranger = await signup('Phase4SubjectStranger');
    const subjectId = await createSubject(owner.token, 'Mine');
    await createSubject(stranger.token, 'Theirs');

    const ownerList = await request(app).get('/api/subjects').set(auth(owner.token));
    expect(ownerList.body.data.map((s: { name: string }) => s.name)).toEqual(['Mine']);

    expectError(
      await request(app)
        .patch(`/api/subjects/${subjectId}`)
        .set(auth(stranger.token))
        .send({ name: 'Hacked' }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await request(app).delete(`/api/subjects/${subjectId}`).set(auth(stranger.token)),
      404,
      'NOT_FOUND',
    );

    // Still intact for the owner.
    const again = await request(app).get('/api/subjects').set(auth(owner.token));
    expect(again.body.data).toHaveLength(1);
  });

  it('detaches sets when their subject is deleted', async () => {
    const { token } = await signup('Phase4SubjectDetach');
    const subjectId = await createSubject(token, 'Temporary');
    const { id: setId } = await createSet(token, { title: 'Survivor', subjectId });

    const del = await request(app).delete(`/api/subjects/${subjectId}`).set(auth(token));
    expect(del.status).toBe(204);

    const detail = await request(app).get(`/api/sets/${setId}`).set(auth(token));
    expect(detail.status).toBe(200);
    expect(detail.body.data.subjectId).toBeNull();
    expect(detail.body.data.subjectName).toBeNull();
  });
});

describe('phase 4: study sets', () => {
  it('requires authentication for listing and writing sets', async () => {
    const { token } = await signup('Phase4SetAuth');
    const { id: setId } = await createSet(token, { title: 'Auth set' });

    expectError(await request(app).get('/api/sets'), 401, 'UNAUTHORIZED');
    expectError(await request(app).post('/api/sets').send({ title: 'x' }), 401, 'UNAUTHORIZED');
    expectError(
      await request(app).patch(`/api/sets/${setId}`).send({ title: 'x' }),
      401,
      'UNAUTHORIZED',
    );
    expectError(await request(app).delete(`/api/sets/${setId}`), 401, 'UNAUTHORIZED');
  });

  it('rejects malformed set ids', async () => {
    const { token } = await signup('Phase4SetParams');
    expectError(await request(app).get('/api/sets/not-a-uuid').set(auth(token)), 400, 'VALIDATION_ERROR');
    expectError(
      await request(app).patch('/api/sets/not-a-uuid').set(auth(token)).send({ title: 'x' }),
      400,
      'VALIDATION_ERROR',
    );
    expectError(
      await request(app).delete('/api/sets/not-a-uuid').set(auth(token)),
      400,
      'VALIDATION_ERROR',
    );
    expectError(
      await request(app).get('/api/sets/not-a-uuid/cards').set(auth(token)),
      400,
      'VALIDATION_ERROR',
    );
  });

  it('validates set input strictly', async () => {
    const { token } = await signup('Phase4SetValidation');
    const badBodies: Record<string, unknown>[] = [
      { title: '' },
      { title: '   ' },
      { title: 'x'.repeat(161) },
      { title: 'ok', visibility: 'semi-public' },
      { title: 'ok', subjectId: 'not-a-uuid' },
      { title: 'ok', level: 'x'.repeat(61) },
      { title: 'ok', description: 'x'.repeat(2001) },
      { title: 'ok', tags: Array.from({ length: 11 }, (_, i) => `tag${i}`) },
      { title: 'ok', tags: ['fine', '   '] },
      { title: 'ok', tags: ['x'.repeat(41)] },
      { title: 'ok', cards: [{ question: '  ', answer: 'a' }] },
      { title: 'ok', cards: [{ question: 'q', answer: '' }] },
    ];
    for (const body of badBodies) {
      const res = await request(app).post('/api/sets').set(auth(token)).send(body);
      expectError(res, 400, 'VALIDATION_ERROR');
    }

    // Empty sets are valid — cards can be added later.
    const empty = await request(app).post('/api/sets').set(auth(token)).send({ title: 'Empty' });
    expect(empty.status).toBe(201);
    expect(empty.body.data.cardCount).toBe(0);

    const { id: setId } = await createSet(token, { title: 'Good set' });
    expectError(
      await request(app).patch(`/api/sets/${setId}`).set(auth(token)).send({}),
      400,
      'VALIDATION_ERROR',
    );
    expectError(
      await request(app).patch(`/api/sets/${setId}`).set(auth(token)).send({ title: '' }),
      400,
      'VALIDATION_ERROR',
    );
    expectError(
      await request(app).patch(`/api/sets/${setId}`).set(auth(token)).send({ visibility: 'friends' }),
      400,
      'VALIDATION_ERROR',
    );
  });

  it('rejects unknown or foreign subjects', async () => {
    const owner = await signup('Phase4SetSubjectOwner');
    const stranger = await signup('Phase4SetSubjectStranger');
    const foreignId = await createSubject(stranger.token, 'Foreign');

    expectError(
      await request(app)
        .post('/api/sets')
        .set(auth(owner.token))
        .send({ title: 'Nope', subjectId: MISSING_UUID }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await request(app)
        .post('/api/sets')
        .set(auth(owner.token))
        .send({ title: 'Nope', subjectId: foreignId }),
      404,
      'NOT_FOUND',
    );

    const { id: setId } = await createSet(owner.token, { title: 'Mine' });
    expectError(
      await request(app)
        .patch(`/api/sets/${setId}`)
        .set(auth(owner.token))
        .send({ subjectId: foreignId }),
      404,
      'NOT_FOUND',
    );
  });

  it('supports the subject_id spelling and detaching via null', async () => {
    const { token } = await signup('Phase4SubjectAlias');
    const subjectId = await createSubject(token, 'Aliased');

    const { id: setId, body } = await createSet(token, {
      title: 'Alias set',
      subject_id: subjectId,
    });
    expect(body['subjectId']).toBe(subjectId);
    expect(body['subjectName']).toBe('Aliased');

    const detach = await request(app)
      .patch(`/api/sets/${setId}`)
      .set(auth(token))
      .send({ subject_id: null });
    expect(detach.status).toBe(200);
    expect(detach.body.data.subjectId).toBeNull();
  });

  it('does not detach the subject on unrelated updates', async () => {
    const { token } = await signup('Phase4SubjectSticky');
    const subjectId = await createSubject(token, 'Sticky');
    const { id: setId } = await createSet(token, { title: 'Sticky set', subjectId });

    const renamed = await request(app)
      .patch(`/api/sets/${setId}`)
      .set(auth(token))
      .send({ title: 'Sticky set v2' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.subjectId).toBe(subjectId);
    expect(renamed.body.data.subjectName).toBe('Sticky');
  });

  it('enforces the public/private read matrix for sets and cards', async () => {
    const owner = await signup('Phase4VisibilityOwner');
    const stranger = await signup('Phase4VisibilityStranger');
    const { id: setId } = await createSet(owner.token, {
      title: 'Matrix set',
      visibility: 'private',
      cards: [{ question: 'q?', answer: 'a' }],
    });

    // Private: owner only.
    expect((await request(app).get(`/api/sets/${setId}`).set(auth(owner.token))).status).toBe(200);
    expectError(
      await request(app).get(`/api/sets/${setId}`).set(auth(stranger.token)),
      404,
      'NOT_FOUND',
    );
    expectError(await request(app).get(`/api/sets/${setId}`), 404, 'NOT_FOUND');
    expectError(
      await request(app).get(`/api/sets/${setId}/cards`).set(auth(stranger.token)),
      404,
      'NOT_FOUND',
    );
    expectError(await request(app).get(`/api/sets/${setId}/cards`), 404, 'NOT_FOUND');

    // Public: everyone can read, nobody else can write.
    const published = await request(app)
      .patch(`/api/sets/${setId}`)
      .set(auth(owner.token))
      .send({ visibility: 'public' });
    expect(published.body.data.visibility).toBe('public');

    expect((await request(app).get(`/api/sets/${setId}`)).status).toBe(200);
    expect(
      (await request(app).get(`/api/sets/${setId}`).set(auth(stranger.token))).status,
    ).toBe(200);
    const guestCards = await request(app).get(`/api/sets/${setId}/cards`);
    expect(guestCards.status).toBe(200);
    expect(guestCards.body.data).toHaveLength(1);

    expectError(
      await request(app)
        .patch(`/api/sets/${setId}`)
        .set(auth(stranger.token))
        .send({ title: 'Hacked' }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await request(app).delete(`/api/sets/${setId}`).set(auth(stranger.token)),
      404,
      'NOT_FOUND',
    );

    // Back to private: hidden again.
    await request(app)
      .patch(`/api/sets/${setId}`)
      .set(auth(owner.token))
      .send({ visibility: 'private' });
    expectError(await request(app).get(`/api/sets/${setId}`), 404, 'NOT_FOUND');
  });

  it('returns 404 for unknown sets without leaking existence', async () => {
    const { token } = await signup('Phase4SetMissing');
    expectError(await request(app).get(`/api/sets/${MISSING_UUID}`).set(auth(token)), 404, 'NOT_FOUND');
    expectError(await request(app).get(`/api/sets/${MISSING_UUID}`), 404, 'NOT_FOUND');
  });
});

describe('phase 4: cards', () => {
  it('requires authentication for card writes', async () => {
    const { token } = await signup('Phase4CardAuth');
    const { id: setId } = await createSet(token, {
      title: 'Card auth',
      visibility: 'public',
      cards: [{ question: 'q?', answer: 'a' }],
    });
    const detail = await request(app).get(`/api/sets/${setId}`).set(auth(token));
    const cardId = (
      detail.body.data.cards as { id: string }[]
    )[0]!.id;

    expectError(
      await request(app).post(`/api/sets/${setId}/cards`).send({ cards: [{ question: 'q', answer: 'a' }] }),
      401,
      'UNAUTHORIZED',
    );
    expectError(
      await request(app).patch(`/api/sets/${setId}/cards/${cardId}`).send({ answer: 'x' }),
      401,
      'UNAUTHORIZED',
    );
    expectError(await request(app).delete(`/api/sets/${setId}/cards/${cardId}`), 401, 'UNAUTHORIZED');
  });

  it('accepts both bulk and single-card payloads', async () => {
    const { token } = await signup('Phase4CardShapes');
    const { id: setId } = await createSet(token, { title: 'Shapes' });

    const single = await request(app)
      .post(`/api/sets/${setId}/cards`)
      .set(auth(token))
      .send({ question: 'Single?', answer: 'Yes' });
    expect(single.status).toBe(201);
    expect(single.body.data).toHaveLength(1);
    expect(single.body.data[0].question).toBe('Single?');

    const bulk = await request(app)
      .post(`/api/sets/${setId}/cards`)
      .set(auth(token))
      .send({
        cards: [
          { question: 'Bulk 1?', answer: 'a1' },
          { question: 'Bulk 2?', answer: 'a2' },
        ],
      });
    expect(bulk.status).toBe(201);
    expect(bulk.body.data).toHaveLength(2);
  });

  it('validates card input strictly', async () => {
    const { token } = await signup('Phase4CardValidation');
    const { id: setId } = await createSet(token, {
      title: 'Card validation',
      cards: [{ question: 'q?', answer: 'a' }],
    });
    const detail = await request(app).get(`/api/sets/${setId}`).set(auth(token));
    const cardId = (detail.body.data.cards as { id: string }[])[0]!.id;

    const badBodies: unknown[] = [
      {},
      { cards: [] },
      { cards: [{ question: '', answer: 'a' }] },
      { cards: [{ question: '   ', answer: 'a' }] },
      { cards: [{ question: 'q', answer: '  ' }] },
      { cards: [{ question: 'q'.repeat(2001), answer: 'a' }] },
      { cards: [{ question: 'q', answer: 'a'.repeat(4001) }] },
      { question: '', answer: 'a' },
      { question: 'q' },
    ];
    for (const body of badBodies) {
      const res = await request(app).post(`/api/sets/${setId}/cards`).set(auth(token)).send(body);
      expectError(res, 400, 'VALIDATION_ERROR');
    }

    expectError(
      await request(app).patch(`/api/sets/${setId}/cards/${cardId}`).set(auth(token)).send({}),
      400,
      'VALIDATION_ERROR',
    );
    expectError(
      await request(app)
        .patch(`/api/sets/${setId}/cards/${cardId}`)
        .set(auth(token))
        .send({ question: '   ' }),
      400,
      'VALIDATION_ERROR',
    );
    expectError(
      await request(app)
        .patch(`/api/sets/${setId}/cards/not-a-uuid`)
        .set(auth(token))
        .send({ answer: 'x' }),
      400,
      'VALIDATION_ERROR',
    );
  });

  it('lets only the set owner write cards', async () => {
    const owner = await signup('Phase4CardOwner');
    const stranger = await signup('Phase4CardStranger');
    const { id: setId } = await createSet(owner.token, {
      title: 'Guarded cards',
      visibility: 'public',
      cards: [{ question: 'q?', answer: 'a' }],
    });
    const detail = await request(app).get(`/api/sets/${setId}`).set(auth(owner.token));
    const cardId = (detail.body.data.cards as { id: string }[])[0]!.id;

    expectError(
      await request(app)
        .post(`/api/sets/${setId}/cards`)
        .set(auth(stranger.token))
        .send({ cards: [{ question: 'q', answer: 'a' }] }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await request(app)
        .patch(`/api/sets/${setId}/cards/${cardId}`)
        .set(auth(stranger.token))
        .send({ answer: 'hacked' }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await request(app).delete(`/api/sets/${setId}/cards/${cardId}`).set(auth(stranger.token)),
      404,
      'NOT_FOUND',
    );
    expectError(
      await request(app)
        .post(`/api/sets/${MISSING_UUID}/cards`)
        .set(auth(stranger.token))
        .send({ cards: [{ question: 'q', answer: 'a' }] }),
      404,
      'NOT_FOUND',
    );
  });

  it('prevents cards from being modified through a different set', async () => {
    const { token } = await signup('Phase4CrossSet');
    const first = await createSet(token, {
      title: 'First',
      cards: [{ question: 'original?', answer: 'original' }],
    });
    const second = await createSet(token, { title: 'Second' });
    const detail = await request(app).get(`/api/sets/${first.id}`).set(auth(token));
    const cardId = (detail.body.data.cards as { id: string }[])[0]!.id;

    expectError(
      await request(app)
        .patch(`/api/sets/${second.id}/cards/${cardId}`)
        .set(auth(token))
        .send({ answer: 'cross-set write' }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await request(app).delete(`/api/sets/${second.id}/cards/${cardId}`).set(auth(token)),
      404,
      'NOT_FOUND',
    );

    // The card is untouched in its real set.
    const again = await request(app).get(`/api/sets/${first.id}`).set(auth(token));
    expect(again.body.data.cards).toHaveLength(1);
    expect(again.body.data.cards[0].answer).toBe('original');
  });

  it('preserves card position ordering', async () => {
    const { token } = await signup('Phase4CardOrder');
    const { id: setId } = await createSet(token, {
      title: 'Ordered',
      cards: [
        { question: 'first?', answer: '1' },
        { question: 'second?', answer: '2' },
        { question: 'third?', answer: '3' },
      ],
    });

    const list = await request(app).get(`/api/sets/${setId}/cards`).set(auth(token));
    expect(list.body.data.map((c: { position: number }) => c.position)).toEqual([0, 1, 2]);
    expect(list.body.data.map((c: { question: string }) => c.question)).toEqual([
      'first?',
      'second?',
      'third?',
    ]);

    const added = await request(app)
      .post(`/api/sets/${setId}/cards`)
      .set(auth(token))
      .send({ cards: [{ question: 'fourth?', answer: '4' }] });
    expect(added.body.data[0].position).toBe(3);

    const middleId = (list.body.data as { id: string }[])[1]!.id;
    const edited = await request(app)
      .patch(`/api/sets/${setId}/cards/${middleId}`)
      .set(auth(token))
      .send({ answer: 'two' });
    expect(edited.status).toBe(200);

    const relist = await request(app).get(`/api/sets/${setId}/cards`).set(auth(token));
    expect(relist.body.data.map((c: { question: string }) => c.question)).toEqual([
      'first?',
      'second?',
      'third?',
      'fourth?',
    ]);
    expect(relist.body.data[1].answer).toBe('two');
  });
});
