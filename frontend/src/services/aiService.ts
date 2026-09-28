import { apiRequest } from '../lib/api';

export interface AiChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiChatReply {
  reply: string;
}

/** How many prior turns the page keeps in memory and sends as history. */
export const AI_HISTORY_LIMIT = 12;

/** Same hard limit as the backend: the student's new message. */
export const AI_MAX_MESSAGE_CHARS = 2000;

/** Per history entry, matching the backend's accepted maximum. */
export const AI_MAX_HISTORY_ITEM_CHARS = 8000;

/** Give up on a hung request instead of leaving the page "loading" forever. */
export const AI_REQUEST_TIMEOUT_MS = 45_000;

/**
 * Keeps the payload small and always valid: newest turns only, and no single
 * message above the backend's limit (a long earlier answer must not break the
 * next question).
 */
export function trimHistory(history: AiChatHistoryMessage[]): AiChatHistoryMessage[] {
  return history.slice(-AI_HISTORY_LIMIT).map(({ role, content }) => ({
    role,
    content:
      content.length > AI_MAX_HISTORY_ITEM_CHARS
        ? `${content.slice(0, AI_MAX_HISTORY_ITEM_CHARS - 4).trimEnd()} […]`
        : content,
  }));
}

/**
 * Lerno AI — built-in study assistant. Talks to the Lerno backend, which is the
 * only side that contacts Groq (the API key never reaches the browser).
 */
export const aiService = {
  chat: (message: string, history: AiChatHistoryMessage[] = [], signal?: AbortSignal) =>
    apiRequest<AiChatReply>('/ai/chat', {
      method: 'POST',
      body: { message, history: trimHistory(history) },
      signal,
    }),
};
