/**
 * Phase 5 coverage: study queue, review submission, sessions, reviews and
 * progress endpoints — ordering, auth matrix and forged-input rejection.
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

interface TestCard {
  id: string;
  question: string;
}

async function createSet(
  token: string,
  body: Record<string, unknown>,
): Promise<{ id: string; cards: TestCard[] }> {
  const res = await request(app).post('/api/sets').set(auth(token)).send(body);
  expect(res.status).toBe(201);
  const cards = (res.body.data.cards as { id: string; question: string }[]).map((c) => ({
    id: c.id,
    question: c.question,
  }));
  return { id: res.body.data.id as string, cards };
}

async function review(
  token: string,
  setId: string,
  cardId: string,
  result: string,
  extra: Record<string, unknown> = {},
): Promise<request.Response> {
  return request(app)
    .post('/api/study/review')
    .set(auth(token))
    .send({ setId, cardId, result, ...extra });
}

function expectError(res: { status: number; body: unknown }, status: number, code: string): void {
  expect(res.status).toBe(status);
  const payload = res.body as { error?: { code?: string; message?: string }; data?: unknown };
  expect(payload.error?.code).toBe(code);
  expect(typeof payload.error?.message).toBe('string');
  expect(payload.data).toBeUndefined();
}

describe('phase 5: study queue', () => {
  it('orders cards by strict scheduling priority', async () => {
    const { token } = await signup('Phase5QueueOrder');
    const { id: setId, cards } = await createSet(token, {
      title: 'Priority set',
      cards: [
        { question: 'failed-once?', answer: 'a' },
        { question: 'learned?', answer: 'b' },
        { question: 'untouched?', answer: 'c' },
        { question: 'failed-thrice?', answer: 'd' },
      ],
    });
    const [failedOnce, learned, , failedThrice] = cards as [TestCard, TestCard, TestCard, TestCard];

    await review(token, setId, failedOnce!.id, 'incorrect');
    await review(token, setId, learned!.id, 'correct');
    await review(token, setId, failedThrice!.id, 'incorrect');
    await review(token, setId, failedThrice!.id, 'incorrect');
    await review(token, setId, failedThrice!.id, 'incorrect');

    const res = await request(app).get(`/api/study/queue/${setId}`).set(auth(token));
    expect(res.status).toBe(200);
    const entries = res.body.data.cards as { card: { question: string }; reason: string }[];
    expect(entries.map((e) => e.card.question)).toEqual([
      'failed-once?',
      'failed-thrice?',
      'untouched?',
      'learned?',
    ]);
    expect(entries.map((e) => e.reason)).toEqual(['incorrect', 'difficult', 'new', 'reviewed']);
    expect(res.body.data.title).toBe('Priority set');
  });

  it('enforces queue visibility for guests, strangers and bad ids', async () => {
    const owner = await signup('Phase5QueueOwner');
    const stranger = await signup('Phase5QueueStranger');
    const { id: setId } = await createSet(owner.token, {
      title: 'Queue visibility',
      visibility: 'private',
      cards: [{ question: 'q?', answer: 'a' }],
    });

    expectError(await request(app).get(`/api/study/queue/${setId}`), 404, 'NOT_FOUND');
    expectError(
      await request(app).get(`/api/study/queue/${setId}`).set(auth(stranger.token)),
      404,
      'NOT_FOUND',
    );

    await request(app)
      .patch(`/api/sets/${setId}`)
      .set(auth(owner.token))
      .send({ visibility: 'public' });

    const guest = await request(app).get(`/api/study/queue/${setId}`);
    expect(guest.status).toBe(200);
    expect(guest.body.data.cards).toHaveLength(1);
    expect(guest.body.data.cards[0].reason).toBe('new');
    const strangerQueue = await request(app)
      .get(`/api/study/queue/${setId}`)
      .set(auth(stranger.token));
    expect(strangerQueue.status).toBe(200);

    expectError(
      await request(app).get('/api/study/queue/not-a-uuid').set(auth(owner.token)),
      400,
      'VALIDATION_ERROR',
    );
    expectError(
      await request(app).get(`/api/study/queue/${MISSING_UUID}`).set(auth(owner.token)),
      404,
      'NOT_FOUND',
    );
  });

  it('keeps the practice queue as an interleaved mix', async () => {
    const { token } = await signup('Phase5PracticeMix');
    const { id: setId } = await createSet(token, {
      title: 'Mix',
      cards: [
        { question: 'q1?', answer: 'a' },
        { question: 'q2?', answer: 'b' },
      ],
    });
    const queue = await request(app).get(`/api/study/practice/${setId}`).set(auth(token));
    expect(queue.status).toBe(200);
    expect(queue.body.data.cards).toHaveLength(2);
  });
});

describe('phase 5: review submission', () => {
  it('applies the owner/stranger/guest auth matrix', async () => {
    const owner = await signup('Phase5ReviewOwner');
    const stranger = await signup('Phase5ReviewStranger');
    const { id: setId, cards } = await createSet(owner.token, {
      title: 'Review auth',
      visibility: 'private',
      cards: [{ question: 'q?', answer: 'a' }],
    });
    const cardId = cards[0]!.id;

    expectError(
      await request(app).post('/api/study/review').send({ setId, cardId, result: 'correct' }),
      401,
      'UNAUTHORIZED',
    );
    expectError(await review(stranger.token, setId, cardId, 'correct'), 404, 'NOT_FOUND');

    const ownerReview = await review(owner.token, setId, cardId, 'correct');
    expect(ownerReview.status).toBe(200);
    expect(ownerReview.body.data.progress.repetitionCount).toBe(1);

    // Public sets can be studied (with own progress) by other users.
    await request(app)
      .patch(`/api/sets/${setId}`)
      .set(auth(owner.token))
      .send({ visibility: 'public' });
    const strangerReview = await review(stranger.token, setId, cardId, 'correct');
    expect(strangerReview.status).toBe(200);
    expect(strangerReview.body.data.progress.correctCount).toBe(1);

    // Progress is per-user: the stranger has their own row.
    const strangerProgress = await request(app).get('/api/progress').set(auth(stranger.token));
    expect(strangerProgress.body.data.cardsStudied).toBe(1);
    const ownerProgress = await request(app).get('/api/progress').set(auth(owner.token));
    expect(ownerProgress.body.data.cardsStudied).toBe(1);
  });

  it('validates review input and card/set consistency', async () => {
    const { token } = await signup('Phase5ReviewValidation');
    const first = await createSet(token, {
      title: 'First',
      cards: [{ question: 'q?', answer: 'a' }],
    });
    const second = await createSet(token, {
      title: 'Second',
      cards: [{ question: 'other?', answer: 'b' }],
    });

    expectError(await review(token, 'not-a-uuid', first.cards[0]!.id, 'correct'), 400, 'VALIDATION_ERROR');
    expectError(await review(token, first.id, 'not-a-uuid', 'correct'), 400, 'VALIDATION_ERROR');
    expectError(
      await request(app).post('/api/study/review').set(auth(token)).send({ setId: first.id }),
      400,
      'VALIDATION_ERROR',
    );
    expectError(await review(token, first.id, first.cards[0]!.id, 'maybe'), 400, 'VALIDATION_ERROR');
    expectError(await review(token, MISSING_UUID, first.cards[0]!.id, 'correct'), 404, 'NOT_FOUND');
    expectError(await review(token, first.id, MISSING_UUID, 'correct'), 404, 'NOT_FOUND');
    // Card from another set.
    expectError(await review(token, first.id, second.cards[0]!.id, 'correct'), 404, 'NOT_FOUND');
  });

  it('ignores forged progress values and computes scheduling server-side', async () => {
    const { token } = await signup('Phase5ForgedValues');
    const { id: setId, cards } = await createSet(token, {
      title: 'Forged',
      cards: [{ question: 'q?', answer: 'a' }],
    });
    const before = Date.now();
    const res = await review(token, setId, cards[0]!.id, 'correct', {
      repetitionCount: 99,
      ease: 99,
      correctCount: 50,
      incorrectCount: 0,
      lastReviewedAt: '2001-01-01T00:00:00.000Z',
      nextReviewAt: '2999-12-31T00:00:00.000Z',
    });
    expect(res.status).toBe(200);
    const progress = res.body.data.progress as {
      repetitionCount: number;
      ease: number;
      correctCount: number;
      incorrectCount: number;
      nextReviewAt: string;
    };
    expect(progress.repetitionCount).toBe(1);
    expect(progress.correctCount).toBe(1);
    expect(progress.incorrectCount).toBe(0);
    expect(progress.ease).toBeGreaterThan(1.9);
    expect(progress.ease).toBeLessThan(2.2);
    // ~1 day out, not the forged year-2999 timestamp.
    const nextMs = Date.parse(progress.nextReviewAt);
    expect(nextMs).toBeGreaterThan(before + 20 * 3600_000);
    expect(nextMs).toBeLessThan(before + 28 * 3600_000);
  });

  it('keeps one progress row per user/card and isolates users', async () => {
    const first = await signup('Phase5IsolationA');
    const second = await signup('Phase5IsolationB');
    const { id: setId, cards } = await createSet(first.token, {
      title: 'Isolation',
      visibility: 'public',
      cards: [{ question: 'q?', answer: 'a' }],
    });
    const cardId = cards[0]!.id;

    await review(first.token, setId, cardId, 'correct');
    const again = await review(first.token, setId, cardId, 'correct');
    expect(again.body.data.progress.correctCount).toBe(2);
    expect(again.body.data.progress.repetitionCount).toBe(2);

    const progress = await request(app).get('/api/progress').set(auth(first.token));
    expect(progress.body.data.cardsStudied).toBe(1);

    await review(second.token, setId, cardId, 'incorrect');
    const secondProgress = await request(app).get('/api/progress').set(auth(second.token));
    expect(secondProgress.body.data.cardsStudied).toBe(1);
    expect(secondProgress.body.data.accuracy).toBe(0);

    // First user's accuracy is untouched by the second user's answers.
    const firstAgain = await request(app).get('/api/progress').set(auth(first.token));
    expect(firstAgain.body.data.accuracy).toBe(1);
  });
});

describe('phase 5: study sessions', () => {
  it('starts sessions with visibility checks', async () => {
    const owner = await signup('Phase5SessionOwner');
    const stranger = await signup('Phase5SessionStranger');
    const { id: privateId } = await createSet(owner.token, {
      title: 'Private session set',
      visibility: 'private',
      cards: [{ question: 'q?', answer: 'a' }],
    });

    expectError(
      await request(app).post('/api/study/sessions').send({ setId: privateId }),
      401,
      'UNAUTHORIZED',
    );
    expectError(
      await request(app).post('/api/study/sessions').set(auth(stranger.token)).send({ setId: privateId }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await request(app).post('/api/study/sessions').set(auth(owner.token)).send({ setId: 'nope' }),
      400,
      'VALIDATION_ERROR',
    );

    const withSet = await request(app)
      .post('/api/study/sessions')
      .set(auth(owner.token))
      .send({ setId: privateId });
    expect(withSet.status).toBe(201);
    expect(withSet.body.data.setId).toBe(privateId);
    expect(withSet.body.data.startedAt).toBeTruthy();
    expect(withSet.body.data.endedAt).toBeNull();

    const withoutSet = await request(app)
      .post('/api/study/sessions')
      .set(auth(owner.token))
      .send({});
    expect(withoutSet.status).toBe(201);
    expect(withoutSet.body.data.setId).toBeNull();
  });

  it('ends only the caller’s own sessions with validated input', async () => {
    const owner = await signup('Phase5EndOwner');
    const stranger = await signup('Phase5EndStranger');
    const started = await request(app)
      .post('/api/study/sessions')
      .set(auth(owner.token))
      .send({});
    const sessionId = started.body.data.id as string;

    expectError(
      await request(app).patch(`/api/study/sessions/${sessionId}`).send({ cardsSeen: 1 }),
      401,
      'UNAUTHORIZED',
    );
    expectError(
      await request(app).patch('/api/study/sessions/not-a-uuid').set(auth(owner.token)).send({}),
      400,
      'VALIDATION_ERROR',
    );
    expectError(
      await request(app).patch(`/api/study/sessions/${MISSING_UUID}`).set(auth(owner.token)).send({}),
      404,
      'NOT_FOUND',
    );
    expectError(
      await request(app)
        .patch(`/api/study/sessions/${sessionId}`)
        .set(auth(stranger.token))
        .send({ cardsSeen: 1 }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await request(app)
        .patch(`/api/study/sessions/${sessionId}`)
        .set(auth(owner.token))
        .send({ cardsSeen: -1 }),
      400,
      'VALIDATION_ERROR',
    );
    expectError(
      await request(app)
        .patch(`/api/study/sessions/${sessionId}`)
        .set(auth(owner.token))
        .send({ cardsSeen: 20_000 }),
      400,
      'VALIDATION_ERROR',
    );

    const ended = await request(app)
      .patch(`/api/study/sessions/${sessionId}`)
      .set(auth(owner.token))
      .send({ cardsSeen: 5 });
    expect(ended.status).toBe(200);
    expect(ended.body.data.cardsSeen).toBe(5);
    expect(ended.body.data.endedAt).toBeTruthy();

    // cardsSeen defaults to 0.
    const second = await request(app).post('/api/study/sessions').set(auth(owner.token)).send({});
    const defaulted = await request(app)
      .patch(`/api/study/sessions/${second.body.data.id as string}`)
      .set(auth(owner.token))
      .send({});
    expect(defaulted.body.data.cardsSeen).toBe(0);
  });
});

describe('phase 5: reviews and progress endpoints', () => {
  it('requires authentication', async () => {
    expectError(await request(app).get('/api/reviews'), 401, 'UNAUTHORIZED');
    expectError(await request(app).get('/api/progress'), 401, 'UNAUTHORIZED');
  });

  it('hides due groups for sets the user can no longer study', async () => {
    const owner = await signup('Phase5DueOwner');
    const stranger = await signup('Phase5DueStranger');
    const { id: setId, cards } = await createSet(owner.token, {
      title: 'Soon private',
      visibility: 'public',
      cards: [{ question: 'q?', answer: 'a' }],
    });

    await review(stranger.token, setId, cards[0]!.id, 'incorrect');
    const before = await request(app).get('/api/reviews').set(auth(stranger.token));
    expect(before.body.data).toHaveLength(1);

    await request(app)
      .patch(`/api/sets/${setId}`)
      .set(auth(owner.token))
      .send({ visibility: 'private' });

    const after = await request(app).get('/api/reviews').set(auth(stranger.token));
    expect(after.body.data).toEqual([]);
    expectError(
      await request(app).get(`/api/study/queue/${setId}`).set(auth(stranger.token)),
      404,
      'NOT_FOUND',
    );
  });

  it('reports answer totals, due cards and accuracy', async () => {
    const { token } = await signup('Phase5ProgressTotals');
    const { id: setId, cards } = await createSet(token, {
      title: 'Totals',
      cards: [
        { question: 'q1?', answer: 'a' },
        { question: 'q2?', answer: 'b' },
      ],
    });
    await review(token, setId, cards[0]!.id, 'correct');
    await review(token, setId, cards[1]!.id, 'incorrect');

    const res = await request(app).get('/api/progress').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.data.cardsStudied).toBe(2);
    expect(res.body.data.correctAnswers).toBe(1);
    expect(res.body.data.incorrectAnswers).toBe(1);
    expect(res.body.data.dueCards).toBe(1);
    expect(res.body.data.accuracy).toBe(0.5);
    expect(res.body.data.setProgress).toHaveLength(1);
    expect(res.body.data.setProgress[0].dueCards).toBe(1);
  });
});
