/**
 * Controllers for the Lerno AI learning endpoints (set actions, generation,
 * overhoor mode). Thin: authorization and validation happen in middleware,
 * data access + AI orchestration live in `ai-learning-service.ts`.
 */
import type { Request, Response } from 'express';
import { asyncHandler, sendOk } from '../lib/http.js';
import { errors } from '../lib/errors.js';
import { aiLearningService } from '../services/ai-learning-service.js';
import type { ExplainSetBody, SummarizeSetBody } from '../validators/ai-set.validators.js';

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
};
