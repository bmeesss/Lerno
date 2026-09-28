import type { Request, Response } from 'express';
import { asyncHandler, sendOk } from '../lib/http.js';
import { errors } from '../lib/errors.js';
import { askLernoAi } from '../services/ai-service.js';
import type { AiChatBody } from '../validators/ai.validators.js';

export const aiController = {
  /** POST /api/ai/chat — authenticated chat with Lerno AI (via Groq). */
  chat: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    const body = req.body as AiChatBody;
    const reply = await askLernoAi({ message: body.message, history: body.history });
    // Only the reply text is returned — no model internals, no raw Groq payload.
    sendOk(res, { reply });
  }),
};
