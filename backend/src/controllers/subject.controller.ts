import type { Request, Response } from 'express';
import { asyncHandler, sendOk } from '../lib/http.js';
import { errors } from '../lib/errors.js';
import { subjectService } from '../services/subject-service.js';
import type { CreateSubjectBody, UpdateSubjectBody } from '../validators/set.validators.js';

export const subjectController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    sendOk(res, await subjectService.list(req.db, req.auth.id));
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    const body = req.body as CreateSubjectBody;
    sendOk(res, await subjectService.create(req.db, req.auth.id, body.name), 201);
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    const { subjectId } = req.params as { subjectId: string };
    const body = req.body as UpdateSubjectBody;
    sendOk(res, await subjectService.rename(req.db, req.auth.id, subjectId, body.name));
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    const { subjectId } = req.params as { subjectId: string };
    await subjectService.remove(req.db, req.auth.id, subjectId);
    res.status(204).end();
  }),
};
