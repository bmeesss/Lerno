import { z } from 'zod';

/** Matches the maximum cards per study set: every generated question must be submittable. */
export const MAX_QUIZ_ANSWERS = 500;

export const quizSubmitSchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string().uuid('Invalid question id'),
        answer: z.string().max(1000),
      }),
    )
    .min(1, 'At least one answer is required')
    .max(MAX_QUIZ_ANSWERS),
});

export const quizSetParamsSchema = z.object({ setId: z.string().uuid('Invalid set id') });

export type QuizSubmitBody = z.infer<typeof quizSubmitSchema>;
