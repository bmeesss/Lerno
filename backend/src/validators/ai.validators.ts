import { z } from 'zod';
import {
  MAX_HISTORY_ITEM_CHARS,
  MAX_HISTORY_MESSAGES_ACCEPTED,
  MAX_HISTORY_TOTAL_CHARS,
  MAX_USER_MESSAGE_CHARS,
} from '../lib/ai-limits.js';

/** Max characters for the student's new message. */
export const MAX_MESSAGE_LENGTH = MAX_USER_MESSAGE_CHARS;

/** Max characters of one history entry (an old AI answer may be long). */
export const MAX_HISTORY_ITEM_LENGTH = MAX_HISTORY_ITEM_CHARS;

/** Max number of history entries accepted per request. */
export const MAX_HISTORY_LENGTH = MAX_HISTORY_MESSAGES_ACCEPTED;

/** Max total characters of history accepted per request. */
export const MAX_HISTORY_TOTAL_LENGTH = MAX_HISTORY_TOTAL_CHARS;

const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z
    .string()
    .trim()
    .min(1, 'History messages cannot be empty')
    .max(MAX_HISTORY_ITEM_LENGTH, 'A history message is too long'),
});

/**
 * Rejects only genuinely oversized payloads. Lengthy *conversations* are
 * allowed here and trimmed when the Groq context is built, so a long earlier
 * answer can never turn into a 400.
 */
const historySchema = z
  .array(chatMessageSchema)
  .max(MAX_HISTORY_LENGTH, `Too many history messages (max ${MAX_HISTORY_LENGTH})`)
  .refine(
    (messages) =>
      messages.reduce((total, message) => total + message.content.length, 0) <=
      MAX_HISTORY_TOTAL_LENGTH,
    { message: 'The conversation history is too large' },
  );

export const aiChatSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, 'Message cannot be empty')
    .max(MAX_MESSAGE_LENGTH, `Message is too long (max ${MAX_MESSAGE_LENGTH} characters)`),
  /** Prior turns of the current conversation, newest last. */
  history: historySchema.optional().default([]),
});

export type AiChatBody = z.infer<typeof aiChatSchema>;
export type AiChatMessage = z.infer<typeof chatMessageSchema>;
