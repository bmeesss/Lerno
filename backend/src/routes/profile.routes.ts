import { Router } from 'express';
import { z } from 'zod';
import { profileController } from '../controllers/profile.controller.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { publicRateLimit, writeRateLimit } from '../middleware/rate-limit.js';
import { validate } from '../middleware/validate.js';
import { updateProfileSchema } from '../validators/auth.validators.js';

const userIdParams = z.object({ userId: z.string().uuid('Invalid user id') });

export function profileRoutes(): Router {
  const router = Router();

  router.get('/', requireAuth, profileController.getOwn);
  router.patch(
    '/',
    requireAuth,
    writeRateLimit,
    validate({ body: updateProfileSchema }),
    profileController.update,
  );
  router.get(
    '/:userId',
    publicRateLimit,
    optionalAuth,
    validate({ params: userIdParams }),
    profileController.getPublic,
  );

  return router;
}
