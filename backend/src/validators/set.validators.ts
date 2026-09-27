import { z } from 'zod';

export const subjectNameSchema = z
  .string()
  .trim()
  .min(1, 'Subject name is required')
  .max(80, 'Subject name is too long');

export const createSubjectSchema = z.object({ name: subjectNameSchema });

export const updateSubjectSchema = z.object({ name: subjectNameSchema });

export const subjectParamsSchema = z.object({ subjectId: z.string().uuid('Invalid subject id') });

export const cardContentSchema = z.object({
  question: z.string().trim().min(1, 'Question is required').max(2000),
  answer: z.string().trim().min(1, 'Answer is required').max(4000),
});

export const createSetSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(160),
  subjectId: z.string().uuid('Invalid subject').nullable().optional(),
  level: z.string().trim().max(60).default(''),
  description: z.string().trim().max(2000).default(''),
  visibility: z.enum(['private', 'public']).default('private'),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  cards: z.array(cardContentSchema).max(500).optional(),
});

export const updateSetSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    subjectId: z.string().uuid('Invalid subject').nullable().optional(),
    level: z.string().trim().max(60).optional(),
    description: z.string().trim().max(2000).optional(),
    visibility: z.enum(['private', 'public']).optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });

export const bulkCardsSchema = z.object({
  cards: z.array(cardContentSchema).min(1).max(500),
});

export const updateCardSchema = cardContentSchema
  .partial()
  .refine((value) => value.question !== undefined || value.answer !== undefined, {
    message: 'Nothing to update',
  });

export const setParamsSchema = z.object({ setId: z.string().uuid('Invalid set id') });

export const cardParamsSchema = z.object({
  setId: z.string().uuid('Invalid set id'),
  cardId: z.string().uuid('Invalid card id'),
});

export type CreateSubjectBody = z.infer<typeof createSubjectSchema>;
export type UpdateSubjectBody = z.infer<typeof updateSubjectSchema>;
export type CreateSetBody = z.infer<typeof createSetSchema>;
export type UpdateSetBody = z.infer<typeof updateSetSchema>;
export type BulkCardsBody = z.infer<typeof bulkCardsSchema>;
export type UpdateCardBody = z.infer<typeof updateCardSchema>;
