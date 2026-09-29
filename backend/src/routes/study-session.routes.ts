import { Router } from 'express';
import { studySessionController } from '../controllers/study-session.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { studySessionRateLimit } from '../middleware/rate-limit.js';
import { validate } from '../middleware/validate.js';
import {
  answerItemSchema,
  completeSessionSchema,
  createSessionSchema,
  previewSessionQuerySchema,
  rateItemSchema,
  saveAnswersSchema,
  sessionItemParamsSchema,
  sessionParamsSchema,
} from '../validators/study-session.validators.js';

/**
 * /api/study-sessions — Learn, Practice, Review and Test as one resumable,
 * server-side abstraction. Every route needs a signed-in student; ownership of
 * the session, its items and the pack is checked in the service.
 */
export function studySessionRoutes(): Router {
  const router = Router();
  router.use(requireAuth);

  // Static paths first so they cannot be swallowed by /:sessionId.
  router.get('/preview', validate({ query: previewSessionQuerySchema }), studySessionController.preview);
  router.get('/active', studySessionController.active);

  router.post(
    '/',
    studySessionRateLimit,
    validate({ body: createSessionSchema }),
    studySessionController.create,
  );
  router.get('/:sessionId', validate({ params: sessionParamsSchema }), studySessionController.get);
  router.post(
    '/:sessionId/start',
    studySessionRateLimit,
    validate({ params: sessionParamsSchema }),
    studySessionController.start,
  );
  router.post(
    '/:sessionId/items/:itemId/answer',
    studySessionRateLimit,
    validate({ params: sessionItemParamsSchema, body: answerItemSchema }),
    studySessionController.answer,
  );
  router.post(
    '/:sessionId/items/:itemId/rating',
    studySessionRateLimit,
    validate({ params: sessionItemParamsSchema, body: rateItemSchema }),
    studySessionController.rate,
  );
  router.post(
    '/:sessionId/items/:itemId/skip',
    studySessionRateLimit,
    validate({ params: sessionItemParamsSchema }),
    studySessionController.skip,
  );
  router.put(
    '/:sessionId/answers',
    studySessionRateLimit,
    validate({ params: sessionParamsSchema, body: saveAnswersSchema }),
    studySessionController.saveAnswers,
  );
  router.post(
    '/:sessionId/complete',
    studySessionRateLimit,
    validate({ params: sessionParamsSchema, body: completeSessionSchema }),
    studySessionController.complete,
  );
  router.post(
    '/:sessionId/abandon',
    studySessionRateLimit,
    validate({ params: sessionParamsSchema }),
    studySessionController.abandon,
  );
  router.get(
    '/:sessionId/mistakes',
    validate({ params: sessionParamsSchema }),
    studySessionController.mistakes,
  );

  return router;
}

/** GET /api/progress/study — added next to the existing /api/progress routes. */
export function studyProgressRoutes(): Router {
  const router = Router();
  router.get('/study', requireAuth, studySessionController.progress);
  return router;
}
