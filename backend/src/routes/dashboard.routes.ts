import { Router } from 'express';
import { dashboardController } from '../controllers/dashboard.controller.js';
import { requireAuth } from '../middleware/auth.js';

export function dashboardRoutes(): Router {
  const router = Router();
  router.get('/', requireAuth, dashboardController.get);
  return router;
}
