import { Router, type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import multer, { MulterError } from 'multer';
import { aiController } from '../controllers/ai.controller.js';
import { aiLearningController } from '../controllers/ai-learning.controller.js';
import { aiStudioController } from '../controllers/ai-studio.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { aiIpRateLimit, aiRateLimit } from '../middleware/rate-limit.js';
import { validate } from '../middleware/validate.js';
import { aiChatSchema } from '../validators/ai.validators.js';
import {
  aiCardParamsSchema,
  aiSetParamsSchema,
  evaluateAnswerSchema,
  explainSetSchema,
  cardActionSchema,
  finishStudySchema,
  generateQuestionsSchema,
  generateQuizSchema,
  generateSetSchema,
  hintRequestSchema,
  summarizeSetSchema,
} from '../validators/ai-set.validators.js';
import { MAX_AI_BODY_CHARS } from '../lib/ai-limits.js';
import { errors } from '../lib/errors.js';
import { MAX_STUDIO_PDF_BYTES } from '../services/ai-studio-pdf.js';
import {
  studioCardsRequestSchema,
  studioChatRequestSchema,
  studioQuestionsRequestSchema,
  studioPlanRequestSchema,
  studioQuizRequestSchema,
  studioSummaryRequestSchema,
} from '../validators/ai-studio.validators.js';

/**
 * Rejects oversized payloads before schema parsing. The global JSON parser
 * allows 1 MB (set imports need it); an AI request never does.
 */
export function bodySizeGuard(maxChars: number): RequestHandler {
  return (req, _res, next) => {
    const body: unknown = req.body;
    const size = typeof body === 'string' ? body.length : JSON.stringify(body ?? {}).length;
    if (size > maxChars) {
      next(errors.validation('The request is too large'));
      return;
    }
    next();
  };
}

/** Shared guards for every AI endpoint: auth, two rate limiters, body size. */
function aiGuards(): RequestHandler[] {
  return [requireAuth, aiIpRateLimit, aiRateLimit, bodySizeGuard(MAX_AI_BODY_CHARS)];
}

const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_STUDIO_PDF_BYTES, files: 1, fields: 1, fieldNameSize: 40, fieldSize: 256 },
}).single('file');

/** Multipart PDF handling stays in memory and has independent byte limits. */
const handlePdfUpload: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  pdfUpload(req, res, (error: unknown) => {
    if (!error) {
      next();
      return;
    }
    if (error instanceof MulterError && error.code === 'LIMIT_FILE_SIZE') {
      next(errors.validation('PDFs must be 15 MB or smaller.'));
      return;
    }
    next(errors.validation('The PDF upload could not be processed. Choose one PDF and try again.'));
  });
};

/** /api/ai — built-in Lerno AI (website only, independent of MCP). */
export function aiRoutes(): Router {
  const router = Router();

  // Free chat -------------------------------------------------------------
  router.post('/chat', ...aiGuards(), validate({ body: aiChatSchema }), aiController.chat);

  // AI Study Studio: source content is session-only; set IDs are re-authorized per task.
  router.post(
    '/studio/sources/pdf',
    requireAuth,
    aiIpRateLimit,
    aiRateLimit,
    handlePdfUpload,
    aiStudioController.extractPdf,
  );
  router.post(
    '/studio/summary',
    ...aiGuards(),
    validate({ body: studioSummaryRequestSchema }),
    aiStudioController.summarize,
  );
  router.post(
    '/studio/cards',
    ...aiGuards(),
    validate({ body: studioCardsRequestSchema }),
    aiStudioController.cards,
  );
  router.post(
    '/studio/quiz',
    ...aiGuards(),
    validate({ body: studioQuizRequestSchema }),
    aiStudioController.quiz,
  );
  router.post(
    '/studio/questions',
    ...aiGuards(),
    validate({ body: studioQuestionsRequestSchema }),
    aiStudioController.questions,
  );
  router.post(
    '/studio/plan',
    ...aiGuards(),
    validate({ body: studioPlanRequestSchema }),
    aiStudioController.plan,
  );
  router.post(
    '/studio/chat',
    ...aiGuards(),
    validate({ body: studioChatRequestSchema }),
    aiStudioController.chat,
  );

  // Study-set actions -----------------------------------------------------
  router.post(
    '/sets/:setId/explain',
    ...aiGuards(),
    validate({ params: aiSetParamsSchema, body: explainSetSchema }),
    aiLearningController.explainSet,
  );
  router.post(
    '/sets/:setId/summarize',
    ...aiGuards(),
    validate({ params: aiSetParamsSchema, body: summarizeSetSchema }),
    aiLearningController.summarizeSet,
  );
  router.post(
    '/sets/:setId/questions',
    ...aiGuards(),
    validate({ params: aiSetParamsSchema, body: generateQuestionsSchema }),
    aiLearningController.generateQuestions,
  );

  router.post(
    '/sets/:setId/quiz',
    ...aiGuards(),
    validate({ params: aiSetParamsSchema, body: generateQuizSchema }),
    aiLearningController.generateQuiz,
  );

  // Card-level actions ----------------------------------------------------
  router.post(
    '/cards/:cardId/action',
    ...aiGuards(),
    validate({ params: aiCardParamsSchema, body: cardActionSchema }),
    aiLearningController.cardAction,
  );

  // Generation (preview only — never auto-saved) --------------------------
  router.post(
    '/generate-set',
    ...aiGuards(),
    validate({ body: generateSetSchema }),
    aiLearningController.generateSet,
  );

  // Overhoor / AI study mode ---------------------------------------------
  router.post(
    '/study/evaluate',
    ...aiGuards(),
    validate({ body: evaluateAnswerSchema }),
    aiLearningController.evaluateAnswer,
  );
  router.post(
    '/study/hint',
    ...aiGuards(),
    validate({ body: hintRequestSchema }),
    aiLearningController.hint,
  );
  router.post(
    '/study/finish',
    ...aiGuards(),
    validate({ body: finishStudySchema }),
    aiLearningController.finishStudy,
  );

  return router;
}
