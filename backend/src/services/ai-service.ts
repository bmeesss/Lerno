/**
 * Lerno AI service — free chat with the built-in study assistant.
 *
 * The API key lives server-side only; it is never returned, logged, or shipped
 * to the frontend. Only the student's chat text is sent to Groq — no emails,
 * profile data, or other account information.
 *
 * Request pipeline:
 *   validate (route) → normalize history (bounded context) → Groq call
 *   → leak check on the answer → friendly error mapping → structured log line
 *
 * Structured learning features (set actions, generation, evaluation) live in
 * `ai-learning-service.ts` and share the low-level client in `ai-completion.ts`.
 */
import { STUDY_SYSTEM_PROMPT } from './ai-prompts.js';
import { selectChatContext, chatOutputBudget } from '../lib/ai-chat-context.js';
import { cleanAiText } from '../lib/ai-text.js';
import { config } from '../config.js';
import { errors } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import {
  MAX_CONTEXT_CHARS,
  MAX_HISTORY_ITEM_SENT_CHARS,
  MAX_HISTORY_MESSAGES_SENT,
  MAX_USER_MESSAGE_CHARS,
} from '../lib/ai-limits.js';
import { sanitizeChatText } from '../lib/ai-sanitize.js';
import { guardSecretLeak } from '../lib/ai-guard.js';
import { requestChat } from './ai-completion.js';
import type { AiChatMessage } from '../validators/ai.validators.js';

export { MAX_CONTEXT_CHARS, MAX_HISTORY_ITEM_SENT_CHARS, MAX_HISTORY_MESSAGES_SENT };
export { mapGroqError } from './ai-completion.js';
export type { ConversationMessage } from './ai-completion.js';

/**
 * How many prior messages (user + assistant combined) are sent to Groq.
 * Bounded so requests stay small and cheap; older turns are dropped.
 */
export const MAX_HISTORY_SENT = MAX_HISTORY_MESSAGES_SENT;

/**
 * System prompt for Lerno AI.
 *
 * Kept compact on purpose: it is sent with every request, so every extra
 * sentence costs tokens on all traffic. It covers tone, adaptive answer length,
 * teaching behaviour and the anti-leak rules (see docs/AI.md).
 */
export const LERNO_AI_SYSTEM_PROMPT = STUDY_SYSTEM_PROMPT;

/**
 * Builds the Groq message list: exactly one system prompt + normalized history
 * + the new message. Exported for tests so context shaping can be verified
 * without API calls.
 */
export function buildConversation(
  message: string,
  history: AiChatMessage[],
): { role: 'system' | 'user' | 'assistant'; content: string }[] {
  // Sanitizing never invents text: if nothing survives, the trimmed original is
  // used so the student's question is still answered.
  const safeMessage =
    sanitizeChatText(message, MAX_USER_MESSAGE_CHARS) ||
    message.trim().slice(0, MAX_USER_MESSAGE_CHARS);
  const { messages, level } = selectChatContext(safeMessage, history);

  const conversation: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: LERNO_AI_SYSTEM_PROMPT + (level ? ` Level: ${level}.` : '') },
  ];
  for (const entry of messages) {
    conversation.push({ role: entry.role, content: entry.content });
  }
  conversation.push({ role: 'user', content: safeMessage });
  return conversation;
}

export interface AiChatInput {
  /** The student's new question (validated, non-empty, bounded). */
  message: string;
  /** Prior turns of this conversation, newest last. */
  history: AiChatMessage[];
}

/** Blocks answers that would leak the system prompt or a secret. */
export function guardReply(reply: string): string {
  return guardSecretLeak(reply);
}

/** Asks Lerno AI and returns only the assistant's reply text. */
export async function askLernoAi(input: AiChatInput): Promise<string> {
  const messages = buildConversation(input.message, input.history);
  const historyItems = messages.length - 2;
  const historyChars = messages
    .slice(1, -1)
    .reduce((total, message) => total + message.content.length, 0);

  const result = await requestChat({
    action: 'chat',
    messages,
    maxOutputTokens: Math.min(config.groqMaxOutputTokens, chatOutputBudget(input.message)),
    temperature: config.groqTemperature,
  });

  if (!result.text) {
    logger.warn('ai.action.failed', {
      action: 'chat',
      model: config.groqModel,
      durationMs: result.durationMs,
      outcome: 'empty',
      errorCode: 'AI_ERROR',
      historyItems,
    });
    throw errors.aiError();
  }

  const safeReply = guardReply(result.text);

  logger.info('ai.action.completed', {
    action: 'chat',
    model: config.groqModel,
    durationMs: result.durationMs,
    outcome: safeReply === result.text ? 'ok' : 'blocked',
    historyItems,
    historyChars,
    questionChars: messages[messages.length - 1]!.content.length,
    answerChars: safeReply.length,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    totalTokens: result.totalTokens,
  });

  return cleanAiText(safeReply);
}
