/**
 * Low-level Groq completion helper shared by every Lerno AI feature
 * (free chat, set actions, generation, evaluation).
 *
 * Responsibilities:
 * - one cached Groq client (connection reuse) keyed by API key
 * - missing key → clean AI_UNAVAILABLE, upstream failures → safe mapped errors
 * - a hard timeout (next to the SDK timeout) so no request hangs the API
 * - structured logging per action: action, model, reasoning effort, duration,
 *   tokens, outcome
 * - the request body is built in one place (`buildChatParams`), so the reasoning
 *   effort, output budget and temperature are identical in production and in the
 *   live audit script
 *
 * Never logs: the API key, the prompt, or the answer.
 */
import Groq from 'groq-sdk';
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from 'groq-sdk/resources/chat/completions.js';
import { config } from '../config.js';
import { errors, type ApiError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { REASONING_RESERVE, resolveReasoningEffort, type ReasoningEffort } from './ai-reasoning.js';

/** A text part or an image part (multimodal OCR asks for an image). */
export type ConversationContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export type ConversationMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | ConversationContentPart[];
};

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
  /** Model override (used by OCR, which needs a vision-capable model). */
  model?: string;
  messages: ConversationMessage[];
  maxOutputTokens: number;
  temperature?: number;
  /** Ask the model for a JSON object (best effort — output is always validated). */
  jsonMode?: boolean;
  /**
   * Reasoning effort for this request. Omit it and the per-task default
   * (`AI_TASKS`) or the free-chat classifier decides; `GROQ_REASONING_EFFORT`
   * overrides both. Ignored by models without reasoning support.
   */
  reasoningEffort?: ReasoningEffort;
}

export interface ChatResult {
  text: string;
  /** Model that actually answered (for logs; never shown to students). */
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  /** Hidden reasoning tokens billed for this answer (null when not reported). */
  reasoningTokens: number | null;
  totalTokens: number | null;
  durationMs: number;
  /** Effort actually sent upstream, or null for models without the parameter. */
  reasoningEffort: ReasoningEffort | null;
}

/**
 * Visible-answer budget plus bounded reasoning headroom, sized by the effort
 * level that will actually be requested (GPT-OSS counts hidden reasoning against
 * the same ceiling). Free chat additionally respects
 * `GROQ_MAX_OUTPUT_TOKENS` as an absolute ceiling.
 */
export function completionBudget(
  request: Pick<ChatRequest, 'action' | 'maxOutputTokens' | 'reasoningEffort'>,
): number {
  const effort = resolveReasoningEffort(request);
  const budget = request.maxOutputTokens + (effort ? REASONING_RESERVE[effort] : 0);
  return request.action === 'chat' ? Math.min(config.groqMaxOutputTokens, budget) : budget;
}

/**
 * The exact Groq request body for one call. Kept separate from `requestChat` so
 * the live audit script measures the very same settings production sends.
 */
export function buildChatParams(request: ChatRequest): ChatCompletionCreateParamsNonStreaming {
  const reasoningEffort = resolveReasoningEffort(request);
  return {
    model: request.model ?? config.groqModel,
    messages: request.messages as ChatCompletionMessageParam[],
    max_completion_tokens: completionBudget(request),
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    temperature: request.temperature ?? config.groqTemperature,
    ...(request.jsonMode && config.groqJsonMode
      ? { response_format: { type: 'json_object' as const } }
      : {}),
  };
}

/** Sends one chat completion and returns the trimmed text (never throws raw upstream errors). */
export async function requestChat(request: ChatRequest): Promise<ChatResult> {
  const apiKey = requireGroqKey();
  const model = request.model ?? config.groqModel;

  const startedAt = Date.now();
  // Belt and braces next to the SDK timeout: covers retries too.
  const controller = new AbortController();
  const abortAfter = setTimeout(
    () => controller.abort(),
    config.groqTimeoutMs * (config.groqMaxRetries + 1) + 2000,
  );
  abortAfter.unref?.();

  let completion: Awaited<ReturnType<Groq['chat']['completions']['create']>>;
  const reasoningEffort = resolveReasoningEffort(request);
  try {
    completion = await getGroqClient(apiKey).chat.completions.create(buildChatParams(request), {
      signal: controller.signal,
    });
  } catch (err) {
    const mapped = mapGroqError(err);
    logger.warn('ai.action.failed', {
      action: request.action,
      model,
      reasoningEffort,
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
    model,
    durationMs: Date.now() - startedAt,
    inputTokens: usage?.prompt_tokens ?? null,
    outputTokens: usage?.completion_tokens ?? null,
    reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? null,
    totalTokens: usage?.total_tokens ?? null,
    reasoningEffort,
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
    model: result.model,
    reasoningEffort: result.reasoningEffort,
    durationMs: result.durationMs,
    outcome,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    reasoningTokens: result.reasoningTokens,
    totalTokens: result.totalTokens,
    answerChars: result.text.length,
    ...extra,
  });
}
