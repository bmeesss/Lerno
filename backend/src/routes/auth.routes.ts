import { Router } from 'express';
import { authController } from '../controllers/auth.controller.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { authRateLimit } from '../middleware/rate-limit.js';
import { validate } from '../middleware/validate.js';
import {
  loginSchema,
  refreshSchema,
  resetPasswordSchema,
  signupSchema,
} from '../validators/auth.validators.js';

export function authRoutes(): Router {
  const router = Router();

  router.post('/signup', authRateLimit, validate({ body: signupSchema }), authController.signup);
  router.post('/login', authRateLimit, validate({ body: loginSchema }), authController.login);
  router.post('/logout', authRateLimit, optionalAuth, authController.logout);
  router.post('/refresh', authRateLimit, validate({ body: refreshSchema }), authController.refresh);
  router.post(
    '/reset-password',
    authRateLimit,
    validate({ body: resetPasswordSchema }),
    authController.resetPassword,
  );
  router.get('/me', requireAuth, authController.me);

  return router;
}
