/**
 * Central reasoning policy for the Groq model (docs/AI.md).
 *
 * GPT-OSS on Groq accepts `reasoning_effort` = `low` | `medium` | `high`
 * (`medium` is the provider default). The reasoning itself is hidden, but its
 * tokens are billed and count against the same `max_completion_tokens` ceiling,
 * so the effort level decides both latency/cost and how much output headroom has
 * to be reserved.
 *
 * Policy (deliberately conservative, school questions are not olympiad tasks):
 * - `low`   → explanations, definitions, "why" questions, greetings, hints
 * - `medium`→ problem solving (math), complex evaluation, generation (quiz,
 *             flashcards, practice questions, an explicitly complex question)
 * - `high`  → never used by default: no measured gain for school-level answers,
 *             only latency and tokens.
 *
 * All of it is centrally managed: per-task defaults live with the task config
 * (`ai-prompts.ts`), free chat classifies the student's question here, and
 * `GROQ_REASONING_EFFORT` can force one level for a measurement run.
 *
 * Reasoning is a *sampling* setting, never a substitute for prompt quality.
 */
import { config } from '../config.js';
import { AI_TASKS, type AiTaskName } from './ai-prompts.js';
import type { ChatRequest } from './ai-completion.js';

export type ReasoningEffort = 'low' | 'medium' | 'high';

export const REASONING_EFFORTS: readonly ReasoningEffort[] = ['low', 'medium', 'high'];

/**
 * Extra completion tokens reserved for hidden reasoning, per effort level.
 *
 * These are headroom, not a provider guarantee: a small extra margin keeps a
 * tight budget (a 120-token hint) from being fully consumed by thinking, while
 * the real cap stays the visible answer budget plus this reserve.
 */
export const REASONING_RESERVE: Record<ReasoningEffort, number> = {
  low: 256,
  medium: 512,
  high: 1024,
};

/** Only reasoning models accept reasoning_effort; others must not receive it. */
export function supportsReasoningEffort(model: string): boolean {
  return /gpt-oss/.test(model);
}

/**
 * A question that is explicitly asked to go deep: it costs more to answer well
 * than a normal explanation, so it earns medium reasoning.
 */
const COMPLEX_REQUEST =
  /\b(?:uitgebreid|complexe?|diepgaand|volledig|alles over|in detail|bewijs|aantonen|proof|prove|analyseer|analyze|vergelijk|compare|stap voor stap|step by step|herschrijf|vereenvoudig|integraal|afgeleide|derivative|integral)\b/i;

/** Problem solving: calculations, equations, multi-step derivations. */
const PROBLEM_SOLVING =
  /\b(?:los|bereken|reken|rekenen|reken uit|omrekenen|converteren|calculate|compute|solve|vergelijking|equation|formule|formula)\b/i;

/** Any arithmetic written out, e.g. "3x + 7 = 22". */
const EQUATION = /\d\s*[a-z]\s*[-+*/^=]|\d\s*[-+*/^]\s*\d+[^?!.]{0,24}[=<>]/i;

/** Requesting new material (question, quiz, cards) instead of an explanation. */
const GENERATION =
  /\b(?:maak|geef|genereer|schrijf|bedenk|verzin|ontwerp)\b[^?.]{0,40}\b(?:vraag|vragen|oefen\w*|opgave\w*|quiz|toets|kaart\w*|cards?)\b/i;

/**
 * Reasoning effort for one free-chat question.
 *
 * Cheap, bounded pattern matching on the student's own text — the same
 * heuristics the output-budget policy already uses. Unknown questions stay on
 * `low`, because a longer chain of thought never fixes a wrong instruction.
 */
export function chatReasoningEffort(message: string): ReasoningEffort {
  if (COMPLEX_REQUEST.test(message) || GENERATION.test(message)) return 'medium';
  if (PROBLEM_SOLVING.test(message) || EQUATION.test(message)) return 'medium';
  return 'low';
}

/** Per-task default effort; unknown actions fall back to the cheapest level. */
export function defaultReasoningEffort(action: string): ReasoningEffort {
  return AI_TASKS[action as AiTaskName]?.reasoning ?? 'low';
}

/**
 * Single source of truth for the effort sent upstream: the request's own value,
 * else the per-task/classifier default, else forced by `GROQ_REASONING_EFFORT`.
 * Returns `null` for models that do not support the parameter.
 */
export function resolveReasoningEffort(
  request: Pick<ChatRequest, 'action' | 'reasoningEffort'>,
): ReasoningEffort | null {
  if (!supportsReasoningEffort(config.groqModel)) return null;
  const forced = config.groqReasoningEffort;
  if (forced !== 'auto') return forced;
  return request.reasoningEffort ?? defaultReasoningEffort(request.action);
}
