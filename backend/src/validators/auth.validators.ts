import { z } from 'zod';

const email = z.string().trim().toLowerCase().email('A valid email is required').max(254);
const password = z.string().min(8, 'Password must be at least 8 characters').max(128);
const displayName = z
  .string()
  .trim()
  .min(1, 'Display name is required')
  .max(60, 'Display name is too long');

export const signupSchema = z.object({ email, password, displayName });
export const loginSchema = z.object({ email, password });
export const resetPasswordSchema = z.object({ email });
export const refreshSchema = z.object({ refreshToken: z.string().min(10) });

export const updateProfileSchema = z
  .object({
    displayName: displayName.optional(),
    avatarUrl: z.string().url('avatarUrl must be a valid URL').max(500).nullable().optional(),
  })
  .refine((value) => value.displayName !== undefined || value.avatarUrl !== undefined, {
    message: 'Nothing to update',
  });

export type SignupBody = z.infer<typeof signupSchema>;
export type LoginBody = z.infer<typeof loginSchema>;
export type ResetPasswordBody = z.infer<typeof resetPasswordSchema>;
export type RefreshBody = z.infer<typeof refreshSchema>;
export type UpdateProfileBody = z.infer<typeof updateProfileSchema>;
