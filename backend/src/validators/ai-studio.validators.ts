import { z } from 'zod';

const documentSourceSchema = z.object({
  type: z.enum(['text', 'pdf']),
  title: z.string().trim().min(1).max(120),
  text: z.string().trim().min(20, 'Add at least 20 characters of study material.').max(50_000),
  pageCount: z.number().int().min(1).max(100).optional(),
  extractedChars: z.number().int().min(0).max(80_000).optional(),
  truncated: z.boolean().default(false),
});

const setSourceSchema = z.object({
  type: z.literal('set'),
  setId: z.string().uuid(),
});

/** User-provided text/PDF stays in the browser session; set IDs are re-authorized per task. */
export const studioSourceSchema = z.discriminatedUnion('type', [documentSourceSchema, setSourceSchema]);

export const studioPdfTitleSchema = z.object({
  title: z.string().trim().max(120).optional(),
});

export const studioSummaryRequestSchema = z.object({ source: studioSourceSchema });

export const studioCardsRequestSchema = z.object({
  source: studioSourceSchema,
  count: z.coerce.number().int().min(3).max(30).default(10),
});

export const studioQuizRequestSchema = z.object({
  source: studioSourceSchema,
  count: z.coerce.number().int().min(3).max(15).default(10),
  types: z.array(z.enum(['multiple_choice', 'true_false', 'open'])).min(1).max(3).default([
    'multiple_choice',
    'true_false',
    'open',
  ]),
});

export const studioQuestionsRequestSchema = z.object({
  source: studioSourceSchema,
  count: z.coerce.number().int().min(3).max(15).default(10),
  difficulty: z.enum(['easy', 'normal', 'hard']).default('normal'),
});

export const studioPlanRequestSchema = z.object({
  source: studioSourceSchema,
  days: z.coerce.number().int().min(3).max(14).default(7),
  minutesPerDay: z.coerce.number().int().min(10).max(180).default(30),
});

export const studioChatRequestSchema = z.object({
  source: studioSourceSchema,
  message: z.string().trim().min(1).max(2_000),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(1_500),
      }),
    )
    .max(8)
    .default([]),
});

export type StudioActionSource = z.infer<typeof studioSourceSchema>;
export type StudioCardsRequest = z.infer<typeof studioCardsRequestSchema>;
export type StudioChatRequest = z.infer<typeof studioChatRequestSchema>;
export type StudioQuestionsRequest = z.infer<typeof studioQuestionsRequestSchema>;
export type StudioPlanRequest = z.infer<typeof studioPlanRequestSchema>;
export type StudioQuizRequest = z.infer<typeof studioQuizRequestSchema>;
