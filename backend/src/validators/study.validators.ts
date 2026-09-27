import { z } from 'zod';

export const reviewInputSchema = z.object({
  setId: z.string().uuid('Invalid set id'),
  cardId: z.string().uuid('Invalid card id'),
  result: z.enum(['correct', 'incorrect']),
});

export const startSessionSchema = z.object({
  setId: z.string().uuid('Invalid set id').nullable().optional(),
});

export const endSessionSchema = z.object({
  cardsSeen: z.number().int().min(0).max(10_000).default(0),
});

export const sessionParamsSchema = z.object({ sessionId: z.string().uuid('Invalid session id') });

export type ReviewInput = z.infer<typeof reviewInputSchema>;
export type StartSessionBody = z.infer<typeof startSessionSchema>;
export type EndSessionBody = z.infer<typeof endSessionSchema>;
