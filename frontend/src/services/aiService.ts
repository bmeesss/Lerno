import { api } from '../lib/api';

export interface AiChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiChatReply {
  reply: string;
}

/** How many prior turns the page keeps in memory and sends as history. */
export const AI_HISTORY_LIMIT = 12;

/**
 * Lerno AI — built-in study assistant. Talks to the Lerno backend, which is
 * the only side that contacts Groq (the API key never reaches the browser).
 */
export const aiService = {
  chat: (message: string, history: AiChatHistoryMessage[]) =>
    api.post<AiChatReply>('/ai/chat', { message, history }),
};
