import { z } from 'zod';

/**
 * Study session request validation. Sessions carry their own ids, so every
 * path parameter is a UUID and every body is small and explicit.
 */
const uuid = (label: string) => z.string().uuid(`Invalid ${label}`);

export const sessionTypeSchema = z.enum(['learn', 'practice', 'review', 'test']);
const testModeSchema = z.enum(['quick10', 'quick20', 'exam']);
const responseTimeSchema = z.coerce.number().int().min(0).max(3_600_000).optional();

export const sessionParamsSchema = z.object({
  sessionId: uuid('study session id'),
});

export const sessionItemParamsSchema = z.object({
  sessionId: uuid('study session id'),
  itemId: uuid('session item id'),
});

/** Query strings arrive as text: "true"/"false" must not both be truthy. */
const flag = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => value === true || value === 'true');

export const createSessionSchema = z.object({
  packId: uuid('study pack id'),
  type: sessionTypeSchema,
  mode: testModeSchema.optional(),
  conceptId: uuid('concept id').nullish(),
  count: z.coerce.number().int().min(1).max(50).optional(),
  restart: flag.optional(),
  start: flag.optional(),
});

export const previewSessionQuerySchema = z.object({
  packId: uuid('study pack id'),
  type: sessionTypeSchema,
  mode: testModeSchema.optional(),
  conceptId: uuid('concept id').optional(),
  count: z.coerce.number().int().min(1).max(50).optional(),
});

export const answerItemSchema = z.object({
  answer: z.string().trim().min(1, 'Give an answer first').max(2000),
  responseTimeMs: responseTimeSchema,
});

export const rateItemSchema = z.object({
  rating: z.enum(['again', 'hard', 'good', 'easy']),
  responseTimeMs: responseTimeSchema,
});

const batchAnswersSchema = z
  .array(
    z.object({
      itemId: uuid('session item id'),
      // An empty string clears the answer.
      answer: z.string().max(2000),
    }),
  )
  .max(100);

export const saveAnswersSchema = z.object({
  answers: batchAnswersSchema,
  currentPosition: z.coerce.number().int().min(0).max(200).optional(),
});

export const completeSessionSchema = z.object({
  answers: batchAnswersSchema.optional(),
});

export type CreateSessionBody = z.infer<typeof createSessionSchema>;
export type PreviewSessionQuery = z.infer<typeof previewSessionQuerySchema>;
export type AnswerItemBody = z.infer<typeof answerItemSchema>;
export type RateItemBody = z.infer<typeof rateItemSchema>;
export type SaveAnswersBody = z.infer<typeof saveAnswersSchema>;
export type CompleteSessionBody = z.infer<typeof completeSessionSchema>;
