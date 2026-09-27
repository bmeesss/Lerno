import type { Request, Response } from 'express';
import { asyncHandler, sendOk } from '../lib/http.js';
import { errors } from '../lib/errors.js';
import { profileService } from '../services/profile-service.js';
import type { UpdateProfileBody } from '../validators/auth.validators.js';

export const profileController = {
  getOwn: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    sendOk(res, await profileService.getOwn(req.db, req.auth.id));
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    const body = req.body as UpdateProfileBody;
    sendOk(res, await profileService.update(req.db, req.auth.id, body));
  }),

  getPublic: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params as { userId: string };
    sendOk(res, await profileService.getPublic(req.db, userId));
  }),
};
