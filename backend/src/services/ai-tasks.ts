/**
 * Shared AI task runners — the single implementation of "run one configured AI
 * task" used by every Lerno AI feature (study packs, AI Studio, set actions).
 *
 * Two shapes exist:
 *  - `runTextAiTask`      → free text answer (chat, explanations, tutor)
 *  - `runStructuredAiTask` → JSON answer, parsed defensively and validated with
 *    a Zod schema, retried a bounded number of times
 *
 * Both apply the same safety pipeline before their result leaves this module:
 * secret/system-prompt guard → cleaning → logging that never contains the
 * prompt or the answer.
 */
import type { z } from 'zod';
import type { AiContextSource } from '../lib/ai-context-source.js';
import { guardSecretLeak } from '../lib/ai-guard.js';
import { describeAiJsonFailure, parseAiJson, type AiJsonFailure } from '../lib/ai-json.js';
import { cleanAiText } from '../lib/ai-text.js';
import { errors } from '../lib/errors.js';
import { logAiAction, requestChat, type ChatResult } from './ai-completion.js';
import type { AiProviderId } from './ai-providers.js';
import { AI_TASKS, taskMessages, type AiTaskName } from './ai-prompts.js';

export interface AiTaskRunOptions {
  task: AiTaskName;
  /** One compact payload; never raw user input interpolated into the system prompt. */
  payload: string;
  contextSource?: AiContextSource;
  maxOutputTokens?: number;
  temperature?: number;
  /** Non-sensitive metadata for structured logs (ids, counts, flags). */
  logMeta?: Record<string, unknown>;
}

export interface TextTaskResult {
  text: string;
  result: ChatResult;
}

/** Runs a free-text task and returns guarded, cleaned text. */
export async function runTextAiTask(options: AiTaskRunOptions): Promise<TextTaskResult> {
  const taskConfig = AI_TASKS[options.task];
  const result = await requestChat({
    action: options.task,
    messages: taskMessages(
      options.task,
      options.payload,
      options.contextSource ?? 'none',
    ),
    maxOutputTokens: options.maxOutputTokens ?? taskConfig.maxOutputTokens,
    temperature: options.temperature ?? taskConfig.temperature,
  });

  if (!result.text.trim()) {
    logAiAction(options.task, result, 'invalid', { ...options.logMeta, reason: 'empty' });
    throw errors.aiError();
  }

  const safe = guardSecretLeak(result.text);
  logAiAction(options.task, result, safe === result.text ? 'ok' : 'blocked', options.logMeta ?? {});
  return { text: cleanAiText(safe), result };
}

export interface StructuredTaskOptions<S extends z.ZodTypeAny> extends AiTaskRunOptions {
  schema: S;
  /** Extra acceptance rule on top of the schema (e.g. exact item count). */
  validCount?: (value: z.infer<S>) => boolean;
}

export interface StructuredTaskResult<S extends z.ZodTypeAny> {
  data: z.infer<S>;
  result: ChatResult;
}

/**
 * Runs a JSON task. Unusable output is retried `parseAttempts` times and then
 * reported as `AI_INVALID_CONTENT` — model text is never returned raw.
 */
export async function runStructuredAiTask<S extends z.ZodTypeAny>(
  options: StructuredTaskOptions<S>,
): Promise<StructuredTaskResult<S>> {
  const taskConfig = AI_TASKS[options.task];
  let failure: AiJsonFailure = { ok: false, reason: 'empty' };
  /**
   * Provider this user action has already switched to. When the primary failed
   * on one attempt, the remaining parse attempts stay on the provider that
   * answered: one action never re-tries a provider that is down, and never
   * falls back twice.
   */
  let preferProvider: AiProviderId | undefined;

  for (let attempt = 1; attempt <= taskConfig.parseAttempts; attempt += 1) {
    const result = await requestChat({
      action: options.task,
      messages: taskMessages(
        options.task,
        options.payload,
        options.contextSource ?? 'none',
      ),
      maxOutputTokens: options.maxOutputTokens ?? taskConfig.maxOutputTokens,
      temperature: options.temperature ?? taskConfig.temperature,
      jsonMode: taskConfig.json,
      preferProvider,
    });
    preferProvider = result.provider === 'groq' ? preferProvider : result.provider;

    const parsed = parseAiJson(guardSecretLeak(result.text), options.schema);
    if (parsed.ok && (!options.validCount || options.validCount(parsed.data))) {
      logAiAction(options.task, result, 'ok', { ...options.logMeta, attempt });
      return { data: parsed.data, result };
    }

    failure = parsed.ok ? { ok: false, reason: 'schema' } : parsed;
    logAiAction(options.task, result, 'invalid', {
      ...options.logMeta,
      attempt,
      reason: failure.reason,
    });
  }

  throw errors.aiInvalidContent(describeAiJsonFailure(failure));
}

export { cleanAiText };
