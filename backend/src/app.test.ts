import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

describe('GET /api/health', () => {
  it('returns status ok', async () => {
    const app = createApp();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('does not run a database probe by default', async () => {
    let probed = false;
    const app = createApp({
      dbPing: async () => {
        probed = true;
      },
    });
    await request(app).get('/api/health');
    expect(probed).toBe(false);
  });
});

describe('unknown routes', () => {
  it('returns the structured error envelope', async () => {
    const app = createApp();
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Route not found' },
    });
  });

  it('never leaks stack traces', async () => {
    const app = createApp();
    const res = await request(app).get('/api/nope');
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts:\d+/);
  });
});
