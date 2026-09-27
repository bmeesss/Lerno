import type { Request, Response } from 'express';
import { asyncHandler, sendOk } from '../lib/http.js';
import { quizService } from '../services/quiz-service.js';
import type { QuizSubmitBody } from '../validators/quiz.validators.js';

export const quizController = {
  load: asyncHandler(async (req: Request, res: Response) => {
    const { setId } = req.params as { setId: string };
    sendOk(res, await quizService.loadForSet(req.db, req.auth?.id ?? null, setId));
  }),

  submit: asyncHandler(async (req: Request, res: Response) => {
    const { setId } = req.params as { setId: string };
    const body = req.body as QuizSubmitBody;
    sendOk(res, await quizService.submit(req.db, req.auth?.id ?? null, setId, body.answers));
  }),
};
