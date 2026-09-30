import { z } from 'zod';

/**
 * Study Pack request validation.
 *
 * Every source kind Lerno can really process is accepted here: pasted text,
 * (extracted) PDF text, existing Lerno sets, YouTube links with the student's own
 * transcript, and binary uploads (PDF/PPTX/image/audio) through the upload
 * endpoints. File uploads are validated again in the upload middleware and in the
 * extractors themselves (MIME type, extension, real signature, size).
 */

const titleSchema = z.string().trim().min(1, 'Title is required').max(160);
/** "2026-02-31" matches the pattern but is not a day: reject it instead of showing "exam today". */
function isRealCalendarDay(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

const examDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-18')
  .refine(isRealCalendarDay, 'Use a real calendar date')
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

/**
 * YouTube needs captions. Lerno never downloads them: the student pastes the
 * transcript from YouTube's own transcript panel, or the source fails with the
 * honest "This video doesn't have usable captions." message.
 */
const youtubeSourceSchema = z.object({
  type: z.literal('youtube'),
  title: z.string().trim().min(1).max(120).optional(),
  url: z.string().trim().min(5).max(500),
  transcript: z.string().trim().max(50_000).optional(),
});

/** Generation settings: the only knobs the student gets (kept deliberately small). */
export const generationSettingsSchema = z.object({
  flashcards: z.coerce.number().int().min(3).max(30).optional(),
  practice: z.coerce.number().int().min(3).max(30).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  language: z.enum(['nl', 'en']).optional(),
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
  youtubeSourceSchema,
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
  source: z.discriminatedUnion('type', [
    textSourceSchema,
    pdfSourceSchema,
    setSourceSchema,
    youtubeSourceSchema,
  ]),
  /** Set by "Import anyway" after the duplicate warning. */
  allowDuplicate: z.boolean().default(false),
  /** Optional generation settings stored with the run. */
  settings: generationSettingsSchema.optional(),
});

/**
 * Multipart import: the same pack fields, plus the kind of file that is being
 * uploaded. The file itself is validated by the upload middleware.
 */
export const importUploadSchema = z.object({
  title: titleSchema,
  kind: z.enum(['pdf', 'powerpoint', 'image', 'audio']),
  subjectId: z.string().uuid('Invalid subject').nullable().optional(),
  description: z.string().trim().max(2000).default(''),
  level: z.string().trim().max(60).default(''),
  examDate: examDateSchema.optional(),
  allowDuplicate: z
    .union([z.boolean(), z.enum(['true', 'false']).transform((value) => value === 'true')])
    .default(false),
  flashcards: z.coerce.number().int().min(3).max(30).optional(),
  practice: z.coerce.number().int().min(3).max(30).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  language: z.enum(['nl', 'en']).optional(),
});

/** Adding one source (file or YouTube) to an existing pack. */
export const sourceUploadSchema = z.object({
  kind: z.enum(['pdf', 'powerpoint', 'image', 'audio']),
  title: z.string().trim().min(1).max(160).optional(),
  flashcards: z.coerce.number().int().min(3).max(30).optional(),
  practice: z.coerce.number().int().min(3).max(30).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  language: z.enum(['nl', 'en']).optional(),
});

export const sourceYouTubeSchema = z.object({
  url: z.string().trim().min(5).max(500),
  transcript: z.string().trim().max(50_000).optional(),
  title: z.string().trim().min(1).max(160).optional(),
  settings: generationSettingsSchema.optional(),
});

/**
 * Starting (or retrying) processing for material that is already stored.
 * `stage` retries exactly one pipeline stage ("Retry extraction", "Retry
 * generation") without re-uploading anything else.
 */
export const processPackSchema = z.object({
  sourceId: z.string().uuid('Invalid source id').nullable().optional(),
  stage: z
    .enum(['extract', 'normalize', 'analyze', 'generate', 'review', 'plan'])
    .nullable()
    .optional(),
  settings: generationSettingsSchema.optional(),
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
  settings: generationSettingsSchema.optional(),
});

/** The review bundle: everything generated at once, quality-checked. */
export const generateBundleSchema = z.object({
  sourceId: z.string().uuid('Invalid source id').nullable().optional(),
  settings: generationSettingsSchema.optional(),
});

/** Regenerating exactly one item in the review screen. */
export const regenerateItemSchema = z.object({
  kind: z.enum(['flashcard', 'question', 'concept']),
  current: z.record(z.unknown()).default({}),
  sourceId: z.string().uuid('Invalid source id').nullable().optional(),
  settings: generationSettingsSchema.optional(),
});

/**
 * Optional provenance a reviewed item may carry (multi-source packs). The
 * backend verifies it again; the review screen can pass through what the
 * generator produced, so "Generated from slide 8" survives the confirmation.
 */
const provenanceFields = {
  sourceId: z.string().uuid().nullable().optional(),
  refLabel: z.string().trim().max(160).nullable().optional(),
  conceptId: z.string().uuid().nullable().optional(),
  importance: z.number().min(0).max(1).nullable().optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).nullable().optional(),
};

const editableConceptSchema = z.object({
  name: z.string().trim().min(2).max(200),
  explanation: z.string().trim().max(1200).default(''),
  ...provenanceFields,
});

const editableCardSchema = z.object({
  front: z.string().trim().min(1).max(2000),
  back: z.string().trim().min(1).max(4000),
  ...provenanceFields,
});

const editableQuestionSchema = z.object({
  questionType: z.enum(['multiple_choice', 'true_false', 'short_answer']),
  prompt: z.string().trim().min(3).max(2000),
  correctAnswer: z.string().trim().min(1).max(2000),
  options: z.array(z.string().trim().min(1).max(300)).min(2).max(6).nullable().default(null),
  explanation: z.string().trim().max(1200).default(''),
  ...provenanceFields,
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
  /**
   * Where the tutor was opened from — a concept, or a concept inside a study
   * session. Optional: the plain pack tutor keeps working without it.
   */
  context: z
    .object({
      conceptId: z.string().uuid('Invalid concept id').optional(),
      sessionId: z.string().uuid('Invalid study session id').optional(),
      itemId: z.string().uuid('Invalid session item id').optional(),
    })
    .optional(),
});

export type CreatePackBody = z.infer<typeof createPackSchema>;
export type ImportPackBody = z.infer<typeof importPackSchema>;
export type ProcessPackBody = z.infer<typeof processPackSchema>;
export type GenerationSettingsBody = z.infer<typeof generationSettingsSchema>;
export type UpdatePackBody = z.infer<typeof updatePackSchema>;
export type AddSourceBody = z.infer<typeof addSourceSchema>;
export type ImportUploadBody = z.infer<typeof importUploadSchema>;
export type SourceUploadBody = z.infer<typeof sourceUploadSchema>;
export type SourceYouTubeBody = z.infer<typeof sourceYouTubeSchema>;
export type GenerateBundleBody = z.infer<typeof generateBundleSchema>;
export type RegenerateItemBody = z.infer<typeof regenerateItemSchema>;
export type GenerateBody = z.infer<typeof generateSchema>;
export type ApplyContentBody = z.infer<typeof applyContentSchema>;
export type CreateTestBody = z.infer<typeof createTestSchema>;
export type SubmitTestBody = z.infer<typeof submitTestSchema>;
export type TutorBody = z.infer<typeof tutorSchema>;
