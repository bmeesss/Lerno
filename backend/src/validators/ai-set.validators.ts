/**
 * Validators for the Lerno AI learning endpoints (sets, cards, generation,
 * study). Every body is validated before it reaches a service, and every AI
 * answer is validated separately with `lib/ai-schemas.ts`.
 */
import { z } from 'zod';

export const aiSetParamsSchema = z.object({ setId: z.string().uuid('Invalid set id') });

export const aiCardParamsSchema = z.object({ cardId: z.string().uuid('Invalid card id') });

/** Optional extra instructions the student can add to a set action. */
const focusSchema = z.string().trim().max(300).default('');

export const explainSetSchema = z.object({ focus: focusSchema });

export const summarizeSetSchema = z.object({ focus: focusSchema });

export const QUESTION_COUNT_VALUES = [5, 10, 15] as const;
export const DIFFICULTY_VALUES = ['easy', 'normal', 'hard'] as const;

const questionCount = z.coerce
  .number()
  .int()
  .refine(
    (value): value is (typeof QUESTION_COUNT_VALUES)[number] =>
      QUESTION_COUNT_VALUES.includes(value as (typeof QUESTION_COUNT_VALUES)[number]),
    { message: 'count must be 5, 10 or 15' },
  )
  .default(10);

const difficulty = z.enum(DIFFICULTY_VALUES).default('normal');

export const generateQuestionsSchema = z.object({
  count: questionCount,
  difficulty,
  focus: focusSchema,
});

export const QUIZ_TYPE_VALUES = ['multiple_choice', 'open', 'true_false'] as const;

export const generateQuizSchema = z.object({
  count: questionCount,
  difficulty,
  types: z
    .array(z.enum(QUIZ_TYPE_VALUES))
    .min(1, 'Pick at least one question type')
    .max(3)
    .default(['multiple_choice']),
  focus: focusSchema,
});

/** Generate a whole study set from a prompt (preview only — never auto-saved). */
export const generateSetSchema = z.object({
  prompt: z
    .string()
    .trim()
    .min(8, 'Describe what you want to study in a few words')
    .max(600, 'That description is too long'),
  cardCount: z.coerce.number().int().min(3).max(30).default(12),
  level: z.string().trim().max(60).default(''),
});

export const CARD_ACTION_VALUES = ['explain', 'example', 'hint', 'practice'] as const;

export const cardActionSchema = z.object({
  setId: z.string().uuid('Invalid set id'),
  action: z.enum(CARD_ACTION_VALUES),
  focus: focusSchema,
});

/** One evaluated answer of an overhoor/quiz session. */
export const studyResultSchema = z.object({
  cardId: z.string().uuid('Invalid card id').optional(),
  question: z.string().trim().min(1).max(500),
  answer: z.string().trim().max(2000).default(''),
  verdict: z.enum(['correct', 'partial', 'incorrect']),
});

export const finishStudySchema = z.object({
  setId: z.string().uuid('Invalid set id'),
  results: z.array(studyResultSchema).min(1).max(50),
});

export const evaluateAnswerSchema = z.object({
  setId: z.string().uuid('Invalid set id'),
  cardId: z.string().uuid('Invalid card id').optional(),
  question: z.string().trim().min(1).max(500),
  expectedAnswer: z.string().trim().max(1000).default(''),
  answer: z.string().trim().max(2000).default(''),
});

export const hintRequestSchema = z.object({
  setId: z.string().uuid('Invalid set id'),
  cardId: z.string().uuid('Invalid card id').optional(),
  question: z.string().trim().min(1).max(500),
  expectedAnswer: z.string().trim().max(1000).default(''),
  hintsGiven: z.coerce.number().int().min(0).max(10).default(0),
});

export type ExplainSetBody = z.infer<typeof explainSetSchema>;
export type SummarizeSetBody = z.infer<typeof summarizeSetSchema>;
export type GenerateQuestionsBody = z.infer<typeof generateQuestionsSchema>;
export type GenerateQuizBody = z.infer<typeof generateQuizSchema>;
export type GenerateSetBody = z.infer<typeof generateSetSchema>;
export type CardActionBody = z.infer<typeof cardActionSchema>;
export type EvaluateAnswerBody = z.infer<typeof evaluateAnswerSchema>;
export type HintRequestBody = z.infer<typeof hintRequestSchema>;
export type FinishStudyBody = z.infer<typeof finishStudySchema>;
export type StudyResultInput = z.infer<typeof studyResultSchema>;
