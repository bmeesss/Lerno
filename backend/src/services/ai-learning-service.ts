/**
 * Lerno AI learning service — the AI features that work on the student's own
 * material (sets, cards, generated sets, quizzes, overhoor mode).
 *
 * Data isolation (#9) is enforced here, before anything reaches the model:
 *   1. the caller is authenticated (route middleware)
 *   2. `loadSetForAi` loads the set through the existing repository and applies
 *      the same visibility rule as the set endpoints (`canViewSet`): a set the
 *      user may not see is a 404 — never a different error, never data
 *   3. only that set's cards (trimmed, de-duplicated, capped) become context
 *
 * The AI never gets database access: the backend fetches the data and hands
 * over a bounded, normalized text block (`ai-context.ts`).
 */
import type { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { Database } from '../lib/db/repository.js';
import type { CardRecord, StudySetRecord } from '../lib/db/types.js';
import { errors } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { describeAiJsonFailure, parseAiJson, type AiJsonFailure } from '../lib/ai-json.js';
import { guardSecretLeak } from '../lib/ai-guard.js';
import { AI_TASKS, taskMessages, type AiTaskName } from './ai-prompts.js';
import { buildCardContext, buildSetContext, buildStudyContext } from './ai-context.js';
import { logAiAction, requestChat, type ChatResult } from './ai-completion.js';
import { canViewSet } from './set-service.js';

export interface AiSetContext {
  set: StudySetRecord;
  cards: CardRecord[];
  /** Trimmed context block handed to the model. */
  context: string;
  /** Cards included in the context (after limits). */
  contextCards: number;
  totalCards: number;
}

/**
 * Loads a set the caller is allowed to see, with its cards.
 *
 * Same semantics as the existing set endpoints: a private set of another user
 * (or a manipulated id) is reported as "Study set not found" — never as
 * unauthorized, never with any data attached.
 */
export async function loadSetForAi(
  db: Database,
  userId: string,
  setId: string,
): Promise<AiSetContext> {
  const set = await db.sets.get(setId);
  if (!set || !canViewSet(set, userId)) throw errors.notFound('Study set not found');

  const cards = await db.cards.listBySet(setId);
  if (cards.length === 0) {
    throw errors.validation('This set has no cards yet, so Lerno AI has nothing to work with.');
  }

  const context = buildSetContext(set, cards);
  return {
    set,
    cards,
    context: context.text,
    contextCards: context.cardCount,
    totalCards: context.totalCards,
  };
}

// ---------------------------------------------------------------- task runners

/**
 * Runs a task whose output is plain text (explanation, summary, card help).
 * Returns empty-text failures as normal AI errors and blocks secret leaks.
 */
async function runTextTask(
  task: AiTaskName,
  payload: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const config = AI_TASKS[task];
  const result = await requestChat({
    action: task,
    messages: taskMessages(task, payload),
    maxOutputTokens: config.maxOutputTokens,
    temperature: config.temperature,
  });

  if (!result.text) {
    logAiAction(task, result, 'invalid', { ...extra, reason: 'empty' });
    throw errors.aiError();
  }

  const safe = guardSecretLeak(result.text);
  logAiAction(task, result, safe === result.text ? 'ok' : 'blocked', extra);
  return safe;
}

/**
 * Runs a task whose output must be JSON. The answer is parsed defensively and
 * validated with `schema`; unusable output is retried a bounded number of
 * times and then reported as `AI_INVALID_CONTENT` (never raw model output).
 */
async function runStructuredTask<T>(
  task: AiTaskName,
  payload: string,
  schema: z.ZodType<T>,
  extra: Record<string, unknown> = {},
): Promise<{ data: T; result: ChatResult }> {
  const config = AI_TASKS[task];
  let failure: AiJsonFailure = { ok: false, reason: 'empty' };

  for (let attempt = 1; attempt <= config.parseAttempts; attempt += 1) {
    const result = await requestChat({
      action: task,
      messages: taskMessages(task, payload),
      maxOutputTokens: config.maxOutputTokens,
      temperature: config.temperature,
      jsonMode: config.json,
    });

    const parsed = parseAiJson(result.text, schema);
    if (parsed.ok) {
      logAiAction(task, result, 'ok', { ...extra, attempt });
      return { data: parsed.data, result };
    }

    failure = parsed;
    logAiAction(task, result, 'invalid', { ...extra, attempt, reason: parsed.reason });
  }

  throw errors.aiInvalidContent(describeAiJsonFailure(failure));
}

function focusLine(focus?: string): string {
  return focus && focus.trim() ? `\nEXTRA FOCUS FROM THE STUDENT: ${focus.trim()}` : '';
}

// -------------------------------------------------------------- set actions

export interface SetTextResult {
  text: string;
  meta: {
    setId: string;
    totalCards: number;
    contextCards: number;
    omittedCards: number;
  };
}

export const aiLearningService = {
  /** "Leg deze set uit" — explain the set like a teacher would (#2). */
  async explainSet(
    db: Database,
    userId: string,
    setId: string,
    focus?: string,
  ): Promise<SetTextResult> {
    const loaded = await loadSetForAi(db, userId, setId);
    const payload = [`TASK: Explain this study set.`, '', loaded.context, focusLine(focus)].join(
      '\n',
    );

    const text = await runTextTask('explain', payload, {
      setId,
      totalCards: loaded.totalCards,
      contextCards: loaded.contextCards,
    });

    return {
      text,
      meta: {
        setId,
        totalCards: loaded.totalCards,
        contextCards: loaded.contextCards,
        omittedCards: loaded.totalCards - loaded.contextCards,
      },
    };
  },

  /** "Vat deze set samen" — compact summary of the set (#1). */
  async summarizeSet(
    db: Database,
    userId: string,
    setId: string,
    focus?: string,
  ): Promise<SetTextResult> {
    const loaded = await loadSetForAi(db, userId, setId);
    const payload = [`TASK: Summarize this study set.`, '', loaded.context, focusLine(focus)].join(
      '\n',
    );

    const text = await runTextTask('summarize', payload, {
      setId,
      totalCards: loaded.totalCards,
      contextCards: loaded.contextCards,
    });

    return {
      text,
      meta: {
        setId,
        totalCards: loaded.totalCards,
        contextCards: loaded.contextCards,
        omittedCards: loaded.totalCards - loaded.contextCards,
      },
    };
  },
};

/** Exposed for later phases: the shared runner + set loader. */
export const aiLearningInternals = {
  runTextTask,
  runStructuredTask,
  requestId: () => randomUUID(),
  logSetAction: (action: string, setId: string, outcome: string, extra: Record<string, unknown>) =>
    logger.info('ai.set.action', { action, setId, outcome, ...extra }),
};

export { buildCardContext, buildStudyContext };
