import { Router } from 'express';
import { aiController } from '../controllers/ai.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { aiRateLimit } from '../middleware/rate-limit.js';
import { validate } from '../middleware/validate.js';
import { aiChatSchema } from '../validators/ai.validators.js';

/** /api/ai — built-in Lerno AI (website only, independent of MCP). */
export function aiRoutes(): Router {
  const router = Router();

  router.post(
    '/chat',
    requireAuth,
    aiRateLimit,
    validate({ body: aiChatSchema }),
    aiController.chat,
  );

  return router;
}
