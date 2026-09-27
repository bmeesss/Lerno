import { z } from 'zod';

export const quizSubmitSchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string().uuid('Invalid question id'),
        answer: z.string().max(1000),
      }),
    )
    .min(1, 'At least one answer is required')
    .max(100),
});

export type QuizSubmitBody = z.infer<typeof quizSubmitSchema>;
