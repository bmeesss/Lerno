import type { Request, Response } from 'express';
import { asyncHandler, sendOk } from '../lib/http.js';
import { errors } from '../lib/errors.js';
import { studyProgressService } from '../services/study-progress-service.js';
import { studySessionService } from '../services/study-session-service.js';
import type {
  AnswerItemBody,
  CompleteSessionBody,
  CreateSessionBody,
  PreviewSessionQuery,
  RateItemBody,
  SaveAnswersBody,
} from '../validators/study-session.validators.js';

/**
 * Study session endpoints. Ownership is enforced in the service (a session that
 * is not yours answers 404, exactly like one that does not exist); controllers
 * only translate HTTP ↔ service.
 */
function userId(req: Request): string {
  if (!req.auth) throw errors.unauthorized();
  return req.auth.id;
}

export const studySessionController = {
  preview: asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as unknown as PreviewSessionQuery;
    sendOk(res, await studySessionService.preview(req.db, userId(req), query));
  }),

  active: asyncHandler(async (req: Request, res: Response) => {
    sendOk(res, await studySessionService.listActive(req.db, userId(req)));
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as CreateSessionBody;
    const result = await studySessionService.create(req.db, userId(req), {
      ...body,
      conceptId: body.conceptId ?? null,
    });
    // 201 for a new session, 200 when an open one was resumed.
    sendOk(res, result, 'resumed' in result && result.resumed ? 200 : 201);
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    const { sessionId } = req.params as { sessionId: string };
    sendOk(res, await studySessionService.get(req.db, userId(req), sessionId));
  }),

  start: asyncHandler(async (req: Request, res: Response) => {
    const { sessionId } = req.params as { sessionId: string };
    sendOk(res, await studySessionService.start(req.db, userId(req), sessionId));
  }),

  answer: asyncHandler(async (req: Request, res: Response) => {
    const { sessionId, itemId } = req.params as { sessionId: string; itemId: string };
    const body = req.body as AnswerItemBody;
    sendOk(res, await studySessionService.answer(req.db, userId(req), sessionId, itemId, body));
  }),

  rate: asyncHandler(async (req: Request, res: Response) => {
    const { sessionId, itemId } = req.params as { sessionId: string; itemId: string };
    const body = req.body as RateItemBody;
    sendOk(res, await studySessionService.rate(req.db, userId(req), sessionId, itemId, body));
  }),

  skip: asyncHandler(async (req: Request, res: Response) => {
    const { sessionId, itemId } = req.params as { sessionId: string; itemId: string };
    sendOk(res, await studySessionService.skip(req.db, userId(req), sessionId, itemId));
  }),

  saveAnswers: asyncHandler(async (req: Request, res: Response) => {
    const { sessionId } = req.params as { sessionId: string };
    const body = req.body as SaveAnswersBody;
    sendOk(res, await studySessionService.saveAnswers(req.db, userId(req), sessionId, body));
  }),

  complete: asyncHandler(async (req: Request, res: Response) => {
    const { sessionId } = req.params as { sessionId: string };
    const body = req.body as CompleteSessionBody;
    sendOk(res, await studySessionService.complete(req.db, userId(req), sessionId, body));
  }),

  abandon: asyncHandler(async (req: Request, res: Response) => {
    const { sessionId } = req.params as { sessionId: string };
    sendOk(res, await studySessionService.abandon(req.db, userId(req), sessionId));
  }),

  mistakes: asyncHandler(async (req: Request, res: Response) => {
    const { sessionId } = req.params as { sessionId: string };
    sendOk(res, await studySessionService.mistakes(req.db, userId(req), sessionId));
  }),

  /** GET /api/progress/study — everything the Progress page needs in one request. */
  progress: asyncHandler(async (req: Request, res: Response) => {
    sendOk(res, await studyProgressService.overview(req.db, userId(req)));
  }),

  /** GET /api/subjects/:subjectId/overview */
  subjectOverview: asyncHandler(async (req: Request, res: Response) => {
    const { subjectId } = req.params as { subjectId: string };
    sendOk(res, await studyProgressService.subjectOverview(req.db, userId(req), subjectId));
  }),
};
