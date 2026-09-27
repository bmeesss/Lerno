/**
 * Dashboard coverage: auth, backward-compatible fields and discover
 * suggestions (public only, excluding own and favorited sets).
 */
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

const app = createApp();

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

async function createSet(token: string, body: Record<string, unknown>): Promise<{ id: string }> {
  const res = await request(app).post('/api/sets').set(auth(token)).send(body);
  expect(res.status).toBe(201);
  return { id: res.body.data.id as string };
}

function cards(n: number): { question: string; answer: string }[] {
  return Array.from({ length: n }, (_, i) => ({
    question: `Q${i}?`,
    answer: `A${i}`,
  }));
}

interface Suggestion {
  id: string;
  ownerId: string;
  visibility: string;
  updatedAt: string;
}

describe('dashboard', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/dashboard');
    expect(res.status).toBe(401);
  });

  it('keeps the existing dashboard fields', async () => {
    const { token } = await signup('DashboardFields');
    const res = await request(app).get('/api/dashboard').set(auth(token));
    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.greetingName).toBe('DashboardFields');
    expect(data.cardsDue).toBe(0);
    expect(data.streakDays).toBe(0);
    expect(data.cardsStudied).toBe(0);
    expect(data.quizAccuracy).toBeNull();
    expect(data.continueSet).toBeNull();
    expect(data.today.target).toBe(10);
    expect(Array.isArray(data.suggestions)).toBe(true);
  });

  it('suggests only public sets from others, newest first, at most 3', async () => {
    const author = await signup('DashboardAuthor');
    const reader = await signup('DashboardReader');
    for (let i = 0; i < 4; i += 1) {
      await createSet(author.token, {
        title: `Dashboard public ${i} ${Date.now()}`,
        visibility: 'public',
        cards: cards(2),
      });
    }

    const res = await request(app).get('/api/dashboard').set(auth(reader.token));
    expect(res.status).toBe(200);
    const suggestions = res.body.data.suggestions as Suggestion[];
    expect(suggestions.length).toBeLessThanOrEqual(3);
    // Every suggestion is public and not owned by the reader…
    for (const suggestion of suggestions) {
      expect(suggestion.visibility).toBe('public');
      expect(suggestion.ownerId).not.toBe(reader.userId);
    }
    // …and sorted newest-first.
    const stamps = suggestions.map((suggestion) => suggestion.updatedAt);
    expect([...stamps].sort((a, b) => b.localeCompare(a))).toEqual(stamps);
  });

  it('excludes own, private and favorited sets from suggestions', async () => {
    const author = await signup('DashboardAuthor2');
    const reader = await signup('DashboardReader2');
    const pub1 = await createSet(author.token, {
      title: `Dashboard keep ${Date.now()}`,
      visibility: 'public',
      cards: cards(2),
    });
    const pub2 = await createSet(author.token, {
      title: `Dashboard fav ${Date.now()}`,
      visibility: 'public',
      cards: cards(2),
    });
    const priv = await createSet(author.token, {
      title: `Dashboard priv ${Date.now()}`,
      visibility: 'private',
      cards: cards(2),
    });
    const own = await createSet(reader.token, {
      title: `Dashboard own ${Date.now()}`,
      visibility: 'public',
      cards: cards(2),
    });
    const fav = await request(app).post(`/api/favorites/${pub2.id}`).set(auth(reader.token));
    expect(fav.status).toBe(201);

    const res = await request(app).get('/api/dashboard').set(auth(reader.token));
    expect(res.status).toBe(200);
    const suggestions = res.body.data.suggestions as Suggestion[];
    const suggestedIds = new Set(suggestions.map((suggestion) => suggestion.id));
    expect(suggestedIds.has(pub1.id)).toBe(true);
    expect(suggestedIds.has(pub2.id)).toBe(false);
    expect(suggestedIds.has(priv.id)).toBe(false);
    expect(suggestedIds.has(own.id)).toBe(false);
  });
});
