import rateLimit from 'express-rate-limit';
import type { Request, Response } from 'express';
import { config } from '../config.js';
import { clientIp } from '../lib/http.js';

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
 * IP-keyed rate limiter answering with the standard error envelope.
 * Used for auth-sensitive and write-heavy routes (spec §15).
 */
export function createLimiter(options: LimiterOptions) {
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => `${options.name}:${options.keyBy?.(req) ?? clientIp(req)}`,
    handler: (_req: Request, res: Response) => {
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests, please slow down and try again later.',
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
 * Lerno AI chat: every request is an upstream Groq call, so the limit is
 * strict and keyed per authenticated user (fallback: IP) (spec §15).
 */
export const aiRateLimit = createLimiter({
  windowMs: 5 * 60 * 1000,
  max: 20,
  name: 'ai',
  keyBy: aiLimiterKey,
});
