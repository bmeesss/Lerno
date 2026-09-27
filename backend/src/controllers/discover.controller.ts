import type { Request, Response } from 'express';
import { asyncHandler, sendOk } from '../lib/http.js';
import { errors } from '../lib/errors.js';
import { discoverService } from '../services/discover-service.js';
import { favoriteService } from '../services/favorite-service.js';
import type { DiscoverQuery } from '../validators/discover.validators.js';

export const discoverController = {
  search: asyncHandler(async (req: Request, res: Response) => {
    sendOk(res, await discoverService.search(req.db, req.query as unknown as DiscoverQuery));
  }),

  facets: asyncHandler(async (req: Request, res: Response) => {
    sendOk(res, await discoverService.facets(req.db));
  }),

  listFavorites: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    sendOk(res, await favoriteService.list(req.db, req.auth.id));
  }),

  addFavorite: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    const { setId } = req.params as { setId: string };
    await favoriteService.add(req.db, req.auth.id, setId);
    sendOk(res, { ok: true }, 201);
  }),

  removeFavorite: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    const { setId } = req.params as { setId: string };
    await favoriteService.remove(req.db, req.auth.id, setId);
    res.status(204).end();
  }),
};
