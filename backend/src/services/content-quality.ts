/**
 * Content quality — the automatic check every piece of AI content passes before
 * a student can see it.
 *
 * This is deliberately deterministic (no second model judging the first): rules
 * a teacher would agree with, applied to the real text. Anything that fails is
 * rejected with a reason, and the caller either regenerates or simply does not
 * show it. There is no fake fallback content anywhere in this file.
 *
 * The rules come straight from the product requirements: empty question/answer,
 * duplicate question/flashcard, missing concept, missing source reference,
 * invalid multiple-choice options, missing correct answer, question or answer too
 * long, and the answer literally written inside the question.
 *
 * Pure module: no database, no AI, no I/O.
 */
import type { QuestionType } from '../lib/db/types.js';

export type ContentItemKind = 'summary' | 'concept' | 'flashcard' | 'question';

export type ContentIssueReason =
  | 'empty_concept'
  | 'duplicate_concept'
  | 'missing_source_reference'
  | 'empty_question'
  | 'empty_answer'
  | 'duplicate_question'
  | 'duplicate_flashcard'
  | 'missing_concept'
  | 'invalid_options'
  | 'missing_correct_answer'
  | 'question_too_long'
  | 'answer_too_long'
  | 'answer_in_question'
  | 'trivial_question'
  | 'empty_summary';

export interface RejectedItem {
  kind: ContentItemKind;
  /** Index inside the generated batch (for logs and the review screen). */
  index: number;
  reason: ContentIssueReason;
  /** Short, student-readable explanation. */
  detail: string;
}

export interface ReviewOutcome<T> {
  accepted: T[];
  rejected: RejectedItem[];
}

/** Hard limits a piece of generated content may not exceed. */
export const CONTENT_LIMITS = {
  question: 320,
  answer: 420,
  cardFront: 200,
  cardBack: 340,
  conceptName: 120,
  conceptExplanation: 700,
  multipleChoiceOptions: { min: 2, max: 6 },
} as const;

/** Lowercases, collapses whitespace and drops surrounding punctuation. */
export function normalizeForComparison(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s\u00a0]+/g, ' ')
    .replace(/^[\s.,;:!?"'“”‘’()[\]-]+|[\s.,;:!?"'“”‘’()[\]-]+$/g, '')
    .trim();
}

function words(value: string): string[] {
  return normalizeForComparison(value)
    .split(' ')
    .filter((word) => word.length > 0);
}

/** Jaccard similarity of the word sets; used for near-duplicate detection. */
export function similarity(a: string, b: string): number {
  const left = new Set(words(a));
  const right = new Set(words(b));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}

const DUPLICATE_SIMILARITY = 0.85;

/** True when two items ask (almost) the same thing. */
export function isDuplicateQuestion(a: string, b: string): boolean {
  const left = normalizeForComparison(a);
  const right = normalizeForComparison(b);
  if (!left || !right) return false;
  return left === right || similarity(left, right) >= DUPLICATE_SIMILARITY;
}

export interface ConceptCandidate {
  name: string;
  explanation: string;
  /** Verified provenance label, or null when the source has no inner structure. */
  refLabel: string | null;
  /** The source this concept was attributed to (required: real provenance). */
  sourceId: string | null;
}

/** Checks generated concepts: usable name/explanation, provenance, uniqueness. */
export function reviewConcepts(
  concepts: ConceptCandidate[],
  existing: { names: string[] } = { names: [] },
): ReviewOutcome<ConceptCandidate> {
  const accepted: ConceptCandidate[] = [];
  const rejected: RejectedItem[] = [];
  const seen = existing.names.map(normalizeForComparison);

  concepts.forEach((concept, index) => {
    const name = concept.name.trim();
    const explanation = concept.explanation.trim();
    if (name.length < 3 || explanation.length < 10) {
      rejected.push({
        kind: 'concept',
        index,
        reason: 'empty_concept',
        detail: 'A concept without a usable name and explanation was skipped.',
      });
      return;
    }
    if (name.length > CONTENT_LIMITS.conceptName || explanation.length > CONTENT_LIMITS.conceptExplanation) {
      rejected.push({
        kind: 'concept',
        index,
        reason: 'answer_too_long',
        detail: 'A concept was too long to study and was skipped.',
      });
      return;
    }
    const key = normalizeForComparison(name);
    if (seen.includes(key) || seen.some((other) => similarity(other, key) >= DUPLICATE_SIMILARITY)) {
      rejected.push({
        kind: 'concept',
        index,
        reason: 'duplicate_concept',
        detail: `"${name}" already exists in this study pack.`,
      });
      return;
    }
    if (!concept.sourceId) {
      rejected.push({
        kind: 'concept',
        index,
        reason: 'missing_source_reference',
        detail: `"${name}" could not be linked to your material and was skipped.`,
      });
      return;
    }
    seen.push(key);
    accepted.push({ name, explanation, refLabel: concept.refLabel, sourceId: concept.sourceId });
  });

  return { accepted, rejected };
}

export interface FlashcardCandidate {
  front: string;
  back: string;
  refLabel: string | null;
  sourceId: string | null;
  conceptId: string | null;
}

/** Checks generated flashcards the way a teacher would read them. */
export function reviewFlashcards(
  cards: FlashcardCandidate[],
  existing: { fronts: string[] } = { fronts: [] },
): ReviewOutcome<FlashcardCandidate> {
  const accepted: FlashcardCandidate[] = [];
  const rejected: RejectedItem[] = [];
  const seen = [...existing.fronts];

  cards.forEach((card, index) => {
    const front = card.front.trim();
    const back = card.back.trim();
    if (front.length < 3) {
      rejected.push({ kind: 'flashcard', index, reason: 'empty_question', detail: 'An empty question was skipped.' });
      return;
    }
    if (back.length < 1) {
      rejected.push({ kind: 'flashcard', index, reason: 'empty_answer', detail: 'A card without an answer was skipped.' });
      return;
    }
    if (front.length > CONTENT_LIMITS.cardFront) {
      rejected.push({ kind: 'flashcard', index, reason: 'question_too_long', detail: 'A question was too long and was skipped.' });
      return;
    }
    if (back.length > CONTENT_LIMITS.cardBack) {
      rejected.push({ kind: 'flashcard', index, reason: 'answer_too_long', detail: 'An answer was too long and was skipped.' });
      return;
    }
    if (words(front).length < 2) {
      rejected.push({ kind: 'flashcard', index, reason: 'trivial_question', detail: 'A card asked too little to be useful.' });
      return;
    }
    if (
      normalizeForComparison(back).length >= 8 &&
      normalizeForComparison(front).includes(normalizeForComparison(back))
    ) {
      rejected.push({
        kind: 'flashcard',
        index,
        reason: 'answer_in_question',
        detail: 'A card already contained its own answer and was skipped.',
      });
      return;
    }
    if (seen.some((other) => isDuplicateQuestion(front, other))) {
      rejected.push({
        kind: 'flashcard',
        index,
        reason: 'duplicate_flashcard',
        detail: 'A duplicate flashcard was skipped.',
      });
      return;
    }
    if (!card.sourceId) {
      rejected.push({
        kind: 'flashcard',
        index,
        reason: 'missing_source_reference',
        detail: 'A card that could not be linked to your material was skipped.',
      });
      return;
    }
    seen.push(front);
    accepted.push({
      front,
      back,
      refLabel: card.refLabel,
      sourceId: card.sourceId,
      conceptId: card.conceptId,
    });
  });

  return { accepted, rejected };
}

export interface PracticeQuestionCandidate {
  questionType: QuestionType;
  prompt: string;
  correctAnswer: string;
  options: string[] | null;
  explanation: string;
  refLabel: string | null;
  sourceId: string | null;
  conceptId: string | null;
  /**
   * Set when the question points at a concept that is generated in the same run
   * and therefore has no id yet. Such a question is linked, not concept-less.
   */
  conceptName?: string | null;
}

/** Checks generated practice questions, including the multiple-choice contract. */
export function reviewPracticeQuestions(
  questions: PracticeQuestionCandidate[],
  existing: { prompts: string[] } = { prompts: [] },
): ReviewOutcome<PracticeQuestionCandidate> {
  const accepted: PracticeQuestionCandidate[] = [];
  const rejected: RejectedItem[] = [];
  const seen = [...existing.prompts];

  questions.forEach((question, index) => {
    const prompt = question.prompt.trim();
    const answer = question.correctAnswer.trim();
    if (prompt.length < 3) {
      rejected.push({ kind: 'question', index, reason: 'empty_question', detail: 'An empty question was skipped.' });
      return;
    }
    if (prompt.length > CONTENT_LIMITS.question) {
      rejected.push({ kind: 'question', index, reason: 'question_too_long', detail: 'A question was too long and was skipped.' });
      return;
    }
    if (answer.length === 0) {
      rejected.push({ kind: 'question', index, reason: 'empty_answer', detail: 'A question without an answer was skipped.' });
      return;
    }
    if (answer.length > CONTENT_LIMITS.answer) {
      rejected.push({ kind: 'question', index, reason: 'answer_too_long', detail: 'An answer was too long and was skipped.' });
      return;
    }
    if (question.questionType === 'short_answer' && question.options && question.options.length > 0) {
      rejected.push({ kind: 'question', index, reason: 'invalid_options', detail: 'An open question came with options and was skipped.' });
      return;
    }
    if (question.questionType === 'multiple_choice') {
      const options = (question.options ?? []).map((option) => option.trim()).filter(Boolean);
      const distinct = new Set(options.map(normalizeForComparison));
      if (options.length < CONTENT_LIMITS.multipleChoiceOptions.min) {
        rejected.push({ kind: 'question', index, reason: 'invalid_options', detail: 'A multiple-choice question had too few options.' });
        return;
      }
      if (options.length > CONTENT_LIMITS.multipleChoiceOptions.max || distinct.size !== options.length) {
        rejected.push({ kind: 'question', index, reason: 'invalid_options', detail: 'A multiple-choice question had unusable options.' });
        return;
      }
      const match = options.find((option) => normalizeForComparison(option) === normalizeForComparison(answer));
      if (!match) {
        rejected.push({ kind: 'question', index, reason: 'missing_correct_answer', detail: 'A multiple-choice question did not include its correct answer.' });
        return;
      }
    }
    if (question.questionType === 'true_false') {
      const normalized = normalizeForComparison(answer);
      if (normalized !== 'true' && normalized !== 'false' && normalized !== 'juist' && normalized !== 'onjuist') {
        rejected.push({ kind: 'question', index, reason: 'missing_correct_answer', detail: 'A true/false question had no clear verdict.' });
        return;
      }
    }
    if (
      normalizeForComparison(answer).length >= 8 &&
      normalizeForComparison(prompt).includes(normalizeForComparison(answer))
    ) {
      rejected.push({ kind: 'question', index, reason: 'answer_in_question', detail: 'A question already contained its own answer and was skipped.' });
      return;
    }
    if (seen.some((other) => isDuplicateQuestion(prompt, other))) {
      rejected.push({ kind: 'question', index, reason: 'duplicate_question', detail: 'A duplicate question was skipped.' });
      return;
    }
    if (!question.conceptId && !question.conceptName) {
      rejected.push({
        kind: 'question',
        index,
        reason: 'missing_concept',
        detail: 'A question could not be linked to a concept and was skipped.',
      });
      return;
    }
    if (!question.sourceId) {
      rejected.push({
        kind: 'question',
        index,
        reason: 'missing_source_reference',
        detail: 'A question that could not be linked to your material was skipped.',
      });
      return;
    }
    seen.push(prompt);
    accepted.push({ ...question, prompt, correctAnswer: answer, options: question.options });
  });

  return { accepted, rejected };
}

/** Summary text: long enough to be useful, bounded so it stays readable. */
export function reviewSummary(
  summary: string,
  maxChars = 4_000,
): ReviewOutcome<{ summary: string }> {
  const clean = summary.trim();
  if (clean.length < 30) {
    return {
      accepted: [],
      rejected: [
        { kind: 'summary', index: 0, reason: 'empty_summary', detail: 'The summary was too short to keep.' },
      ],
    };
  }
  return { accepted: [{ summary: clean.slice(0, maxChars) }], rejected: [] };
}

/** Short, grouped message for the review screen ("3 items were skipped: …"). */
export function describeRejections(rejected: RejectedItem[]): string | null {
  if (rejected.length === 0) return null;
  const reasons = new Map<ContentIssueReason, number>();
  for (const item of rejected) {
    reasons.set(item.reason, (reasons.get(item.reason) ?? 0) + 1);
  }
  const labels: Record<ContentIssueReason, string> = {
    empty_concept: 'incomplete concept',
    duplicate_concept: 'duplicate concept',
    missing_source_reference: 'no place in your material',
    empty_question: 'empty question',
    empty_answer: 'empty answer',
    duplicate_question: 'duplicate question',
    duplicate_flashcard: 'duplicate flashcard',
    missing_concept: 'not linked to a concept',
    invalid_options: 'unusable answer options',
    missing_correct_answer: 'missing correct answer',
    question_too_long: 'question too long',
    answer_too_long: 'answer too long',
    answer_in_question: 'answer already in the question',
    trivial_question: 'too little to test',
    empty_summary: 'summary too short',
  };
  return [...reasons.entries()]
    .map(([reason, count]) => `${count}× ${labels[reason]}`)
    .join(', ');
}
