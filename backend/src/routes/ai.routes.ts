import { Router, type RequestHandler } from 'express';
import { aiController } from '../controllers/ai.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { aiIpRateLimit, aiRateLimit } from '../middleware/rate-limit.js';
import { validate } from '../middleware/validate.js';
import { aiChatSchema } from '../validators/ai.validators.js';
import { MAX_AI_BODY_CHARS } from '../lib/ai-limits.js';
import { errors } from '../lib/errors.js';

/**
 * Rejects oversized payloads before schema parsing. The global JSON parser
 * allows 1 MB (set imports need it); a chat request never does.
 */
export function bodySizeGuard(maxChars: number): RequestHandler {
  return (req, _res, next) => {
    const body: unknown = req.body;
    const size = typeof body === 'string' ? body.length : JSON.stringify(body ?? {}).length;
    if (size > maxChars) {
      next(errors.validation('The request is too large'));
      return;
    }
    next();
  };
}

/** /api/ai — built-in Lerno AI (website only, independent of MCP). */
export function aiRoutes(): Router {
  const router = Router();

  router.post(
    '/chat',
    requireAuth,
    // Two limiters: a wider per-IP guard (many accounts, one network) and the
    // strict per-user budget. Both are far stricter than the normal API limits.
    aiIpRateLimit,
    aiRateLimit,
    bodySizeGuard(MAX_AI_BODY_CHARS),
    validate({ body: aiChatSchema }),
    aiController.chat,
  );

  return router;
}
