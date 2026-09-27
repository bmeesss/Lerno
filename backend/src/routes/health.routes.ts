import { Router } from 'express';
import { healthHandler, type DbPing } from '../controllers/health.controller.js';

export function healthRoutes(dbPing?: DbPing): Router {
  const router = Router();
  router.get('/', healthHandler(dbPing));
  return router;
}
