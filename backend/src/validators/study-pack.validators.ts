import { z } from 'zod';

/**
 * Study Pack request validation.
 *
 * Source kinds are intentionally limited to what Lerno can process today:
 * pasted text, PDF text extracted in the browser, and existing Lerno sets.
 * PowerPoint/YouTube/image/audio are reserved in the data model and rejected
 * here with an honest message until their adapters exist.
 */

const titleSchema = z.string().trim().min(1, 'Title is required').max(160);
const examDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-18')
  .nullable();

export const packParamsSchema = z.object({
  packId: z.string().uuid('Invalid study pack id'),
});

export const packSourceParamsSchema = z.object({
  packId: z.string().uuid('Invalid study pack id'),
  sourceId: z.string().uuid('Invalid source id'),
});

export const conceptParamsSchema = z.object({
  packId: z.string().uuid('Invalid study pack id'),
  conceptId: z.string().uuid('Invalid concept id'),
});

export const testParamsSchema = z.object({
  packId: z.string().uuid('Invalid study pack id'),
  testId: z.string().uuid('Invalid test id'),
});

const textSourceSchema = z.object({
  type: z.literal('text'),
  title: z.string().trim().min(1).max(120),
  text: z.string().trim().min(20, 'Add at least 20 characters of study material.').max(50_000),
});

const pdfSourceSchema = z.object({
  type: z.literal('pdf'),
  title: z.string().trim().min(1).max(120),
  text: z.string().trim().min(20, 'Add at least 20 characters of study material.').max(50_000),
  pageCount: z.coerce.number().int().min(1).max(500).optional(),
});

const setSourceSchema = z.object({
  type: z.literal('set'),
  setId: z.string().uuid('Invalid set id'),
  title: z.string().trim().min(1).max(120).optional(),
});

export const createPackSchema = z.object({
  title: titleSchema,
  subjectId: z.string().uuid('Invalid subject').nullable().optional(),
  description: z.string().trim().max(2000).default(''),
  level: z.string().trim().max(60).default(''),
  visibility: z.enum(['private', 'public']).default('private'),
  examDate: examDateSchema.optional(),
  /** Optional first piece of material; without it a pack starts empty. */
  source: z
    .discriminatedUnion('type', [textSourceSchema, pdfSourceSchema, setSourceSchema])
    .optional(),
  /** Optional manually written cards (kept when the student creates a pack by hand). */
  cards: z
    .array(
      z.object({
        question: z.string().trim().min(1, 'Question is required').max(2000),
        answer: z.string().trim().min(1, 'Answer is required').max(4000),
      }),
    )
    .max(200)
    .optional(),
});

export const updatePackSchema = z
  .object({
    title: titleSchema.optional(),
    subjectId: z.string().uuid('Invalid subject').nullable().optional(),
    description: z.string().trim().max(2000).optional(),
    level: z.string().trim().max(60).optional(),
    visibility: z.enum(['private', 'public']).optional(),
    examDate: examDateSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });

export const addSourceSchema = z.discriminatedUnion('type', [
  textSourceSchema,
  pdfSourceSchema,
  setSourceSchema,
]);

/* ------------------------------- import flow ------------------------------- */
/*
 * The import endpoint creates a pack *and* starts processing its first source.
 * It reuses the same source shapes as `createPackSchema`, plus the explicit
 * `allowDuplicate` switch the duplicate dialog needs.
 */

export const importPackSchema = z.object({
  title: titleSchema,
  subjectId: z.string().uuid('Invalid subject').nullable().optional(),
  description: z.string().trim().max(2000).default(''),
  level: z.string().trim().max(60).default(''),
  examDate: examDateSchema.optional(),
  /** Material the pack is built from; one source per import. */
  source: z.discriminatedUnion('type', [textSourceSchema, pdfSourceSchema, setSourceSchema]),
  /** Set by "Import anyway" after the duplicate warning. */
  allowDuplicate: z.boolean().default(false),
});

/** Starting (or retrying) generation for material that is already stored. */
export const processPackSchema = z.object({
  sourceId: z.string().uuid('Invalid source id').nullable().optional(),
});

export const createConceptSchema = z.object({
  name: z.string().trim().min(2, 'Concept name is too short').max(200),
  explanation: z.string().trim().max(1200).default(''),
});

export const updateConceptSchema = z
  .object({
    name: z.string().trim().min(2).max(200).optional(),
    explanation: z.string().trim().max(1200).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });

/* ---------------------------- generated content ---------------------------- */

export const generateSchema = z.object({
  target: z.enum(['summary', 'concepts', 'flashcards', 'practice']),
  sourceId: z.string().uuid('Invalid source id').nullable().optional(),
  count: z.coerce.number().int().min(3).max(30).optional(),
});

const editableConceptSchema = z.object({
  name: z.string().trim().min(2).max(200),
  explanation: z.string().trim().max(1200).default(''),
});

const editableCardSchema = z.object({
  front: z.string().trim().min(1).max(2000),
  back: z.string().trim().min(1).max(4000),
});

const editableQuestionSchema = z.object({
  questionType: z.enum(['multiple_choice', 'true_false', 'short_answer']),
  prompt: z.string().trim().min(3).max(2000),
  correctAnswer: z.string().trim().min(1).max(2000),
  options: z.array(z.string().trim().min(1).max(300)).min(2).max(6).nullable().default(null),
  explanation: z.string().trim().max(1200).default(''),
});

/**
 * Applying a confirmed (and possibly edited) preview. Every target is additive:
 * content is appended, never replaced, so AI cannot overwrite student work.
 */
export const applyContentSchema = z.discriminatedUnion('target', [
  z.object({
    target: z.literal('summary'),
    summary: z.string().trim().min(20).max(4000),
    sourceId: z.string().uuid().nullable().default(null),
  }),
  z.object({
    target: z.literal('concepts'),
    concepts: z.array(editableConceptSchema).min(1).max(20),
    sourceId: z.string().uuid().nullable().default(null),
  }),
  z.object({
    target: z.literal('flashcards'),
    cards: z.array(editableCardSchema).min(1).max(30),
    sourceId: z.string().uuid().nullable().default(null),
  }),
  z.object({
    target: z.literal('practice'),
    questions: z.array(editableQuestionSchema).min(1).max(15),
    sourceId: z.string().uuid().nullable().default(null),
  }),
]);

/* -------------------------------- studying -------------------------------- */

export const practiceQueueQuerySchema = z.object({
  conceptId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export const learnNextQuerySchema = z.object({
  exclude: z.preprocess(
    (value) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value),
    z.array(z.string().uuid()).max(300),
  ).optional(),
  focusConceptId: z.string().uuid().optional(),
});

const responseTimeSchema = z.number().int().min(0).max(3_600_000).optional();

export const practiceAttemptSchema = z.object({
  questionId: z.string().uuid('Invalid question id'),
  answer: z.string().max(4000).default(''),
  responseTimeMs: responseTimeSchema,
});

export const createTestSchema = z.object({
  mode: z.enum(['quick10', 'quick20', 'exam']).default('quick10'),
});

export const submitTestSchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string().uuid('Invalid question id'),
        answer: z.string().max(4000).default(''),
        responseTimeMs: responseTimeSchema,
      }),
    )
    .max(50)
    .default([]),
});

export const rateConceptSchema = z.object({
  rating: z.enum(['again', 'hard', 'good', 'easy']),
  responseTimeMs: responseTimeSchema,
});

export const createPlanSchema = z.object({
  days: z.coerce.number().int().min(1).max(60).optional(),
  minutesPerDay: z.coerce.number().int().min(10).max(180).optional(),
});

export const tutorSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(1500),
      }),
    )
    .max(8)
    .default([]),
});

export type CreatePackBody = z.infer<typeof createPackSchema>;
export type ImportPackBody = z.infer<typeof importPackSchema>;
export type ProcessPackBody = z.infer<typeof processPackSchema>;
export type UpdatePackBody = z.infer<typeof updatePackSchema>;
export type AddSourceBody = z.infer<typeof addSourceSchema>;
export type GenerateBody = z.infer<typeof generateSchema>;
export type ApplyContentBody = z.infer<typeof applyContentSchema>;
export type CreateTestBody = z.infer<typeof createTestSchema>;
export type SubmitTestBody = z.infer<typeof submitTestSchema>;
export type TutorBody = z.infer<typeof tutorSchema>;
