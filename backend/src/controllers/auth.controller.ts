import type { Request, Response } from 'express';
import { asyncHandler, sendOk } from '../lib/http.js';
import { authService } from '../services/auth-service.js';
import type {
  LoginBody,
  RefreshBody,
  ResetPasswordBody,
  SignupBody,
} from '../validators/auth.validators.js';

export const authController = {
  signup: asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as SignupBody;
    const result = await authService.signup(req.db, body);
    sendOk(res, result, 201);
  }),

  login: asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as LoginBody;
    const result = await authService.login(req.db, body);
    sendOk(res, result);
  }),

  logout: asyncHandler(async (req: Request, res: Response) => {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
    await authService.logout(token);
    res.status(204).end();
  }),

  refresh: asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as RefreshBody;
    const result = await authService.refresh(req.db, body.refreshToken);
    sendOk(res, result);
  }),

  resetPassword: asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as ResetPasswordBody;
    await authService.requestPasswordReset(body.email);
    // Always the same response: never reveal whether the account exists.
    sendOk(res, { ok: true });
  }),

  me: asyncHandler(async (req: Request, res: Response) => {
    const identity = await authService.requireIdentity(req.auth);
    const user = await authService.me(req.db, identity);
    sendOk(res, user);
  }),
};
