import { Router } from 'express';
import { setController } from '../controllers/set.controller.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { publicRateLimit, writeRateLimit } from '../middleware/rate-limit.js';
import { validate } from '../middleware/validate.js';
import {
  bulkCardsSchema,
  cardParamsSchema,
  createSetSchema,
  setParamsSchema,
  updateCardSchema,
  updateSetSchema,
} from '../validators/set.validators.js';

export function setRoutes(): Router {
  const router = Router();

  // Own sets
  router.get('/', requireAuth, setController.listMine);
  router.post(
    '/',
    requireAuth,
    writeRateLimit,
    validate({ body: createSetSchema }),
    setController.create,
  );

  // Set detail (owner or public; guests allowed for public sets — spec §8)
  router.get(
    '/:setId',
    publicRateLimit,
    optionalAuth,
    validate({ params: setParamsSchema }),
    setController.detail,
  );
  router.patch(
    '/:setId',
    requireAuth,
    writeRateLimit,
    validate({ params: setParamsSchema, body: updateSetSchema }),
    setController.update,
  );
  router.delete(
    '/:setId',
    requireAuth,
    writeRateLimit,
    validate({ params: setParamsSchema }),
    setController.remove,
  );

  // Cards
  router.get(
    '/:setId/cards',
    publicRateLimit,
    optionalAuth,
    validate({ params: setParamsSchema }),
    setController.listCards,
  );
  router.post(
    '/:setId/cards',
    requireAuth,
    writeRateLimit,
    validate({ params: setParamsSchema, body: bulkCardsSchema }),
    setController.addCards,
  );
  router.patch(
    '/:setId/cards/:cardId',
    requireAuth,
    writeRateLimit,
    validate({ params: cardParamsSchema, body: updateCardSchema }),
    setController.updateCard,
  );
  router.delete(
    '/:setId/cards/:cardId',
    requireAuth,
    writeRateLimit,
    validate({ params: cardParamsSchema }),
    setController.removeCard,
  );

  // Quiz (generation/loading/scoring — spec §6)

  return router;
}
