import { Router } from 'express';
import { z } from 'zod';
import { discoverController } from '../controllers/discover.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { publicRateLimit, writeRateLimit } from '../middleware/rate-limit.js';
import { validate } from '../middleware/validate.js';
import { discoverQuerySchema } from '../validators/discover.validators.js';

const setParams = z.object({ setId: z.string().uuid('Invalid set id') });

export function discoverRoutes(): Router {
  const router = Router();

  router.get(
    '/',
    publicRateLimit,
    validate({ query: discoverQuerySchema }),
    discoverController.search,
  );
  router.get('/facets', publicRateLimit, discoverController.facets);

  return router;
}

export function favoriteRoutes(): Router {
  const router = Router();

  router.get('/', requireAuth, discoverController.listFavorites);
  router.post(
    '/:setId',
    requireAuth,
    writeRateLimit,
    validate({ params: setParams }),
    discoverController.addFavorite,
  );
  router.delete(
    '/:setId',
    requireAuth,
    writeRateLimit,
    validate({ params: setParams }),
    discoverController.removeFavorite,
  );

  return router;
}
