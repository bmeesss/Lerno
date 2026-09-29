import { Router } from 'express';
import { subjectController } from '../controllers/subject.controller.js';
import { studySessionController } from '../controllers/study-session.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { writeRateLimit } from '../middleware/rate-limit.js';
import { validate } from '../middleware/validate.js';
import {
  createSubjectSchema,
  subjectParamsSchema,
  updateSubjectSchema,
} from '../validators/set.validators.js';

export function subjectRoutes(): Router {
  const router = Router();

  router.use(requireAuth);
  router.get('/', subjectController.list);
  router.post(
    '/',
    writeRateLimit,
    validate({ body: createSubjectSchema }),
    subjectController.create,
  );
  router.get(
    '/:subjectId/overview',
    validate({ params: subjectParamsSchema }),
    studySessionController.subjectOverview,
  );
  router.patch(
    '/:subjectId',
    writeRateLimit,
    validate({ params: subjectParamsSchema, body: updateSubjectSchema }),
    subjectController.update,
  );
  router.delete(
    '/:subjectId',
    writeRateLimit,
    validate({ params: subjectParamsSchema }),
    subjectController.remove,
  );

  return router;
}
