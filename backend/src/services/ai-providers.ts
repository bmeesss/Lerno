/**
 * AI provider layer — one contract, two providers.
 *
 *   groq     · primary  · Groq chat completions via the existing `groq-sdk` client
 *   cerebras · fallback · Cerebras Inference, OpenAI-compatible `/v1/chat/completions`
 *
 * Why this file exists: every Lerno AI feature must keep working when one
 * upstream provider is rate-limited or down, *without* a second AI
 * implementation somewhere else in the codebase. So the provider-specific parts
 * (base URL, model name, credentials, HTTP client, error shape) live here and
 * nowhere else; `ai-completion.ts` runs the Groq → Cerebras decision on top.
 *
 * Security: both keys are read from config (server-side only), passed as an
 * `Authorization` header, and never logged, returned or shipped to the client.
 * Upstream response bodies and messages never leave this module — failures are
 * re-thrown as `ProviderError`s with a message we wrote ourselves.
 *
 * Both providers are OpenAI-compatible chat completion APIs, so Cerebras reuses
 * the protocol (same request body, same `choices[0].message.content`) over the
 * built-in `fetch` — no extra SDK, and the same params object that Groq gets.
 */
import Groq from 'groq-sdk';
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
} from 'groq-sdk/resources/chat/completions.js';
import { config } from '../config.js';
import { ApiError, errors } from '../lib/errors.js';

export type AiProviderId = 'groq' | 'cerebras';

/** One provider answer, normalized so callers cannot tell the providers apart. */
export interface ProviderAnswer {
  text: string;
  /** Model that actually answered (for logs; never shown to students). */
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
}

export interface AiProvider {
  readonly id: AiProviderId;
  /** True when this provider has a usable server-side credential. */
  isConfigured(): boolean;
  /** Model to ask for when a request does not pin one. */
  defaultModel(): string;
  /**
   * One non-streaming chat completion. Rejects with a provider-shaped error
   * (see `ProviderError`) — never with an upstream message or body.
   */
  complete(
    params: ChatCompletionCreateParamsNonStreaming,
    options: { signal: AbortSignal },
  ): Promise<ProviderAnswer>;
}

/**
 * An upstream failure shaped like the ones the Groq SDK throws: `status`,
 * `name` and `code` are enough for both the error mapper and the fallback
 * decision, so one implementation covers every provider.
 *
 * The message is ours (never the upstream body): it can be logged safely.
 */
export class ProviderError extends Error {
  readonly status: number | null;
  readonly code: string | null;

  constructor(options: {
    name: string;
    message: string;
    status?: number | null;
    code?: string | null;
  }) {
    super(options.message);
    this.name = options.name;
    this.status = options.status ?? null;
    this.code = options.code ?? null;
  }
}

/* -------------------------------------------------------------------------- */
/* Error classification: "should this request go to the fallback provider?"    */
/* -------------------------------------------------------------------------- */

/**
 * HTTP statuses that mean "provider-side, try again elsewhere": rate limits,
 * conflicts, and every flavour of 5xx (including Cloudflare's 52x).
 */
const TRANSIENT_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]);
/**
 * Provider-side problems our own code cannot fix and that another provider
 * solves: rejected/expired credentials, a retired model, permission loss.
 */
const PROVIDER_SIDE_STATUS = new Set([401, 403, 404]);
/** Our own malformed request — it would fail at the fallback provider too. */
const CLIENT_SIDE_STATUS = new Set([400, 405, 406, 413, 414, 415, 422]);

const NETWORK_CODE =
  /^(?:ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNABORTED|EPIPE|EHOSTUNREACH|ENETUNREACH|ABORT_ERR|UND_ERR)/;
const TIMEOUT_NAMES = new Set([
  'APIConnectionTimeoutError',
  'APIUserAbortError',
  'AbortError',
  'TimeoutError',
]);
const CONNECTION_NAMES = new Set(['APIConnectionError', 'FetchError']);
const TIMEOUT_MESSAGE = /timed?\s?out|timeout/i;
const CONNECTION_MESSAGE = /connection error|fetch failed|socket hang up|network/i;

/** Why a provider call failed — non-sensitive, safe for logs. */
export type ProviderFailureReason =
  'rate_limit' | 'timeout' | 'network' | 'provider_unavailable' | 'invalid_request' | 'unknown';

function fieldOf(error: unknown, key: string): unknown {
  return typeof error === 'object' && error !== null
    ? (error as Record<string, unknown>)[key]
    : undefined;
}

function nameOf(error: unknown): string {
  if (error instanceof Error && typeof error.name === 'string') return error.name;
  return '';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : '';
}

function statusOf(error: unknown): number | null {
  const status = fieldOf(error, 'status');
  return typeof status === 'number' ? status : null;
}

/** The error code, or the code of the wrapped cause (Node's `fetch failed`). */
function codeOf(error: unknown): string | null {
  const code = fieldOf(error, 'code');
  if (typeof code === 'string' && code) return code;
  const cause = fieldOf(error, 'cause');
  const causeCode = fieldOf(cause, 'code');
  if (typeof causeCode === 'string' && causeCode) return causeCode;
  return null;
}

function isTimeoutError(error: unknown): boolean {
  const name = nameOf(error);
  if (TIMEOUT_NAMES.has(name)) return true;
  const code = codeOf(error);
  if (code === 'ETIMEDOUT' || code === 'ECONNABORTED' || code === 'ABORT_ERR') return true;
  return TIMEOUT_MESSAGE.test(messageOf(error));
}

function isNetworkError(error: unknown): boolean {
  const name = nameOf(error);
  if (CONNECTION_NAMES.has(name)) return true;
  const code = codeOf(error);
  if (code && NETWORK_CODE.test(code)) return true;
  // Node's fetch rejects with `TypeError: fetch failed` and a wrapped cause.
  if (name === 'TypeError' && CONNECTION_MESSAGE.test(messageOf(error))) return true;
  return CONNECTION_MESSAGE.test(messageOf(error));
}

/**
 * Classifies a failed provider call. Deliberately conservative: anything that is
 * not recognizably an upstream/transport problem is `unknown`, and `unknown`
 * never triggers the fallback.
 */
export function classifyProviderError(error: unknown): ProviderFailureReason {
  // Our own already-clean errors (missing key, rate-limited student, …) are
  // decisions we made, not provider failures — never forward them.
  if (error instanceof ApiError) return 'unknown';
  if (isTimeoutError(error)) return 'timeout';
  const status = statusOf(error);
  if (status === 429) return 'rate_limit';
  if (status !== null && TRANSIENT_STATUS.has(status)) return 'provider_unavailable';
  if (status !== null && PROVIDER_SIDE_STATUS.has(status)) return 'provider_unavailable';
  if (isNetworkError(error)) return 'network';
  if (status !== null && CLIENT_SIDE_STATUS.has(status)) return 'invalid_request';
  return 'unknown';
}

/**
 * True when the same request may be retried once at another provider: rate
 * limits, timeouts, network failures and provider-side unavailability.
 *
 * False for our own errors and for request/validation failures — a malformed
 * request or a programming mistake must surface as-is instead of being masked
 * by a second provider (and must never cost a second upstream call).
 */
export function isTransientProviderError(error: unknown): boolean {
  const reason = classifyProviderError(error);
  return (
    reason === 'rate_limit' ||
    reason === 'timeout' ||
    reason === 'network' ||
    reason === 'provider_unavailable'
  );
}

/* -------------------------------------------------------------------------- */
/* Groq (primary)                                                             */
/* -------------------------------------------------------------------------- */

let cachedGroqClient: Groq | null = null;
let cachedGroqClientKey = '';

/** Reuses one client (and its HTTP connections) instead of building one per request. */
export function getGroqClient(apiKey: string): Groq {
  if (!cachedGroqClient || cachedGroqClientKey !== apiKey) {
    cachedGroqClient = new Groq({
      apiKey,
      timeout: config.groqTimeoutMs,
      maxRetries: config.groqMaxRetries,
    });
    cachedGroqClientKey = apiKey;
  }
  return cachedGroqClient;
}

/** Returns the configured Groq key or throws the safe "AI unavailable" error. */
export function requireGroqKey(): string {
  const apiKey = config.groqApiKey;
  if (!apiKey) {
    // Checked per call (not at boot) so the rest of the API works without AI.
    throw errors.aiUnavailable('Lerno AI is not available right now. Please try again later.');
  }
  return apiKey;
}

function answerFromGroq(
  completion: ChatCompletion | null | undefined,
  params: ChatCompletionCreateParamsNonStreaming,
): ProviderAnswer {
  const usage = completion?.usage;
  return {
    text: completion?.choices?.[0]?.message?.content?.trim() ?? '',
    model: params.model,
    inputTokens: usage?.prompt_tokens ?? null,
    outputTokens: usage?.completion_tokens ?? null,
    reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? null,
    totalTokens: usage?.total_tokens ?? null,
  };
}

export const groqProvider: AiProvider = {
  id: 'groq',

  isConfigured: () => Boolean(config.groqApiKey),

  defaultModel: () => config.groqModel,

  async complete(params, { signal }) {
    const apiKey = requireGroqKey();
    const completion = await getGroqClient(apiKey).chat.completions.create(params, { signal });
    return answerFromGroq(completion, params);
  },
};

/* -------------------------------------------------------------------------- */
/* Cerebras (fallback)                                                        */
/* -------------------------------------------------------------------------- */

/** OpenAI-compatible path appended to `CEREBRAS_BASE_URL` (…/v1). */
const CEREBRAS_CHAT_PATH = '/chat/completions';

/** Small pause before an *optional* client-level retry; never a retry loop. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });
}

/**
 * The request signal: aborts when the caller aborts *or* when the provider
 * budget runs out (whichever comes first). Written by hand instead of
 * `AbortSignal.any` so the backend keeps running on every Node 20 release.
 */
function withTimeout(
  callerSignal: AbortSignal,
  timeoutMs: number,
): { signal: AbortSignal; timedOut: () => boolean; dispose: () => void } {
  const controller = new AbortController();
  let timedOut = false;
  const onCallerAbort = (): void => controller.abort();
  if (callerSignal.aborted) controller.abort();
  else callerSignal.addEventListener('abort', onCallerAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  timer.unref?.();

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      callerSignal.removeEventListener('abort', onCallerAbort);
    },
  };
}

/** Maps a thrown fetch/abort error to the same shapes the Groq SDK produces. */
function connectionError(
  error: unknown,
  timing: { timedOut: () => boolean },
  callerSignal: AbortSignal,
): ProviderError {
  if (timing.timedOut() && !callerSignal.aborted) {
    return new ProviderError({
      name: 'APIConnectionTimeoutError',
      message: 'Cerebras request timed out',
      code: 'ETIMEDOUT',
    });
  }
  if (callerSignal.aborted) {
    return new ProviderError({
      name: 'APIUserAbortError',
      message: 'Cerebras request aborted',
      code: 'ABORT_ERR',
    });
  }
  return new ProviderError({
    name: 'APIConnectionError',
    message: 'Cerebras connection error',
    code: codeOf(error),
  });
}

/** Text of an OpenAI-compatible message: a string, or joined text parts. */
function messageText(message: unknown): string {
  const content = fieldOf(message, 'content');
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof fieldOf(part, 'text') === 'string' ? fieldOf(part, 'text') : ''))
      .filter(Boolean)
      .join(' ')
      .trim();
  }
  return '';
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function answerFromCerebras(payload: unknown, model: string): ProviderAnswer {
  const choices = fieldOf(payload, 'choices');
  const choice: unknown = Array.isArray(choices) ? choices[0] : null;
  const usage = fieldOf(payload, 'usage');
  const details = fieldOf(usage, 'completion_tokens_details');
  return {
    text: messageText(fieldOf(choice, 'message')),
    model,
    inputTokens: numberOrNull(fieldOf(usage, 'prompt_tokens')),
    outputTokens: numberOrNull(fieldOf(usage, 'completion_tokens')),
    // Cerebras reports reasoning tokens in `completion_tokens_details`, some
    // OpenAI-compatible builds at the top level; read both, never guess.
    reasoningTokens:
      numberOrNull(fieldOf(details, 'reasoning_tokens')) ??
      numberOrNull(fieldOf(usage, 'reasoning_tokens')),
    totalTokens: numberOrNull(fieldOf(usage, 'total_tokens')),
  };
}

async function cerebrasOnce(
  params: ChatCompletionCreateParamsNonStreaming,
  callerSignal: AbortSignal,
): Promise<ProviderAnswer> {
  const timing = withTimeout(callerSignal, config.cerebrasTimeoutMs);

  let response: Response;
  try {
    response = await fetch(`${config.cerebrasBaseUrl}${CEREBRAS_CHAT_PATH}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${config.cerebrasApiKey}`,
      },
      // The body is the same OpenAI-compatible body Groq receives, apart from
      // the provider's own model name.
      body: JSON.stringify({ ...params, stream: false }),
      signal: timing.signal,
    });
  } catch (error) {
    throw connectionError(error, timing, callerSignal);
  } finally {
    timing.dispose();
  }

  if (!response.ok) {
    // The upstream body/message stays server-side.
    throw new ProviderError({
      name: 'APIError',
      message: `Cerebras responded with HTTP ${response.status}`,
      status: response.status,
      code: 'HTTP_ERROR',
    });
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ProviderError({
      name: 'APIError',
      message: 'Cerebras returned a non-JSON response',
      status: response.status,
      code: 'INVALID_RESPONSE',
    });
  }

  return answerFromCerebras(payload, params.model);
}

export const cerebrasProvider: AiProvider = {
  id: 'cerebras',

  isConfigured: () => Boolean(config.cerebrasApiKey),

  defaultModel: () => config.cerebrasModel,

  async complete(params, { signal }) {
    if (!config.cerebrasApiKey) {
      throw errors.aiUnavailable('Lerno AI is not available right now. Please try again later.');
    }
    let lastError: unknown;
    for (let attempt = 0; attempt <= config.cerebrasMaxRetries; attempt += 1) {
      try {
        return await cerebrasOnce(params, signal);
      } catch (error) {
        lastError = error;
        if (attempt === config.cerebrasMaxRetries || !isTransientProviderError(error)) throw error;
        await delay(250 * (attempt + 1));
      }
    }
    throw lastError;
  },
};

/**
 * The fallback provider: the only provider `ai-completion.ts` may switch to,
 * and only after a transient primary failure.
 */
export const fallbackProvider: AiProvider = cerebrasProvider;
