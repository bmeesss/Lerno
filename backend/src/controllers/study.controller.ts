import type { Request, Response } from 'express';
import { asyncHandler, sendOk } from '../lib/http.js';
import { errors } from '../lib/errors.js';
import { progressService } from '../services/progress-service.js';
import { retentionService } from '../services/retention-service.js';
import { studyService } from '../services/study-service.js';
import type {
  EndSessionBody,
  ReviewInput,
  StartSessionBody,
} from '../validators/study.validators.js';

export const studyController = {
  review: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    const body = req.body as ReviewInput;
    sendOk(res, await studyService.review(req.db, req.auth.id, body));
  }),

  practiceQueue: asyncHandler(async (req: Request, res: Response) => {
    const { setId } = req.params as { setId: string };
    sendOk(res, await studyService.practiceQueue(req.db, req.auth?.id ?? null, setId));
  }),

  studyQueue: asyncHandler(async (req: Request, res: Response) => {
    const { setId } = req.params as { setId: string };
    sendOk(res, await studyService.studyQueue(req.db, req.auth?.id ?? null, setId));
  }),

  startSession: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    const body = req.body as StartSessionBody;
    sendOk(res, await studyService.startSession(req.db, req.auth.id, body.setId ?? null), 201);
  }),

  endSession: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    const { sessionId } = req.params as { sessionId: string };
    const body = req.body as EndSessionBody;
    sendOk(res, await studyService.endSession(req.db, req.auth.id, sessionId, body.cardsSeen));
  }),

  dueReviews: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    sendOk(res, await studyService.dueGroups(req.db, req.auth.id));
  }),

  progress: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    sendOk(res, await progressService.stats(req.db, req.auth.id));
  }),

  today: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    sendOk(res, await retentionService.today(req.db, req.auth.id));
  }),

  week: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    sendOk(res, await retentionService.week(req.db, req.auth.id));
  }),
};
