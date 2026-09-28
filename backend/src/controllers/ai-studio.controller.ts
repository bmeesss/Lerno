import type { Request, Response } from 'express';
import { asyncHandler, sendOk } from '../lib/http.js';
import { errors } from '../lib/errors.js';
import {
  chatWithStudioSource,
  createStudioPlan,
  extractStudioPdf,
  generateStudioCards,
  generateStudioQuestions,
  generateStudioQuiz,
  summarizeStudioSource,
} from '../services/ai-studio-service.js';
import type {
  StudioActionSource,
  StudioCardsRequest,
  StudioChatRequest,
  StudioQuestionsRequest,
  StudioPlanRequest,
  StudioQuizRequest,
} from '../validators/ai-studio.validators.js';

function caller(req: Request): string {
  if (!req.auth) throw errors.unauthorized();
  return req.auth.id;
}

export const aiStudioController = {
  extractPdf: asyncHandler(async (req: Request, res: Response) => {
    if (!req.file?.buffer) throw errors.validation('Choose a PDF file to upload.');
    if (req.file.mimetype && !['application/pdf', 'application/octet-stream'].includes(req.file.mimetype)) {
      throw errors.validation('Choose a PDF document.');
    }
    const rawTitle = typeof req.body?.title === 'string'
      ? req.body.title
      : req.file.originalname.replace(/\.pdf$/i, '');
    sendOk(res, await extractStudioPdf(req.file.buffer, rawTitle), 201);
  }),

  summarize: asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as { source: StudioActionSource };
    sendOk(res, await summarizeStudioSource(req.db, caller(req), body.source));
  }),

  cards: asyncHandler(async (req: Request, res: Response) => {
    sendOk(res, await generateStudioCards(req.db, caller(req), req.body as StudioCardsRequest));
  }),

  quiz: asyncHandler(async (req: Request, res: Response) => {
    sendOk(res, await generateStudioQuiz(req.db, caller(req), req.body as StudioQuizRequest));
  }),

  questions: asyncHandler(async (req: Request, res: Response) => {
    sendOk(res, await generateStudioQuestions(req.db, caller(req), req.body as StudioQuestionsRequest));
  }),

  plan: asyncHandler(async (req: Request, res: Response) => {
    sendOk(res, await createStudioPlan(req.db, caller(req), req.body as StudioPlanRequest));
  }),

  chat: asyncHandler(async (req: Request, res: Response) => {
    sendOk(res, await chatWithStudioSource(req.db, caller(req), req.body as StudioChatRequest));
  }),
};
