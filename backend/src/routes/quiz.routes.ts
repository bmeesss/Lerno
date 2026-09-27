import { Router } from 'express';
import { quizController } from '../controllers/quiz.controller.js';
import { optionalAuth } from '../middleware/auth.js';
import { publicRateLimit, writeRateLimit } from '../middleware/rate-limit.js';
import { validate } from '../middleware/validate.js';
import { quizSetParamsSchema, quizSubmitSchema } from '../validators/quiz.validators.js';

/** Mounted at /api/sets/:setId/quiz (mergeParams for setId). */
export function quizRoutes(): Router {
  const router = Router({ mergeParams: true });

  // Load (generating on first access) — guests allowed for public sets (spec §8)
  router.get(
    '/',
    publicRateLimit,
    optionalAuth,
    validate({ params: quizSetParamsSchema }),
    quizController.load,
  );

  // Submit answers → scored result; attempts persist for signed-in users
  router.post(
    '/attempts',
    writeRateLimit,
    optionalAuth,
    validate({ params: quizSetParamsSchema, body: quizSubmitSchema }),
    quizController.submit,
  );

  return router;
}
