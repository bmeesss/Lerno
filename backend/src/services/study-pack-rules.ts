/**
 * Study Pack domain rules — pure, testable helpers shared by the pack services.
 *
 * Everything in this file is deterministic and side-effect free:
 *  - answer grading (multiple choice / true-false / open answers)
 *  - concept mastery updates (the basis for adaptive learning later)
 *  - concept ↔ card/question matching
 *  - weak-topic detection and the single recommended next action
 *  - exam countdown + study-plan generation
 *
 * No database access and no AI calls happen here, so the rules can be unit
 * tested and later replaced (e.g. by a smarter mastery model) without touching
 * services or controllers.
 */
import { DEFAULT_TIMEZONE, todayInZone } from '../lib/timezone.js';
import type {
  AnswerVerdict,
  CardRecord,
  ConceptMasteryRecord,
  ConceptRecord,
  PracticeQuestionRecord,
} from '../lib/db/types.js';

/* --------------------------------- grading -------------------------------- */

/** Lowercases, strips accents/punctuation and collapses whitespace. */
export function normalizeAnswer(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'een',
  'het',
  'van',
  'dat',
  'die',
  'met',
  'voor',
  'als',
  'zijn',
  'wordt',
  'worden',
  'naar',
  'door',
]);

function keywords(value: string): string[] {
  return normalizeAnswer(value)
    .split(' ')
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
}

export interface GradeResult {
  verdict: AnswerVerdict;
  /** Normalized student answer echoed back for storage/display. */
  normalized: string;
}

/**
 * Grades one practice/test answer without an AI call.
 *
 * Deliberately generous on wording (open answers are compared by meaning at
 * word level) and strict about emptiness: an empty answer is never correct.
 * AI grading stays available for open answers elsewhere in Lerno; this baseline
 * keeps Practice and Test useful even when AI is not configured.
 */
export function gradeAnswer(
  question: Pick<PracticeQuestionRecord, 'questionType' | 'correctAnswer' | 'options'>,
  answer: string,
): GradeResult {
  const normalized = normalizeAnswer(answer);
  if (!normalized) return { verdict: 'incorrect', normalized };

  const expected = normalizeAnswer(question.correctAnswer);

  if (question.questionType === 'multiple_choice' || question.questionType === 'true_false') {
    // Accept either the option text or its 0-based index (what a UI radio sends).
    const options = question.options ?? [];
    const index = Number.parseInt(normalized, 10);
    const picked =
      Number.isInteger(index) && String(index) === normalized ? (options[index] ?? '') : answer;
    const pickedNormalized = normalizeAnswer(picked);
    const matches = options.length > 0 && options.some((option) => normalizeAnswer(option) === pickedNormalized);
    const verdict: AnswerVerdict = matches && pickedNormalized === expected ? 'correct' : 'incorrect';
    return { verdict, normalized: pickedNormalized || normalized };
  }

  if (normalized === expected) return { verdict: 'correct', normalized };

  const expectedWords = keywords(question.correctAnswer);
  const answerWords = new Set(keywords(answer));
  if (expectedWords.length === 0) {
    return { verdict: normalized.includes(expected) ? 'correct' : 'incorrect', normalized };
  }

  const hit = expectedWords.filter((word) => answerWords.has(word)).length;
  const coverage = hit / expectedWords.length;
  if (coverage >= 0.8) return { verdict: 'correct', normalized };
  if (coverage >= 0.5) return { verdict: 'partial', normalized };
  return { verdict: 'incorrect', normalized };
}

/* -------------------------------- mastery --------------------------------- */

export const WEAK_MASTERY_THRESHOLD = 0.3;
export const LEARNING_MASTERY_THRESHOLD = 0.6;
export const STRONG_MASTERY_THRESHOLD = 0.85;

export type MasteryLabel = 'New' | 'Weak' | 'Learning' | 'Familiar' | 'Mastered';

/** Product-facing bands; storage remains a numeric 0..1 mastery value. */
export function masteryLabel(state: Pick<MasteryState, 'mastery' | 'attempts'>): MasteryLabel {
  if (state.attempts === 0) return 'New';
  if (state.mastery < WEAK_MASTERY_THRESHOLD) return 'Weak';
  if (state.mastery < LEARNING_MASTERY_THRESHOLD) return 'Learning';
  if (state.mastery < STRONG_MASTERY_THRESHOLD) return 'Familiar';
  return 'Mastered';
}

/** Self-ratings used by Learn mode (adaptive-ready, no AI needed). */
export type ConceptRating = 'again' | 'hard' | 'good' | 'easy';

const RATING_DELTA: Record<ConceptRating, number> = {
  again: -0.1,
  hard: 0.05,
  good: 0.15,
  easy: 0.25,
};

const VERDICT_DELTA: Record<AnswerVerdict, number> = {
  correct: 0.2,
  partial: 0.08,
  incorrect: -0.15,
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, Math.round(value * 100) / 100));
}

export interface MasteryState {
  mastery: number;
  confidence: number;
  attempts: number;
  correctCount: number;
  incorrectCount: number;
  lastPracticedAt: string | null;
  nextReviewAt: string | null;
}

export function emptyMastery(): MasteryState {
  return {
    mastery: 0,
    confidence: 0.5,
    attempts: 0,
    correctCount: 0,
    incorrectCount: 0,
    lastPracticedAt: null,
    nextReviewAt: null,
  };
}

function clampConfidence(value: number): number {
  return Math.min(0.99, Math.max(0.01, Math.round(value * 100) / 100));
}

function addInterval(now: Date, milliseconds: number): string {
  return new Date(now.getTime() + milliseconds).toISOString();
}

/** A small, explainable interval ladder for concept review. */
export function conceptReviewAt(
  state: MasteryState,
  result: 'correct' | 'partial' | 'incorrect',
  now: Date,
): string {
  if (result === 'incorrect') return addInterval(now, 60 * 60 * 1000);
  if (result === 'partial') return addInterval(now, 24 * 60 * 60 * 1000);
  const days = state.mastery >= 0.85 && state.confidence >= 0.8 ? 14 :
    state.mastery >= 0.6 ? 7 : state.mastery >= 0.3 ? 3 : 1;
  return addInterval(now, days * 24 * 60 * 60 * 1000);
}

/** Applies one graded answer to mastery, confidence and the next due date. */
export function applyVerdict(state: MasteryState, verdict: AnswerVerdict, now: Date): MasteryState {
  const mastery = clamp01(state.mastery + VERDICT_DELTA[verdict]);
  const confidenceDelta = verdict === 'correct' ? 0.08 : verdict === 'partial' ? 0.02 : -0.12;
  const confidence = clampConfidence(state.confidence + confidenceDelta);
  const next = {
    mastery,
    confidence,
    attempts: state.attempts + 1,
    correctCount: state.correctCount + (verdict === 'correct' ? 1 : 0),
    incorrectCount: state.incorrectCount + (verdict === 'incorrect' ? 1 : 0),
    lastPracticedAt: now.toISOString(),
    nextReviewAt: null as string | null,
  };
  next.nextReviewAt = conceptReviewAt(next, verdict, now);
  return next;
}

/** Applies one Learn-mode self-rating to a mastery state. */
export function applyRating(state: MasteryState, rating: ConceptRating, now: Date): MasteryState {
  const mastery = clamp01(state.mastery + RATING_DELTA[rating]);
  const confidenceDelta: Record<ConceptRating, number> = {
    again: -0.12,
    hard: -0.03,
    good: 0.06,
    easy: 0.1,
  };
  const confidence = clampConfidence(state.confidence + confidenceDelta[rating]);
  const intervalMs: Record<ConceptRating, number> = {
    again: 60 * 60 * 1000,
    hard: 24 * 60 * 60 * 1000,
    good: 3 * 24 * 60 * 60 * 1000,
    easy: 7 * 24 * 60 * 60 * 1000,
  };
  return {
    mastery,
    confidence,
    attempts: state.attempts + 1,
    correctCount: state.correctCount + (rating === 'good' || rating === 'easy' ? 1 : 0),
    incorrectCount: state.incorrectCount + (rating === 'again' ? 1 : 0),
    lastPracticedAt: now.toISOString(),
    nextReviewAt: addInterval(now, intervalMs[rating]),
  };
}

export function masteryFromRecord(record: ConceptMasteryRecord | null): MasteryState {
  if (!record) return emptyMastery();
  return {
    mastery: record.mastery,
    confidence: record.confidence ?? 0.5,
    attempts: record.attempts,
    correctCount: record.correctCount,
    incorrectCount: record.incorrectCount,
    lastPracticedAt: record.lastPracticedAt,
    nextReviewAt: record.nextReviewAt ?? null,
  };
}

/** A concept is weak when the student has practised it and stays below the bar. */
export function isWeakConcept(state: MasteryState): boolean {
  return state.attempts > 0 && state.mastery < WEAK_MASTERY_THRESHOLD;
}

export function isStrongConcept(state: MasteryState): boolean {
  return state.attempts > 0 && state.mastery >= STRONG_MASTERY_THRESHOLD;
}

export interface LearnCandidate {
  concept: ConceptRecord;
  state: MasteryState;
}

/** Existing rows without an interval become due after seven unseen days. */
export function isConceptDue(state: MasteryState, now: Date = new Date()): boolean {
  let dueAt = state.nextReviewAt ? Date.parse(state.nextReviewAt) : Number.NaN;
  if (!Number.isFinite(dueAt) && state.lastPracticedAt) {
    const lastPracticedAt = Date.parse(state.lastPracticedAt);
    if (Number.isFinite(lastPracticedAt)) dueAt = lastPracticedAt + 7 * 86_400_000;
  }
  return Number.isFinite(dueAt) && dueAt <= now.getTime();
}

export type LearnReason = 'weak' | 'new' | 'learning' | 'due' | 'confirmation';

/** Learn tiers, most urgent first. */
const LEARN_TIERS: LearnReason[] = ['weak', 'new', 'learning', 'due', 'confirmation'];

/** Which Learn tier a concept is in: the single definition the ranking and the UI reason share. */
export function learnReason(state: MasteryState, now: Date = new Date()): LearnReason {
  if (state.attempts > 0 && state.mastery < WEAK_MASTERY_THRESHOLD) return 'weak';
  if (state.attempts === 0) return 'new';
  if (state.mastery < LEARNING_MASTERY_THRESHOLD) return 'learning';
  if (isConceptDue(state, now)) return 'due';
  return 'confirmation';
}

/**
 * Learn priority, from the student's live mastery state:
 *   weak → new → learning → due → mastered confirmation.
 *
 * "Learning" is the 30–60% band, "due" is a familiar concept whose review date
 * has passed, and the last tier confirms what looks mastered. Within a tier the
 * most urgent concept goes first (lowest mastery, or longest overdue).
 */
export function rankLearnCandidates(
  candidates: LearnCandidate[],
  excludedIds: string[] = [],
  now: Date = new Date(),
): LearnCandidate[] {
  const excluded = new Set(excludedIds);
  const tierOf = (candidate: LearnCandidate): number =>
    LEARN_TIERS.indexOf(learnReason(candidate.state, now));
  const dueAt = (state: MasteryState): string => state.nextReviewAt ?? '';
  return candidates
    .filter(({ concept }) => !excluded.has(concept.id))
    .slice()
    .sort((a, b) => {
      const tierA = tierOf(a);
      const tierB = tierOf(b);
      if (tierA !== tierB) return tierA - tierB;
      // Tiers with a review schedule: the longest overdue first, then weakest.
      if (tierA === 2 || tierA === 3) {
        return (
          dueAt(a.state).localeCompare(dueAt(b.state)) ||
          a.state.mastery - b.state.mastery ||
          a.concept.position - b.concept.position
        );
      }
      if (tierA === 1) return a.concept.position - b.concept.position;
      return a.state.mastery - b.state.mastery || a.concept.position - b.concept.position;
    });
}

export interface RankedRecommendation {
  priority: number;
  examDaysLeft: number | null;
  recency?: number;
}

/** Transparent urgency score: a nearer exam adds a predictable bonus. */
export function recommendationScore(candidate: RankedRecommendation): number {
  const days = candidate.examDaysLeft;
  const examBonus = days === null || days < 0 ? 0
    : days <= 2 ? 50
      : days <= 7 ? 35
        : days <= 14 ? 20
          : days <= 30 ? 8 : 0;
  return candidate.priority + examBonus;
}

export function rankRecommendations<T extends RankedRecommendation>(candidates: T[]): T[] {
  return candidates.slice().sort((a, b) =>
    recommendationScore(b) - recommendationScore(a) ||
    (b.recency ?? 0) - (a.recency ?? 0),
  );
}

/* --------------------------- concept ↔ content ---------------------------- */

/**
 * Matches a generated card/question to the concept it belongs to, using plain
 * word overlap between the content and the concept text. Deterministic and
 * explainable — good enough for "related flashcards/questions", and easy to
 * replace with an explicit AI reference later.
 */
/** The two fields matching needs, so freshly generated concepts work too. */
export interface MatchableConcept {
  name: string;
  explanation: string;
}

export function matchConcept<T extends MatchableConcept>(
  text: string,
  concepts: T[],
  minimumScore = 0.34,
): T | null {
  const textWords = new Set(keywords(text));
  if (textWords.size === 0) return null;

  let best: { concept: T; score: number } | null = null;
  for (const concept of concepts) {
    const conceptBase = keywords(concept.name);
    if (conceptBase.length === 0) continue;
    const conceptWords = new Set([...conceptBase, ...keywords(concept.explanation).slice(0, 12)]);
    let hit = 0;
    for (const word of conceptWords) if (textWords.has(word)) hit += 1;
    const score = hit / conceptWords.size;
    const nameHit = conceptBase.some((word) => textWords.has(word));
    const weighted = nameHit ? Math.min(1, score + 0.34) : score;
    if (weighted >= minimumScore && (!best || weighted > best.score)) {
      best = { concept, score: weighted };
    }
  }
  return best?.concept ?? null;
}

export function conceptIdForCard(card: Pick<CardRecord, 'question' | 'answer'>, concepts: ConceptRecord[]) {
  return matchConcept(`${card.question} ${card.answer}`, concepts)?.id ?? null;
}

/* ---------------------------- exam + planning ----------------------------- */

/**
 * Whole calendar days from *today* until an ISO calendar day (negative when past).
 *
 * An exam date is a calendar day, not an instant, so "today" has to be the
 * student's local day: at 23:30 UTC on the 8th it is already the 9th in
 * Amsterdam, and the countdown must say so. Both sides are compared as
 * `YYYY-MM-DD` days (pure calendar arithmetic, immune to DST), which removes the
 * off-by-one a UTC-only comparison has around midnight.
 */
export function daysUntil(dayIso: string, now: Date, timeZone: string = DEFAULT_TIMEZONE): number {
  const target = Date.parse(`${dayIso}T00:00:00Z`);
  if (Number.isNaN(target)) return 0;
  const today = Date.parse(`${todayInZone(timeZone, now)}T00:00:00Z`);
  return Math.round((target - today) / 86_400_000);
}

export function addDaysIso(dayIso: string, days: number): string {
  const base = Date.parse(`${dayIso}T00:00:00Z`);
  const result = new Date((Number.isNaN(base) ? Date.now() : base) + days * 86_400_000);
  return result.toISOString().slice(0, 10);
}

/** Today's calendar day (YYYY-MM-DD) in the student's timezone (UTC by default). */
export function todayIso(now: Date = new Date(), timeZone: string = DEFAULT_TIMEZONE): string {
  return todayInZone(timeZone, now);
}

/* --------------------------- recommended action --------------------------- */

export interface PackStats {
  readySources: number;
  totalSources: number;
  concepts: number;
  flashcards: number;
  practiceQuestions: number;
  dueCards: number;
  weakConcepts: { id: string; name: string }[];
  unlearnedConcepts: number;
  /** Accuracy over graded practice answers (0..1) or null when none yet. */
  accuracy: number | null;
}

export type RecommendedAction =
  | { type: 'add-source'; label: string; description: string }
  | { type: 'generate-concepts'; label: string; description: string }
  | { type: 'generate-flashcards'; label: string; description: string }
  | { type: 'generate-practice'; label: string; description: string }
  | { type: 'learn'; label: string; description: string; conceptId: string | null; conceptName: string | null }
  | { type: 'review'; label: string; description: string }
  | { type: 'practice'; label: string; description: string; conceptId: string | null; conceptName: string | null }
  | { type: 'test'; label: string; description: string };

/**
 * The single next action for a student, in the order that actually helps most:
 * material → understanding → recall → practice → testing.
 */
export function recommendNextAction(stats: PackStats): RecommendedAction {
  if (stats.totalSources === 0) {
    return {
      type: 'add-source',
      label: 'Add study material',
      description: 'Add notes, a PDF or an existing set so Lerno can build this pack.',
    };
  }
  if (stats.readySources === 0) {
    return {
      type: 'generate-concepts',
      label: 'Finish processing your material',
      description: 'Your source is still processing. Come back in a moment.',
    };
  }
  if (stats.concepts === 0) {
    return {
      type: 'generate-concepts',
      label: 'Extract key concepts',
      description: 'Let Lerno find the key concepts in your material.',
    };
  }
  const weakest = stats.weakConcepts[0];
  if (weakest) {
    return {
      type: 'practice',
      label: `Practice: ${weakest.name}`,
      description: `You're weakest on ${stats.weakConcepts.length} concept${stats.weakConcepts.length === 1 ? '' : 's'}.`,
      conceptId: weakest.id,
      conceptName: weakest.name,
    };
  }
  if (stats.dueCards > 0) {
    return {
      type: 'review',
      label: `Review ${stats.dueCards} due card${stats.dueCards === 1 ? '' : 's'}`,
      description: 'Spaced repetition says these are ready to come back.',
    };
  }
  if (stats.unlearnedConcepts > 0) {
    return {
      type: 'learn',
      label: `Learn ${Math.min(stats.unlearnedConcepts, 5)} new concept${stats.unlearnedConcepts === 1 ? '' : 's'}`,
      description: 'Understand the material before practising it.',
      conceptId: null,
      conceptName: null,
    };
  }
  if (stats.flashcards === 0) {
    return {
      type: 'generate-flashcards',
      label: 'Generate flashcards',
      description: 'Turn your concepts into cards you can study and review.',
    };
  }
  if (stats.practiceQuestions === 0) {
    return {
      type: 'generate-practice',
      label: 'Generate practice questions',
      description: 'Check whether you really understand the material.',
    };
  }
  return {
    type: 'test',
    label: 'Take a practice test',
    description: 'Test yourself under exam conditions to find the last gaps.',
  };
}

/** Overall mastery of a pack: average mastery over its concepts (0..100). */
export function packMasteryPercent(concepts: number, masteryValues: number[]): number {
  if (concepts === 0) return 0;
  const sum = masteryValues.reduce((total, value) => total + value, 0);
  return Math.round((sum / concepts) * 100);
}
