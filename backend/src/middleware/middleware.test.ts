import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError } from '../lib/errors.js';
import { asyncHandler, sendOk } from '../lib/http.js';
import { errorHandler } from './error-handler.js';
import { createLimiter } from './rate-limit.js';
import { validate } from './validate.js';

function testApp(): express.Express {
  const app = express();
  app.use(express.json());

  app.post(
    '/echo',
    validate({ body: z.object({ name: z.string().min(2), age: z.number().int().optional() }) }),
    (req, res) => {
      sendOk(res, req.body, 201);
    },
  );

  app.get(
    '/boom',
    asyncHandler(async () => {
      throw new Error('internal detail secret-token');
    }),
  );

  app.get('/forbidden', (_req, _res, next) => {
    next(new ApiError('FORBIDDEN', 'Owners only'));
  });

  app.get(
    '/limited',
    createLimiter({ windowMs: 60_000, max: 2, name: 'test', skip: () => false }),
    (_req, res) => {
      sendOk(res, { ok: true });
    },
  );

  app.use(errorHandler);
  return app;
}

describe('validate middleware', () => {
  const app = testApp();

  it('accepts a valid body and passes typed data through', async () => {
    const res = await request(app).post('/echo').send({ name: 'Ada', age: 31 });
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ name: 'Ada', age: 31 });
  });

  it('rejects an invalid body with VALIDATION_ERROR', async () => {
    const res = await request(app).post('/echo').send({ name: 'A' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/name/);
  });

  it('rejects non-object bodies safely', async () => {
    const res = await request(app).post('/echo').send('not-json-object');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('error handler', () => {
  const app = testApp();

  it('maps ApiError to its status and code', async () => {
    const res = await request(app).get('/forbidden');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: { code: 'FORBIDDEN', message: 'Owners only' } });
  });

  it('hides internal error details from both response and logs', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const res = await request(app).get('/boom');
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(res.body.error.message).not.toContain('secret-token');
      expect(JSON.stringify(log.mock.calls)).not.toContain('secret-token');
    } finally {
      log.mockRestore();
    }
  });
});

describe('rate limiting', () => {
  it('returns the RATE_LIMITED envelope after the limit', async () => {
    const app = testApp();
    expect((await request(app).get('/limited')).status).toBe(200);
    expect((await request(app).get('/limited')).status).toBe(200);
    const res = await request(app).get('/limited');
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });
});
