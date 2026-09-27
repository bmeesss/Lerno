import type { Request, Response } from 'express';
import { asyncHandler, sendOk } from '../lib/http.js';
import { errors } from '../lib/errors.js';
import { setService } from '../services/set-service.js';
import type {
  BulkCardsBody,
  CreateSetBody,
  UpdateCardBody,
  UpdateSetBody,
} from '../validators/set.validators.js';

export const setController = {
  listMine: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    sendOk(res, await setService.listMine(req.db, req.auth.id));
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    const body = req.body as CreateSetBody;
    sendOk(res, await setService.create(req.db, req.auth.id, body), 201);
  }),

  detail: asyncHandler(async (req: Request, res: Response) => {
    const { setId } = req.params as { setId: string };
    sendOk(res, await setService.getDetail(req.db, req.auth?.id ?? null, setId));
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    const { setId } = req.params as { setId: string };
    const body = req.body as UpdateSetBody;
    sendOk(res, await setService.update(req.db, req.auth.id, setId, body));
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    const { setId } = req.params as { setId: string };
    await setService.remove(req.db, req.auth.id, setId);
    res.status(204).end();
  }),

  listCards: asyncHandler(async (req: Request, res: Response) => {
    const { setId } = req.params as { setId: string };
    sendOk(res, await setService.listCards(req.db, req.auth?.id ?? null, setId));
  }),

  addCards: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    const { setId } = req.params as { setId: string };
    const body = req.body as BulkCardsBody;
    sendOk(res, await setService.addCards(req.db, req.auth.id, setId, body.cards), 201);
  }),

  updateCard: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    const { setId, cardId } = req.params as { setId: string; cardId: string };
    const body = req.body as UpdateCardBody;
    sendOk(res, await setService.updateCard(req.db, req.auth.id, setId, cardId, body));
  }),

  removeCard: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    const { setId, cardId } = req.params as { setId: string; cardId: string };
    await setService.removeCard(req.db, req.auth.id, setId, cardId);
    res.status(204).end();
  }),
};
