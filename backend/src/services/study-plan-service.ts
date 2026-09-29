/**
 * Study plan service — today's numbered plan and the day-by-day exam planner.
 *
 * Both are deterministic and built on the same engine:
 *  - "Today" takes the ranked activities of the recommendation service (which
 *    already applies the exam boost across every pack) and fits them to the
 *    day's time budget. Subjects are grouped from that ranking; there is no
 *    hardcoded subject order.
 *  - The exam planner spreads the concepts that are weak, new or still
 *    learning over the days that are left, ends with an exam simulation and
 *    starts from the live "Today" tasks so the plan and today never disagree.
 *
 * No AI is involved, so a plan exists as soon as a pack has an exam date.
 */
import type { Database } from '../lib/db/repository.js';
import type {
  ConceptRecord,
  StudyPackRecord,
  StudyPlanRecord,
  StudyPlanSession,
  StudyPlanTask,
} from '../lib/db/types.js';
import { dto } from '../lib/dto.js';
import { DEFAULT_TIMEZONE } from '../lib/timezone.js';
import {
  examDaysLeft,
  loadPackSnapshots,
  type PackSummarySnapshot,
} from './pack-data.js';
import {
  collectRecentMistakes,
  packCandidates,
  rankTasks,
  selectLearnConcepts,
  TASK_COUNTS,
  toTask,
  type RecommendationContext,
  type RecommendationTask,
} from './recommendation-service.js';
import { COMEBACK_GAP_DAYS, resolveTimeZone } from './retention-service.js';
import {
  cardMinutes,
  isResumable,
  learnMinutes,
  questionMinutes,
  toResumeCard,
} from './session-model.js';
import { buildStudyStreak, collectStudyDays } from './study-progress-service.js';
import {
  addDaysIso,
  daysUntil,
  emptyMastery,
  rankRecommendations,
  todayIso,
  type MasteryState,
} from './study-pack-rules.js';

/* --------------------------------- budgets --------------------------------- */

export const DEFAULT_DAILY_MINUTES = 25;
/** A step may overshoot the budget by this much rather than being dropped. */
const BUDGET_SLACK_MINUTES = 3;
export const MAX_TODAY_STEPS = 6;
export const MAX_LEARN_PER_DAY = 4;
const PRACTICE_CONCEPTS_PER_DAY = 2;
/** An exam this close changes the plan (also the reach of the ranking boost). */
export const EXAM_ADJUSTMENT_DAYS = 30;
const PLAN_MAX_DAYS = 60;

/** More minutes when the exam is near — the same distance bands as the ranking boost. */
export function dailyBudgetMinutes(daysLeft: number | null): number {
  if (daysLeft === null || daysLeft < 0) return DEFAULT_DAILY_MINUTES;
  if (daysLeft <= 2) return 45;
  if (daysLeft <= 7) return 35;
  if (daysLeft <= 14) return 30;
  return DEFAULT_DAILY_MINUTES;
}

/**
 * Keeps items in order while they fit the budget. The first item is always
 * kept (a plan is never empty), and one that does not fit is skipped so a
 * smaller one behind it can still use the time.
 */
export function fitToBudget<T extends { minutes: number }>(
  items: T[],
  budgetMinutes: number,
  maxItems: number = MAX_TODAY_STEPS,
): T[] {
  const chosen: T[] = [];
  let total = 0;
  for (const item of items) {
    if (chosen.length >= maxItems) break;
    if (chosen.length === 0 || total + item.minutes <= budgetMinutes + BUDGET_SLACK_MINUTES) {
      chosen.push(item);
      total += item.minutes;
    }
  }
  return chosen;
}

/* ---------------------------------- today ---------------------------------- */

export interface PlanStep extends RecommendationTask {
  /** 1-based position in the numbered plan. */
  order: number;
}

export interface TodayPlan {
  /** The daily budget: "25 min recommended". */
  budgetMinutes: number;
  /** The sum of the steps: "You have 21 minutes planned". */
  minutes: number;
  steps: PlanStep[];
  /** True when an exam within a month shaped the order or the time budget. */
  adjustedForExam: boolean;
}

function taskKey(task: RecommendationTask): string {
  return [task.type, task.packId, task.conceptId, task.sessionId].join(':');
}

export function buildTodayPlan(ranked: RecommendationTask[], budgetMinutes: number): TodayPlan {
  const seen = new Set<string>();
  const unique = ranked.filter((task) => {
    const key = taskKey(task);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const real = unique.filter((task) => task.type !== 'add-material');
  const source = real.length > 0 ? real : unique;
  const steps = fitToBudget(source, budgetMinutes).map((task, index) => ({
    ...task,
    order: index + 1,
  }));
  return {
    budgetMinutes,
    minutes: steps.reduce((sum, step) => sum + step.minutes, 0),
    steps,
    adjustedForExam: steps.some(
      (step) =>
        step.examDaysLeft !== null &&
        step.examDaysLeft >= 0 &&
        step.examDaysLeft <= EXAM_ADJUSTMENT_DAYS,
    ),
  };
}

export interface ExamBanner {
  packId: string;
  title: string;
  examDate: string;
  daysLeft: number;
  /** "Biology exam in 9 days". */
  message: string;
  /** "Your plan is adjusted for the exam." once the exam influences the plan. */
  note: string | null;
}

export function examMessage(title: string, daysLeft: number): string {
  if (daysLeft <= 0) return `${title} exam is today`;
  if (daysLeft === 1) return `${title} exam is tomorrow`;
  return `${title} exam in ${daysLeft} days`;
}

/** The nearest exam that has not passed yet, if there is one. */
export function nearestExam(
  packs: Pick<StudyPackRecord, 'id' | 'title' | 'examDate'>[],
  now: Date,
  timeZone: string,
): ExamBanner | null {
  const upcoming = packs
    .flatMap((pack) =>
      pack.examDate
        ? [{ pack, daysLeft: daysUntil(pack.examDate, now, timeZone) }]
        : [],
    )
    .filter((entry) => entry.daysLeft >= 0)
    .sort((a, b) => a.daysLeft - b.daysLeft || a.pack.title.localeCompare(b.pack.title))[0];
  if (!upcoming) return null;
  return {
    packId: upcoming.pack.id,
    title: upcoming.pack.title,
    examDate: upcoming.pack.examDate!,
    daysLeft: upcoming.daysLeft,
    message: examMessage(upcoming.pack.title, upcoming.daysLeft),
    note:
      upcoming.daysLeft <= EXAM_ADJUSTMENT_DAYS ? 'Your plan is adjusted for the exam.' : null,
  };
}

export interface SubjectToday {
  subjectId: string | null;
  subjectName: string;
  packs: number;
  masteryPercent: number | null;
  dueCards: number;
  weakConcepts: number;
  examDaysLeft: number | null;
  /** Minutes of this subject inside today's plan. */
  minutes: number;
  steps: PlanStep[];
  /** The engine's best activity for this subject (may not fit today's budget). */
  next: RecommendationTask | null;
}

const NO_SUBJECT = 'none';

/**
 * Groups today by subject. The order of subjects is the engine's own ranking —
 * the subject whose best activity ranks highest (exam boost included) comes
 * first — never a fixed list.
 */
export function buildSubjectsToday(
  snapshots: PackSummarySnapshot[],
  ranked: RecommendationTask[],
  plan: TodayPlan,
  now: Date,
  timeZone: string,
): SubjectToday[] {
  const keyOf = (subjectId: string | null) => subjectId ?? NO_SUBJECT;
  const groups = new Map<string, PackSummarySnapshot[]>();
  for (const snapshot of snapshots) {
    const key = keyOf(snapshot.pack.subjectId);
    groups.set(key, [...(groups.get(key) ?? []), snapshot]);
  }

  const rows: (SubjectToday & { rank: number })[] = [];
  for (const [key, members] of groups) {
    const rank = ranked.findIndex((task) => task.packId && keyOf(task.subjectId) === key);
    if (rank < 0) continue;
    const next = ranked[rank]!;
    const concepts = members.reduce((sum, member) => sum + member.summary.concepts, 0);
    const exams = members
      .map((member) => examDaysLeft(member.pack, now, timeZone))
      .filter((days): days is number => days !== null && days >= 0);
    const steps = plan.steps.filter((step) => step.packId && keyOf(step.subjectId) === key);
    rows.push({
      subjectId: members[0]!.pack.subjectId,
      subjectName: members[0]!.pack.subjectName ?? 'Other packs',
      packs: members.length,
      masteryPercent:
        concepts > 0
          ? Math.round(
              members.reduce(
                (sum, member) => sum + member.summary.masteryPercent * member.summary.concepts,
                0,
              ) / concepts,
            )
          : null,
      dueCards: members.reduce((sum, member) => sum + member.summary.dueCards, 0),
      weakConcepts: members.reduce((sum, member) => sum + member.summary.weakConcepts, 0),
      examDaysLeft: exams.length > 0 ? Math.min(...exams) : null,
      minutes: steps.reduce((sum, step) => sum + step.minutes, 0),
      steps,
      next,
      rank,
    });
  }
  return rows.sort((a, b) => a.rank - b.rank).map(({ rank: _rank, ...row }) => row);
}

/* ------------------------------ exam-day planner ---------------------------- */

export interface PlanInput {
  title: string;
  startDay: string;
  days: number;
  budgetMinutes: number;
  examDaysLeft: number | null;
  concepts: ConceptRecord[];
  states: ReadonlyMap<string, MasteryState>;
  questionCountByConcept: ReadonlyMap<string, number>;
  cardCount: number;
  questionCount: number;
  dueCards: number;
  /** Days since the student last studied this pack (null = never). */
  daysSinceStudied: number | null;
  recentMistakes: ReadonlyMap<string, number>;
  /** The live engine tasks of this pack: day 1 is built from them. */
  liveTasks: RecommendationTask[];
  now: Date;
}

/** Recommendation task → plan task (setup tasks such as "add material" are not study). */
export function toPlanTask(task: RecommendationTask): StudyPlanTask | null {
  const sessionType = task.sessionType;
  const type: StudyPlanTask['type'] | null =
    task.type === 'generate-concepts' || task.type === 'generate-practice' || task.type === 'add-material'
      ? null
      : sessionType ?? (task.type === 'review' || task.type === 'continue' ? 'cards' : task.type);
  if (!type) return null;
  return {
    type,
    label: task.label,
    minutes: task.minutes,
    conceptId: task.conceptId,
    conceptName: task.conceptName,
    mode: task.mode,
    count: task.count ?? undefined,
  };
}

function learnLabel(names: string[]): string {
  if (names.length === 1) return `Learn ${names[0]}`;
  const shown = names.slice(0, 2).join(', ');
  return names.length === 2 ? `Learn ${shown}` : `Learn ${shown} and ${names.length - 2} more`;
}

function focusFor(tasks: StudyPlanTask[], isFinal: boolean, examDay: boolean): string {
  if (examDay) return 'Exam day — a light warm-up';
  if (isFinal) return 'Exam simulation and final review';
  if (tasks.some((task) => task.type === 'learn')) return 'Learn new concepts';
  if (tasks.some((task) => task.type === 'test')) return 'Check your progress with a test';
  if (tasks.some((task) => task.type === 'practice')) return 'Practice weak topics';
  return 'Spaced review';
}

function activitiesOf(tasks: StudyPlanTask[], extra: string[] = []): string[] {
  return [...tasks.map((task) => `${task.label} (${task.minutes} min)`), ...extra];
}

/**
 * The exam planner. Day 1 is today's live plan; the days in between first learn
 * what is weak/new/still learning (a few concepts a day), then practise the
 * weakest concepts with spaced flashcard reviews and a checkpoint test; the last
 * day before the exam is an exam simulation plus a final review.
 */
export function planStudyDays(input: PlanInput): { overview: string; sessions: StudyPlanSession[] } {
  const days = Math.max(1, Math.min(PLAN_MAX_DAYS, Math.round(input.days)));
  const budget = Math.max(10, Math.min(180, Math.round(input.budgetMinutes)));
  const examDay = input.examDaysLeft === 0;
  const comeback = input.daysSinceStudied !== null && input.daysSinceStudied >= COMEBACK_GAP_DAYS;
  const stateOf = (concept: ConceptRecord) => input.states.get(concept.id) ?? emptyMastery();
  const questionsOf = (concept: ConceptRecord) => input.questionCountByConcept.get(concept.id) ?? 0;

  /* What still has to be learned: weak first, then new (important ones first
     when an exam is coming), then the ones that are still shaky. */
  const queue = selectLearnConcepts({
    concepts: input.concepts,
    states: input.states,
    limit: input.concepts.length + 1,
    now: input.now,
  }).filter((entry) => entry.reason === 'weak' || entry.reason === 'new' || entry.reason === 'learning');
  const byTier = (reason: string) => queue.filter((entry) => entry.reason === reason).map((entry) => entry.concept);
  const fresh = byTier('new');
  if (input.examDaysLeft !== null) {
    fresh.sort(
      (a, b) => (b.importance ?? -1) - (a.importance ?? -1) || a.position - b.position,
    );
  }
  const weakest = byTier('weak');
  const ordered = [...weakest, ...fresh, ...byTier('learning')];

  /* Day 1: the live tasks (fit to a lighter budget after a break). */
  const dayOneBudget = comeback ? Math.round(budget * 0.8) : budget;
  const liveTasks = input.liveTasks
    .flatMap((task) => {
      const planTask = toPlanTask(task);
      return planTask ? [planTask] : [];
    });
  const dayOne = fitToBudget(liveTasks, dayOneBudget);
  const learnedToday = dayOne
    .filter((task) => task.type === 'learn')
    .reduce((sum, task) => sum + (task.count ?? 1), 0);
  const remaining = ordered.slice(learnedToday);
  const learnedIds = new Set<string>([
    ...ordered.slice(0, learnedToday).map((concept) => concept.id),
    ...input.concepts.filter((concept) => stateOf(concept).attempts > 0).map((concept) => concept.id),
  ]);

  const sessions: StudyPlanSession[] = [];
  const dateOf = (day: number) => addDaysIso(input.startDay, day - 1);
  const push = (day: number, tasks: StudyPlanTask[], isFinal: boolean, extra: string[] = []) => {
    sessions.push({
      day,
      date: dateOf(day),
      focus: focusFor(tasks, isFinal, examDay && day === 1),
      activities: activitiesOf(tasks, extra),
      minutes: tasks.reduce((sum, task) => sum + task.minutes, 0),
      tasks,
      budgetMinutes: budget,
    });
  };

  const simulation = (): StudyPlanTask | null => {
    if (input.questionCount < 5) return null;
    const count = Math.min(25, input.questionCount);
    return {
      type: 'test',
      label: 'Take an exam simulation without hints',
      minutes: questionMinutes(count),
      mode: 'exam',
      count,
    };
  };
  const cardsTask = (count: number): StudyPlanTask | null =>
    input.cardCount > 0
      ? { type: 'cards', label: 'Review the flashcards that are due', minutes: cardMinutes(count), count }
      : null;
  const compact = <T,>(items: (T | null)[]): T[] => items.filter((item): item is T => item !== null);

  const isSingleDay = days === 1;
  const finalExtra = ['Review every mistake from the test'];

  /* Day 1 (and the only day when the exam is tomorrow or today). */
  if (isSingleDay) {
    const sim = examDay ? null : simulation();
    const tasks = fitToBudget(compact([...dayOne, sim]), Math.round(budget * 1.5));
    push(1, tasks.length > 0 ? tasks : compact([cardsTask(10)]), !examDay, examDay ? [] : finalExtra);
  } else {
    push(1, dayOne.length > 0 ? dayOne : compact([cardsTask(10)]), false);
  }

  /* The days in between. */
  const middleDays = days >= 3 ? days - 2 : 0;
  const learnWindow = Math.max(1, Math.ceil(middleDays * 0.6));
  const perDay = Math.min(MAX_LEARN_PER_DAY, Math.max(1, Math.ceil(remaining.length / learnWindow)));
  const learnDays = Math.min(middleDays, Math.ceil(remaining.length / perDay));
  const uncovered = Math.max(0, remaining.length - learnDays * perDay);
  const practiceOrder = (concept: ConceptRecord) =>
    -(input.recentMistakes.get(concept.id) ?? 0) * 0.2 + stateOf(concept).mastery;
  const checkpoint =
    input.questionCount >= 10 && middleDays >= 3 ? Math.max(learnDays, middleDays - 2) : -1;

  for (let index = 0; index < middleDays; index += 1) {
    const day = index + 2;
    const tasks: StudyPlanTask[] = [];

    if (index < learnDays) {
      const chunk = remaining.slice(index * perDay, (index + 1) * perDay);
      tasks.push({
        type: 'learn',
        label: learnLabel(chunk.map((concept) => concept.name)),
        minutes: learnMinutes(chunk.length),
        conceptId: chunk[0]?.id ?? null,
        conceptName: chunk[0]?.name ?? null,
        count: chunk.length,
      });
    }

    const pool = input.concepts
      .filter((concept) => learnedIds.has(concept.id) && questionsOf(concept) > 0)
      .sort((a, b) => practiceOrder(a) - practiceOrder(b) || a.position - b.position);
    if (index === checkpoint) {
      tasks.push({
        type: 'test',
        label: 'Take a practice test and review its mistakes',
        minutes: questionMinutes(10),
        mode: 'quick10',
        count: 10,
      });
    } else if (pool.length > 0) {
      for (let pick = 0; pick < Math.min(PRACTICE_CONCEPTS_PER_DAY, pool.length); pick += 1) {
        const concept = pool[(index * PRACTICE_CONCEPTS_PER_DAY + pick) % pool.length]!;
        if (tasks.some((task) => task.conceptId === concept.id)) continue;
        tasks.push({
          type: 'practice',
          label: `Practice ${concept.name}`,
          minutes: questionMinutes(TASK_COUNTS.practiceFocus),
          conceptId: concept.id,
          conceptName: concept.name,
          count: TASK_COUNTS.practiceFocus,
        });
      }
    } else if (input.questionCount > 0) {
      tasks.push({
        type: 'practice',
        label: 'Practice mixed questions',
        minutes: questionMinutes(TASK_COUNTS.practice),
        count: TASK_COUNTS.practice,
      });
    }
    if (index % 2 === 0) {
      const cards = cardsTask(10);
      if (cards) tasks.push(cards);
    }
    for (const concept of remaining.slice(index * perDay, (index + 1) * perDay)) learnedIds.add(concept.id);

    const fitted = fitToBudget(tasks, budget);
    push(day, fitted.length > 0 ? fitted : compact([cardsTask(10)]), false);
  }

  /* The last day before the exam. */
  if (days >= 2) {
    const sim = simulation();
    const tasks = fitToBudget(compact([sim, cardsTask(10)]), Math.round(budget * 1.5));
    push(days, tasks, true, sim ? finalExtra : []);
  }

  const total = sessions.reduce((sum, session) => sum + session.minutes, 0);
  const overviewParts = [
    `${days} ${days === 1 ? 'day' : 'days'} of study at ${budget} minutes per day.`,
    input.concepts.length > 0 ? `${input.concepts.length} concepts to understand.` : null,
    input.cardCount > 0 ? `${input.cardCount} flashcards to learn.` : null,
    input.dueCards > 0 ? `${input.dueCards} cards are already due for review.` : null,
    weakest.length > 0
      ? `Weakest right now: ${weakest.slice(0, 3).map((concept) => concept.name).join(', ')}.`
      : null,
    fresh.length > 0
      ? `${fresh.length} new ${fresh.length === 1 ? 'concept' : 'concepts'} to learn.`
      : null,
    input.examDaysLeft !== null && input.examDaysLeft <= EXAM_ADJUSTMENT_DAYS
      ? `The exam is ${input.examDaysLeft === 0 ? 'today' : `in ${input.examDaysLeft} ${input.examDaysLeft === 1 ? 'day' : 'days'}`}, so the plan puts weak concepts first and ends with an exam simulation.`
      : null,
    comeback
      ? `You have not studied for ${input.daysSinceStudied} days, so today starts lighter.`
      : null,
    uncovered > 0
      ? `${uncovered} ${uncovered === 1 ? 'concept does' : 'concepts do'} not fit before the exam at this pace — the plan covers the weakest first.`
      : null,
    `About ${total} minutes in total.`,
  ].filter((part): part is string => part !== null);

  return { overview: overviewParts.join(' '), sessions };
}

/* --------------------------------- service --------------------------------- */

function daysSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((now.getTime() - time) / 86_400_000));
}

/** Plans are auto-managed for packs that have an upcoming exam within this many days. */
const AUTO_PLAN_DAYS = PLAN_MAX_DAYS;

async function loadContext(
  db: Database,
  userId: string,
  snapshots: PackSummarySnapshot[],
  now: Date,
  timeZone: string,
) {
  const [openSessions, flashcardSessions] = await Promise.all([
    db.learningSessions.listByUser(userId, { statuses: ['not_started', 'active'], limit: 50 }),
    db.sessions.listByUser(userId),
  ]);
  const ctx: RecommendationContext = {
    now,
    timeZone,
    recentMistakes: collectRecentMistakes(snapshots, now),
    openSessions: openSessions.filter((session) => isResumable(session, now)),
    openFlashcardSessions: flashcardSessions.filter((session) => !session.endedAt),
  };
  return { ctx, flashcardSessions, openSessions: ctx.openSessions };
}

/** Builds and stores the plan of one pack from an already-loaded snapshot. */
async function storePlan(
  db: Database,
  userId: string,
  snapshot: PackSummarySnapshot,
  ctx: RecommendationContext,
  options: { days?: number; minutesPerDay?: number },
): Promise<StudyPlanRecord> {
  const { pack, context, progress } = snapshot;
  const daysLeft = examDaysLeft(pack, ctx.now, ctx.timeZone);
  const days = Math.min(
    Math.max(options.days ?? (daysLeft !== null ? Math.max(1, daysLeft) : 7), 1),
    PLAN_MAX_DAYS,
  );
  const states = new Map(progress.conceptStates.map((entry) => [entry.concept.id, entry.state]));
  const questionCountByConcept = new Map<string, number>();
  for (const question of context.questions) {
    if (question.conceptId) {
      questionCountByConcept.set(question.conceptId, (questionCountByConcept.get(question.conceptId) ?? 0) + 1);
    }
  }
  const plan = planStudyDays({
    title: pack.title,
    startDay: todayIso(ctx.now, ctx.timeZone),
    days,
    budgetMinutes: options.minutesPerDay ?? dailyBudgetMinutes(daysLeft),
    examDaysLeft: daysLeft,
    concepts: context.concepts,
    states,
    questionCountByConcept,
    cardCount: context.cards.length,
    questionCount: context.questions.length,
    dueCards: progress.dueCards,
    daysSinceStudied: daysSince(progress.activity.slice().sort().at(-1) ?? null, ctx.now),
    recentMistakes: ctx.recentMistakes,
    liveTasks: rankRecommendations(packCandidates(snapshot, ctx)).map(toTask),
    now: ctx.now,
  });
  return db.studyPlans.upsert({
    packId: pack.id,
    ownerId: userId,
    examDate: pack.examDate,
    overview: plan.overview,
    sessions: plan.sessions,
  });
}

function planIsStale(plan: StudyPlanRecord | null, pack: StudyPackRecord, today: string): boolean {
  if (!plan) return true;
  if (plan.examDate !== pack.examDate) return true;
  const first = plan.sessions[0]?.date ?? null;
  return first !== today;
}

export const studyPlanService = {
  /** Explicit "build my plan" (owner only checks happen in the caller). */
  async build(
    db: Database,
    userId: string,
    pack: StudyPackRecord,
    input: { days?: number; minutesPerDay?: number } = {},
    now: Date = new Date(),
  ) {
    const timeZone = await resolveTimeZone(db, userId);
    const snapshots = await loadPackSnapshots(db, userId, [pack], now, timeZone);
    const { ctx } = await loadContext(db, userId, snapshots, now, timeZone);
    const saved = await storePlan(db, userId, snapshots[0]!, ctx, input);
    return dto.studyPlan(saved);
  },

  /**
   * Keeps the plans of packs with an upcoming exam current: creates a missing
   * one, and rebuilds one from a previous day, for another exam date or after
   * `force` (a finished session changed the mastery it was built from). The
   * student's chosen daily budget survives a rebuild. Best effort by design —
   * a plan that cannot be refreshed must never break the page that asked.
   */
  async refreshExamPlans(
    db: Database,
    userId: string,
    snapshots: PackSummarySnapshot[],
    ctx: RecommendationContext,
    options: { force?: boolean; packIds?: string[] } = {},
  ): Promise<void> {
    const today = todayIso(ctx.now, ctx.timeZone);
    for (const snapshot of snapshots) {
      const { pack } = snapshot;
      if (options.packIds && !options.packIds.includes(pack.id)) continue;
      const daysLeft = examDaysLeft(pack, ctx.now, ctx.timeZone);
      if (daysLeft === null || daysLeft < 0 || daysLeft > AUTO_PLAN_DAYS) continue;
      try {
        const existing = await db.studyPlans.getByPack(pack.id);
        if (!options.force && !planIsStale(existing, pack, today)) continue;
        await storePlan(db, userId, snapshot, ctx, {
          minutesPerDay: existing?.sessions[0]?.budgetMinutes,
        });
      } catch {
        // Keep going: the plan is refreshed again on the next visit.
      }
    }
  },

  /** After a session: rebuild the plan of that pack when it has an exam. */
  async refreshAfterSession(
    db: Database,
    userId: string,
    packId: string,
    now: Date = new Date(),
  ): Promise<void> {
    const pack = await db.packs.get(packId);
    if (!pack || pack.ownerId !== userId || !pack.examDate) return;
    const timeZone = await resolveTimeZone(db, userId);
    const snapshots = await loadPackSnapshots(db, userId, [pack], now, timeZone);
    const { ctx } = await loadContext(db, userId, snapshots, now, timeZone);
    await this.refreshExamPlans(db, userId, snapshots, ctx, { force: true, packIds: [pack.id] });
  },

  /**
   * The exam date changed: rebuild the plan for the new date, or drop the plan
   * that only existed for the old one. Best effort — never fails the edit.
   */
  async onExamDateChanged(
    db: Database,
    userId: string,
    pack: StudyPackRecord,
    now: Date = new Date(),
  ): Promise<void> {
    try {
      if (pack.examDate) {
        await this.refreshAfterSession(db, userId, pack.id, now);
        return;
      }
      const plan = await db.studyPlans.getByPack(pack.id);
      if (plan?.examDate) await db.studyPlans.deleteByPack(pack.id);
    } catch {
      // The plan is rebuilt on the next visit.
    }
  },

  /**
   * The stored plan of a pack, brought up to date first when it belongs to an
   * upcoming exam of its owner (yesterday's plan must not be shown as today's).
   */
  async currentPlan(
    db: Database,
    userId: string | null,
    pack: StudyPackRecord,
    now: Date = new Date(),
  ) {
    if (userId && pack.ownerId === userId && pack.examDate) {
      const timeZone = await resolveTimeZone(db, userId);
      const snapshots = await loadPackSnapshots(db, userId, [pack], now, timeZone);
      const { ctx } = await loadContext(db, userId, snapshots, now, timeZone);
      await this.refreshExamPlans(db, userId, snapshots, ctx);
    }
    const plan = await db.studyPlans.getByPack(pack.id);
    return plan ? dto.studyPlan(plan) : null;
  },

  /**
   * "Today" for the whole student: numbered plan, per-subject sections, the
   * exam banner, resumable sessions and the streak — one request, one engine.
   */
  async today(db: Database, userId: string, now: Date = new Date()) {
    const timeZone = await resolveTimeZone(db, userId).catch(() => DEFAULT_TIMEZONE);
    const day = todayIso(now, timeZone);
    const packs = await db.packs.listByOwner(userId);
    const snapshots = await loadPackSnapshots(db, userId, packs, now, timeZone);
    const summaries = snapshots.map((snapshot) => snapshot.summary);
    const { ctx, flashcardSessions, openSessions } = await loadContext(db, userId, snapshots, now, timeZone);

    const exams = (await db.packs.listUpcomingExams(userId, day)).map((pack) => {
      const summary = summaries.find((entry) => entry.id === pack.id);
      return {
        packId: pack.id,
        title: pack.title,
        examDate: pack.examDate,
        daysLeft: pack.examDate ? daysUntil(pack.examDate, now, timeZone) : null,
        masteryPercent: summary?.masteryPercent ?? 0,
        weakConcepts: summary?.weakConcepts ?? 0,
        dueCards: summary?.dueCards ?? 0,
      };
    });

    // Keep the exam plans fresh before anything is derived from them.
    await this.refreshExamPlans(db, userId, snapshots, ctx);

    const ranked = rankTasks(snapshots, ctx);
    const exam = nearestExam(packs, now, timeZone);
    const budget = dailyBudgetMinutes(exam?.daysLeft ?? null);
    const plan = buildTodayPlan(ranked, budget);
    const packById = new Map(packs.map((pack) => [pack.id, pack]));

    const streakStats = await db.learningSessions.statsByUser(userId);
    const streak = buildStudyStreak(
      collectStudyDays({ sessions: streakStats, flashcardSessions }, timeZone),
      day,
    );

    return {
      date: day,
      /** Kept for existing clients: the top task and the four best tasks. */
      recommended: ranked[0]!,
      tasks: ranked.slice(0, 4),
      exams,
      totalDue: summaries.reduce((total, summary) => total + summary.dueCards, 0),
      packs: summaries.slice(0, 6),
      plan,
      /** The single primary action of the page: the first step of the plan. */
      primary: plan.steps[0] ?? null,
      exam,
      subjects: buildSubjectsToday(snapshots, ranked, plan, now, timeZone),
      resume: openSessions
        .filter((session) => packById.has(session.packId))
        .slice(0, 3)
        .map((session) => toResumeCard(session, packById.get(session.packId)!)),
      streak,
    };
  },
};

