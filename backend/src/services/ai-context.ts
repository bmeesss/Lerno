/**
 * AI context builders — the ONLY way study data reaches the model.
 *
 * Rules:
 * - Callers pass already-authorized data (ownership/visibility is enforced by
 *   the services *before* these functions run). These builders never query the
 *   database themselves, so the AI can never pull data on its own.
 * - Every builder normalizes, de-duplicates, trims and caps its output, so a
 *   500-card set can never blow up the prompt or the bill.
 * - Empty input produces an empty, honest context — never invented content.
 */
import type { CardRecord, StudySetRecord } from '../lib/db/types.js';
import { capLength } from '../lib/ai-sanitize.js';
import { config } from '../config.js';

export interface SetContextOptions {
  /** Max cards included (config default, overridable per task). */
  maxCards?: number;
  /** Hard ceiling for the whole context block. */
  maxChars?: number;
}

export interface SetContext {
  /** Compact, token-friendly block describing the set and its cards. */
  text: string;
  /** Cards actually included (after trimming). */
  cardCount: number;
  /** Cards in the set. */
  totalCards: number;
  /** Cards dropped by the limits. */
  omittedCards: number;
}

// eslint-disable-next-line no-control-regex -- stripping control characters is the point here
const CONTROL_CHARS = new RegExp('[\\u0000-\\u0008\\u000b-\\u001f\\u007f]', 'g');

const MAX_QUESTION_CHARS = 240;
const MAX_ANSWER_CHARS = 400;
const MAX_TITLE_CHARS = 120;
const MAX_DESCRIPTION_CHARS = 300;

/** Collapses whitespace and cuts control characters — model payload hygiene. */
export function normalizeText(value: string, maxChars: number): string {
  return capLength(
    value.replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim(),
    maxChars,
  );
}

function cardLine(card: CardRecord, index: number): string {
  return `${index}. Q: ${normalizeText(card.question, MAX_QUESTION_CHARS)} | A: ${normalizeText(
    card.answer,
    MAX_ANSWER_CHARS,
  )}`;
}

/** De-duplicates identical question/answer pairs (common in imported sets). */
function dedupeCards(cards: CardRecord[]): CardRecord[] {
  const seen = new Set<string>();
  const unique: CardRecord[] = [];
  for (const card of cards) {
    const key = `${normalizeText(card.question, MAX_QUESTION_CHARS).toLowerCase()}::${normalizeText(
      card.answer,
      MAX_ANSWER_CHARS,
    ).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(card);
  }
  return unique;
}

/**
 * Builds the set context used by explanation, summary, question and quiz
 * generation. Cards are sorted by position, de-duplicated, capped in count and
 * total characters — a large set is trimmed instead of being rejected.
 */
export function buildSetContext(
  set: StudySetRecord,
  cards: CardRecord[],
  options: SetContextOptions = {},
): SetContext {
  const maxCards = Math.max(1, options.maxCards ?? config.aiContextMaxCards);
  const maxChars = Math.max(500, options.maxChars ?? config.aiContextMaxChars);

  const sorted = [...cards].sort((a, b) => a.position - b.position);
  const unique = dedupeCards(sorted);
  const totalCards = unique.length;

  const header = [
    `SET: ${normalizeText(set.title, MAX_TITLE_CHARS)}`,
    set.subjectName ? `SUBJECT: ${normalizeText(set.subjectName, 60)}` : null,
    set.level ? `LEVEL: ${normalizeText(set.level, 40)}` : null,
    set.description
      ? `DESCRIPTION: ${normalizeText(set.description, MAX_DESCRIPTION_CHARS)}`
      : null,
    `CARDS: ${totalCards}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');

  const selected: CardRecord[] = [];
  let used = header.length + 20; // header + the "… N more" line
  for (const card of unique) {
    if (selected.length >= maxCards) break;
    const line = cardLine(card, selected.length + 1);
    if (used + line.length > maxChars) break;
    used += line.length + 1;
    selected.push(card);
  }

  const omitted = totalCards - selected.length;
  const lines = selected.map((card, index) => cardLine(card, index + 1));
  const text = [
    header,
    'CONTENT:',
    ...lines,
    omitted > 0 ? `(${omitted} more cards in this set are not shown.)` : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  return { text, cardCount: selected.length, totalCards, omittedCards: omitted };
}

/** Context for a single card (card-level AI actions). */
export function buildCardContext(set: StudySetRecord, card: CardRecord): string {
  return [
    `SET: ${normalizeText(set.title, MAX_TITLE_CHARS)}`,
    set.subjectName ? `SUBJECT: ${normalizeText(set.subjectName, 60)}` : null,
    set.level ? `LEVEL: ${normalizeText(set.level, 40)}` : null,
    `CARD ${card.position + 1}:`,
    `Q: ${normalizeText(card.question, MAX_QUESTION_CHARS)}`,
    `A: ${normalizeText(card.answer, MAX_ANSWER_CHARS)}`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

/** Context for evaluating one answer in overhoor/quiz mode (minimal, focused). */
export function buildStudyContext(
  set: StudySetRecord,
  card: { question: string; answer: string },
): string {
  return [
    `SET: ${normalizeText(set.title, MAX_TITLE_CHARS)}`,
    // The level is already known here, so it travels with the task: the judge
    // and the hint stay at the student's level.
    set.level ? `LEVEL: ${normalizeText(set.level, 40)}` : null,
    `QUESTION: ${normalizeText(card.question, MAX_QUESTION_CHARS)}`,
    `MODEL ANSWER: ${normalizeText(card.answer, MAX_ANSWER_CHARS)}`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

/** Context for generating a quiz from a set (same shaping, quiz-sized budget). */
export function buildQuizContext(
  set: StudySetRecord,
  cards: CardRecord[],
  options: SetContextOptions = {},
): SetContext {
  return buildSetContext(set, cards, {
    maxCards: options.maxCards ?? Math.min(config.aiContextMaxCards, 80),
    maxChars: options.maxChars ?? config.aiContextMaxChars,
  });
}
