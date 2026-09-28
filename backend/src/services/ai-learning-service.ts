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
import {
  buildCardContext,
  buildSetContext,
  buildStudyContext,
  normalizeText,
} from './ai-context.js';
import {
  evaluationSchema,
  generatedQuestionsSchema,
  generatedQuizSchema,
  hintResponseSchema,
} from '../lib/ai-schemas.js';
import { logAiAction, requestChat, type ChatResult } from './ai-completion.js';
import { canViewSet } from './set-service.js';
import { studyService } from './study-service.js';
import type {
  EvaluateAnswerBody,
  FinishStudyBody,
  GenerateQuestionsBody,
  HintRequestBody,
} from '../validators/ai-set.validators.js';

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
interface RunOptions {
  /** Overrides the task's default budget (e.g. 15 questions need more room). */
  maxOutputTokens?: number;
}

async function runTextTask(
  task: AiTaskName,
  payload: string,
  extra: Record<string, unknown> = {},
  options: RunOptions = {},
): Promise<string> {
  const config = AI_TASKS[task];
  const result = await requestChat({
    action: task,
    messages: taskMessages(task, payload),
    maxOutputTokens: options.maxOutputTokens ?? config.maxOutputTokens,
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
async function runStructuredTask<S extends z.ZodTypeAny>(
  task: AiTaskName,
  payload: string,
  schema: S,
  extra: Record<string, unknown> = {},
  options: RunOptions = {},
): Promise<{ data: z.infer<S>; result: ChatResult }> {
  const config = AI_TASKS[task];
  let failure: AiJsonFailure = { ok: false, reason: 'empty' };

  for (let attempt = 1; attempt <= config.parseAttempts; attempt += 1) {
    const result = await requestChat({
      action: task,
      messages: taskMessages(task, payload),
      maxOutputTokens: options.maxOutputTokens ?? config.maxOutputTokens,
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

type StudyInput = {
  question: string;
  expectedAnswer?: string;
  answer?: string;
};

/** Builds the shared "set + question + reference answer" payload for evaluate/hint. */
function buildEvaluationPayload(
  set: StudySetRecord,
  card: CardRecord | null,
  body: StudyInput,
  task: string,
): string {
  const reference = card ? card.answer : (body.expectedAnswer ?? '');
  const head = card
    ? buildStudyContext(set, card)
    : [
        `SET: ${normalizeText(set.title, 120)}`,
        `QUESTION: ${normalizeText(body.question, 300)}`,
        `MODEL ANSWER: ${normalizeText(reference, 500)}`,
      ].join('\n');

  return [
    task,
    '',
    head,
    '',
    `STUDENT'S ANSWER: ${normalizeText(body.answer ?? '', 1000) || '(empty)'}`,
  ].join('\n');
}

function focusLine(focus?: string): string {
  return focus && focus.trim() ? `\nEXTRA FOCUS FROM THE STUDENT: ${focus.trim()}` : '';
}

const DIFFICULTY_HINT: Record<string, string> = {
  easy: 'Recall: the answer is stated in the material.',
  normal: 'Understanding: the student must explain or apply one step.',
  hard: 'Apply or connect: combine two ideas, or transfer to a new example.',
};

/** Questions scale with the requested count — 15 questions need more room. */
function questionsBudget(count: number): number {
  return Math.min(2200, 520 + count * 110);
}

interface StudyTarget {
  set: StudySetRecord;
  card: CardRecord | null;
}

/**
 * Loads the set (and optional card) an evaluation/hint refers to, with the same
 * visibility rule as everywhere else. A card that does not belong to the set is
 * reported as not found — it can never be used to reach other data.
 */
async function loadStudyTarget(
  db: Database,
  userId: string,
  input: { setId: string; cardId?: string },
): Promise<StudyTarget> {
  const set = await db.sets.get(input.setId);
  if (!set || !canViewSet(set, userId)) throw errors.notFound('Study set not found');

  if (!input.cardId) return { set, card: null };
  const card = await db.cards.get(input.cardId);
  if (!card || card.setId !== set.id) throw errors.notFound('Card not found');
  return { set, card };
}

// -------------------------------------------------------------- set actions

export type AnswerEvaluation = z.infer<typeof evaluationSchema>;
export type GeneratedQuestion = z.infer<typeof generatedQuestionsSchema>['questions'][number];
export type GeneratedQuizQuestion = z.infer<typeof generatedQuizSchema>['questions'][number];

export interface AiSetMeta {
  setId: string;
  totalCards: number;
  contextCards: number;
  omittedCards: number;
}

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

  /**
   * "Maak oefenvragen" — structured practice questions from the set (#3).
   * The model's JSON is parsed defensively and validated before returning.
   */
  async generateQuestions(
    db: Database,
    userId: string,
    setId: string,
    body: GenerateQuestionsBody,
  ): Promise<{ questions: GeneratedQuestion[]; meta: AiSetMeta }> {
    const loaded = await loadSetForAi(db, userId, setId);
    const payload = [
      `TASK: Write ${body.count} practice questions.`,
      `DIFFICULTY: ${body.difficulty} — ${DIFFICULTY_HINT[body.difficulty] ?? ''}`,
      '',
      loaded.context,
      focusLine(body.focus),
    ].join('\n');

    const { data } = await runStructuredTask(
      'questions',
      payload,
      generatedQuestionsSchema,
      { setId, count: body.count, difficulty: body.difficulty, totalCards: loaded.totalCards },
      { maxOutputTokens: questionsBudget(body.count) },
    );

    // Map the optional card reference onto a real card id so an overhoor
    // session can feed the normal study progress. Anything out of range or
    // missing simply has no cardId — the client can never invent one.
    const orderedCards = [...loaded.cards].sort((a, b) => a.position - b.position);
    const questions = data.questions.slice(0, body.count).map((question) => {
      const card = question.cardRef ? orderedCards[question.cardRef - 1] : undefined;
      return {
        type: question.type,
        question: question.question,
        answer: question.answer,
        hint: question.hint,
        options: question.options,
        correctIndex: question.correctIndex,
        cardId: card?.id ?? null,
      };
    });

    return {
      questions,
      meta: {
        setId,
        totalCards: loaded.totalCards,
        contextCards: loaded.contextCards,
        omittedCards: loaded.totalCards - loaded.contextCards,
      },
    };
  },

  /**
   * Judges one answer with the model (#4): correct / partial / incorrect plus
   * short feedback. Never plain string matching, always schema validated.
   */
  async evaluateAnswer(
    db: Database,
    userId: string,
    body: EvaluateAnswerBody,
  ): Promise<AnswerEvaluation> {
    const { set, card } = await loadStudyTarget(db, userId, body);
    const payload = buildEvaluationPayload(set, card, body, "Judge the student's answer.");

    const { data } = await runStructuredTask('evaluate', payload, evaluationSchema, {
      setId: set.id,
      hasCard: Boolean(card),
    });

    return data;
  },

  /** A small hint that never gives the answer away (#5). */
  async hint(db: Database, userId: string, body: HintRequestBody): Promise<{ hint: string }> {
    const { set, card } = await loadStudyTarget(db, userId, body);
    const step = body.hintsGiven > 0 ? 'next' : 'first';
    const payload = [
      ...buildEvaluationPayload(set, card, body, `Give the ${step} hint for this question.`)
        .split('\n\nSTUDENT')[0]!
        .split('\n'),
      body.hintsGiven > 0
        ? `You already gave ${body.hintsGiven} hint(s): take the next step, but still stop short of the answer.`
        : 'This is the first hint: point at the first step or the key idea only.',
    ]
      .filter((line) => !line.startsWith('TASK:'))
      .join('\n');

    const { data } = await runStructuredTask('hint', payload, hintResponseSchema, {
      setId: set.id,
      hintsGiven: body.hintsGiven,
    });

    return data;
  },

  /**
   * Finishes an overhoor session: aggregates the verdicts, derives the topics
   * that need practice and — for questions that came from real cards — records
   * the result through the existing spaced-repetition flow, so the normal
   * study schedule for this set stays in sync (#4, #14).
   */
  async finishStudy(db: Database, userId: string, body: FinishStudyBody) {
    const set = await db.sets.get(body.setId);
    if (!set || !canViewSet(set, userId)) throw errors.notFound('Study set not found');

    const correct = body.results.filter((result) => result.verdict === 'correct').length;
    const partial = body.results.filter((result) => result.verdict === 'partial').length;
    const incorrect = body.results.filter((result) => result.verdict === 'incorrect').length;
    const total = body.results.length;
    const accuracy = total > 0 ? (correct + partial * 0.5) / total : 0;

    const topicsToReview = [
      ...new Set(
        body.results
          .filter((result) => result.verdict !== 'correct')
          .map((result) => normalizeText(result.question, 120)),
      ),
    ].slice(0, 10);

    // Persist through the normal review flow: only cards of this set are
    // touched and scheduling stays inside scheduling-service.
    let persisted = false;
    const cards = await db.cards.listBySet(set.id);
    const cardIds = new Set(cards.map((card) => card.id));
    for (const result of body.results) {
      if (!result.cardId || !cardIds.has(result.cardId)) continue;
      // "partial" returns to the queue too: not fully known yet.
      await studyService.review(db, userId, {
        setId: set.id,
        cardId: result.cardId,
        result: result.verdict === 'correct' ? 'correct' : 'incorrect',
      });
      persisted = true;
    }

    logger.info('ai.study.finished', {
      action: 'finish-study',
      setId: set.id,
      outcome: 'ok',
      total,
      correct,
      partial,
      incorrect,
      persisted,
    });

    return {
      setId: set.id,
      total,
      correct,
      partial,
      incorrect,
      accuracy,
      topicsToReview,
      persisted,
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
