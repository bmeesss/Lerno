import { ZodError, type ZodTypeAny, type z } from 'zod';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ApiError } from '../lib/errors.js';

interface Schemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/**
 * Request validation middleware (spec §15). Parses and replaces req.body /
 * req.query / req.params with validated data, or returns VALIDATION_ERROR.
 */
export function validate(schemas: Schemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body ?? {});
      if (schemas.query) req.query = schemas.query.parse(req.query ?? {}) as Request['query'];
      if (schemas.params) req.params = schemas.params.parse(req.params ?? {}) as Request['params'];
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const first = err.issues[0];
        const where = first?.path.join('.') || 'request';
        next(
          new ApiError(
            'VALIDATION_ERROR',
            first ? `${where}: ${first.message}` : 'Invalid request',
          ),
        );
        return;
      }
      next(err);
    }
  };
}

/** Convenience type for validated request bodies. */
export type Infer<T extends ZodTypeAny> = z.infer<T>;
