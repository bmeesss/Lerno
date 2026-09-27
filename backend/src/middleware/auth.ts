/**
 * Authentication middleware (spec §9, §15).
 *
 * Verifies the bearer token through the auth provider on every protected
 * request and loads the caller's role. `requireAdmin` additionally demands the
 * admin role; admin handlers use createAdminDatabase() only after this check.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { getAuthProvider } from '../lib/auth/index.js';
import { createDatabase } from '../lib/db/index.js';
import { errors } from '../lib/errors.js';
import type { Role } from '../lib/db/types.js';

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

async function loadIdentity(req: Request): Promise<boolean> {
  const token = bearerToken(req);
  req.db = createDatabase(token ? { accessToken: token } : undefined);
  if (!token) return false;

  const identity = await getAuthProvider().verify(token);
  if (!identity) return false;

  const profile = await req.db.profiles.get(identity.id);
  const role: Role = profile?.role ?? 'user';
  req.auth = { id: identity.id, email: identity.email, role };
  return true;
}

/** Always-on data context: binds req.db to the caller's token (or anonymous). */
export const attachDatabase: RequestHandler = (req, _res, next) => {
  void loadIdentity(req)
    .then(() => next())
    .catch(next);
};

/** Attaches req.db (token-bound when present) without requiring auth. */
export const optionalAuth: RequestHandler = (req, _res, next) => {
  void loadIdentity(req)
    .then(() => next())
    .catch(next);
};

/** Requires a valid identity; 401 otherwise. */
export const requireAuth: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  void loadIdentity(req)
    .then((ok) => {
      if (!ok) {
        next(errors.unauthorized('You must be logged in to do this'));
        return;
      }
      next();
    })
    .catch(next);
};

/** Requires the admin role (spec §8 moderation). */
export const requireAdmin: RequestHandler = (req, _res, next) => {
  void loadIdentity(req)
    .then((ok) => {
      if (!ok) {
        next(errors.unauthorized('You must be logged in to do this'));
        return;
      }
      if (req.auth?.role !== 'admin') {
        next(errors.forbidden('Admin access required'));
        return;
      }
      next();
    })
    .catch(next);
};
