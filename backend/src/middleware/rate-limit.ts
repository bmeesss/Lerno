import rateLimit from 'express-rate-limit';
import type { Request, Response } from 'express';
import { config } from '../config.js';
import { clientIp } from '../lib/http.js';
import { FixedWindowStore } from '../lib/rate-limit-store.js';

export interface LimiterOptions {
  windowMs: number;
  max: number;
  name: string;
  /** Force-disable/enable; defaults to enabled except in tests. */
  skip?: () => boolean;
  /** Custom key extractor (defaults to the client IP). */
  keyBy?: (req: Request) => string;
}

/**
 * Rate limiter answering with the standard error envelope.
 *
 * Uses an atomic fixed-window store so concurrent requests cannot race past the
 * limit, and returns `Retry-After` (header + body field) so the frontend can
 * tell the student when to try again.
 */
export function createLimiter(options: LimiterOptions) {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.max,
    standardHeaders: true,
    legacyHeaders: false,
    store: new FixedWindowStore(options.windowMs),
    keyGenerator: (req: Request) => `${options.name}:${options.keyBy?.(req) ?? clientIp(req)}`,
    handler: (req: Request, res: Response) => {
      const info = (req as unknown as { rateLimit?: { resetTime?: Date } }).rateLimit;
      const reset = info?.resetTime;
      const retryAfter = Math.max(
        1,
        Math.ceil((reset ? reset.getTime() - Date.now() : options.windowMs) / 1000),
      );
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests, please slow down and try again later.',
          retryAfter,
        },
      });
    },
    skip: options.skip ?? (() => config.isTest),
  });
}

/** Auth-sensitive routes (login/signup/reset): strict. */
export const authRateLimit = createLimiter({ windowMs: 15 * 60 * 1000, max: 30, name: 'auth' });

/** Write-heavy routes (create/update/delete): moderate. */
export const writeRateLimit = createLimiter({ windowMs: 10 * 60 * 1000, max: 120, name: 'write' });

/** Public read + report endpoints: basic abuse protection (spec §15). */
export const publicRateLimit = createLimiter({ windowMs: 5 * 60 * 1000, max: 240, name: 'public' });

/**
 * Rate-limit key for AI chat: per authenticated user (fallback: client IP),
 * so one student cannot exhaust another's budget from a shared IP.
 */
export function aiLimiterKey(req: Request): string {
  return req.auth?.id ?? clientIp(req);
}

/**
 * Lerno AI chat: every request is an upstream Groq call, so the limit is much
 * stricter than for normal API endpoints and keyed per authenticated user
 * (fallback: IP). Configurable via `AI_RATE_LIMIT_MAX` /
 * `AI_RATE_LIMIT_WINDOW_MS`.
 */
export const aiRateLimit = createLimiter({
  windowMs: config.aiRateLimitWindowMs,
  max: config.aiRateLimitMax,
  name: 'ai',
  keyBy: aiLimiterKey,
});

/**
 * Wider per-IP guard for the AI endpoint: a single network can hold many
 * accounts, and every request costs real upstream tokens.
 */
export const aiIpRateLimit = createLimiter({
  windowMs: config.aiRateLimitWindowMs,
  max: config.aiRateLimitIpMax,
  name: 'ai-ip',
});

/**
 * Material imports: one import can trigger a full AI generation run (several
 * upstream calls), so the limit is per student per hour — stricter than a
 * normal write, looser than a single AI request.
 */
export const STUDY_PACK_IMPORT_RATE_LIMIT = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 30,
  name: 'import',
  keyBy: aiLimiterKey,
});
