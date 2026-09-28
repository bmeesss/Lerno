import { z } from 'zod';

/** Max characters for one chat message (kept small so Groq requests stay cheap). */
export const MAX_MESSAGE_LENGTH = 2000;

/** Max history entries accepted from the client (anything more is rejected). */
export const MAX_HISTORY_LENGTH = 30;

const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1, 'History messages cannot be empty').max(MAX_MESSAGE_LENGTH),
});

export const aiChatSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, 'Message cannot be empty')
    .max(MAX_MESSAGE_LENGTH, `Message is too long (max ${MAX_MESSAGE_LENGTH} characters)`),
  /** Prior turns of the current conversation, newest last. */
  history: z.array(chatMessageSchema).max(MAX_HISTORY_LENGTH).optional().default([]),
});

export type AiChatBody = z.infer<typeof aiChatSchema>;
export type AiChatMessage = z.infer<typeof chatMessageSchema>;
