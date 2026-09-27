import type { Request, Response } from 'express';
import { asyncHandler, sendOk } from '../lib/http.js';
import { errors } from '../lib/errors.js';
import { dashboardService } from '../services/dashboard-service.js';

export const dashboardController = {
  get: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    const profile = await req.db.profiles.get(req.auth.id);
    sendOk(res, await dashboardService.get(req.db, req.auth.id, profile?.displayName ?? ''));
  }),
};
