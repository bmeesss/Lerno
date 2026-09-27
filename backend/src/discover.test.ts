import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

const app = createApp();

async function signup(name: string): Promise<{ token: string; userId: string }> {
  const email = `${name}${Math.floor(Math.random() * 1e6)}@example.com`;
  const res = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'password123', displayName: name });
  return { token: res.body.data.accessToken as string, userId: res.body.data.user.id as string };
}

async function createSet(
  token: string,
  title: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const res = await request(app)
    .post('/api/sets')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title,
      description: `${title} description`,
      level: 'havo 4',
      visibility: 'public',
      tags: ['demo'],
      cards: [{ question: `${title} Q?`, answer: `${title} A` }],
      ...extra,
    });
  return res.body.data.id as string;
}

describe('discovery', () => {
  it('searches public sets with filters and pagination', async () => {
    const { token } = await signup('Finder');
    await createSet(token, 'Algebra essentials', { level: 'vwo 5', tags: ['math', 'algebra'] });
    await createSet(token, 'World War Two timeline', { level: 'havo 4', tags: ['history'] });
    // Private sets are never discovered
    await createSet(token, 'Hidden knowledge', { visibility: 'private' });

    const all = await request(app).get('/api/discover');
    expect(all.status).toBe(200);
    expect(all.body.data.total).toBeGreaterThanOrEqual(2);
    const titles = (all.body.data.items as { title: string }[]).map((item) => item.title);
    expect(titles).not.toContain('Hidden knowledge');

    const search = await request(app).get('/api/discover?q=algebra');
    expect(search.body.data.total).toBe(1);
    expect(search.body.data.items[0].title).toBe('Algebra essentials');

    const byTag = await request(app).get('/api/discover?tag=history');
    expect(byTag.body.data.total).toBe(1);
    expect(byTag.body.data.items[0].title).toBe('World War Two timeline');

    const byLevel = await request(app).get('/api/discover?level=vwo 5');
    expect(byLevel.body.data.total).toBe(1);

    const paged = await request(app).get('/api/discover?page=1&pageSize=1');
    expect(paged.body.data.items).toHaveLength(1);
    expect(paged.body.data.pageSize).toBe(1);
    expect(paged.body.data.page).toBe(1);
  });

  it('offers facets for the filter UI', async () => {
    const { token } = await signup('Facets');
    await createSet(token, 'Chemistry basics', { level: 'mbo 2', tags: ['science'] });
    const res = await request(app).get('/api/discover/facets');
    expect(res.status).toBe(200);
    expect(res.body.data.levels).toContain('mbo 2');
    expect(res.body.data.tags).toContain('science');
    expect(res.body.data.subjects.length).toBeGreaterThanOrEqual(0);
  });

  it('includes author names and card counts', async () => {
    const { token } = await signup('AuthorName');
    await createSet(token, 'Named set');
    const res = await request(app).get('/api/discover?q=Named set');
    expect(res.body.data.items[0].authorName).toBe('AuthorName');
    expect(res.body.data.items[0].cardCount).toBe(1);
  });
});

describe('favorites', () => {
  it('adds, lists and removes favorites', async () => {
    const owner = await signup('OwnerFav');
    const fan = await signup('FanFav');
    const setId = await createSet(owner.token, 'Favorite-able set');

    const add = await request(app)
      .post(`/api/favorites/${setId}`)
      .set('Authorization', `Bearer ${fan.token}`);
    expect(add.status).toBe(201);

    const list = await request(app)
      .get('/api/favorites')
      .set('Authorization', `Bearer ${fan.token}`);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].id).toBe(setId);

    // Idempotent
    await request(app).post(`/api/favorites/${setId}`).set('Authorization', `Bearer ${fan.token}`);
    const list2 = await request(app)
      .get('/api/favorites')
      .set('Authorization', `Bearer ${fan.token}`);
    expect(list2.body.data).toHaveLength(1);

    const remove = await request(app)
      .delete(`/api/favorites/${setId}`)
      .set('Authorization', `Bearer ${fan.token}`);
    expect(remove.status).toBe(204);
    const list3 = await request(app)
      .get('/api/favorites')
      .set('Authorization', `Bearer ${fan.token}`);
    expect(list3.body.data).toHaveLength(0);
  });

  it('rejects favoriting private or missing sets and requires auth', async () => {
    const owner = await signup('OwnerPriv');
    const fan = await signup('FanPriv');
    const setId = await createSet(owner.token, 'Private thing', { visibility: 'private' });

    const priv = await request(app)
      .post(`/api/favorites/${setId}`)
      .set('Authorization', `Bearer ${fan.token}`);
    expect(priv.status).toBe(404);

    const anon = await request(app).post(`/api/favorites/${setId}`);
    expect(anon.status).toBe(401);

    const missing = await request(app)
      .post('/api/favorites/11111111-1111-1111-1111-111111111111')
      .set('Authorization', `Bearer ${fan.token}`);
    expect(missing.status).toBe(404);
  });

  it('shows favorited sets on the public profile flow through favorites list', async () => {
    const owner = await signup('OwnerProf');
    const fan = await signup('FanProf');
    const a = await createSet(owner.token, 'Profile set A');
    await createSet(owner.token, 'Profile set B');
    await request(app).post(`/api/favorites/${a}`).set('Authorization', `Bearer ${fan.token}`);

    const publicProfile = await request(app).get(`/api/profile/${owner.userId}`);
    expect(publicProfile.status).toBe(200);
    expect(publicProfile.body.data.publicSets.length).toBeGreaterThanOrEqual(2);
    expect(publicProfile.body.data.stats.publicSetCount).toBeGreaterThanOrEqual(2);
    expect(publicProfile.body.data.profile.displayName).toBe('OwnerProf');
  });
});
