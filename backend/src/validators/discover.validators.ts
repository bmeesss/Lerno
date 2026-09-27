import { z } from 'zod';

export const discoverQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  subject: z.string().trim().max(80).optional(),
  level: z.string().trim().max(60).optional(),
  tag: z.string().trim().max(40).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
});

export type DiscoverQuery = z.infer<typeof discoverQuerySchema>;
