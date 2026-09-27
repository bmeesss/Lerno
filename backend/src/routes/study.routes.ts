import { Router } from 'express';
import { z } from 'zod';
import { studyController } from '../controllers/study.controller.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { publicRateLimit, writeRateLimit } from '../middleware/rate-limit.js';
import { validate } from '../middleware/validate.js';
import {
  endSessionSchema,
  reviewInputSchema,
  sessionParamsSchema,
  startSessionSchema,
} from '../validators/study.validators.js';

const setParams = z.object({ setId: z.string().uuid('Invalid set id') });

export function studyRoutes(): Router {
  const router = Router();

  // Flashcard review (persists progress + schedules next review)
  router.post(
    '/review',
    requireAuth,
    writeRateLimit,
    validate({ body: reviewInputSchema }),
    studyController.review,
  );

  // Practice queue (guests allowed for public sets — spec §8)
  router.get(
    '/practice/:setId',
    publicRateLimit,
    optionalAuth,
    validate({ params: setParams }),
    studyController.practiceQueue,
  );

  // Flashcard study queue in strict scheduling priority (Phase 5 §5)
  router.get(
    '/queue/:setId',
    publicRateLimit,
    optionalAuth,
    validate({ params: setParams }),
    studyController.studyQueue,
  );

  // Study sessions (server-timed for study-time stats)
  router.post(
    '/sessions',
    requireAuth,
    writeRateLimit,
    validate({ body: startSessionSchema }),
    studyController.startSession,
  );
  router.patch(
    '/sessions/:sessionId',
    requireAuth,
    writeRateLimit,
    validate({ params: sessionParamsSchema, body: endSessionSchema }),
    studyController.endSession,
  );

  return router;
}

export function reviewRoutes(): Router {
  const router = Router();
  router.get('/', requireAuth, studyController.dueReviews);
  return router;
}

export function progressRoutes(): Router {
  const router = Router();
  router.get('/', requireAuth, studyController.progress);
  router.get('/today', requireAuth, studyController.today);
  router.get('/week', requireAuth, studyController.week);
  return router;
}
