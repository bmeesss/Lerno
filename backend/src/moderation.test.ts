import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { getMemoryState } from './lib/db/index.js';

const app = createApp();

async function signup(name: string): Promise<{ token: string; userId: string }> {
  const email = `${name}${Math.floor(Math.random() * 1e6)}@example.com`;
  const res = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'password123', displayName: name });
  return { token: res.body.data.accessToken as string, userId: res.body.data.user.id as string };
}

function makeAdmin(userId: string): void {
  const profile = getMemoryState().profiles.get(userId);
  if (profile) getMemoryState().profiles.set(userId, { ...profile, role: 'admin' });
}

describe('reports', () => {
  it('lets authenticated users report public content', async () => {
    const owner = await signup('ReportOwner');
    const reporter = await signup('Reporter');
    const set = await request(app)
      .post('/api/sets')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        title: 'Reportable set',
        visibility: 'public',
        cards: [{ question: 'Q?', answer: 'A' }],
      });

    const res = await request(app)
      .post('/api/reports')
      .set('Authorization', `Bearer ${reporter.token}`)
      .send({
        targetType: 'study_set',
        targetId: set.body.data.id,
        reason: 'Incorrect answers',
        details: 'Card 1 is wrong',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('open');

    // Duplicate open reports are rejected (abuse protection)
    const dup = await request(app)
      .post('/api/reports')
      .set('Authorization', `Bearer ${reporter.token}`)
      .send({ targetType: 'study_set', targetId: set.body.data.id, reason: 'Spam' });
    expect(dup.status).toBe(409);

    // Guests cannot report
    const anon = await request(app)
      .post('/api/reports')
      .send({ targetType: 'study_set', targetId: set.body.data.id, reason: 'Spam' });
    expect(anon.status).toBe(401);
  });

  it('rejects reports for content the reporter cannot see', async () => {
    const owner = await signup('HiddenOwner');
    const reporter = await signup('HiddenReporter');
    const set = await request(app)
      .post('/api/sets')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        title: 'Private set',
        visibility: 'private',
        cards: [{ question: 'Q?', answer: 'A' }],
      });

    const res = await request(app)
      .post('/api/reports')
      .set('Authorization', `Bearer ${reporter.token}`)
      .send({ targetType: 'study_set', targetId: set.body.data.id, reason: 'Something' });
    expect(res.status).toBe(404);
  });
});

describe('admin area', () => {
  it('is inaccessible to non-admins and guests', async () => {
    const user = await signup('NotAdmin');
    const forbidden = await request(app)
      .get('/api/admin/metrics')
      .set('Authorization', `Bearer ${user.token}`);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');

    const anon = await request(app).get('/api/admin/metrics');
    expect(anon.status).toBe(401);
  });

  it('exposes metrics and moderation actions to admins', async () => {
    const owner = await signup('ModOwner');
    const reporter = await signup('ModReporter');
    const admin = await signup('ModAdmin');
    makeAdmin(admin.userId);

    const set = await request(app)
      .post('/api/sets')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        title: 'Moderated set',
        visibility: 'public',
        cards: [{ question: 'Q?', answer: 'A' }],
      });
    const setId = set.body.data.id as string;

    await request(app)
      .post('/api/reports')
      .set('Authorization', `Bearer ${reporter.token}`)
      .send({ targetType: 'study_set', targetId: setId, reason: 'Wrong content' });

    // Metrics
    const metrics = await request(app)
      .get('/api/admin/metrics')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(metrics.status).toBe(200);
    expect(metrics.body.data.users).toBeGreaterThanOrEqual(3);
    expect(metrics.body.data.openReports).toBeGreaterThanOrEqual(1);
    expect(metrics.body.data.totalSets).toBeGreaterThanOrEqual(1);
    expect(metrics.body.data.cards).toBeGreaterThanOrEqual(1);

    // Reports list + resolve (find the report created in this test)
    const reports = await request(app)
      .get('/api/admin/reports?status=open')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(reports.status).toBe(200);
    const ourReport = (reports.body.data.items as { id: string; targetId: string }[]).find(
      (item) => item.targetId === setId,
    );
    expect(ourReport).toBeTruthy();
    const reportId = ourReport!.id;

    const resolved = await request(app)
      .patch(`/api/admin/reports/${reportId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ status: 'resolved' });
    expect(resolved.status).toBe(200);
    expect(resolved.body.data.status).toBe('resolved');
    expect(resolved.body.data.resolvedBy).toBe(admin.userId);

    // Unpublish (takedown) + restore
    const takedown = await request(app)
      .patch(`/api/admin/sets/${setId}/moderate`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ action: 'unpublish' });
    expect(takedown.status).toBe(200);
    expect(takedown.body.data.visibility).toBe('private');

    const hidden = await request(app).get(`/api/sets/${setId}`);
    expect(hidden.status).toBe(404);

    const restore = await request(app)
      .patch(`/api/admin/sets/${setId}/moderate`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ action: 'restore' });
    expect(restore.body.data.visibility).toBe('public');

    // User management: role changes and deletion
    const users = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(users.status).toBe(200);
    expect(users.body.data.items.length).toBeGreaterThanOrEqual(3);

    const roleChange = await request(app)
      .patch(`/api/admin/users/${reporter.userId}/role`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ role: 'admin' });
    expect(roleChange.status).toBe(200);
    expect(getMemoryState().profiles.get(reporter.userId)?.role).toBe('admin');

    const deleted = await request(app)
      .delete(`/api/admin/users/${reporter.userId}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(deleted.status).toBe(200);
    expect(getMemoryState().profiles.has(reporter.userId)).toBe(false);
  });

  it('lists public sets for moderation', async () => {
    const owner = await signup('ListOwner');
    const admin = await signup('ListAdmin');
    makeAdmin(admin.userId);
    await request(app)
      .post('/api/sets')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        title: 'Visible for mods',
        visibility: 'public',
        cards: [{ question: 'Q?', answer: 'A' }],
      });

    const res = await request(app)
      .get('/api/admin/sets')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    const titles = (res.body.data.items as { title: string }[]).map((item) => item.title);
    expect(titles).toContain('Visible for mods');
  });
});
