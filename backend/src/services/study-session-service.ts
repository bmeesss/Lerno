/**
 * Study session service — the one abstraction behind Learn, Practice, Review and
 * Test: a user studying a pack with a set of target concepts, an ordered list of
 * activities, progress and (once finished) a result.
 *
 *   not_started → active → completed | abandoned
 *
 * The server owns the state, so a session survives a closed tab, a reload or a
 * different device. Every rule that decides *what* is studied comes from the
 * adaptive engine (recommendation-service) and every mastery change goes through
 * the mastery service; this module only sequences them:
 *
 *  - Learn:    concept → explanation → example → check question → self-rating.
 *  - Practice: adaptive questions, instant feedback, mastery updated per answer.
 *  - Review:   spaced review of the concepts that are due.
 *  - Test:     questions are answered without any feedback; answers are saved in
 *              batches and everything is graded, analysed and applied once, at
 *              the end. Nothing about correctness leaves the server before that.
 *
 * No AI is involved anywhere in here.
 */
import type { Database } from '../lib/db/repository.js';
import type {
  AnswerVerdict,
  ConceptRecord,
  LearningSessionItemRecord,
  LearningSessionRecord,
  LearningSessionResult,
  LearningSessionType,
  PracticeQuestionRecord,
  SelfRating,
  SessionConceptChange,
  SessionConceptOutcome,
  SessionNextStep,
  StudyPackRecord,
  TestMode,
} from '../lib/db/types.js';
import { errors } from '../lib/errors.js';
import { findConceptExample, type ConceptExample } from './learn-content.js';
import {
  masteryService,
  percentOf,
  type AppliedOutcome,
  type MasteryOutcome,
} from './mastery-service.js';
import {
  canViewPack,
  examDaysLeft,
  loadPackContext,
  loadPackSnapshots,
  requireOwnedPack,
  requireVisiblePack,
  type PackContextData,
} from './pack-data.js';
import {
  buildQuestionHistory,
  collectRecentMistakes,
  describeDifficulty,
  emptyContext,
  nextStepAfterSession,
  selectAdaptiveQuestions,
  selectLearnConcepts,
  selectTestQuestions,
  testQuestionCount,
  type LearnSelection,
  type QuestionHistory,
  type RecommendationContext,
  type SelectedQuestion,
} from './recommendation-service.js';
import { resolveTimeZone } from './retention-service.js';
import {
  addActiveSeconds,
  canTransition,
  firstOpenPosition,
  IDLE_GAP_CAP_SECONDS,
  isOpenStatus,
  isResumable,
  learnMinutes,
  questionMinutes,
  sessionLabel,
  sessionProgress,
  sessionTitle,
  toResumeCard,
  type ResumeCard,
  type SessionProgress,
} from './session-model.js';
import {
  gradeAnswer,
  isConceptDue,
  isWeakConcept,
  learnReason,
  masteryFromRecord,
  emptyMastery,
  type LearnReason,
  type MasteryState,
} from './study-pack-rules.js';
import { studyPlanService } from './study-plan-service.js';

/* ---------------------------------- input ---------------------------------- */

export interface CreateSessionInput {
  packId: string;
  type: LearningSessionType;
  /** Test sessions only: 10 questions, 20 questions or the exam simulation. */
  mode?: TestMode;
  /** Focus concept ("Practice this concept", "Learn Osmosis"). */
  conceptId?: string | null;
  count?: number;
  /** Abandon an open session of the same kind and start a fresh one. */
  restart?: boolean;
  /** Start right away (default). False leaves it `not_started`. */
  start?: boolean;
}

export interface AnswerInput {
  answer: string;
  responseTimeMs?: number;
}

export const DEFAULT_COUNTS = { learn: 5, practice: 10, review: 8 } as const;
/** Concepts at or above this score in a test count as "You know well". */
export const KNOWN_WELL_PERCENT = 75;

/* ------------------------------- item planning ------------------------------ */

export interface PlannedItem {
  kind: 'concept' | 'question';
  conceptId: string | null;
  questionId: string | null;
}

export interface SessionPlan {
  items: PlannedItem[];
  focusConceptId: string | null;
  targetConceptIds: string[];
  /** Why each question/concept was chosen (for the pre-start screen). */
  reasons: Map<string, string>;
  difficulty: 'easy' | 'medium' | 'hard';
  learn: LearnSelection[];
  selected: SelectedQuestion[];
}

interface PlanInputData {
  type: LearningSessionType;
  mode: TestMode | null;
  count: number;
  focusConceptId: string | null;
  context: PackContextData;
  states: ReadonlyMap<string, MasteryState>;
  history: ReadonlyMap<string, QuestionHistory>;
  weakConceptIds: ReadonlySet<string>;
  now: Date;
  examDaysLeft: number | null;
}

/** Fills in the options a true/false question is always graded against. */
export function withOptions(question: PracticeQuestionRecord): PracticeQuestionRecord {
  if (
    question.questionType === 'true_false' &&
    (!question.options || question.options.length === 0)
  ) {
    return { ...question, options: ['True', 'False'] };
  }
  return question;
}

/** "2" (an option index) → the option text, so a review shows what was chosen. */
export function displayAnswer(question: PracticeQuestionRecord, raw: string): string {
  const answer = raw.trim();
  const options = withOptions(question).options ?? [];
  if (
    (question.questionType === 'multiple_choice' || question.questionType === 'true_false') &&
    /^\d+$/.test(answer) &&
    options[Number.parseInt(answer, 10)] !== undefined
  ) {
    return options[Number.parseInt(answer, 10)]!;
  }
  return answer;
}

/**
 * Chooses the items of a session. Pure: the same data always gives the same
 * plan, which is what makes the pre-start screen and the created session agree.
 */
export function planSessionItems(input: PlanInputData): SessionPlan {
  const { context, states, history, now } = input;
  const conceptById = new Map(context.concepts.map((concept) => [concept.id, concept]));
  const questions = context.questions.map(withOptions);
  const reasons = new Map<string, string>();
  let learn: LearnSelection[] = [];
  let selected: SelectedQuestion[] = [];
  let items: PlannedItem[] = [];

  if (input.type === 'learn') {
    learn = selectLearnConcepts({
      concepts: context.concepts,
      states,
      limit: input.count,
      focusConceptId: input.focusConceptId,
      now,
    });
    const used = new Set<string>();
    items = learn.map((entry) => {
      reasons.set(entry.concept.id, entry.reason);
      const [check] = selectAdaptiveQuestions({
        questions,
        concepts: context.concepts,
        states,
        history,
        now,
        count: 1,
        onlyConceptIds: new Set([entry.concept.id]),
        excludeQuestionIds: used,
        examDaysLeft: input.examDaysLeft,
      });
      if (check) used.add(check.question.id);
      return {
        kind: 'concept' as const,
        conceptId: entry.concept.id,
        questionId: check?.question.id ?? null,
      };
    });
  } else if (input.type === 'test') {
    const chosen = selectTestQuestions({
      questions,
      weakConceptIds: input.weakConceptIds,
      history,
      count: input.count,
    });
    selected = chosen.map((question) => ({ question, reason: 'mixed' as const }));
    items = chosen.map((question) => ({
      kind: 'question' as const,
      conceptId: question.conceptId,
      questionId: question.id,
    }));
  } else {
    // Practice and Review share the adaptive question engine.
    const dueIds =
      input.type === 'review'
        ? new Set(
            context.concepts
              .filter((concept) => {
                const state = states.get(concept.id) ?? emptyMastery();
                return state.attempts > 0 && isConceptDue(state, now);
              })
              .map((concept) => concept.id),
          )
        : null;
    selected = selectAdaptiveQuestions({
      questions,
      concepts: context.concepts,
      states,
      history,
      now,
      count: input.count,
      focusConceptId: input.focusConceptId,
      onlyConceptIds: dueIds,
      examDaysLeft: input.examDaysLeft,
    });
    items = selected.map((entry) => ({
      kind: 'question' as const,
      conceptId: entry.question.conceptId,
      questionId: entry.question.id,
    }));
    for (const entry of selected) {
      if (entry.question.conceptId && !reasons.has(entry.question.conceptId)) {
        reasons.set(entry.question.conceptId, entry.reason);
      }
    }
  }

  return {
    items,
    focusConceptId: input.focusConceptId,
    targetConceptIds: [
      ...new Set(items.flatMap((item) => (item.conceptId ? [item.conceptId] : []))),
    ],
    reasons,
    difficulty: describeDifficulty(selected, states, conceptById),
    learn,
    selected,
  };
}

/* --------------------------------- results ---------------------------------- */

function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/**
 * Assembles the result of a finished session from its items — everything the
 * summary screen shows, computed once and stored on the session.
 */
export function buildSessionResult(input: {
  session: Pick<LearningSessionRecord, 'type' | 'itemCount'>;
  items: LearningSessionItemRecord[];
  conceptNames: ReadonlyMap<string, string>;
  finalStates: ReadonlyMap<string, MasteryState>;
  durationSeconds: number;
  testAttemptId: string | null;
  pack: { weakCount: number; masteryPercent: number };
  next: SessionNextStep;
}): LearningSessionResult {
  const { session, items } = input;
  const isTest = session.type === 'test';
  const scored = items.filter((item) => item.verdict !== null);
  const correct = scored.filter((item) => item.verdict === 'correct').length;
  const partial = scored.filter((item) => item.verdict === 'partial').length;
  const incorrect = scored.filter((item) => item.verdict === 'incorrect').length;
  const score = correct + partial * 0.5;
  const skipped = items.filter((item) => item.status === 'skipped').length;
  // Learn counts rated concepts, the rest count answered questions.
  const answered = items.filter((item) => item.status === 'answered').length;
  // A test counts every question (a blank one is a miss); the rest count what was attempted.
  const denominator = isTest ? session.itemCount : scored.length;

  const byConcept = new Map<string, LearningSessionItemRecord[]>();
  for (const item of items) {
    if (!item.conceptId) continue;
    byConcept.set(item.conceptId, [...(byConcept.get(item.conceptId) ?? []), item]);
  }
  const concepts: SessionConceptChange[] = [];
  const outcomes: SessionConceptOutcome[] = [];
  for (const [conceptId, entries] of byConcept) {
    const ordered = entries.slice().sort((a, b) => a.position - b.position);
    const first = ordered.find((item) => item.masteryBefore !== null);
    const last = ordered
      .slice()
      .reverse()
      .find((item) => item.masteryAfter !== null);
    if (!first || !last) continue;
    const name = input.conceptNames.get(conceptId) ?? '';
    const conceptCorrect = entries.filter((item) => item.verdict === 'correct').length;
    const conceptPartial = entries.filter((item) => item.verdict === 'partial').length;
    const conceptIncorrect = entries.filter((item) => item.verdict === 'incorrect').length;
    concepts.push({
      conceptId,
      name,
      beforePercent: Math.round((first.masteryBefore ?? 0) * 100),
      afterPercent: Math.round((last.masteryAfter ?? 0) * 100),
      answered: entries.filter((item) => item.status === 'answered' || item.verdict !== null)
        .length,
      correct: conceptCorrect,
      incorrect: conceptIncorrect,
    });
    const total = conceptCorrect + conceptPartial + conceptIncorrect;
    if (total > 0) {
      outcomes.push({
        conceptId,
        name,
        correct: conceptCorrect,
        partial: conceptPartial,
        incorrect: conceptIncorrect,
        total,
        percent: percent(conceptCorrect + conceptPartial * 0.5, total),
        masteryPercent: Math.round((last.masteryAfter ?? 0) * 100),
      });
    }
  }
  concepts.sort((a, b) => a.name.localeCompare(b.name));

  const stillWeak = concepts
    .filter((change) => {
      const state = input.finalStates.get(change.conceptId);
      return state ? isWeakConcept(state) : false;
    })
    .map((change) => ({
      conceptId: change.conceptId,
      name: change.name,
      masteryPercent: change.afterPercent,
    }))
    .sort((a, b) => a.masteryPercent - b.masteryPercent);

  const knownWell = isTest
    ? outcomes
        .filter((outcome) => outcome.percent >= KNOWN_WELL_PERCENT)
        .sort((a, b) => b.percent - a.percent || a.name.localeCompare(b.name))
    : [];
  const needsPractice = isTest
    ? outcomes
        .filter((outcome) => outcome.percent < KNOWN_WELL_PERCENT)
        .sort((a, b) => a.percent - b.percent || a.name.localeCompare(b.name))
    : [];

  return {
    total: session.itemCount,
    answered,
    skipped,
    correct,
    partial,
    incorrect,
    score,
    percent: percent(score, denominator),
    durationSeconds: input.durationSeconds,
    concepts,
    stillWeak,
    packWeakCount: input.pack.weakCount,
    packMasteryPercent: input.pack.masteryPercent,
    knownWell,
    needsPractice,
    mistakeCount: scored.filter((item) => item.verdict !== 'correct').length,
    next: input.next,
    testAttemptId: input.testAttemptId,
  };
}

/* ----------------------------------- DTOs ----------------------------------- */

interface ItemLookups {
  concept: ConceptRecord | null;
  question: PracticeQuestionRecord | null;
  sourceTitle: string | null;
}

export interface QuestionView {
  id: string;
  prompt: string;
  questionType: PracticeQuestionRecord['questionType'];
  options: string[] | null;
  conceptId: string | null;
  conceptName: string | null;
  sourceTitle: string | null;
}

export interface ItemFeedback {
  verdict: AnswerVerdict;
  correctAnswer: string;
  explanation: string;
  masteryBeforePercent: number | null;
  masteryAfterPercent: number | null;
  /** Where the answer comes from: "Biology H3.pdf · page 6". */
  source: { title: string | null; ref: string | null; origin: string | null } | null;
}

export interface LearnView {
  explanation: string;
  example: ConceptExample | null;
  sourceTitle: string | null;
  refLabel: string | null;
  origin: ConceptRecord['origin'];
  masteryPercent: number;
  reason: LearnReason;
}

export interface SessionItemView {
  id: string;
  position: number;
  kind: 'concept' | 'question';
  status: LearningSessionItemRecord['status'];
  conceptId: string | null;
  conceptName: string | null;
  /** The question, or the "Check yourself" question of a Learn concept. */
  question: QuestionView | null;
  learn: LearnView | null;
  /** The student's own answer (their data, never the solution). */
  answer: string | null;
  rating: SelfRating | null;
  /** Null while a test runs: no feedback, no mastery hints. */
  feedback: ItemFeedback | null;
}

function questionView(question: PracticeQuestionRecord, lookups: ItemLookups): QuestionView {
  const prepared = withOptions(question);
  return {
    id: prepared.id,
    prompt: prepared.prompt,
    questionType: prepared.questionType,
    options: prepared.options,
    conceptId: prepared.conceptId,
    conceptName: lookups.concept?.name ?? null,
    sourceTitle: lookups.sourceTitle,
  };
}

function feedbackFor(item: LearningSessionItemRecord, lookups: ItemLookups): ItemFeedback | null {
  if (!item.verdict || !lookups.question) return null;
  return {
    verdict: item.verdict,
    correctAnswer: lookups.question.correctAnswer,
    explanation: lookups.question.explanation,
    masteryBeforePercent: item.masteryBefore === null ? null : Math.round(item.masteryBefore * 100),
    masteryAfterPercent: item.masteryAfter === null ? null : Math.round(item.masteryAfter * 100),
    source:
      lookups.sourceTitle || lookups.concept?.refLabel
        ? {
            title: lookups.sourceTitle,
            ref: lookups.concept?.refLabel ?? null,
            origin: lookups.question.origin,
          }
        : null,
  };
}

export function toItemView(
  item: LearningSessionItemRecord,
  lookups: ItemLookups,
  options: { hideFeedback: boolean; learn?: LearnView | null },
): SessionItemView {
  return {
    id: item.id,
    position: item.position,
    kind: item.kind,
    status: item.status,
    conceptId: item.conceptId,
    conceptName: lookups.concept?.name ?? null,
    question: lookups.question ? questionView(lookups.question, lookups) : null,
    learn: options.learn ?? null,
    answer: item.answer,
    rating: item.rating,
    feedback: options.hideFeedback ? null : feedbackFor(item, lookups),
  };
}

/** A test hides everything about correctness until it has been handed in. */
export function hidesFeedback(session: Pick<LearningSessionRecord, 'type' | 'status'>): boolean {
  return session.type === 'test' && session.status !== 'completed';
}

/* -------------------------------- persistence ------------------------------- */

function conflict(message: string) {
  return errors.conflict(message);
}

async function loadSession(db: Database, userId: string, sessionId: string) {
  const session = await db.learningSessions.get(sessionId);
  // Someone else's session looks exactly like a missing one.
  if (!session || session.userId !== userId) throw errors.notFound('Study session not found');
  const pack = await db.packs.get(session.packId);
  if (!pack || !canViewPack(pack, userId)) throw errors.notFound('Study session not found');
  return { session, pack };
}

function assertOpen(session: LearningSessionRecord): void {
  if (session.status === 'completed') throw conflict('This session is already finished');
  if (session.status === 'abandoned') throw conflict('This session was abandoned');
}

/** Interaction bookkeeping: last activity, and the active time since the previous one. */
function activityPatch(session: LearningSessionRecord, now: Date) {
  return {
    lastActivityAt: now.toISOString(),
    durationSeconds: addActiveSeconds(session.durationSeconds, session.lastActivityAt, now),
  };
}

async function loadLookups(
  db: Database,
  pack: StudyPackRecord,
  items: LearningSessionItemRecord[],
  type: LearningSessionType,
) {
  const conceptIds = [
    ...new Set(items.flatMap((item) => (item.conceptId ? [item.conceptId] : []))),
  ];
  const questionIds = [
    ...new Set(items.flatMap((item) => (item.questionId ? [item.questionId] : []))),
  ];
  if (type === 'learn') {
    // Learn shows the material itself, so it needs the whole pack context once.
    const context = await loadPackContext(db, pack);
    return {
      conceptById: new Map(context.concepts.map((concept) => [concept.id, concept])),
      questionById: new Map(context.questions.map((question) => [question.id, question])),
      sourceById: new Map(context.sources.map((source) => [source.id, source])),
      context,
    };
  }
  const [concepts, questions, sources] = await Promise.all([
    db.concepts.listByIds(conceptIds),
    db.practiceQuestions.listByIds(questionIds),
    db.packSources.listByPack(pack.id),
  ]);
  return {
    conceptById: new Map(concepts.map((concept) => [concept.id, concept])),
    questionById: new Map(questions.map((question) => [question.id, question])),
    sourceById: new Map(sources.map((source) => [source.id, source])),
    context: null,
  };
}

/** The full, client-ready view of a session. */
async function buildDetail(
  db: Database,
  userId: string,
  session: LearningSessionRecord,
  pack: StudyPackRecord,
  extra: { resumed?: boolean } = {},
) {
  const items = await db.learningSessionItems.listBySession(session.id);
  const lookups = await loadLookups(db, pack, items, session.type);
  const states =
    session.type === 'learn'
      ? await masteryService.loadStates(db, userId, pack.id)
      : new Map<string, MasteryState>();
  const hideFeedback = hidesFeedback(session);
  const sources = lookups.context?.sources ?? [];
  const cards = lookups.context?.cards ?? [];

  const views = items.map((item) => {
    const concept = item.conceptId ? (lookups.conceptById.get(item.conceptId) ?? null) : null;
    const question = item.questionId ? (lookups.questionById.get(item.questionId) ?? null) : null;
    const sourceId = question?.sourceId ?? concept?.sourceId ?? null;
    const sourceTitle = sourceId ? (lookups.sourceById.get(sourceId)?.title ?? null) : null;
    let learn: LearnView | null = null;
    if (session.type === 'learn' && item.kind === 'concept' && concept) {
      const state = states.get(concept.id) ?? emptyMastery();
      const conceptSource = concept.sourceId
        ? (lookups.sourceById.get(concept.sourceId) ?? null)
        : null;
      learn = {
        explanation: concept.explanation,
        example: findConceptExample(concept, sources, cards),
        sourceTitle: conceptSource?.title ?? null,
        refLabel: concept.refLabel,
        origin: concept.origin,
        // While the session runs this is the mastery before the concept was studied.
        masteryPercent:
          item.masteryBefore === null ? percentOf(state) : Math.round(item.masteryBefore * 100),
        reason: learnReason(state),
      };
    }
    return toItemView(item, { concept, question, sourceTitle }, { hideFeedback, learn });
  });

  const focus = session.focusConceptId
    ? (lookups.conceptById.get(session.focusConceptId) ?? null)
    : null;
  return {
    session: {
      id: session.id,
      packId: pack.id,
      packTitle: pack.title,
      /** Only the owner of a pack can use its AI Tutor and take its tests. */
      isOwner: pack.ownerId === userId,
      type: session.type,
      mode: session.mode,
      status: session.status,
      title: session.title,
      label: sessionLabel(session, pack.title),
      focusConceptId: session.focusConceptId,
      focusConceptName: focus?.name ?? null,
      itemCount: session.itemCount,
      answeredCount: session.answeredCount,
      currentPosition: session.currentPosition,
      progress: sessionProgress(session, items),
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      lastActivityAt: session.lastActivityAt,
      durationSeconds: session.durationSeconds,
      hideFeedback,
      result: session.result,
      items: views,
    },
    ...(extra.resumed === undefined ? {} : { resumed: extra.resumed }),
  };
}

type SessionView = Awaited<ReturnType<typeof buildDetail>>['session'];
export type SessionDetail = SessionView;

/** The small response after one item changed: no need to reload the session. */
function itemResponse(
  session: LearningSessionRecord,
  items: LearningSessionItemRecord[],
  view: SessionItemView,
) {
  return {
    item: view,
    progress: sessionProgress(session, items),
    session: {
      id: session.id,
      status: session.status,
      currentPosition: session.currentPosition,
      answeredCount: session.answeredCount,
      durationSeconds: session.durationSeconds,
    },
  };
}

async function itemLookups(
  db: Database,
  item: LearningSessionItemRecord,
  known: { question?: PracticeQuestionRecord | null; concept?: ConceptRecord | null } = {},
): Promise<ItemLookups> {
  const question =
    known.question !== undefined
      ? known.question
      : item.questionId
        ? await db.practiceQuestions.get(item.questionId)
        : null;
  const concept =
    known.concept !== undefined
      ? known.concept
      : (item.conceptId ?? question?.conceptId)
        ? await db.concepts.get((item.conceptId ?? question?.conceptId)!)
        : null;
  // A question without its own source inherits the source of its concept.
  const sourceId = question?.sourceId ?? concept?.sourceId ?? null;
  const source = sourceId ? await db.packSources.get(sourceId) : null;
  return { question, concept, sourceTitle: source?.title ?? null };
}

async function requireItem(db: Database, session: LearningSessionRecord, itemId: string) {
  const items = await db.learningSessionItems.listBySession(session.id);
  const item = items.find((entry) => entry.id === itemId);
  if (!item || item.userId !== session.userId) throw errors.notFound('Session item not found');
  return { items, item };
}

function replaceItem(items: LearningSessionItemRecord[], updated: LearningSessionItemRecord) {
  return items.map((item) => (item.id === updated.id ? updated : item));
}

/** Opens the session if it has not been started yet (answering starts it). */
function startPatch(session: LearningSessionRecord, now: Date) {
  return session.status === 'not_started'
    ? { status: 'active' as const, startedAt: now.toISOString(), lastActivityAt: now.toISOString() }
    : {};
}

/* ---------------------------------- service --------------------------------- */

export const studySessionService = {
  /** What the pre-start screen shows, computed with the same plan the session would get. */
  async preview(
    db: Database,
    userId: string,
    input: {
      packId: string;
      type: LearningSessionType;
      mode?: TestMode;
      conceptId?: string | null;
      count?: number;
    },
    now: Date = new Date(),
  ) {
    const pack = await requireVisiblePack(db, userId, input.packId);
    const timeZone = await resolveTimeZone(db, userId);
    const data = await loadPlanData(db, userId, pack, now, timeZone);
    const mode = input.type === 'test' ? (input.mode ?? 'quick10') : null;
    const conceptById = new Map(data.context.concepts.map((concept) => [concept.id, concept]));
    if (input.conceptId && !conceptById.has(input.conceptId))
      throw errors.notFound('Concept not found');
    const focus = input.conceptId ? (conceptById.get(input.conceptId) ?? null) : null;
    const available = data.context.questions.length;
    const isOwner = pack.ownerId === userId;

    const countFor = (m: TestMode | null): number =>
      input.type === 'test' && m
        ? testQuestionCount(m, available)
        : Math.min(
            input.count ?? DEFAULT_COUNTS[input.type as 'learn' | 'practice' | 'review'],
            50,
          );

    const plan = planSessionItems({
      type: input.type,
      mode,
      count: Math.max(1, countFor(mode)),
      focusConceptId: input.conceptId ?? null,
      context: data.context,
      states: data.states,
      history: data.history,
      weakConceptIds: data.weakConceptIds,
      now,
      examDaysLeft: data.examDaysLeft,
    });

    const concepts = plan.targetConceptIds.slice(0, 8).flatMap((conceptId) => {
      const concept = conceptById.get(conceptId);
      if (!concept) return [];
      const state = data.states.get(conceptId) ?? emptyMastery();
      return [
        {
          id: concept.id,
          name: concept.name,
          masteryPercent: percentOf(state),
          reason: plan.reasons.get(conceptId) ?? learnReason(state, now),
        },
      ];
    });

    let blockedReason: string | null = null;
    if (input.type === 'learn' && data.context.concepts.length === 0) {
      blockedReason = 'This study pack has no concepts to learn yet.';
    } else if (input.type === 'test' && !isOwner) {
      blockedReason = 'Only the owner of a study pack can take its tests.';
    } else if (input.type === 'test' && available < 3) {
      blockedReason = 'Add at least three practice questions before taking a test.';
    } else if (
      input.type === 'practice' &&
      focus &&
      !data.context.questions.some((q) => q.conceptId === focus.id)
    ) {
      blockedReason = 'This concept has no practice questions yet.';
    } else if (input.type === 'practice' && plan.items.length === 0) {
      blockedReason = 'This study pack has no practice questions yet.';
    } else if (input.type === 'review' && plan.items.length === 0) {
      blockedReason = 'Nothing is due for review yet.';
    }

    const count = plan.items.length;
    const focusLabel = (() => {
      if (input.type === 'test') return 'No hints or explanations until you finish';
      if (focus) return `Focus: ${focus.name}`;
      const reasons = [...plan.reasons.values()];
      if (input.type === 'learn') {
        return reasons.some((r) => r === 'weak' || r === 'new')
          ? 'Focus: weak and new concepts'
          : 'Focus: confirming what you know';
      }
      if (input.type === 'review') return 'Focus: concepts due for review';
      if (reasons.includes('weak')) return 'Focus: weak concepts';
      if (reasons.includes('mistake')) return 'Focus: recent mistakes';
      if (reasons.includes('due')) return 'Focus: concepts that are due';
      return 'Focus: a mix of concepts';
    })();

    const open = await findOpenSession(
      db,
      userId,
      pack.id,
      {
        type: input.type,
        mode,
        conceptId: input.conceptId ?? null,
      },
      now,
    );

    return {
      packId: pack.id,
      packTitle: pack.title,
      type: input.type,
      mode,
      title: sessionTitle(input.type, mode, focus?.name ?? pack.title),
      count,
      minutes: input.type === 'learn' ? learnMinutes(count) : questionMinutes(count),
      difficulty: plan.difficulty,
      focus: { label: focusLabel, conceptId: focus?.id ?? null, conceptName: focus?.name ?? null },
      concepts,
      availableQuestions: available,
      availableConcepts: data.context.concepts.length,
      examDaysLeft: data.examDaysLeft,
      canStart: blockedReason === null && count > 0,
      blockedReason,
      resume: open ? toResumeCard(open, pack) : null,
      modes:
        input.type === 'test'
          ? (['quick10', 'quick20', 'exam'] as const).map((m) => {
              const modeCount = testQuestionCount(m, available);
              return {
                mode: m,
                label: m === 'exam' ? 'Exam simulation' : `${m === 'quick10' ? 10 : 20} questions`,
                description:
                  m === 'exam'
                    ? 'The whole pack, up to 25 questions, without hints.'
                    : `A quick check of ${m === 'quick10' ? 10 : 20} questions.`,
                count: modeCount,
                minutes: questionMinutes(modeCount),
                available: available >= 3,
              };
            })
          : null,
    };
  },

  /**
   * Creates a session, or resumes the open one of the same kind. Idempotent, so
   * a double click or a second device never leaves two half-finished sessions.
   */
  async create(db: Database, userId: string, input: CreateSessionInput, now: Date = new Date()) {
    const type = input.type;
    // Tests are stored for the pack's owner (as before); everything else works on any visible pack.
    const pack =
      type === 'test'
        ? await requireOwnedPack(db, userId, input.packId)
        : await requireVisiblePack(db, userId, input.packId);
    const mode: TestMode | null = type === 'test' ? (input.mode ?? 'quick10') : null;
    const start = input.start ?? true;

    const existing = await findOpenSession(
      db,
      userId,
      pack.id,
      { type, mode, conceptId: input.conceptId ?? null },
      now,
    );
    if (existing && !input.restart) {
      let session = existing;
      if (start && existing.status === 'not_started') {
        session = await db.learningSessions.update(existing.id, startPatch(existing, now));
      } else if (
        now.getTime() - Date.parse(existing.lastActivityAt) >
        IDLE_GAP_CAP_SECONDS * 1000
      ) {
        // Coming back after a break: the break is not study time.
        session = await db.learningSessions.update(existing.id, {
          lastActivityAt: now.toISOString(),
        });
      }
      return { ...(await buildDetail(db, userId, session, pack, { resumed: true })) };
    }
    if (existing && input.restart) {
      await db.learningSessions.update(existing.id, {
        status: 'abandoned',
        ...activityPatch(existing, now),
      });
    }

    const timeZone = await resolveTimeZone(db, userId);
    const data = await loadPlanData(db, userId, pack, now, timeZone);
    if (
      input.conceptId &&
      !data.context.concepts.some((concept) => concept.id === input.conceptId)
    ) {
      throw errors.notFound('Concept not found');
    }
    if (type === 'test' && data.context.questions.length < 3) {
      throw errors.validation('Add at least three practice questions before making a test');
    }
    if (type === 'learn' && data.context.concepts.length === 0) {
      throw errors.validation('This study pack has no concepts to learn yet');
    }
    if (
      type === 'practice' &&
      input.conceptId &&
      !data.context.questions.some((question) => question.conceptId === input.conceptId)
    ) {
      throw errors.validation('This concept has no practice questions yet');
    }

    const count =
      type === 'test'
        ? testQuestionCount(mode!, data.context.questions.length)
        : Math.min(input.count ?? DEFAULT_COUNTS[type], 50);
    const plan = planSessionItems({
      type,
      mode,
      count,
      focusConceptId: input.conceptId ?? null,
      context: data.context,
      states: data.states,
      history: data.history,
      weakConceptIds: data.weakConceptIds,
      now,
      examDaysLeft: data.examDaysLeft,
    });
    if (plan.items.length === 0) {
      throw errors.validation(
        type === 'review'
          ? 'Nothing is due for review yet'
          : 'This study pack has no practice questions yet',
      );
    }

    const focus = input.conceptId
      ? data.context.concepts.find((concept) => concept.id === input.conceptId)
      : undefined;
    let testId: string | null = null;
    if (type === 'test') {
      const { test } = await db.tests.createTest({
        packId: pack.id,
        ownerId: userId,
        title: sessionTitle('test', mode, pack.title),
        mode: mode!,
        questionIds: plan.items.map((item) => item.questionId!).filter(Boolean),
      });
      testId = test.id;
    }

    const created = await db.learningSessions.create({
      userId,
      packId: pack.id,
      type,
      status: start ? 'active' : 'not_started',
      mode,
      title: sessionTitle(type, mode, focus?.name ?? pack.title),
      focusConceptId: input.conceptId ?? null,
      targetConceptIds: plan.targetConceptIds,
      testId,
      itemCount: plan.items.length,
      startedAt: start ? now.toISOString() : null,
    });
    try {
      await db.learningSessionItems.createMany(
        plan.items.map((item, position) => ({
          sessionId: created.id,
          userId,
          packId: pack.id,
          position,
          kind: item.kind,
          conceptId: item.conceptId,
          questionId: item.questionId,
        })),
      );
    } catch (error) {
      // Never leave a session without items behind.
      await db.learningSessions.update(created.id, { status: 'abandoned' }).catch(() => undefined);
      throw error;
    }
    return { ...(await buildDetail(db, userId, created, pack, { resumed: false })) };
  },

  async get(db: Database, userId: string, sessionId: string, now: Date = new Date()) {
    const loaded = await loadSession(db, userId, sessionId);
    const { pack } = loaded;
    let { session } = loaded;
    // Opening a session after a break must not turn the break into study time.
    if (
      isOpenStatus(session.status) &&
      now.getTime() - Date.parse(session.lastActivityAt) > IDLE_GAP_CAP_SECONDS * 1000
    ) {
      session = await db.learningSessions.update(session.id, { lastActivityAt: now.toISOString() });
    }
    return buildDetail(db, userId, session, pack);
  },

  /** Open sessions of the student (resume list), newest first. */
  async listActive(
    db: Database,
    userId: string,
    now: Date = new Date(),
  ): Promise<{ sessions: ResumeCard[] }> {
    const open = (
      await db.learningSessions.listByUser(userId, {
        statuses: ['not_started', 'active'],
        limit: 20,
      })
    ).filter((session) => isResumable(session, now));
    if (open.length === 0) return { sessions: [] };
    const packs = await db.packs.listByIds([...new Set(open.map((session) => session.packId))]);
    const byId = new Map(
      packs.filter((pack) => canViewPack(pack, userId)).map((pack) => [pack.id, pack]),
    );
    return {
      sessions: open.flatMap((session) => {
        const pack = byId.get(session.packId);
        return pack ? [toResumeCard(session, pack)] : [];
      }),
    };
  },

  async start(db: Database, userId: string, sessionId: string, now: Date = new Date()) {
    const { session, pack } = await loadSession(db, userId, sessionId);
    if (session.status === 'active') return buildDetail(db, userId, session, pack);
    if (!canTransition(session.status, 'active'))
      throw conflict('This session can no longer be started');
    const updated = await db.learningSessions.update(session.id, startPatch(session, now));
    return buildDetail(db, userId, updated, pack);
  },

  /** Grades one Practice/Review/Learn-check answer and applies it to mastery immediately. */
  async answer(
    db: Database,
    userId: string,
    sessionId: string,
    itemId: string,
    input: AnswerInput,
    now: Date = new Date(),
  ) {
    const { session, pack } = await loadSession(db, userId, sessionId);
    assertOpen(session);
    if (session.type === 'test') {
      throw errors.validation('Answers in a test are saved together and graded when you finish');
    }
    const { items, item } = await requireItem(db, session, itemId);
    if (!item.questionId) throw errors.validation('This step has no question to answer');
    const question = await db.practiceQuestions.get(item.questionId);
    if (!question) throw errors.notFound('Practice question not found');
    const concept = question.conceptId ? await db.concepts.get(question.conceptId) : null;
    const lookups = await itemLookups(db, item, { question, concept });

    // Answering twice returns what was decided the first time (no double counting).
    if (item.verdict !== null) {
      return itemResponse(session, items, toItemView(item, lookups, { hideFeedback: false }));
    }

    const prepared = withOptions(question);
    const graded = gradeAnswer(prepared, input.answer);
    let applied: AppliedOutcome | null = null;
    if (concept) {
      const previous = await db.conceptMastery.get(userId, concept.id);
      const recorded = await masteryService.record(
        db,
        userId,
        pack.id,
        [
          {
            conceptId: concept.id,
            evidence: { kind: 'verdict', verdict: graded.verdict },
            at: now,
          },
        ],
        new Map([[concept.id, masteryFromRecord(previous)]]),
      );
      applied = recorded.applied[0] ?? null;
    }
    await db.practiceAttempts.create({
      userId,
      packId: pack.id,
      questionId: question.id,
      conceptId: question.conceptId,
      answer: graded.normalized,
      verdict: graded.verdict,
    });
    await db.learningEvents.create({
      userId,
      packId: pack.id,
      conceptId: concept?.id ?? null,
      questionId: question.id,
      eventType: session.type === 'review' ? 'review' : 'practice',
      isCorrect: graded.verdict === 'partial' ? null : graded.verdict === 'correct',
      responseTimeMs: input.responseTimeMs ?? null,
      metadata: { verdict: graded.verdict, sessionId: session.id, sessionType: session.type },
    });

    const isQuestionItem = item.kind === 'question';
    const updatedItem: LearningSessionItemRecord = {
      ...item,
      // A Learn concept is finished by its self-rating; the check is only one step of it.
      status: isQuestionItem ? 'answered' : item.status,
      answer: displayAnswer(question, input.answer),
      verdict: graded.verdict,
      masteryBefore: applied ? applied.before.mastery : item.masteryBefore,
      masteryAfter: applied ? applied.after.mastery : item.masteryAfter,
      responseTimeMs: input.responseTimeMs ?? null,
      answeredAt: now.toISOString(),
    };
    await db.learningSessionItems.saveMany([updatedItem]);
    const nextItems = replaceItem(items, updatedItem);
    const updatedSession = await db.learningSessions.update(session.id, {
      ...startPatch(session, now),
      ...activityPatch(session, now),
      ...(isQuestionItem
        ? {
            answeredCount: session.answeredCount + 1,
            currentPosition: firstOpenPosition(nextItems),
          }
        : {}),
    });
    return itemResponse(
      updatedSession,
      nextItems,
      toItemView(updatedItem, lookups, { hideFeedback: false }),
    );
  },

  /** Learn: "How well do you know this?" — one self-rating finishes a concept. */
  async rate(
    db: Database,
    userId: string,
    sessionId: string,
    itemId: string,
    input: { rating: SelfRating; responseTimeMs?: number },
    now: Date = new Date(),
  ) {
    const { session, pack } = await loadSession(db, userId, sessionId);
    assertOpen(session);
    if (session.type !== 'learn') throw errors.validation('Only Learn sessions use self-ratings');
    const { items, item } = await requireItem(db, session, itemId);
    if (item.kind !== 'concept' || !item.conceptId)
      throw errors.validation('This step cannot be rated');
    const concept = await db.concepts.get(item.conceptId);
    const question = item.questionId ? await db.practiceQuestions.get(item.questionId) : null;
    const lookups = await itemLookups(db, item, { question, concept });

    if (item.status === 'answered') {
      return itemResponse(session, items, toItemView(item, lookups, { hideFeedback: false }));
    }

    const previous = await db.conceptMastery.get(userId, item.conceptId);
    const recorded = await masteryService.record(
      db,
      userId,
      pack.id,
      [{ conceptId: item.conceptId, evidence: { kind: 'rating', rating: input.rating }, at: now }],
      new Map([[item.conceptId, masteryFromRecord(previous)]]),
    );
    const applied = recorded.applied[0]!;
    await db.learningEvents.create({
      userId,
      packId: pack.id,
      conceptId: item.conceptId,
      eventType: 'self_rating',
      isCorrect:
        input.rating === 'good' || input.rating === 'easy'
          ? true
          : input.rating === 'again'
            ? false
            : null,
      responseTimeMs: input.responseTimeMs ?? null,
      metadata: { rating: input.rating, sessionId: session.id, sessionType: 'learn' },
    });

    const updatedItem: LearningSessionItemRecord = {
      ...item,
      status: 'answered',
      rating: input.rating,
      // If the check ran first, "before" is the mastery before the check.
      masteryBefore: item.masteryBefore ?? applied.before.mastery,
      masteryAfter: applied.after.mastery,
      answeredAt: now.toISOString(),
    };
    await db.learningSessionItems.saveMany([updatedItem]);
    const nextItems = replaceItem(items, updatedItem);
    const updatedSession = await db.learningSessions.update(session.id, {
      ...startPatch(session, now),
      ...activityPatch(session, now),
      answeredCount: session.answeredCount + 1,
      currentPosition: firstOpenPosition(nextItems),
    });
    return itemResponse(
      updatedSession,
      nextItems,
      toItemView(updatedItem, lookups, { hideFeedback: false }),
    );
  },

  /** Skips a question without changing mastery. */
  async skip(
    db: Database,
    userId: string,
    sessionId: string,
    itemId: string,
    now: Date = new Date(),
  ) {
    const { session } = await loadSession(db, userId, sessionId);
    assertOpen(session);
    if (session.type === 'test' || session.type === 'learn') {
      throw errors.validation('Questions can only be skipped in Practice and Review');
    }
    const { items, item } = await requireItem(db, session, itemId);
    const lookups = await itemLookups(db, item);
    if (item.status !== 'pending') {
      return itemResponse(session, items, toItemView(item, lookups, { hideFeedback: false }));
    }
    const updatedItem: LearningSessionItemRecord = {
      ...item,
      status: 'skipped',
      answeredAt: now.toISOString(),
    };
    await db.learningSessionItems.saveMany([updatedItem]);
    const nextItems = replaceItem(items, updatedItem);
    const updatedSession = await db.learningSessions.update(session.id, {
      ...startPatch(session, now),
      ...activityPatch(session, now),
      currentPosition: firstOpenPosition(nextItems),
    });
    return itemResponse(
      updatedSession,
      nextItems,
      toItemView(updatedItem, lookups, { hideFeedback: false }),
    );
  },

  /**
   * Test: stores the answers given so far — one request for many answers, safe to
   * repeat. Nothing is graded and nothing about correctness is returned.
   */
  async saveAnswers(
    db: Database,
    userId: string,
    sessionId: string,
    input: { answers: { itemId: string; answer: string }[]; currentPosition?: number },
    now: Date = new Date(),
  ) {
    const { session } = await loadSession(db, userId, sessionId);
    assertOpen(session);
    if (session.type !== 'test') throw errors.validation('Only tests save answers in batches');
    const items = await db.learningSessionItems.listBySession(session.id);
    const merged = mergeTestAnswers(items, input.answers);
    if (merged.changed.length > 0) await db.learningSessionItems.saveMany(merged.changed);
    const answeredCount = merged.items.filter(
      (item) => item.answer !== null && item.answer !== '',
    ).length;
    const currentPosition = Math.min(
      Math.max(0, input.currentPosition ?? session.currentPosition),
      Math.max(0, session.itemCount - 1),
    );
    const updated = await db.learningSessions.update(session.id, {
      ...startPatch(session, now),
      ...activityPatch(session, now),
      answeredCount,
      currentPosition,
    });
    return {
      saved: merged.changed.length,
      progress: sessionProgress(updated, merged.items),
      session: {
        id: updated.id,
        status: updated.status,
        currentPosition: updated.currentPosition,
        answeredCount: updated.answeredCount,
        durationSeconds: updated.durationSeconds,
      },
    };
  },

  /**
   * Finishes a session: grades a test, stores the result (score, per-concept
   * change, analysis, next step), records the daily mastery snapshot and lets
   * the exam plan follow the new mastery.
   */
  async complete(
    db: Database,
    userId: string,
    sessionId: string,
    input: { answers?: { itemId: string; answer: string }[] } = {},
    now: Date = new Date(),
  ) {
    const { session, pack } = await loadSession(db, userId, sessionId);
    if (session.status === 'completed') return buildDetail(db, userId, session, pack);
    if (session.status === 'abandoned') throw conflict('This session was abandoned');

    let items = await db.learningSessionItems.listBySession(session.id);
    if (session.type === 'test' && input.answers) {
      const merged = mergeTestAnswers(items, input.answers);
      if (merged.changed.length > 0) await db.learningSessionItems.saveMany(merged.changed);
      items = merged.items;
    }
    const hasWork =
      session.type === 'test'
        ? items.some((item) => item.answer !== null && item.answer !== '')
        : items.some((item) => item.status === 'answered');
    if (!hasWork) {
      throw errors.validation(
        session.type === 'learn'
          ? 'Rate at least one concept before finishing'
          : 'Answer at least one question before finishing',
      );
    }

    const timeZone = await resolveTimeZone(db, userId);
    let testAttemptId: string | null = null;
    let finalStates: ReadonlyMap<string, MasteryState> | null = null;
    if (session.type === 'test') {
      const graded = await gradeTest(db, userId, pack, session, items, now);
      items = graded.items;
      testAttemptId = graded.attemptId;
      finalStates = graded.finalStates;
    } else {
      finalStates = await masteryService.loadStates(db, userId, pack.id);
    }

    const durationSeconds = addActiveSeconds(session.durationSeconds, session.lastActivityAt, now);
    const conceptIds = [
      ...new Set(items.flatMap((item) => (item.conceptId ? [item.conceptId] : []))),
    ];
    const concepts = await db.concepts.listByIds(conceptIds);
    const conceptNames = new Map(concepts.map((concept) => [concept.id, concept.name]));

    // Fresh pack state (after this session) drives "what next" and the pack figures.
    const [snapshot] = await loadPackSnapshots(db, userId, [pack], now, timeZone);
    const missed = new Map<string, number>();
    for (const item of items) {
      if (item.conceptId && item.verdict === 'incorrect') {
        missed.set(item.conceptId, (missed.get(item.conceptId) ?? 0) + 1);
      }
    }
    const ctx: RecommendationContext = {
      ...emptyContext(now, timeZone),
      recentMistakes: collectRecentMistakes(snapshot ? [snapshot] : [], now),
    };
    const next: SessionNextStep = snapshot
      ? nextStepAfterSession({ snapshot, ctx, missed })
      : {
          type: 'practice',
          label: 'Keep practising',
          description: '',
          conceptId: null,
          conceptName: null,
        };

    const result = buildSessionResult({
      session,
      items,
      conceptNames,
      finalStates,
      durationSeconds,
      testAttemptId,
      pack: {
        weakCount: snapshot?.summary.weakConcepts ?? 0,
        masteryPercent: snapshot?.summary.masteryPercent ?? 0,
      },
      next,
    });

    const completed = await db.learningSessions.update(session.id, {
      status: 'completed',
      completedAt: now.toISOString(),
      lastActivityAt: now.toISOString(),
      durationSeconds,
      answeredCount: result.answered,
      currentPosition: Math.max(0, session.itemCount - 1),
      result,
      ...(session.startedAt ? {} : { startedAt: now.toISOString() }),
    });

    // Follow-ups never fail the completion: the session result is already stored.
    await masteryService
      .recordSnapshots(db, userId, [pack.id], now, timeZone)
      .catch(() => undefined);
    await studyPlanService.refreshAfterSession(db, userId, pack.id, now).catch(() => undefined);

    return buildDetail(db, userId, completed, pack);
  },

  /** Leaves a session for good: answers already given stay applied, nothing else happens. */
  async abandon(db: Database, userId: string, sessionId: string, now: Date = new Date()) {
    const { session, pack } = await loadSession(db, userId, sessionId);
    if (session.status === 'abandoned') return buildDetail(db, userId, session, pack);
    if (!canTransition(session.status, 'abandoned'))
      throw conflict('A finished session cannot be abandoned');
    const updated = await db.learningSessions.update(session.id, {
      status: 'abandoned',
      ...activityPatch(session, now),
    });
    if (session.answeredCount > 0 && session.type !== 'test') {
      const timeZone = await resolveTimeZone(db, userId);
      await masteryService
        .recordSnapshots(db, userId, [pack.id], now, timeZone)
        .catch(() => undefined);
    }
    return buildDetail(db, userId, updated, pack);
  },

  /** "Review mistakes": only the questions that were not answered correctly. */
  async mistakes(db: Database, userId: string, sessionId: string) {
    const { session, pack } = await loadSession(db, userId, sessionId);
    if (session.type === 'test' && isOpenStatus(session.status)) {
      throw conflict('Finish the test to review your mistakes');
    }
    const items = await db.learningSessionItems.listBySession(session.id);
    const wrong = items.filter(
      (item) => item.questionId && (item.verdict === 'incorrect' || item.verdict === 'partial'),
    );
    const lookups = await loadLookups(db, pack, wrong, 'practice');
    return {
      sessionId: session.id,
      packId: pack.id,
      packTitle: pack.title,
      type: session.type,
      total: wrong.length,
      mistakes: wrong.map((item) => {
        const question = lookups.questionById.get(item.questionId!)!;
        const concept = item.conceptId ? (lookups.conceptById.get(item.conceptId) ?? null) : null;
        const sourceId = question.sourceId ?? concept?.sourceId ?? null;
        const source = sourceId ? (lookups.sourceById.get(sourceId) ?? null) : null;
        const prepared = withOptions(question);
        return {
          itemId: item.id,
          position: item.position,
          verdict: item.verdict!,
          question: {
            id: prepared.id,
            prompt: prepared.prompt,
            questionType: prepared.questionType,
            options: prepared.options,
          },
          yourAnswer: item.answer ?? '',
          correctAnswer: question.correctAnswer,
          explanation: question.explanation,
          concept: concept ? { id: concept.id, name: concept.name } : null,
          source:
            source || concept?.refLabel
              ? {
                  title: source?.title ?? null,
                  ref: concept?.refLabel ?? null,
                  origin: question.origin,
                }
              : null,
        };
      }),
    };
  },
};

/* ---------------------------------- helpers --------------------------------- */

async function findOpenSession(
  db: Database,
  userId: string,
  packId: string,
  match: { type: LearningSessionType; mode: TestMode | null; conceptId: string | null },
  now: Date,
): Promise<LearningSessionRecord | null> {
  const open = await db.learningSessions.listByUser(userId, {
    packId,
    statuses: ['not_started', 'active'],
    limit: 50,
  });
  const same = open.filter(
    (session) =>
      session.type === match.type &&
      session.mode === match.mode &&
      (session.focusConceptId ?? null) === match.conceptId,
  );
  // Old open sessions are closed for good, so they stop showing up as "continue".
  for (const session of same) {
    if (!isResumable(session, now)) {
      await db.learningSessions.update(session.id, { status: 'abandoned' }).catch(() => undefined);
    }
  }
  return same.find((session) => isResumable(session, now)) ?? null;
}

/** Everything the planner needs about a pack, loaded in one round of queries. */
async function loadPlanData(
  db: Database,
  userId: string,
  pack: StudyPackRecord,
  now: Date,
  timeZone: string,
) {
  const [snapshot] = await loadPackSnapshots(db, userId, [pack], now, timeZone);
  if (!snapshot) throw errors.notFound('Study pack not found');
  const seenItems = await db.learningSessionItems.listSeenByUserAndPack(userId, pack.id);
  return {
    context: snapshot.context,
    states: new Map(
      snapshot.progress.conceptStates.map((entry) => [entry.concept.id, entry.state]),
    ),
    history: buildQuestionHistory({
      attempts: snapshot.progress.attempts,
      testAttempts: snapshot.progress.testAttempts,
      seenItems,
    }),
    weakConceptIds: new Set(snapshot.progress.stats.weakConcepts.map((concept) => concept.id)),
    examDaysLeft: examDaysLeft(pack, now, timeZone),
  };
}

const MAX_ANSWER_LENGTH = 2000;

/** Applies saved test answers to the items; only changed rows are returned for writing. */
export function mergeTestAnswers(
  items: LearningSessionItemRecord[],
  answers: { itemId: string; answer: string }[],
): { items: LearningSessionItemRecord[]; changed: LearningSessionItemRecord[] } {
  const byId = new Map(items.map((item) => [item.id, item]));
  const changed = new Map<string, LearningSessionItemRecord>();
  for (const entry of answers) {
    const item = byId.get(entry.itemId);
    if (!item || !item.questionId) throw errors.notFound('Session item not found');
    const answer = entry.answer.trim().slice(0, MAX_ANSWER_LENGTH);
    const next: LearningSessionItemRecord = {
      ...item,
      answer: answer === '' ? null : answer,
      status: answer === '' ? 'pending' : 'answered',
    };
    if (next.answer !== item.answer || next.status !== item.status) {
      byId.set(item.id, next);
      changed.set(item.id, next);
    }
  }
  return { items: items.map((item) => byId.get(item.id)!), changed: [...changed.values()] };
}

/**
 * Grades a whole test in one pass: verdicts, mastery (one batched write), the
 * `test_attempts` row the classic flow uses, learning events, and the graded
 * items. Unanswered questions count as missed, like on a real exam.
 */
async function gradeTest(
  db: Database,
  userId: string,
  pack: StudyPackRecord,
  session: LearningSessionRecord,
  items: LearningSessionItemRecord[],
  now: Date,
) {
  const questionIds = items.flatMap((item) => (item.questionId ? [item.questionId] : []));
  const [questions, concepts] = await Promise.all([
    db.practiceQuestions.listByIds(questionIds),
    db.concepts.listByPack(pack.id),
  ]);
  const questionById = new Map(questions.map((question) => [question.id, withOptions(question)]));
  const conceptById = new Map(concepts.map((concept) => [concept.id, concept]));

  const graded = items.flatMap((item) => {
    const question = item.questionId ? questionById.get(item.questionId) : undefined;
    if (!question) return [];
    const answer = item.answer ?? '';
    const verdict: AnswerVerdict = answer ? gradeAnswer(question, answer).verdict : 'incorrect';
    const concept = question.conceptId ? (conceptById.get(question.conceptId) ?? null) : null;
    return [{ item, question, answer, verdict, concept }];
  });

  const outcomes: MasteryOutcome[] = graded.flatMap((entry) =>
    entry.concept
      ? [
          {
            conceptId: entry.concept.id,
            evidence: { kind: 'verdict' as const, verdict: entry.verdict },
            at: now,
          },
        ]
      : [],
  );
  const { applied, final } = await masteryService.record(db, userId, pack.id, outcomes);

  let appliedIndex = 0;
  const gradedItems = new Map<string, LearningSessionItemRecord>();
  let score = 0;
  let correctCount = 0;
  let partialCount = 0;
  let incorrectCount = 0;
  const touched = new Set<string>();
  for (const entry of graded) {
    if (entry.verdict === 'correct') {
      score += 1;
      correctCount += 1;
    } else if (entry.verdict === 'partial') {
      score += 0.5;
      partialCount += 1;
    } else {
      incorrectCount += 1;
    }
    let before: number | null = null;
    let after: number | null = null;
    if (entry.concept) {
      touched.add(entry.concept.id);
      const step = applied[appliedIndex++]!;
      before = step.before.mastery;
      after = step.after.mastery;
    }
    gradedItems.set(entry.item.id, {
      ...entry.item,
      status: entry.answer ? 'answered' : 'skipped',
      answer: entry.answer ? displayAnswer(entry.question, entry.answer) : null,
      verdict: entry.verdict,
      masteryBefore: before,
      masteryAfter: after,
      answeredAt: now.toISOString(),
    });
  }
  await db.learningSessionItems.saveMany([...gradedItems.values()]);

  await db.learningEvents.createMany(
    graded.map((entry) => ({
      userId,
      packId: pack.id,
      conceptId: entry.concept?.id ?? null,
      questionId: entry.question.id,
      eventType: 'test' as const,
      isCorrect: entry.verdict === 'partial' ? null : entry.verdict === 'correct',
      responseTimeMs: null,
      metadata: { verdict: entry.verdict, testId: session.testId, sessionId: session.id },
    })),
  );

  const strongConceptIds: string[] = [];
  const weakConceptIds: string[] = [];
  for (const conceptId of touched) {
    const state = final.get(conceptId);
    if (!state) continue;
    if (isWeakConcept(state)) weakConceptIds.push(conceptId);
    if (state.mastery >= 0.85) strongConceptIds.push(conceptId);
  }
  const attempt = session.testId
    ? await db.testAttempts.create({
        testId: session.testId,
        packId: pack.id,
        userId,
        score,
        total: graded.length,
        correctCount,
        partialCount,
        incorrectCount,
        answers: graded.map((entry) => ({
          questionId: entry.question.id,
          prompt: entry.question.prompt,
          questionType: entry.question.questionType,
          yourAnswer: entry.answer,
          correctAnswer: entry.question.correctAnswer,
          verdict: entry.verdict,
          explanation: entry.question.explanation,
          conceptId: entry.concept?.id ?? null,
          conceptName: entry.concept?.name ?? null,
        })),
        strongConceptIds,
        weakConceptIds,
      })
    : null;
  await db.packs.update(pack.id, {});

  return {
    items: items.map((item) => gradedItems.get(item.id) ?? item),
    attemptId: attempt?.id ?? null,
    finalStates: final,
  };
}

export type { SessionProgress };
