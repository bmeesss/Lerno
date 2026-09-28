/**
 * Zod schemas for **structured AI output** (#11).
 *
 * Model output is never trusted. Every structured AI answer is parsed
 * defensively and then validated here before it becomes an API response, so
 * the frontend can render it without guessing.
 *
 * The schemas are intentionally strict but forgiving about the exact strings
 * the model uses (defaults + trims), because fighting the model costs more
 * tokens than normalizing its output.
 */
import { z } from 'zod';

/**
 * Whitespace-normalized text with a hard length cap. Defaulting happens before
 * the transform, so validated output is always a plain, non-optional string.
 */
function text(min: number, max: number, fallback = '') {
  return z
    .string()
    .trim()
    .max(max)
    .default(fallback)
    .transform((value) => value.replace(/\s+/g, ' ').trim())
    .refine((value) => value.length >= min, {
      message: `Text must be at least ${min} characters`,
    });
}

const key = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ');

// ---------------------------------------------------------------- questions

export const GENERATED_QUESTION_TYPES = ['open', 'multiple_choice'] as const;

export const generatedQuestionSchema = z
  .object({
    type: z.enum(GENERATED_QUESTION_TYPES).catch('open'),
    question: text(3, 200),
    answer: text(1, 300),
    hint: text(1, 200).default(''),
    options: z.array(text(1, 160)).max(4).optional(),
    correctIndex: z.number().int().min(0).max(3).optional(),
    /** 1-based index of the card (as numbered in the context) this question is based on. */
    cardRef: z.number().int().min(1).max(500).optional(),
  })
  .transform((question) => ({
    ...question,
    // Only multiple choice carries options; other types render as open input.
    options: question.type === 'multiple_choice' ? (question.options ?? []) : [],
    correctIndex:
      question.type === 'multiple_choice'
        ? (question.correctIndex ??
          (question.options ?? []).findIndex((option) => key(option) === key(question.answer)))
        : null,
  }));

export const generatedQuestionsSchema = z
  .object({
    questions: z.array(generatedQuestionSchema).min(1).max(15),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.questions.forEach((question, index) => {
      const normalized = key(question.question);
      if (seen.has(normalized)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Duplicate question',
          path: ['questions', index, 'question'],
        });
      }
      seen.add(normalized);

      if (question.type === 'multiple_choice' && question.options.length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Multiple choice needs at least two options',
          path: ['questions', index, 'options'],
        });
      }
      if (question.type === 'multiple_choice') {
        const options = question.options.map(key);
        if (new Set(options).size !== options.length) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Multiple-choice options must be distinct',
            path: ['questions', index, 'options'],
          });
        }
      }
      if (question.type === 'multiple_choice' && question.correctIndex !== null) {
        if (question.correctIndex < 0 || question.correctIndex >= question.options.length) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'correctIndex is out of range',
            path: ['questions', index, 'correctIndex'],
          });
        }
      }
    });
  });

export type GeneratedQuestion = z.infer<typeof generatedQuestionSchema>;

// ------------------------------------------------------------------ cards

export const generatedCardsSchema = z
  .object({
    title: text(1, 80),
    description: text(0, 400).default(''),
    cards: z
      .array(
        z.object({
          front: text(1, 160),
          back: text(1, 300),
        }),
      )
      .min(1)
      .max(30),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.cards.forEach((card, index) => {
      const normalized = key(card.front);
      if (seen.has(normalized)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Duplicate card',
          path: ['cards', index, 'front'],
        });
      }
      seen.add(normalized);
    });
  });

export type GeneratedCard = z.infer<typeof generatedCardsSchema>['cards'][number];

// ------------------------------------------------------------------- quiz

export const GENERATED_QUIZ_TYPES = ['multiple_choice', 'open', 'true_false'] as const;

export const generatedQuizQuestionSchema = z.object({
  type: z.enum(GENERATED_QUIZ_TYPES).catch('open'),
  question: text(3, 200),
  options: z.array(text(1, 160)).max(4).default([]),
  correctIndex: z.number().int().min(0).max(3).nullable().default(null),
  answer: text(0, 300).default(''),
  explanation: text(0, 400).default(''),
});

export const generatedQuizSchema = z
  .object({
    questions: z.array(generatedQuizQuestionSchema).min(1).max(15),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.questions.forEach((question, index) => {
      const normalized = key(question.question);
      if (seen.has(normalized)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Duplicate question',
          path: ['questions', index, 'question'],
        });
      }
      seen.add(normalized);

      if (question.type === 'multiple_choice') {
        const normalizedOptions = question.options.map((option) => key(option));
        if (new Set(normalizedOptions).size !== normalizedOptions.length) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Multiple-choice options must be distinct',
            path: ['questions', index, 'options'],
          });
        }
        if (question.options.length !== 4) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Multiple choice needs exactly 4 options',
            path: ['questions', index, 'options'],
          });
        }
        if (question.correctIndex === null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'correctIndex is required',
            path: ['questions', index, 'correctIndex'],
          });
        } else if (question.correctIndex < 0 || question.correctIndex >= question.options.length) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'correctIndex is out of range',
            path: ['questions', index, 'correctIndex'],
          });
        }
      }

      if (question.type === 'true_false') {
        const normalizedOptions = question.options.map((option) => key(option));
        const isTrueFalse =
          normalizedOptions.length === 2 &&
          normalizedOptions.includes('true') &&
          normalizedOptions.includes('false');
        if (!isTrueFalse) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'True/false questions need True and False options',
            path: ['questions', index, 'options'],
          });
        }
        if (
          question.correctIndex === null ||
          question.correctIndex < 0 ||
          question.correctIndex > 1
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'correctIndex must be 0 or 1',
            path: ['questions', index, 'correctIndex'],
          });
        }
      }

      if (question.type === 'open' && question.answer.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Open questions need an expected answer',
          path: ['questions', index, 'answer'],
        });
      }
    });
  });

export type GeneratedQuizQuestion = z.infer<typeof generatedQuizQuestionSchema>;

/** Compact, source-grounded overview for AI Study Studio. */
export const generatedSummarySchema = z
  .object({
    title: text(2, 100),
    summary: text(30, 2_000),
    keyPoints: z.array(text(5, 240)).min(3).max(8),
    terms: z
      .array(
        z.object({
          term: text(1, 80),
          definition: text(5, 300),
        }),
      )
      .max(12)
      .default([]),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.keyPoints.forEach((point, index) => {
      const normalized = key(point);
      if (seen.has(normalized)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate key point', path: ['keyPoints', index] });
      }
      seen.add(normalized);
    });
    const seenTerms = new Set<string>();
    value.terms.forEach((item, index) => {
      const normalized = key(item.term);
      if (seenTerms.has(normalized)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate term', path: ['terms', index, 'term'] });
      }
      seenTerms.add(normalized);
    });
  });


/** Key concepts extracted from study material (Study Pack foundation). */
export const generatedConceptsSchema = z
  .object({
    concepts: z
      .array(
        z.object({
          name: text(2, 120),
          explanation: text(10, 600),
          /** 1-based index of the source block this concept came from. */
          sourceRef: z.number().int().min(1).max(20).optional(),
        }),
      )
      .min(3)
      .max(20),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.concepts.forEach((concept, index) => {
      const normalized = key(concept.name);
      if (seen.has(normalized)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Duplicate concept',
          path: ['concepts', index, 'name'],
        });
      }
      seen.add(normalized);
    });
  });

export type GeneratedConcept = z.infer<typeof generatedConceptsSchema>['concepts'][number];

// ------------------------------------------------------------ study plan

export const generatedStudyPlanSchema = z
  .object({
    title: text(2, 100),
    overview: text(20, 500),
    sessions: z.array(
      z.object({
        day: z.number().int().min(1).max(14),
        focus: text(3, 140),
        activities: z.array(text(3, 180)).min(1).max(4),
        minutes: z.number().int().min(5).max(180),
      }),
    ).min(3).max(14),
  })
  .superRefine((value, ctx) => {
    const days = new Set<number>();
    value.sessions.forEach((session, index) => {
      if (days.has(session.day)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate study-plan day', path: ['sessions', index, 'day'] });
      }
      days.add(session.day);
      const activities = session.activities.map(key);
      if (new Set(activities).size !== activities.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate activity', path: ['sessions', index, 'activities'] });
      }
    });
  });

export type GeneratedStudyPlan = z.infer<typeof generatedStudyPlanSchema>;

// --------------------------------------------------------------- evaluate

export const evaluationSchema = z.object({
  verdict: z.enum(['correct', 'partial', 'incorrect']),
  feedback: text(1, 500),
  missing: text(0, 200).default(''),
});

export type AnswerEvaluation = z.infer<typeof evaluationSchema>;

// ------------------------------------------------------------------- hint

export const hintResponseSchema = z.object({
  hint: text(1, 300),
});
