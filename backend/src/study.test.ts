import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

const app = createApp();

async function setupStudent(): Promise<{
  token: string;
  setId: string;
  cardIds: string[];
}> {
  const email = `study${Math.floor(Math.random() * 1e6)}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'password123', displayName: 'Study Student' });
  const token = signup.body.data.accessToken as string;

  const set = await request(app)
    .post('/api/sets')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: 'Biology basics',
      visibility: 'private',
      cards: [
        { question: 'What is a cell?', answer: 'The basic unit of life' },
        { question: 'What is DNA?', answer: 'Deoxyribonucleic acid' },
        { question: 'What is osmosis?', answer: 'Water diffusion across a membrane' },
      ],
    });

  return {
    token,
    setId: set.body.data.id as string,
    cardIds: (set.body.data.cards as { id: string }[]).map((card) => card.id),
  };
}

describe('flashcard review + spaced repetition', () => {
  it('saves progress and schedules the next review', async () => {
    const { token, setId, cardIds } = await setupStudent();

    const first = await request(app)
      .post('/api/study/review')
      .set('Authorization', `Bearer ${token}`)
      .send({ setId, cardId: cardIds[0], result: 'correct' });
    expect(first.status).toBe(200);
    expect(first.body.data.progress.repetitionCount).toBe(1);
    expect(first.body.data.progress.correctCount).toBe(1);
    expect(first.body.data.requeued).toBe(false);
    expect(first.body.data.progress.nextReviewAt).toBeTruthy();

    // Incorrect answer requeues and reduces the interval
    const wrong = await request(app)
      .post('/api/study/review')
      .set('Authorization', `Bearer ${token}`)
      .send({ setId, cardId: cardIds[0], result: 'incorrect' });
    expect(wrong.status).toBe(200);
    expect(wrong.body.data.progress.repetitionCount).toBe(0);
    expect(wrong.body.data.progress.incorrectCount).toBe(1);
    expect(wrong.body.data.requeued).toBe(true);
  });

  it('rejects reviews for cards outside the set and for private sets', async () => {
    const { token, setId, cardIds } = await setupStudent();

    const wrongSet = await request(app)
      .post('/api/study/review')
      .set('Authorization', `Bearer ${token}`)
      .send({ setId: cardIds[0], cardId: cardIds[0], result: 'correct' });
    expect(wrongSet.status).toBe(404);

    const stranger = await request(app)
      .post('/api/study/review')
      .send({ setId, cardId: cardIds[0], result: 'correct' });
    expect(stranger.status).toBe(401);
  });

  it('builds practice queues mixing due/incorrect/difficult/new cards', async () => {
    const { token, setId, cardIds } = await setupStudent();

    await request(app)
      .post('/api/study/review')
      .set('Authorization', `Bearer ${token}`)
      .send({ setId, cardId: cardIds[0], result: 'correct' });
    await request(app)
      .post('/api/study/review')
      .set('Authorization', `Bearer ${token}`)
      .send({ setId, cardId: cardIds[1], result: 'incorrect' });

    const queue = await request(app)
      .get(`/api/study/practice/${setId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(queue.status).toBe(200);
    expect(queue.body.data.cards).toHaveLength(3);
    const reasons = (queue.body.data.cards as { reason: string }[]).map((card) => card.reason);
    expect(reasons).toContain('new');
    expect(reasons).toContain('incorrect'); // failed card is flagged
    expect(reasons).toContain('reviewed'); // studied-not-due card is labeled honestly
    expect(queue.body.data.title).toBe('Biology basics');
  });

  it('lets guests practice public sets without persisting progress', async () => {
    const { token, setId } = await setupStudent();
    await request(app)
      .patch(`/api/sets/${setId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ visibility: 'public' });

    const queue = await request(app).get(`/api/study/practice/${setId}`);
    expect(queue.status).toBe(200);
    expect((queue.body.data.cards as { reason: string }[]).every((c) => c.reason === 'new')).toBe(
      true,
    );

    // Guests cannot record reviews
    const review = await request(app)
      .post('/api/study/review')
      .send({ setId, cardId: 'x', result: 'correct' });
    expect(review.status).toBe(401);
  });
});

describe('sessions, reviews page, progress and dashboard', () => {
  it('tracks sessions and reports due cards and stats', async () => {
    const { token, setId, cardIds } = await setupStudent();

    const session = await request(app)
      .post('/api/study/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({ setId });
    expect(session.status).toBe(201);
    const sessionId = session.body.data.id as string;

    // Review all cards incorrectly → immediately due again (learning queue)
    for (const cardId of cardIds) {
      await request(app)
        .post('/api/study/review')
        .set('Authorization', `Bearer ${token}`)
        .send({ setId, cardId, result: 'incorrect' });
    }

    const ended = await request(app)
      .patch(`/api/study/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ cardsSeen: 3 });
    expect(ended.status).toBe(200);
    expect(ended.body.data.cardsSeen).toBe(3);
    expect(ended.body.data.endedAt).toBeTruthy();

    const due = await request(app).get('/api/reviews').set('Authorization', `Bearer ${token}`);
    expect(due.status).toBe(200);
    expect(due.body.data).toHaveLength(1);
    expect(due.body.data[0].dueCount).toBe(3);
    expect(due.body.data[0].setTitle).toBe('Biology basics');

    const progress = await request(app)
      .get('/api/progress')
      .set('Authorization', `Bearer ${token}`);
    expect(progress.status).toBe(200);
    expect(progress.body.data.cardsStudied).toBe(3);
    expect(progress.body.data.streakDays).toBe(1);
    expect(progress.body.data.accuracy).toBe(0);
    expect(progress.body.data.studyTimeMinutes).toBeGreaterThanOrEqual(0);
    expect(progress.body.data.subjectProgress.length).toBeGreaterThanOrEqual(1);

    const dashboard = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${token}`);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.data.cardsDue).toBe(3);
    expect(dashboard.body.data.greetingName).toBe('Study');
    expect(dashboard.body.data.continueSet.id).toBe(setId);
  });

  it('reports no due cards for a fresh account', async () => {
    const email = `fresh${Math.floor(Math.random() * 1e6)}@example.com`;
    const signup = await request(app)
      .post('/api/auth/signup')
      .send({ email, password: 'password123', displayName: 'Fresh' });
    const token = signup.body.data.accessToken as string;

    const due = await request(app).get('/api/reviews').set('Authorization', `Bearer ${token}`);
    expect(due.status).toBe(200);
    expect(due.body.data).toEqual([]);

    const progress = await request(app)
      .get('/api/progress')
      .set('Authorization', `Bearer ${token}`);
    expect(progress.body.data.streakDays).toBe(0);
    expect(progress.body.data.cardsStudied).toBe(0);
  });
});

describe('practice completion edge cases', () => {
  it('returns empty queues for sets without cards', async () => {
    const email = `empty${Math.floor(Math.random() * 1e6)}@example.com`;
    const signup = await request(app)
      .post('/api/auth/signup')
      .send({ email, password: 'password123', displayName: 'Empty' });
    const token = signup.body.data.accessToken as string;
    const set = await request(app)
      .post('/api/sets')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Empty set' });
    expect(set.status).toBe(201);
    const setId = set.body.data.id as string;

    const practice = await request(app)
      .get(`/api/study/practice/${setId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(practice.status).toBe(200);
    expect(practice.body.data.cards).toEqual([]);

    const queue = await request(app)
      .get(`/api/study/queue/${setId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(queue.status).toBe(200);
    expect(queue.body.data.cards).toEqual([]);
  });

  it('keeps incorrectly answered fresh cards in the learning queue', async () => {
    const { token, setId, cardIds } = await setupStudent();
    const before = Date.now();
    const res = await request(app)
      .post('/api/study/review')
      .set('Authorization', `Bearer ${token}`)
      .send({ setId, cardId: cardIds[0], result: 'incorrect' });
    expect(res.status).toBe(200);
    expect(res.body.data.requeued).toBe(true);
    // Interval step 0: the next review is due immediately, not days away.
    const nextMs = Date.parse(res.body.data.progress.nextReviewAt as string);
    expect(nextMs).toBeGreaterThanOrEqual(before - 1000);
    expect(nextMs).toBeLessThanOrEqual(Date.now() + 60_000);
  });

  it('rejects guest reviews: server progress stays signed-in only', async () => {
    const { setId, cardIds } = await setupStudent();
    const guestReview = await request(app)
      .post('/api/study/review')
      .send({ setId, cardId: cardIds[0], result: 'correct' });
    expect(guestReview.status).toBe(401);
  });
});
