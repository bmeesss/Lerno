/**
 * End-to-end smoke flow (spec §20):
 *
 *   signup/login → create set → add cards → study → submit quiz result
 *   → progress visible → guest access to published set
 *
 * Runs the real Express app over HTTP (supertest) against the development
 * data store — no mocks of the API surface.
 */
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../backend/src/app.js';

const app = createApp();

describe('smoke: full student journey', () => {
  it('signs up, studies, quizzes and sees progress', async () => {
    const email = `smoke${Date.now()}@example.com`;

    // 1. Signup
    const signup = await request(app).post('/api/auth/signup').send({
      email,
      password: 'password123',
      displayName: 'Smoke Student',
    });
    expect(signup.status).toBe(201);
    const token = signup.body.data.accessToken as string;
    const auth = { Authorization: `Bearer ${token}` };

    // 2. Login (existing account)
    const login = await request(app).post('/api/auth/login').send({
      email,
      password: 'password123',
    });
    expect(login.status).toBe(200);

    // 3. Create a subject and a study set with cards
    const subject = await request(app)
      .post('/api/subjects')
      .set(auth)
      .send({ name: 'Smoke topic' });
    expect(subject.status).toBe(201);

    const created = await request(app)
      .post('/api/sets')
      .set(auth)
      .send({
        title: 'Smoke set',
        subjectId: subject.body.data.id,
        level: 'havo 4',
        description: 'Smoke test material',
        visibility: 'private',
        tags: ['smoke'],
        cards: [
          { question: 'Smoke Q1?', answer: 'Smoke A1' },
          { question: 'Smoke Q2?', answer: 'Smoke A2' },
          { question: 'Smoke Q3?', answer: 'Smoke A3' },
        ],
      });
    expect(created.status).toBe(201);
    const setId = created.body.data.id as string;
    const cardIds = (created.body.data.cards as { id: string }[]).map((card) => card.id);
    expect(cardIds).toHaveLength(3);

    // 4. Add one more card
    const extra = await request(app)
      .post(`/api/sets/${setId}/cards`)
      .set(auth)
      .send({ cards: [{ question: 'Smoke Q4?', answer: 'Smoke A4' }] });
    expect(extra.status).toBe(201);

    // 5. Study: one correct, one incorrect
    const good = await request(app)
      .post('/api/study/review')
      .set(auth)
      .send({ setId, cardId: cardIds[0], result: 'correct' });
    expect(good.status).toBe(200);
    expect(good.body.data.progress.nextReviewAt).toBeTruthy();

    const bad = await request(app)
      .post('/api/study/review')
      .set(auth)
      .send({ setId, cardId: cardIds[1], result: 'incorrect' });
    expect(bad.body.data.requeued).toBe(true);

    // 6. Quiz: load and submit
    const quiz = await request(app).get(`/api/sets/${setId}/quiz`).set(auth);
    expect(quiz.status).toBe(200);
    const answers = (quiz.body.data.questions as { id: string; prompt: string }[]).map(
      (question) => ({
        questionId: question.id,
        answer: question.prompt.startsWith('Smoke Q1?') ? 'Smoke A1' : 'no idea',
      }),
    );
    const attempt = await request(app)
      .post(`/api/sets/${setId}/quiz/attempts`)
      .set(auth)
      .send({ answers });
    expect(attempt.status).toBe(200);
    expect(attempt.body.data.persisted).toBe(true);
    expect(attempt.body.data.correct).toBeGreaterThanOrEqual(1);

    // 7. Progress is visible
    const progress = await request(app).get('/api/progress').set(auth);
    expect(progress.status).toBe(200);
    expect(progress.body.data.cardsStudied).toBe(2);
    expect(progress.body.data.quizAttempts).toBe(1);
    expect(progress.body.data.streakDays).toBe(1);

    const dashboard = await request(app).get('/api/dashboard').set(auth);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.data.continueSet.id).toBe(setId);
    expect(dashboard.body.data.cardsStudied).toBe(2);

    // 8. Publish → guests can study and quiz but cannot write
    const published = await request(app)
      .patch(`/api/sets/${setId}`)
      .set(auth)
      .send({ visibility: 'public' });
    expect(published.body.data.visibility).toBe('public');

    const guestDetail = await request(app).get(`/api/sets/${setId}`);
    expect(guestDetail.status).toBe(200);
    expect(guestDetail.body.data.cards).toHaveLength(4);

    const guestQuiz = await request(app).get(`/api/sets/${setId}/quiz`);
    expect(guestQuiz.status).toBe(200);

    const guestAttempt = await request(app)
      .post(`/api/sets/${setId}/quiz/attempts`)
      .send({ answers: [] })
      .expect(400);
    expect(guestAttempt.body.error.code).toBe('VALIDATION_ERROR');

    // 9. Private set stays hidden from guests after unlisting again
    await request(app).patch(`/api/sets/${setId}`).set(auth).send({ visibility: 'private' });
    expect((await request(app).get(`/api/sets/${setId}`)).status).toBe(404);
  });

  it('answers the health check throughout the stack', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
