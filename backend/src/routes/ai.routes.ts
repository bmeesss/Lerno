import { Router, type RequestHandler } from 'express';
import { aiController } from '../controllers/ai.controller.js';
import { aiLearningController } from '../controllers/ai-learning.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { aiIpRateLimit, aiRateLimit } from '../middleware/rate-limit.js';
import { validate } from '../middleware/validate.js';
import { aiChatSchema } from '../validators/ai.validators.js';
import {
  aiSetParamsSchema,
  explainSetSchema,
  summarizeSetSchema,
} from '../validators/ai-set.validators.js';
import { MAX_AI_BODY_CHARS } from '../lib/ai-limits.js';
import { errors } from '../lib/errors.js';

/**
 * Rejects oversized payloads before schema parsing. The global JSON parser
 * allows 1 MB (set imports need it); an AI request never does.
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

/** Shared guards for every AI endpoint: auth, two rate limiters, body size. */
function aiGuards(): RequestHandler[] {
  return [requireAuth, aiIpRateLimit, aiRateLimit, bodySizeGuard(MAX_AI_BODY_CHARS)];
}

/** /api/ai — built-in Lerno AI (website only, independent of MCP). */
export function aiRoutes(): Router {
  const router = Router();

  // Free chat -------------------------------------------------------------
  router.post('/chat', ...aiGuards(), validate({ body: aiChatSchema }), aiController.chat);

  // Study-set actions -----------------------------------------------------
  router.post(
    '/sets/:setId/explain',
    ...aiGuards(),
    validate({ params: aiSetParamsSchema, body: explainSetSchema }),
    aiLearningController.explainSet,
  );
  router.post(
    '/sets/:setId/summarize',
    ...aiGuards(),
    validate({ params: aiSetParamsSchema, body: summarizeSetSchema }),
    aiLearningController.summarizeSet,
  );
  return router;
}
