import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { ApiError, errors } from '../lib/errors.js';

/** Terminal error middleware — always answers with the error envelope (spec §14). */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request' } });
    return;
  }

  // Malformed JSON bodies (thrown by the JSON parser with status 400).
  if (err instanceof SyntaxError && (err as { status?: unknown }).status === 400) {
    res
      .status(400)
      .json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' } });
    return;
  }

  // Unknown error: log server-side, never leak internals to the client.
  console.error('Unhandled error:', err);
  const internal = errors.internal();
  res.status(internal.status).json({ error: { code: internal.code, message: internal.message } });
}

/** 404 fallback for unknown API routes. */
export function notFoundHandler(_req: Request, res: Response): void {
  const err = errors.notFound('Route not found');
  res.status(err.status).json({ error: { code: err.code, message: err.message } });
}
