import { z } from 'zod';

export const createReportSchema = z.object({
  targetType: z.enum(['study_set', 'card', 'profile']),
  targetId: z.string().uuid('Invalid target'),
  reason: z.string().trim().min(1, 'A reason is required').max(120),
  details: z.string().trim().max(2000).nullable().optional(),
});

export const reportParamsSchema = z.object({ reportId: z.string().uuid('Invalid report id') });

export const adminListQuerySchema = z.object({
  status: z.enum(['open', 'resolved', 'dismissed']).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export const resolveReportSchema = z.object({
  status: z.enum(['resolved', 'dismissed']),
});

export const setRoleSchema = z.object({
  role: z.enum(['user', 'admin']),
});

export const moderateSetSchema = z.object({
  action: z.enum(['unpublish', 'restore']),
});

export const adminUserParamsSchema = z.object({ userId: z.string().uuid('Invalid user id') });

export type CreateReportBody = z.infer<typeof createReportSchema>;
export type AdminListQuery = z.infer<typeof adminListQuerySchema>;
export type ResolveReportBody = z.infer<typeof resolveReportSchema>;
export type SetRoleBody = z.infer<typeof setRoleSchema>;
export type ModerateSetBody = z.infer<typeof moderateSetSchema>;
