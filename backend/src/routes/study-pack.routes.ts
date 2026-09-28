import { Router, type RequestHandler } from 'express';
import { studyPackController } from '../controllers/study-pack.controller.js';
import { bodySizeGuard } from './ai.routes.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { aiIpRateLimit, aiRateLimit, publicRateLimit, writeRateLimit } from '../middleware/rate-limit.js';
import { validate } from '../middleware/validate.js';
import { MAX_AI_BODY_CHARS } from '../lib/ai-limits.js';
import {
  addSourceSchema,
  applyContentSchema,
  conceptParamsSchema,
  createConceptSchema,
  createPackSchema,
  createPlanSchema,
  createTestSchema,
  generateSchema,
  packParamsSchema,
  packSourceParamsSchema,
  practiceAttemptSchema,
  practiceQueueQuerySchema,
  rateConceptSchema,
  submitTestSchema,
  testParamsSchema,
  tutorSchema,
  updateConceptSchema,
  updatePackSchema,
} from '../validators/study-pack.validators.js';

/** AI-backed endpoints share the AI guards (auth + two limiters + body size). */
function aiGuards(): RequestHandler[] {
  return [requireAuth, aiIpRateLimit, aiRateLimit, bodySizeGuard(MAX_AI_BODY_CHARS)];
}

/** /api/study-packs — the study-first layer on top of sets/cards. */
export function studyPackRoutes(): Router {
  const router = Router();

  // Static paths first so they cannot be swallowed by /:packId.
  router.get('/today', requireAuth, studyPackController.today);
  router.get('/review-queue', requireAuth, studyPackController.reviewQueue);
  router.get('/', requireAuth, studyPackController.list);
  router.post(
    '/',
    requireAuth,
    writeRateLimit,
    validate({ body: createPackSchema }),
    studyPackController.create,
  );

  // Pack detail (owner or public pack; guests may read public packs).
  router.get(
    '/:packId',
    publicRateLimit,
    optionalAuth,
    validate({ params: packParamsSchema }),
    studyPackController.detail,
  );
  router.patch(
    '/:packId',
    requireAuth,
    writeRateLimit,
    validate({ params: packParamsSchema, body: updatePackSchema }),
    studyPackController.update,
  );
  router.delete(
    '/:packId',
    requireAuth,
    writeRateLimit,
    validate({ params: packParamsSchema }),
    studyPackController.remove,
  );

  // Sources ------------------------------------------------------------------
  router.get(
    '/:packId/sources',
    publicRateLimit,
    optionalAuth,
    validate({ params: packParamsSchema }),
    studyPackController.listSources,
  );
  router.post(
    '/:packId/sources',
    requireAuth,
    writeRateLimit,
    validate({ params: packParamsSchema, body: addSourceSchema }),
    studyPackController.addSource,
  );
  router.delete(
    '/:packId/sources/:sourceId',
    requireAuth,
    writeRateLimit,
    validate({ params: packSourceParamsSchema }),
    studyPackController.removeSource,
  );

  // Concepts -----------------------------------------------------------------
  router.post(
    '/:packId/concepts',
    requireAuth,
    writeRateLimit,
    validate({ params: packParamsSchema, body: createConceptSchema }),
    studyPackController.createConcept,
  );
  router.patch(
    '/:packId/concepts/:conceptId',
    requireAuth,
    writeRateLimit,
    validate({ params: conceptParamsSchema, body: updateConceptSchema }),
    studyPackController.updateConcept,
  );
  router.delete(
    '/:packId/concepts/:conceptId',
    requireAuth,
    writeRateLimit,
    validate({ params: conceptParamsSchema }),
    studyPackController.removeConcept,
  );
  router.post(
    '/:packId/concepts/:conceptId/rating',
    requireAuth,
    writeRateLimit,
    validate({ params: conceptParamsSchema, body: rateConceptSchema }),
    studyPackController.rateConcept,
  );

  // AI previews + confirmed content -----------------------------------------
  router.post(
    '/:packId/generate',
    ...aiGuards(),
    validate({ params: packParamsSchema, body: generateSchema }),
    studyPackController.generate,
  );
  router.post(
    '/:packId/content',
    requireAuth,
    writeRateLimit,
    validate({ params: packParamsSchema, body: applyContentSchema }),
    studyPackController.applyContent,
  );
  router.post(
    '/:packId/tutor',
    ...aiGuards(),
    validate({ params: packParamsSchema, body: tutorSchema }),
    studyPackController.tutor,
  );

  // Practice -----------------------------------------------------------------
  router.get(
    '/:packId/practice',
    publicRateLimit,
    optionalAuth,
    validate({ params: packParamsSchema, query: practiceQueueQuerySchema }),
    studyPackController.practiceQueue,
  );
  router.post(
    '/:packId/practice/attempts',
    publicRateLimit,
    optionalAuth,
    validate({ params: packParamsSchema, body: practiceAttemptSchema }),
    studyPackController.practiceAttempt,
  );

  // Tests --------------------------------------------------------------------
  router.get(
    '/:packId/tests',
    requireAuth,
    validate({ params: packParamsSchema }),
    studyPackController.listTests,
  );
  router.post(
    '/:packId/tests',
    requireAuth,
    writeRateLimit,
    validate({ params: packParamsSchema, body: createTestSchema }),
    studyPackController.createTest,
  );
  router.post(
    '/:packId/tests/:testId/submit',
    requireAuth,
    writeRateLimit,
    validate({ params: testParamsSchema, body: submitTestSchema }),
    studyPackController.submitTest,
  );

  // Progress + plan ----------------------------------------------------------
  router.get(
    '/:packId/progress',
    publicRateLimit,
    optionalAuth,
    validate({ params: packParamsSchema }),
    studyPackController.progress,
  );
  router.get(
    '/:packId/plan',
    publicRateLimit,
    optionalAuth,
    validate({ params: packParamsSchema }),
    studyPackController.getPlan,
  );
  router.post(
    '/:packId/plan',
    requireAuth,
    writeRateLimit,
    validate({ params: packParamsSchema, body: createPlanSchema }),
    studyPackController.createPlan,
  );

  return router;
}
