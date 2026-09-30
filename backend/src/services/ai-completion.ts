/**
 * Low-level AI completion helper shared by every Lerno AI feature
 * (free chat, set actions, generation, evaluation).
 *
 * Responsibilities:
 * - one cached client per provider (connection reuse); the providers themselves
 *   live in `ai-providers.ts` (Groq primary, Cerebras fallback)
 * - missing Groq key → clean AI_UNAVAILABLE, upstream failures → safe mapped errors
 * - a hard timeout (next to the client timeout) so no request hangs the API
 * - at most *one* fallback attempt: a transient Groq failure is retried once at
 *   Cerebras with the exact same request and context; both failing returns the
 *   same clean error the student saw before the fallback existed
 * - structured logging per action: action, provider, model, reasoning effort,
 *   duration, tokens, outcome — never the prompt or the answer
 * - the request body is built in one place (`buildChatParams`), so the reasoning
 *   effort, output budget and temperature are identical for every provider and
 *   in the live audit script
 *
 * Never logs: an API key, the prompt, or the answer.
 */
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from 'groq-sdk/resources/chat/completions.js';
import { config } from '../config.js';
import { ApiError, errors } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import {
  classifyProviderError,
  fallbackProvider,
  groqProvider,
  isTransientProviderError,
  type AiProvider,
  type AiProviderId,
  type ProviderAnswer,
} from './ai-providers.js';
import { REASONING_RESERVE, resolveReasoningEffort, type ReasoningEffort } from './ai-reasoning.js';

// Re-exported so existing importers (transcription, OCR, scripts) keep working.
export { getGroqClient, requireGroqKey } from './ai-providers.js';

/** A text part or an image part (multimodal OCR asks for an image). */
export type ConversationContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export type ConversationMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | ConversationContentPart[];
};

interface ProviderErrorShape {
  status?: unknown;
  name?: unknown;
  code?: unknown;
  message?: unknown;
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const shape = error as unknown as ProviderErrorShape;
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
 * Used for every provider, so Groq and Cerebras failures look identical.
 */
export function mapGroqError(error: unknown): ApiError {
  if (isTimeoutError(error)) return errors.aiTimeout();

  const status = (error as unknown as ProviderErrorShape)?.status;
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
  /**
   * May this request be retried once at the fallback provider (Cerebras) after a
   * *transient* primary failure? Default: yes. Requests that pin a model only
   * one provider serves (image OCR) opt out.
   */
  fallback?: boolean;
  /**
   * Start at this provider instead of the primary. Set by a caller whose earlier
   * attempt in the same user action already failed at the primary, so a task
   * never re-tries a provider that is known to be down for that action. Ignored
   * when the fallback is disabled or not configured.
   */
  preferProvider?: AiProviderId;
}

export interface ChatResult {
  text: string;
  /** Model that actually answered (for logs; never shown to students). */
  model: string;
  /** Provider that actually answered (for logs; never shown to students). */
  provider: AiProviderId;
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
 * The exact request body for one call, identical for every provider apart from
 * the model name. Kept separate from `requestChat` so the live audit script
 * measures the very same settings production sends.
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

/** How long one call to this provider may take, including its own retries. */
function watchdogMs(provider: AiProvider): number {
  const timeout =
    provider.id === 'groq' ? config.groqTimeoutMs : config.cerebrasTimeoutMs;
  const retries = provider.id === 'groq' ? config.groqMaxRetries : config.cerebrasMaxRetries;
  return timeout * (retries + 1) + 2000;
}

/** Sends one request to one provider, with a watchdog on top of its own timeout. */
async function callProvider(
  provider: AiProvider,
  request: ChatRequest,
  params: ChatCompletionCreateParamsNonStreaming,
): Promise<ProviderAnswer> {
  // The model belongs to the provider: Groq answers with `GROQ_MODEL`, Cerebras
  // with `CEREBRAS_MODEL`; everything else (prompt, context, sampling, budget)
  // is the identical body.
  const providerParams: ChatCompletionCreateParamsNonStreaming = {
    ...params,
    model: request.model ?? provider.defaultModel(),
  };

  const controller = new AbortController();
  const abortAfter = setTimeout(() => controller.abort(), watchdogMs(provider));
  abortAfter.unref?.();
  try {
    return await provider.complete(providerParams, { signal: controller.signal });
  } finally {
    clearTimeout(abortAfter);
  }
}

/** The provider a request starts with. */
function primaryProvider(request: ChatRequest): AiProvider {
  const wantsFallback = (request.fallback ?? true) && request.preferProvider === 'cerebras';
  return wantsFallback && fallbackProvider.isConfigured() ? fallbackProvider : groqProvider;
}

/** True when a failed primary attempt may be retried once at the fallback. */
function mayFallBack(primary: AiProvider, request: ChatRequest, error: unknown): boolean {
  if (primary.id !== groqProvider.id) return false;
  if (request.fallback === false) return false;
  if (!fallbackProvider.isConfigured()) return false;
  return isTransientProviderError(error);
}

function toResult(
  answer: ProviderAnswer,
  provider: AiProviderId,
  reasoningEffort: ReasoningEffort | null,
  durationMs: number,
): ChatResult {
  return {
    text: answer.text,
    model: answer.model,
    provider,
    durationMs,
    inputTokens: answer.inputTokens,
    outputTokens: answer.outputTokens,
    reasoningTokens: answer.reasoningTokens,
    totalTokens: answer.totalTokens,
    reasoningEffort,
  };
}

/**
 * Sends one chat completion and returns the trimmed text (never throws raw
 * upstream errors).
 *
 * Provider policy: Groq answers first; if it fails in a way another provider can
 * fix (rate limit, timeout, network, provider-side outage) the *same* request is
 * sent to Cerebras exactly once. If Cerebras also fails, the mapped Groq error
 * is thrown — the same clean error as before the fallback existed. Failures we
 * caused ourselves (bad request, validation, missing key) never switch provider.
 */
export async function requestChat(request: ChatRequest): Promise<ChatResult> {
  const startedAt = Date.now();
  const params = buildChatParams(request);
  const reasoningEffort = resolveReasoningEffort(request);
  const primary = primaryProvider(request);

  try {
    const answer = await callProvider(primary, request, params);
    return toResult(answer, primary.id, reasoningEffort, Date.now() - startedAt);
  } catch (error) {
    // Our own clean errors (missing key, student rate limit, …) pass through
    // untouched — they are decisions, not provider failures.
    if (error instanceof ApiError) throw error;

    const mapped = mapGroqError(error);

    // Without a fallback the failure is logged exactly like before, and the
    // action carries on failing (`ai.action.failed` keeps its old meaning).
    if (!mayFallBack(primary, request, error)) {
      logActionFailed(request, params.model, reasoningEffort, startedAt, mapped);
      throw mapped;
    }

    // With a fallback, one line explains *why* the provider switch happens —
    // and no failure line is logged unless the action really fails.
    const fallbackStartedAt = Date.now();
    logger.info('ai.provider.fallback', {
      action: request.action,
      from: primary.id,
      to: fallbackProvider.id,
      reason: classifyProviderError(error),
      errorCode: mapped.code,
      httpStatus: mapped.status,
    });

    try {
      const answer = await callProvider(fallbackProvider, request, params);
      logger.info('ai.provider.fallback.completed', {
        action: request.action,
        provider: fallbackProvider.id,
        durationMs: Date.now() - fallbackStartedAt,
        outcome: 'ok',
      });
      return toResult(answer, fallbackProvider.id, reasoningEffort, Date.now() - startedAt);
    } catch (fallbackError) {
      const fallbackMapped = mapGroqError(fallbackError);
      logger.warn('ai.provider.fallback.failed', {
        action: request.action,
        provider: fallbackProvider.id,
        durationMs: Date.now() - fallbackStartedAt,
        outcome: 'error',
        errorCode: fallbackMapped.code,
        httpStatus: fallbackMapped.status,
        primaryErrorCode: mapped.code,
      });
      // Both providers failed: report the error the primary produced, so the
      // student sees the same message as before the fallback existed.
      logActionFailed(request, params.model, reasoningEffort, startedAt, mapped, fallbackMapped);
      throw mapped;
    }
  }
}

/** One `ai.action.failed` line per failed action (never per provider attempt). */
function logActionFailed(
  request: ChatRequest,
  model: string,
  reasoningEffort: ReasoningEffort | null,
  startedAt: number,
  mapped: ApiError,
  fallbackError?: ApiError,
): void {
  logger.warn('ai.action.failed', {
    action: request.action,
    provider: groqProvider.id,
    model,
    reasoningEffort,
    durationMs: Date.now() - startedAt,
    outcome: 'error',
    errorCode: mapped.code,
    httpStatus: mapped.status,
    ...(fallbackError ? { fallbackErrorCode: fallbackError.code } : {}),
  });
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
    provider: result.provider,
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
