/**
 * Low-level Groq completion helper shared by every Lerno AI feature
 * (free chat, set actions, generation, evaluation).
 *
 * Responsibilities:
 * - one cached Groq client (connection reuse) keyed by API key
 * - missing key → clean AI_UNAVAILABLE, upstream failures → safe mapped errors
 * - a hard timeout (next to the SDK timeout) so no request hangs the API
 * - structured logging per action: action, model, duration, tokens, outcome
 *
 * Never logs: the API key, the prompt, or the answer.
 */
import Groq from 'groq-sdk';
import type { ChatCompletionMessageParam } from 'groq-sdk/resources/chat/completions.js';
import { config } from '../config.js';
import { errors, type ApiError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export type ConversationMessage = { role: 'system' | 'user' | 'assistant'; content: string };

let cachedClient: Groq | null = null;
let cachedClientKey = '';

/** Reuses one client (and its HTTP connections) instead of building one per request. */
export function getGroqClient(apiKey: string): Groq {
  if (!cachedClient || cachedClientKey !== apiKey) {
    cachedClient = new Groq({
      apiKey,
      timeout: config.groqTimeoutMs,
      maxRetries: config.groqMaxRetries,
    });
    cachedClientKey = apiKey;
  }
  return cachedClient;
}

/** Returns the configured key or throws the safe "AI unavailable" error. */
export function requireGroqKey(): string {
  const apiKey = config.groqApiKey;
  if (!apiKey) {
    // Checked per call (not at boot) so the rest of the API works without AI.
    throw errors.aiUnavailable('Lerno AI is not available right now. Please try again later.');
  }
  return apiKey;
}

interface GroqErrorShape {
  status?: unknown;
  name?: unknown;
  code?: unknown;
  message?: unknown;
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const shape = error as unknown as GroqErrorShape;
  const name = typeof shape.name === 'string' ? shape.name : '';
  if (
    name === 'APIConnectionTimeoutError' ||
    name === 'APIUserAbortError' ||
    name === 'AbortError' ||
    name === 'TimeoutError'
  ) {
    return true;
  }
  if (shape.code === 'ETIMEDOUT' || shape.code === 'ECONNABORTED' || shape.code === 'ABORT_ERR') {
    return true;
  }
  return /timed?\s?out|timeout/i.test(error.message);
}

/**
 * Maps an upstream failure to a safe API error. Upstream messages, headers and
 * bodies stay server-side — the student only ever sees a generic message.
 */
export function mapGroqError(error: unknown): ApiError {
  if (isTimeoutError(error)) return errors.aiTimeout();

  const status = (error as unknown as GroqErrorShape)?.status;
  if (status === 429) {
    return errors.rateLimited('Lerno AI is busy right now. Please try again in a moment.');
  }
  // 401/403 mean our own credentials are wrong — a configuration problem, and
  // never something the student can fix or needs to know about.
  if (status === 401 || status === 403) return errors.aiUnavailable();
  if (status === 408 || status === 409) return errors.aiTimeout();
  // 400 (invalid request), 5xx and everything else: generic upstream failure.
  return errors.aiError();
}

export interface ChatRequest {
  /** Short action name used in logs (explain, summary, evaluate, …). */
  action: string;
  messages: ConversationMessage[];
  maxOutputTokens: number;
  temperature?: number;
  /** Ask the model for a JSON object (best effort — output is always validated). */
  jsonMode?: boolean;
}

export interface ChatResult {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  durationMs: number;
}

/** Visible-answer budget plus bounded reasoning headroom for the default model. */
export function completionBudget(request: Pick<ChatRequest, 'action' | 'maxOutputTokens'>): number {
  const budget = request.maxOutputTokens + (/gpt-oss/.test(config.groqModel) ? 256 : 0);
  return request.action === 'chat' ? Math.min(config.groqMaxOutputTokens, budget) : budget;
}

/** Sends one chat completion and returns the trimmed text (never throws raw upstream errors). */
export async function requestChat(request: ChatRequest): Promise<ChatResult> {
  const apiKey = requireGroqKey();

  const startedAt = Date.now();
  // Belt and braces next to the SDK timeout: covers retries too.
  const controller = new AbortController();
  const abortAfter = setTimeout(
    () => controller.abort(),
    config.groqTimeoutMs * (config.groqMaxRetries + 1) + 2000,
  );
  abortAfter.unref?.();

  let completion: Awaited<ReturnType<Groq['chat']['completions']['create']>>;
  try {
    completion = await getGroqClient(apiKey).chat.completions.create(
      {
        model: config.groqModel,
        messages: request.messages as ChatCompletionMessageParam[],
        // GPT-OSS counts hidden reasoning against the same ceiling. Reserve a
        // little headroom so a tiny hint/greeting budget still yields visible text.
        max_completion_tokens: completionBudget(request),
        ...(/gpt-oss/.test(config.groqModel) ? { reasoning_effort: 'low' as const } : {}),
        temperature: request.temperature ?? config.groqTemperature,
        ...(request.jsonMode && config.groqJsonMode
          ? { response_format: { type: 'json_object' as const } }
          : {}),
      },
      { signal: controller.signal },
    );
  } catch (err) {
    const mapped = mapGroqError(err);
    logger.warn('ai.action.failed', {
      action: request.action,
      model: config.groqModel,
      durationMs: Date.now() - startedAt,
      outcome: 'error',
      errorCode: mapped.code,
      httpStatus: mapped.status,
    });
    throw mapped;
  } finally {
    clearTimeout(abortAfter);
  }

  const text = completion?.choices?.[0]?.message?.content?.trim() ?? '';
  const usage = completion?.usage;
  return {
    text,
    durationMs: Date.now() - startedAt,
    inputTokens: usage?.prompt_tokens ?? null,
    outputTokens: usage?.completion_tokens ?? null,
    totalTokens: usage?.total_tokens ?? null,
  };
}

/** Logs one completed AI action (never the prompt or the answer). */
export function logAiAction(
  action: string,
  result: ChatResult,
  outcome: 'ok' | 'invalid' | 'blocked',
  extra: Record<string, unknown> = {},
): void {
  logger.info('ai.action.completed', {
    action,
    model: config.groqModel,
    durationMs: result.durationMs,
    outcome,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    totalTokens: result.totalTokens,
    answerChars: result.text.length,
    ...extra,
  });
}
