import { Router } from 'express';
import { z } from 'zod';
import { adminController, reportController } from '../controllers/report.controller.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { publicRateLimit, writeRateLimit } from '../middleware/rate-limit.js';
import { validate } from '../middleware/validate.js';
import {
  adminListQuerySchema,
  adminUserParamsSchema,
  createReportSchema,
  moderateSetSchema,
  reportParamsSchema,
  resolveReportSchema,
  setRoleSchema,
} from '../validators/report.validators.js';

const setParams = z.object({ setId: z.string().uuid('Invalid set id') });

/** POST /api/reports — authenticated users report content (rate-limited). */
export function reportRoutes(): Router {
  const router = Router();

  router.post(
    '/',
    requireAuth,
    publicRateLimit,
    writeRateLimit,
    validate({ body: createReportSchema }),
    reportController.create,
  );

  return router;
}

/** /api/admin — admin-only moderation area (spec §6 Admin). */
export function adminRoutes(): Router {
  const router = Router();
  router.use(requireAdmin);

  router.get('/metrics', adminController.metrics);

  router.get('/reports', validate({ query: adminListQuerySchema }), reportController.list);
  router.patch(
    '/reports/:reportId',
    writeRateLimit,
    validate({ params: reportParamsSchema, body: resolveReportSchema }),
    reportController.resolve,
  );

  router.get('/users', validate({ query: adminListQuerySchema }), adminController.listUsers);
  router.patch(
    '/users/:userId/role',
    writeRateLimit,
    validate({ params: adminUserParamsSchema, body: setRoleSchema }),
    adminController.setRole,
  );
  router.delete(
    '/users/:userId',
    writeRateLimit,
    validate({ params: adminUserParamsSchema }),
    adminController.deleteUser,
  );

  router.get('/sets', validate({ query: adminListQuerySchema }), adminController.listPublicSets);
  router.patch(
    '/sets/:setId/moderate',
    writeRateLimit,
    validate({ params: setParams, body: moderateSetSchema }),
    adminController.moderateSet,
  );

  return router;
}
