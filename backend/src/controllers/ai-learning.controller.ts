/**
 * Controllers for the Lerno AI learning endpoints (set actions, generation,
 * overhoor mode). Thin: authorization and validation happen in middleware,
 * data access + AI orchestration live in `ai-learning-service.ts`.
 */
import type { Request, Response } from 'express';
import { asyncHandler, sendOk } from '../lib/http.js';
import { errors } from '../lib/errors.js';
import { aiLearningService } from '../services/ai-learning-service.js';
import type {
  EvaluateAnswerBody,
  ExplainSetBody,
  FinishStudyBody,
  GenerateQuestionsBody,
  GenerateQuizBody,
  GenerateSetBody,
  HintRequestBody,
  SummarizeSetBody,
} from '../validators/ai-set.validators.js';

function requireUser(req: Request): string {
  if (!req.auth) throw errors.unauthorized();
  return req.auth.id;
}

export const aiLearningController = {
  // ------------------------------------------------------------ set actions

  /** POST /api/ai/sets/:setId/explain */
  explainSet: asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUser(req);
    const { setId } = req.params as { setId: string };
    const body = req.body as ExplainSetBody;
    const result = await aiLearningService.explainSet(req.db, userId, setId, body.focus);
    sendOk(res, { explanation: result.text, meta: result.meta });
  }),

  /** POST /api/ai/sets/:setId/summarize */
  summarizeSet: asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUser(req);
    const { setId } = req.params as { setId: string };
    const body = req.body as SummarizeSetBody;
    const result = await aiLearningService.summarizeSet(req.db, userId, setId, body.focus);
    sendOk(res, { summary: result.text, meta: result.meta });
  }),

  /** POST /api/ai/sets/:setId/questions — structured practice questions (#3). */
  generateQuestions: asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUser(req);
    const { setId } = req.params as { setId: string };
    const body = req.body as GenerateQuestionsBody;
    const result = await aiLearningService.generateQuestions(req.db, userId, setId, body);
    sendOk(res, { questions: result.questions, meta: result.meta });
  }),

  // ------------------------------------------------------------ overhoor mode

  /** POST /api/ai/sets/:setId/quiz — generated quiz, schema validated (#7). */
  generateQuiz: asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUser(req);
    const { setId } = req.params as { setId: string };
    const body = req.body as GenerateQuizBody;
    const result = await aiLearningService.generateQuiz(req.db, userId, setId, body);
    sendOk(res, { questions: result.questions, meta: result.meta });
  }),

  /** POST /api/ai/generate-set — preview only, never auto-saved (#6). */
  generateSet: asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUser(req);
    const body = req.body as GenerateSetBody;
    const generated = await aiLearningService.generateSet(req.db, userId, body);
    sendOk(res, generated);
  }),

  /** POST /api/ai/study/evaluate — judge one answer (#4). */
  evaluateAnswer: asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUser(req);
    const body = req.body as EvaluateAnswerBody;
    const evaluation = await aiLearningService.evaluateAnswer(req.db, userId, body);
    sendOk(res, evaluation);
  }),

  /** POST /api/ai/study/hint — a hint that never reveals the answer (#5). */
  hint: asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUser(req);
    const body = req.body as HintRequestBody;
    const result = await aiLearningService.hint(req.db, userId, body);
    sendOk(res, result);
  }),

  /** POST /api/ai/study/finish — session summary + progress (#4, #14). */
  finishStudy: asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUser(req);
    const body = req.body as FinishStudyBody;
    const summary = await aiLearningService.finishStudy(req.db, userId, body);
    sendOk(res, summary);
  }),
};
