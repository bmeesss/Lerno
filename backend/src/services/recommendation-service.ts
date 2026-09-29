/**
 * Recommendation service — the adaptive engine's decisions in one place.
 *
 * "What should this student do next?" and "which questions go in this
 * session?" are answered here from the PR #13 building blocks (concept mastery,
 * learning events, attempts, `rankRecommendations` with its exam boost). Today,
 * the planner, the subject page and the end-of-session summary all ask this
 * module, so they can never disagree about what matters.
 *
 * Everything is a pure function of already-loaded data: deterministic, unit
 * testable and free of AI. The rules are written down as named constants so
 * they can be read and argued with.
 */
import type {
  AnswerVerdict,
  ConceptRecord,
  LearningSessionItemRecord,
  LearningSessionRecord,
  LearningSessionType,
  PracticeAttemptRecord,
  PracticeQuestionRecord,
  QuestionType,
  SessionNextStep,
  StudySessionRecord,
  TestAttemptRecord,
  TestMode,
} from '../lib/db/types.js';
import { DEFAULT_TIMEZONE } from '../lib/timezone.js';
import type { PackSummarySnapshot } from './pack-data.js';
import {
  cardMinutes,
  isResumable,
  learnMinutes,
  positionLabel,
  questionMinutes,
  sessionLabel,
} from './session-model.js';
import {
  daysUntil,
  emptyMastery,
  isConceptDue,
  isWeakConcept,
  learnReason,
  rankLearnCandidates,
  rankRecommendations,
  STRONG_MASTERY_THRESHOLD,
  WEAK_MASTERY_THRESHOLD,
  type LearnCandidate,
  type LearnReason,
  type MasteryState,
} from './study-pack-rules.js';

/* ---------------------------------- tasks --------------------------------- */

export type TaskType =
  | 'continue'
  | 'learn'
  | 'practice'
  | 'review'
  | 'test'
  | 'generate-concepts'
  | 'generate-practice'
  | 'add-material';

export type TaskReason =
  | 'continue'
  | 'weak'
  | 'mistakes'
  | 'due-cards'
  | 'due-concepts'
  | 'new'
  | 'exam'
  | 'material'
  | 'ready'
  | 'fallback';

/**
 * One recommended activity. `type` keeps the meaning it always had ("review" =
 * flashcards that are due); `sessionType` says which study session the button
 * starts, or null when the activity lives elsewhere (cards, generating content).
 */
export interface RecommendationTask {
  type: TaskType;
  label: string;
  /** Long-standing sentence, kept for existing clients. */
  description: string;
  /** Short, student-facing reason: "You missed 3 recent questions". */
  reasonText: string;
  reason: TaskReason;
  packId: string | null;
  packTitle: string | null;
  subjectId: string | null;
  subjectName: string | null;
  conceptId: string | null;
  conceptName: string | null;
  sessionType: LearningSessionType | null;
  /** Set for "continue": the open session to resume. */
  sessionId: string | null;
  mode: TestMode | null;
  /** How many items the launched session contains (concepts or questions). */
  count: number | null;
  minutes: number;
  examDaysLeft: number | null;
}

export interface TaskCandidate extends RecommendationTask {
  priority: number;
  recency: number;
}

/**
 * Base priorities. The exam boost from `recommendationScore` (+50/+35/+20/+8 at
 * ≤2/7/14/30 days) is added on top when candidates are ranked, so a nearer exam
 * lifts every activity of that pack — never a hardcoded subject order.
 */
export const PRIORITY = {
  continue: 125,
  weak: 110,
  mistakes: 106,
  dueCards: 100,
  dueConcepts: 95,
  newConcept: 90,
  generateConcepts: 85,
  examSimulation: 80,
  generatePractice: 65,
  test: 60,
  fallback: 55,
} as const;

/** How many items a session launched from a recommendation contains. */
export const TASK_COUNTS = {
  learn: 3,
  practiceFocus: 5,
  practice: 10,
  review: 8,
  test: 10,
  cards: 15,
} as const;

/** Exam simulation is suggested this close to the exam. */
export const EXAM_SIMULATION_WITHIN_DAYS = 3;
const MISTAKE_WINDOW_DAYS = 7;

export interface RecommendationContext {
  now: Date;
  timeZone: string;
  /** Concept id → wrong answers within the last 7 days. */
  recentMistakes: ReadonlyMap<string, number>;
  /** Open (not finished, not abandoned) study sessions, any pack. */
  openSessions: LearningSessionRecord[];
  /** Classic flashcard sessions started but not ended. */
  openFlashcardSessions: StudySessionRecord[];
}

export function emptyContext(now: Date, timeZone: string = DEFAULT_TIMEZONE): RecommendationContext {
  return {
    now,
    timeZone,
    recentMistakes: new Map(),
    openSessions: [],
    openFlashcardSessions: [],
  };
}

/** Wrong answers per concept over the recent window, from practice and test attempts. */
export function collectRecentMistakes(
  snapshots: Pick<PackSummarySnapshot, 'progress'>[],
  now: Date,
  windowDays: number = MISTAKE_WINDOW_DAYS,
): Map<string, number> {
  const since = now.getTime() - windowDays * 86_400_000;
  const mistakes = new Map<string, number>();
  const bump = (conceptId: string | null | undefined) => {
    if (conceptId) mistakes.set(conceptId, (mistakes.get(conceptId) ?? 0) + 1);
  };
  for (const snapshot of snapshots) {
    for (const attempt of snapshot.progress.attempts) {
      if (attempt.verdict === 'incorrect' && Date.parse(attempt.createdAt) >= since) {
        bump(attempt.conceptId);
      }
    }
    for (const testAttempt of snapshot.progress.testAttempts) {
      if (Date.parse(testAttempt.createdAt) < since) continue;
      for (const answer of testAttempt.answers) {
        if (answer.verdict === 'incorrect') bump(answer.conceptId);
      }
    }
  }
  return mistakes;
}

/** The fields a candidate has to provide; pack facts and defaults are filled in. */
type TaskInit = Pick<
  RecommendationTask,
  'type' | 'label' | 'description' | 'reasonText' | 'reason' | 'conceptId' | 'conceptName' | 'sessionType' | 'minutes'
> &
  Partial<Pick<RecommendationTask, 'mode' | 'count' | 'sessionId'>>;

function plural(count: number, one: string, many: string = `${one}s`): string {
  return count === 1 ? one : many;
}

function baseTask(snapshot: PackSummarySnapshot, ctx: RecommendationContext) {
  const { pack } = snapshot;
  return {
    packId: pack.id,
    packTitle: pack.title,
    subjectId: pack.subjectId,
    subjectName: pack.subjectName,
    examDaysLeft: pack.examDate ? daysUntil(pack.examDate, ctx.now, ctx.timeZone) : null,
  };
}

function lastActivity(snapshot: PackSummarySnapshot): number {
  const latest = snapshot.progress.activity.slice().sort().at(-1);
  return latest ? Date.parse(latest) : 0;
}

/**
 * Every activity worth doing in one pack, each with its base priority. The
 * order is decided later, across all packs, by `rankRecommendations`.
 */
export function packCandidates(
  snapshot: PackSummarySnapshot,
  ctx: RecommendationContext,
): TaskCandidate[] {
  const { pack, context, progress, summary } = snapshot;
  const base = baseTask(snapshot, ctx);
  const candidates: TaskCandidate[] = [];
  const add = (task: TaskInit, priority: number, recency: number = lastActivity(snapshot)) => {
    candidates.push({ mode: null, count: null, sessionId: null, ...base, ...task, priority, recency });
  };

  /* Continue: an open study session is always the first thing to offer. */
  const openHere = ctx.openSessions
    .filter((session) => session.packId === pack.id && isResumable(session, ctx.now))
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))[0];
  if (openHere) {
    const remaining = Math.max(1, openHere.itemCount - openHere.answeredCount);
    add(
      {
        type: 'continue',
        label: `Continue ${sessionLabel(openHere, pack.title)}`,
        description: positionLabel(openHere),
        reasonText: `You stopped at ${positionLabel(openHere).toLowerCase()}.`,
        reason: 'continue',
        conceptId: openHere.focusConceptId,
        conceptName: null,
        sessionType: openHere.type,
        sessionId: openHere.id,
        mode: openHere.mode,
        count: openHere.itemCount,
        minutes: openHere.type === 'learn' ? learnMinutes(remaining) : questionMinutes(remaining),
      },
      PRIORITY.continue,
      Date.parse(openHere.lastActivityAt),
    );
  }

  const openCards = ctx.openFlashcardSessions
    .filter((session) => pack.legacySetId && session.setId === pack.legacySetId && !session.endedAt)
    .filter((session) => ctx.now.getTime() - Date.parse(session.startedAt) <= 24 * 60 * 60 * 1000)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  if (openCards && !openHere) {
    add(
      {
        type: 'continue',
        label: `Continue ${pack.title}`,
        description: 'You have an unfinished study session.',
        reasonText: 'You have an unfinished flashcard session.',
        reason: 'continue',
        conceptId: null,
        conceptName: null,
        sessionType: null,
        minutes: cardMinutes(TASK_COUNTS.cards),
      },
      PRIORITY.continue,
      Date.parse(openCards.startedAt),
    );
  }

  /* Practice focus: the concept that needs it most (weak, or missed recently). */
  const questionCount = (conceptId: string) =>
    context.questions.filter((question) => question.conceptId === conceptId).length;
  const focus = progress.conceptStates
    .filter(({ state }) => state.attempts > 0 && state.mastery < STRONG_MASTERY_THRESHOLD)
    .map((entry) => {
      const mistakes = ctx.recentMistakes.get(entry.concept.id) ?? 0;
      const weak = isWeakConcept(entry.state);
      return {
        ...entry,
        mistakes,
        weak,
        score: (weak ? 100 : 0) + mistakes * 15 + (1 - entry.state.mastery) * 30,
      };
    })
    .filter((entry) => entry.weak || entry.mistakes > 0)
    .sort((a, b) => b.score - a.score || a.concept.position - b.concept.position)[0];
  if (focus) {
    const hasPractice = questionCount(focus.concept.id) > 0;
    const percent = Math.round(focus.state.mastery * 100);
    add(
      {
        type: hasPractice ? 'practice' : 'learn',
        label: `${hasPractice ? 'Practice' : 'Learn'} ${focus.concept.name}`,
        description:
          focus.mistakes > 0
            ? `You answered ${focus.mistakes} ${plural(focus.mistakes, 'question')} incorrectly recently.`
            : `Mastery is ${percent}%; this concept needs another pass.`,
        reasonText:
          focus.mistakes > 0
            ? `You missed ${focus.mistakes} recent ${plural(focus.mistakes, 'question')}.`
            : `Mastery is ${percent}% — this concept needs another pass.`,
        reason: focus.mistakes > 0 ? 'mistakes' : 'weak',
        conceptId: focus.concept.id,
        conceptName: focus.concept.name,
        sessionType: hasPractice ? 'practice' : 'learn',
        count: hasPractice ? TASK_COUNTS.practiceFocus : 1,
        minutes: hasPractice ? questionMinutes(TASK_COUNTS.practiceFocus) : learnMinutes(1),
      },
      focus.weak ? PRIORITY.weak : PRIORITY.mistakes,
      focus.state.lastPracticedAt ? Date.parse(focus.state.lastPracticedAt) : 0,
    );
  }

  /* Cards that are due (spaced repetition on flashcards). */
  if (summary.dueCards > 0) {
    add(
      {
        type: 'review',
        label: `Review ${summary.dueCards} ${plural(summary.dueCards, 'card')} · ${pack.title}`,
        description: `${summary.dueCards} cards are due today according to spaced repetition.`,
        reasonText: `${summary.dueCards} ${plural(summary.dueCards, 'card is', 'cards are')} due today.`,
        reason: 'due-cards',
        conceptId: null,
        conceptName: null,
        sessionType: null,
        count: Math.min(summary.dueCards, TASK_COUNTS.cards),
        minutes: cardMinutes(Math.min(summary.dueCards, TASK_COUNTS.cards)),
      },
      PRIORITY.dueCards,
    );
  }

  /* Concepts whose review date has passed (not weak: those are handled above). */
  const dueConcepts = progress.conceptStates
    .filter(
      ({ concept, state }) =>
        state.attempts > 0 &&
        !isWeakConcept(state) &&
        isConceptDue(state, ctx.now) &&
        questionCount(concept.id) > 0 &&
        concept.id !== focus?.concept.id,
    )
    .sort(
      (a, b) =>
        (a.state.nextReviewAt ?? '').localeCompare(b.state.nextReviewAt ?? '') ||
        a.state.mastery - b.state.mastery,
    );
  if (dueConcepts.length > 0) {
    const first = dueConcepts[0]!;
    const count = Math.min(TASK_COUNTS.review, dueConcepts.length * 2);
    add(
      {
        type: 'review',
        label:
          dueConcepts.length === 1
            ? `Review ${first.concept.name}`
            : `Review ${dueConcepts.length} concepts · ${pack.title}`,
        description: `${dueConcepts.length} ${plural(dueConcepts.length, 'concept is', 'concepts are')} ready for a spaced review.`,
        reasonText:
          dueConcepts.length === 1
            ? `${first.concept.name} is due for review.`
            : `${dueConcepts.length} concepts are due for review.`,
        reason: 'due-concepts',
        conceptId: first.concept.id,
        conceptName: first.concept.name,
        sessionType: 'review',
        count,
        minutes: questionMinutes(count),
      },
      PRIORITY.dueConcepts,
      first.state.lastPracticedAt ? Date.parse(first.state.lastPracticedAt) : 0,
    );
  }

  /* New material: understand it before being tested on it. */
  const fresh = progress.conceptStates.filter(({ state }) => state.attempts === 0);
  if (fresh.length > 0) {
    const first = fresh[0]!;
    const count = Math.min(TASK_COUNTS.learn, fresh.length);
    add(
      {
        type: 'learn',
        label: `Learn ${first.concept.name}`,
        description: 'This concept is new, so start by understanding it.',
        reasonText:
          fresh.length === 1
            ? 'This concept is new to you.'
            : `${fresh.length} concepts are new to you.`,
        reason: 'new',
        conceptId: first.concept.id,
        conceptName: first.concept.name,
        sessionType: 'learn',
        count,
        minutes: learnMinutes(count),
      },
      PRIORITY.newConcept,
    );
  }

  /* Pack setup gaps, and the "ready for a test" nudge. */
  const readySource = context.sources.some((source) => source.status === 'ready');
  if (context.concepts.length === 0 && readySource) {
    add(
      {
        type: 'generate-concepts',
        label: `Extract concepts · ${pack.title}`,
        description: 'Your material is ready, but it does not have concepts to study yet.',
        reasonText: 'Your material is ready, but has no concepts to study yet.',
        reason: 'material',
        conceptId: null,
        conceptName: null,
        sessionType: null,
        minutes: 2,
      },
      PRIORITY.generateConcepts,
    );
  } else if (context.questions.length === 0 && context.concepts.length > 0) {
    add(
      {
        type: 'generate-practice',
        label: `Create practice questions · ${pack.title}`,
        description: 'Add practice questions to check what you remember.',
        reasonText: 'Practice questions let you check what you remember.',
        reason: 'material',
        conceptId: null,
        conceptName: null,
        sessionType: null,
        minutes: 2,
      },
      PRIORITY.generatePractice,
    );
  } else if (
    context.questions.length > 0 &&
    progress.conceptStates.every((entry) => entry.state.mastery >= STRONG_MASTERY_THRESHOLD)
  ) {
    add(
      {
        type: 'test',
        label: `Prepare for a test · ${pack.title}`,
        description: 'Your concepts look strong. A test can confirm they have stuck.',
        reasonText: 'Your concepts look strong — a test can confirm it.',
        reason: 'ready',
        conceptId: null,
        conceptName: null,
        sessionType: 'test',
        mode: 'quick10',
        count: Math.min(TASK_COUNTS.test, context.questions.length),
        minutes: questionMinutes(Math.min(TASK_COUNTS.test, context.questions.length)),
      },
      PRIORITY.test,
    );
  }

  /* Close to the exam: rehearse under exam conditions unless one was just taken. */
  if (
    base.examDaysLeft !== null &&
    base.examDaysLeft >= 0 &&
    base.examDaysLeft <= EXAM_SIMULATION_WITHIN_DAYS &&
    context.questions.length >= 5
  ) {
    const lastTest = progress.testAttempts
      .map((attempt) => Date.parse(attempt.createdAt))
      .sort((a, b) => b - a)[0];
    const testedRecently = lastTest !== undefined && ctx.now.getTime() - lastTest < 2 * 86_400_000;
    if (!testedRecently) {
      const count = Math.min(25, context.questions.length);
      add(
        {
          type: 'test',
          label: `Exam simulation · ${pack.title}`,
          description: 'The exam is close. Rehearse it once without hints.',
          reasonText:
            base.examDaysLeft === 0
              ? 'Your exam is today.'
              : `Your exam is in ${base.examDaysLeft} ${plural(base.examDaysLeft, 'day')}.`,
          reason: 'exam',
          conceptId: null,
          conceptName: null,
          sessionType: 'test',
          mode: 'exam',
          count,
          minutes: questionMinutes(count),
        },
        PRIORITY.examSimulation,
      );
    }
  }

  /* Existing recommendation rules stay the safe fallback for thin packs. */
  if (progress.recommended.type === 'learn' && !focus && fresh.length === 0) {
    add(
      {
        type: 'learn',
        label: progress.recommended.label,
        description: progress.recommended.description,
        reasonText: progress.recommended.description,
        reason: 'fallback',
        conceptId: progress.recommended.conceptId,
        conceptName: progress.recommended.conceptName,
        sessionType: 'learn',
        count: 1,
        minutes: learnMinutes(1),
      },
      PRIORITY.fallback,
    );
  }

  return candidates;
}

/** What to show a student with nothing to study yet. */
export function addMaterialTask(): RecommendationTask {
  return {
    type: 'add-material',
    label: 'Add study material',
    description: 'Upload notes or a PDF and Lerno will build your first study pack.',
    reasonText: 'Upload notes or a PDF and Lerno builds your first study pack.',
    reason: 'material',
    packId: null,
    packTitle: null,
    subjectId: null,
    subjectName: null,
    conceptId: null,
    conceptName: null,
    sessionType: null,
    sessionId: null,
    mode: null,
    count: null,
    minutes: 0,
    examDaysLeft: null,
  };
}

export function toTask(candidate: TaskCandidate): RecommendationTask {
  const { priority: _priority, recency: _recency, ...task } = candidate;
  return task;
}

/**
 * All activities across the given packs, best first: base priority plus the
 * exam boost, then most recent activity. Always returns at least one task.
 */
export function rankTasks(
  snapshots: PackSummarySnapshot[],
  ctx: RecommendationContext,
): RecommendationTask[] {
  const candidates = snapshots.flatMap((snapshot) => packCandidates(snapshot, ctx));
  if (candidates.length === 0) return [addMaterialTask()];
  return rankRecommendations(candidates).map(toTask);
}

/** The single best next activity for one pack (used by the subject page and pack views). */
export function bestTaskForPack(
  snapshot: PackSummarySnapshot,
  ctx: RecommendationContext,
): RecommendationTask | null {
  const ranked = rankRecommendations(packCandidates(snapshot, ctx));
  return ranked[0] ? toTask(ranked[0]) : null;
}

/* ------------------------------ learn selection ----------------------------- */

export interface LearnSelection extends LearnCandidate {
  reason: LearnReason;
}

/** Concepts confirmed after the rest, at most this many per Learn session. */
const MAX_CONFIRMATIONS = 2;

/**
 * Concepts for a Learn session: weak → new → learning → due → mastered
 * confirmation (the existing ranking). A requested focus concept goes first;
 * mastered concepts only fill up what is left, so Learn never pads a session
 * with things the student already knows.
 */
export function selectLearnConcepts(input: {
  concepts: ConceptRecord[];
  states: ReadonlyMap<string, MasteryState>;
  limit: number;
  focusConceptId?: string | null;
  now: Date;
}): LearnSelection[] {
  const ranked = rankLearnCandidates(
    input.concepts.map((concept) => ({
      concept,
      state: input.states.get(concept.id) ?? emptyMastery(),
    })),
    [],
    input.now,
  ).map((candidate) => ({ ...candidate, reason: learnReason(candidate.state, input.now) }));

  const open = ranked.filter((candidate) => candidate.reason !== 'confirmation');
  const confirmations = ranked.filter((candidate) => candidate.reason === 'confirmation');
  const ordered = [...open, ...confirmations.slice(0, MAX_CONFIRMATIONS)];

  const focus = input.focusConceptId
    ? ranked.find((candidate) => candidate.concept.id === input.focusConceptId)
    : undefined;
  const list = focus
    ? [focus, ...ordered.filter((candidate) => candidate.concept.id !== focus.concept.id)]
    : ordered;
  return list.slice(0, Math.max(1, input.limit));
}

/* ----------------------------- question selection --------------------------- */

/** What the student has already done with a question. */
export interface QuestionHistory {
  lastVerdict: AnswerVerdict | null;
  lastAnsweredAt: number | null;
  /** Last time the question was answered or skipped, in any session. */
  lastSeenAt: number | null;
  timesSeen: number;
}

const EMPTY_HISTORY: QuestionHistory = {
  lastVerdict: null,
  lastAnsweredAt: null,
  lastSeenAt: null,
  timesSeen: 0,
};

/**
 * Question history from what is already stored — practice attempts, test
 * answers and the session items the student answered or skipped. Nothing new
 * is recorded for this: exposure is derived from the learner's own history.
 */
export function buildQuestionHistory(input: {
  attempts: Pick<PracticeAttemptRecord, 'questionId' | 'verdict' | 'createdAt'>[];
  testAttempts: Pick<TestAttemptRecord, 'answers' | 'createdAt'>[];
  seenItems: Pick<LearningSessionItemRecord, 'questionId' | 'verdict' | 'answeredAt' | 'createdAt' | 'status'>[];
}): Map<string, QuestionHistory> {
  const history = new Map<string, QuestionHistory>();
  const touch = (
    questionId: string | null,
    at: string | null,
    verdict: AnswerVerdict | null,
  ) => {
    if (!questionId || !at) return;
    const time = Date.parse(at);
    if (!Number.isFinite(time)) return;
    const entry = { ...(history.get(questionId) ?? EMPTY_HISTORY) };
    entry.timesSeen += 1;
    if (entry.lastSeenAt === null || time > entry.lastSeenAt) entry.lastSeenAt = time;
    if (verdict && (entry.lastAnsweredAt === null || time >= entry.lastAnsweredAt)) {
      entry.lastAnsweredAt = time;
      entry.lastVerdict = verdict;
    }
    history.set(questionId, entry);
  };
  for (const attempt of input.attempts) touch(attempt.questionId, attempt.createdAt, attempt.verdict);
  for (const attempt of input.testAttempts) {
    for (const answer of attempt.answers) touch(answer.questionId, attempt.createdAt, answer.verdict);
  }
  for (const item of input.seenItems) {
    if (item.status === 'skipped') touch(item.questionId, item.answeredAt ?? item.createdAt, null);
  }
  return history;
}

/** Named constants of the question scoring: read, don't guess. */
export const QUESTION_SCORING = {
  concept: { weak: 100, due: 60, new: 45, learning: 40 },
  question: { recentMistake: 70, unseen: 35, recentSuccess: -60, recentlyShown: -40 },
  mistakeWindowDays: 14,
  successWindowDays: 3,
  shownWindowHours: 24,
  focusBonus: 200,
  /** Strong concepts count for less while the exam is near. */
  examMasteredPenalty: 15,
  diversity: { sameConcept: 25, sameTypeInARow: 8 },
} as const;

const TYPE_LEVEL: Record<QuestionType, number> = {
  true_false: 1,
  multiple_choice: 2,
  short_answer: 3,
};

const DAY_MS = 86_400_000;

function examUrgency(daysLeft: number | null): number {
  if (daysLeft === null || daysLeft < 0) return 0;
  if (daysLeft <= 2) return 30;
  if (daysLeft <= 7) return 20;
  if (daysLeft <= 14) return 10;
  return 0;
}

/** Recall gets harder as mastery grows: true/false → multiple choice → short answer. */
export function targetDifficultyLevel(state: MasteryState, concept: ConceptRecord | null): number {
  const base = state.mastery < WEAK_MASTERY_THRESHOLD ? 1 : state.mastery < 0.6 ? 2 : 3;
  if (concept?.difficulty === 'hard') return Math.max(1, base - 1);
  if (concept?.difficulty === 'easy') return Math.min(3, base + 1);
  return base;
}

export interface ScoreInput {
  question: PracticeQuestionRecord;
  concept: ConceptRecord | null;
  state: MasteryState;
  history: QuestionHistory;
  now: Date;
  examDaysLeft: number | null;
  focusConceptId?: string | null;
}

export interface ScoredQuestion {
  score: number;
  /** Why the question is here — the strongest factor, for the UI. */
  reason: 'weak' | 'due' | 'mistake' | 'new' | 'learning' | 'focus' | 'mixed';
}

/**
 * How much a question is worth asking right now. Mastery of its concept
 * decides most (weak, due, new, learning); the question's own history adjusts
 * it (missed recently → again, answered well a moment ago → not again, never
 * seen → preferred); difficulty and the exam date break ties.
 */
export function scoreQuestion(input: ScoreInput): ScoredQuestion {
  const { question, concept, state, history, now } = input;
  const weights = QUESTION_SCORING;
  let score = 0;
  const factors: { reason: ScoredQuestion['reason']; points: number }[] = [];
  const add = (points: number, reason?: ScoredQuestion['reason']) => {
    score += points;
    if (reason && points > 0) factors.push({ reason, points });
  };

  const mastered = state.attempts > 0 && state.mastery >= STRONG_MASTERY_THRESHOLD;
  if (isWeakConcept(state)) add(weights.concept.weak, 'weak');
  else if (state.attempts === 0) add(weights.concept.new, 'new');
  else if (state.mastery < 0.6) add(weights.concept.learning, 'learning');
  if (state.attempts > 0 && isConceptDue(state, now)) add(weights.concept.due, 'due');
  // Fine-tune inside a tier: lower mastery first.
  add((1 - state.mastery) * 20);

  const answeredAgo =
    history.lastAnsweredAt === null ? Infinity : now.getTime() - history.lastAnsweredAt;
  if (history.lastVerdict === 'incorrect' && answeredAgo <= weights.mistakeWindowDays * DAY_MS) {
    add(weights.question.recentMistake, 'mistake');
  } else if (history.timesSeen === 0) {
    add(weights.question.unseen);
  }
  if (history.lastVerdict === 'correct' && answeredAgo <= weights.successWindowDays * DAY_MS) {
    add(weights.question.recentSuccess);
  }
  if (
    history.lastSeenAt !== null &&
    now.getTime() - history.lastSeenAt <= weights.shownWindowHours * 3_600_000
  ) {
    add(weights.question.recentlyShown);
  }

  const gap = Math.abs(TYPE_LEVEL[question.questionType] - targetDifficultyLevel(state, concept));
  add(12 - 8 * gap);

  const daysLeft = input.examDaysLeft;
  if (!mastered) add(examUrgency(daysLeft));
  else if (daysLeft !== null && daysLeft >= 0 && daysLeft <= 14) add(-weights.examMasteredPenalty);
  add((concept?.importance ?? 0) * 10);

  if (input.focusConceptId && question.conceptId === input.focusConceptId) {
    add(weights.focusBonus, 'focus');
  }
  const reason = factors.sort((a, b) => b.points - a.points)[0]?.reason ?? 'mixed';
  return { score, reason };
}

export interface SelectedQuestion {
  question: PracticeQuestionRecord;
  reason: ScoredQuestion['reason'];
}

/**
 * Picks `count` questions for a Practice or Review session, best first, never
 * the same question twice. Picks are greedy with a diversity penalty, so one
 * concept or one question format cannot fill the whole session while other
 * weak concepts wait.
 */
export function selectAdaptiveQuestions(input: {
  questions: PracticeQuestionRecord[];
  concepts: ConceptRecord[];
  states: ReadonlyMap<string, MasteryState>;
  history: ReadonlyMap<string, QuestionHistory>;
  now: Date;
  count: number;
  focusConceptId?: string | null;
  /** Restrict to these concepts (Review sessions). */
  onlyConceptIds?: ReadonlySet<string> | null;
  excludeQuestionIds?: ReadonlySet<string>;
  examDaysLeft?: number | null;
}): SelectedQuestion[] {
  const conceptById = new Map(input.concepts.map((concept) => [concept.id, concept]));
  const pool = input.questions
    .filter((question) => !input.excludeQuestionIds?.has(question.id))
    .filter(
      (question) =>
        !input.onlyConceptIds || (question.conceptId !== null && input.onlyConceptIds.has(question.conceptId)),
    )
    .map((question) => {
      const concept = question.conceptId ? (conceptById.get(question.conceptId) ?? null) : null;
      const state = (concept && input.states.get(concept.id)) || emptyMastery();
      const scored = scoreQuestion({
        question,
        concept,
        state,
        history: input.history.get(question.id) ?? EMPTY_HISTORY,
        now: input.now,
        examDaysLeft: input.examDaysLeft ?? null,
        focusConceptId: input.focusConceptId,
      });
      return { question, ...scored };
    });

  const picked: SelectedQuestion[] = [];
  const perConcept = new Map<string, number>();
  const target = Math.max(0, Math.min(input.count, pool.length));
  while (picked.length < target) {
    const previous = picked[picked.length - 1]?.question;
    let best: (typeof pool)[number] | null = null;
    let bestScore = -Infinity;
    for (const candidate of pool) {
      if (picked.some((entry) => entry.question.id === candidate.question.id)) continue;
      const key = candidate.question.conceptId ?? candidate.question.id;
      let adjusted = candidate.score - (perConcept.get(key) ?? 0) * QUESTION_SCORING.diversity.sameConcept;
      if (previous && previous.questionType === candidate.question.questionType) {
        adjusted -= QUESTION_SCORING.diversity.sameTypeInARow;
      }
      if (
        adjusted > bestScore ||
        (adjusted === bestScore &&
          best &&
          (candidate.question.position < best.question.position ||
            (candidate.question.position === best.question.position && candidate.question.id < best.question.id)))
      ) {
        best = candidate;
        bestScore = adjusted;
      }
    }
    if (!best) break;
    picked.push({ question: best.question, reason: best.reason });
    const key = best.question.conceptId ?? best.question.id;
    perConcept.set(key, (perConcept.get(key) ?? 0) + 1);
  }
  return picked;
}

/** An exam simulation covers the pack, up to this many questions. */
export const EXAM_QUESTION_CAP = 25;

/** How many questions a test of this mode holds for a pack with `available` questions. */
export function testQuestionCount(mode: TestMode, available: number): number {
  const requested =
    mode === 'quick10'
      ? 10
      : mode === 'quick20'
        ? 20
        : Math.min(EXAM_QUESTION_CAP, Math.max(10, available));
  return Math.min(requested, available);
}

/**
 * Questions for a test: broad coverage (round-robin over concepts) with the
 * weak concepts first — a test measures, so it is not tuned to make the
 * student feel good. Inside a concept the least recently seen question goes
 * first, so repeated tests do not keep asking the same ones.
 */
export function selectTestQuestions(input: {
  questions: PracticeQuestionRecord[];
  weakConceptIds: ReadonlySet<string>;
  history: ReadonlyMap<string, QuestionHistory>;
  count: number;
}): PracticeQuestionRecord[] {
  const groups = new Map<string, PracticeQuestionRecord[]>();
  for (const question of input.questions) {
    const key = question.conceptId ?? `unassigned-${question.id}`;
    const list = groups.get(key) ?? [];
    list.push(question);
    groups.set(key, list);
  }
  const seenAt = (question: PracticeQuestionRecord) =>
    input.history.get(question.id)?.lastSeenAt ?? -1;
  for (const list of groups.values()) {
    list.sort((a, b) => seenAt(a) - seenAt(b) || a.position - b.position);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => {
    const aWeak = input.weakConceptIds.has(a) ? 0 : 1;
    const bWeak = input.weakConceptIds.has(b) ? 0 : 1;
    return aWeak - bWeak;
  });
  const selected: PracticeQuestionRecord[] = [];
  for (let index = 0; selected.length < input.count; index += 1) {
    let added = false;
    for (const [, list] of ordered) {
      if (list[index] && selected.length < input.count) {
        selected.push(list[index]!);
        added = true;
      }
    }
    if (!added) break;
  }
  return selected;
}

/** Difficulty of a set of picked questions, for the pre-start screen. */
export function describeDifficulty(
  picked: SelectedQuestion[],
  states: ReadonlyMap<string, MasteryState>,
  conceptById: ReadonlyMap<string, ConceptRecord>,
): 'easy' | 'medium' | 'hard' {
  if (picked.length === 0) return 'medium';
  const total = picked.reduce((sum, entry) => {
    const concept = entry.question.conceptId ? (conceptById.get(entry.question.conceptId) ?? null) : null;
    const state = (concept && states.get(concept.id)) || emptyMastery();
    return sum + TYPE_LEVEL[entry.question.questionType] * 0.5 + targetDifficultyLevel(state, concept) * 0.5;
  }, 0);
  const average = total / picked.length;
  return average < 1.7 ? 'easy' : average < 2.4 ? 'medium' : 'hard';
}

/* ------------------------------ after a session ----------------------------- */

/**
 * "What now?" once a session is over. The concept the student missed the most
 * is the first candidate ("Practice Osmosis — You missed 3 questions on it");
 * otherwise the pack's best activity from the same engine as Today.
 */
export function nextStepAfterSession(input: {
  /** Pack state AFTER the session's mastery updates were stored. */
  snapshot: PackSummarySnapshot;
  ctx: RecommendationContext;
  /** Concept id → wrong answers in the session that just ended. */
  missed: ReadonlyMap<string, number>;
}): SessionNextStep {
  const { snapshot, ctx, missed } = input;
  const { context, progress } = snapshot;
  const hasQuestions = (conceptId: string) =>
    context.questions.some((question) => question.conceptId === conceptId);

  const missedConcept = progress.conceptStates
    .filter(({ concept, state }) => (missed.get(concept.id) ?? 0) > 0 && state.mastery < STRONG_MASTERY_THRESHOLD)
    .sort(
      (a, b) =>
        (missed.get(b.concept.id) ?? 0) - (missed.get(a.concept.id) ?? 0) ||
        a.state.mastery - b.state.mastery,
    )[0];
  if (missedConcept && hasQuestions(missedConcept.concept.id)) {
    const count = missed.get(missedConcept.concept.id) ?? 0;
    return {
      type: 'practice',
      label: `Practice ${missedConcept.concept.name}`,
      description: `You missed ${count} ${plural(count, 'question')} on it.`,
      conceptId: missedConcept.concept.id,
      conceptName: missedConcept.concept.name,
    };
  }

  const ranked = rankRecommendations(
    packCandidates(snapshot, ctx).filter(
      (candidate) => candidate.type !== 'continue' && candidate.sessionType !== null,
    ),
  );
  const best = ranked[0];
  if (best) {
    return {
      type: best.sessionType!,
      label: best.label,
      description: best.reasonText,
      conceptId: best.conceptId,
      conceptName: best.conceptName,
    };
  }
  return {
    type: 'practice',
    label: 'Keep practising',
    description: 'A short practice session keeps what you learned fresh.',
    conceptId: null,
    conceptName: null,
  };
}

