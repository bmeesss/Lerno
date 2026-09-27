/**
 * Retention / study-habit layer — calm, server-authoritative, derived data only.
 *
 * Streaks, daily-goal progress and weekly summaries are computed from existing
 * records (card_progress, quiz_attempts, study_sessions). There are no
 * client-writable counters anywhere: every timestamp used here is written by
 * the server at review/attempt/session time, so streaks and activity dates
 * cannot be forged. No XP, levels, leaderboards or limits — the only goal is
 * to answer "what should I do now?".
 */
import type { Database } from '../lib/db/repository.js';
import { errors } from '../lib/errors.js';
import type {
  CardProgressRecord,
  QuizAttemptRecord,
  StudySessionRecord,
} from '../lib/db/types.js';
import { canViewSet } from './set-service.js';
import { studyService } from './study-service.js';

/** Daily goal: distinct cards reviewed per day. A goal, never a limit. */
export const DAILY_GOAL_TARGET = 10;

/** Days since the last study day before a comeback message appears. */
export const COMEBACK_GAP_DAYS = 3;

/** An unfinished session counts as "continue where you left off" for 24h. */
const ACTIVE_SESSION_WINDOW_MS = 24 * 3600_000;

/** UTC calendar day: "2026-03-05". */
export function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function dayKeyToMs(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

function msToDayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Whole days from day `a` to day `b` (b - a), UTC. */
function diffDays(a: string, b: string): number {
  return Math.round((dayKeyToMs(b) - dayKeyToMs(a)) / 86_400_000);
}

/** Monday (UTC) of the week containing `day`. */
export function mondayOf(day: string): string {
  const weekday = new Date(dayKeyToMs(day)).getUTCDay(); // 0 = Sunday
  return msToDayKey(dayKeyToMs(day) - ((weekday + 6) % 7) * 86_400_000);
}

export interface StreakInfo {
  current: number;
  longest: number;
  lastActiveDay: string | null;
}

/**
 * Streaks from a set of active UTC days. Deterministic and pure.
 * The current streak survives when the user studied today or yesterday; any
 * gap simply ends it (never negative, never corrupt).
 */
export function computeStreaks(activityDayKeys: string[], todayDay: string): StreakInfo {
  const days = new Set(activityDayKeys);
  if (days.size === 0) return { current: 0, longest: 0, lastActiveDay: null };

  const sorted = [...days].sort();
  const lastActiveDay = sorted[sorted.length - 1]!;

  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i += 1) {
    if (diffDays(sorted[i - 1]!, sorted[i]!) === 1) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 1;
    }
  }

  // Current streak: walk back from today (or yesterday — the streak survives
  // until the end of the next day).
  let cursor = dayKeyToMs(todayDay);
  if (!days.has(msToDayKey(cursor))) {
    cursor -= 86_400_000;
    if (!days.has(msToDayKey(cursor))) return { current: 0, longest, lastActiveDay };
  }
  let current = 0;
  while (days.has(msToDayKey(cursor))) {
    current += 1;
    cursor -= 86_400_000;
  }
  return { current, longest, lastActiveDay };
}

export interface UpcomingReviews {
  dueNow: number;
  laterToday: number;
  tomorrow: number;
  next7Days: number;
}

/** Buckets scheduled review times into due-now/upcoming windows (pure). */
export function bucketUpcoming(nextReviewAts: (string | null)[], now: Date): UpcomingReviews {
  const nowMs = now.getTime();
  const todayDay = dayKey(now.toISOString());
  const startOfTomorrow = dayKeyToMs(todayDay) + 86_400_000;
  const startOfDayAfter = startOfTomorrow + 86_400_000;
  const endOfWindow = dayKeyToMs(todayDay) + 8 * 86_400_000; // today + 7 days

  const buckets: UpcomingReviews = { dueNow: 0, laterToday: 0, tomorrow: 0, next7Days: 0 };
  for (const next of nextReviewAts) {
    if (!next) continue;
    const ms = Date.parse(next);
    if (!Number.isFinite(ms)) continue;
    if (ms <= nowMs) buckets.dueNow += 1;
    else if (ms < startOfTomorrow) buckets.laterToday += 1;
    else if (ms < startOfDayAfter) buckets.tomorrow += 1;
    else if (ms < endOfWindow) buckets.next7Days += 1;
  }
  return buckets;
}

export interface ActivityInput {
  progress: CardProgressRecord[];
  attempts: QuizAttemptRecord[];
  sessions: StudySessionRecord[];
}

/**
 * Days with meaningful study activity: at least one card review, one quiz
 * attempt, or one completed (ended, cards seen) study session. Merely opening
 * the app or starting a session without studying counts for nothing.
 */
export function collectActivityDays(input: ActivityInput): Set<string> {
  const days = new Set<string>();
  for (const row of input.progress) {
    if (row.lastReviewedAt) days.add(dayKey(row.lastReviewedAt));
  }
  for (const attempt of input.attempts) {
    days.add(dayKey(attempt.createdAt));
  }
  for (const session of input.sessions) {
    if (session.endedAt && session.cardsSeen > 0) days.add(dayKey(session.endedAt));
  }
  return days;
}

export type ContinueAction =
  | { type: 'review'; setId: string; setTitle: string; dueCount: number }
  | { type: 'continue-session'; sessionId: string; setId: string; setTitle: string }
  | { type: 'study-set'; setId: string; setTitle: string; remaining: number }
  | { type: 'daily-goal'; setId: string; setTitle: string; remaining: number }
  | { type: 'create-set' }
  | { type: 'discover' };

export interface ComebackInfo {
  awayDays: number;
  dueCount: number;
  message: string;
}

export interface TodaySummary {
  date: string;
  target: number;
  completedCards: number;
  completionPercentage: number;
  goalReached: boolean;
  cardsDue: number;
  upcoming: UpcomingReviews;
  streak: StreakInfo;
  comeback: ComebackInfo | null;
  continueAction: ContinueAction;
}

export interface WeekDaySummary {
  day: string;
  active: boolean;
  cardsTouched: number;
  quizzes: number;
  studyMinutes: number;
}

export interface WeekSummary {
  weekStart: string;
  studyDays: number;
  cardsStudied: number;
  quizzesCompleted: number;
  quizAccuracy: number | null;
  studyTimeMinutes: number;
  currentStreak: number;
  days: WeekDaySummary[];
}

export type StudyPlanAction = 'review-due' | 'retry-wrong' | 'study-new';

export interface StudyPlanDayFocus {
  setId: string;
  setTitle: string;
  action: StudyPlanAction;
  cards: number;
}

export interface StudyPlanDay {
  day: string;
  focus: StudyPlanDayFocus[];
}

export interface StudyPlan {
  days: number;
  startDay: string;
  totals: { sets: number; dueCards: number; wrongCards: number; newCards: number };
  setsTruncated: boolean;
  plan: StudyPlanDay[];
  note: string | null;
}

/** Days of planning supported (a suggestion window, never an obligation). */
const STUDY_PLAN_DAYS_MIN = 1;
const STUDY_PLAN_DAYS_MAX = 30;

/** Upper bound on sets scanned for one plan (keeps the query count sane). */
const STUDY_PLAN_MAX_SETS = 50;

export const retentionService = {
  /**
   * "What should I do now?" — daily goal, streak, due/upcoming reviews,
   * comeback state and the single most relevant next action.
   */
  async today(db: Database, userId: string, now: Date = new Date()): Promise<TodaySummary> {
    const todayDay = dayKey(now.toISOString());
    const [progressList, attempts, sessions, dueGroups] = await Promise.all([
      db.progress.listByUser(userId),
      db.attempts.listByUser(userId),
      db.sessions.listByUser(userId),
      studyService.dueGroups(db, userId, now),
    ]);

    const streak = computeStreaks(
      [...collectActivityDays({ progress: progressList, attempts, sessions })],
      todayDay,
    );

    const completedCards = progressList.filter(
      (row) => row.lastReviewedAt && dayKey(row.lastReviewedAt) === todayDay,
    ).length;
    const goalReached = completedCards >= DAILY_GOAL_TARGET;

    const upcoming = await upcomingForUser(db, userId, progressList, now);
    const cardsDue = dueGroups.reduce((sum, group) => sum + group.dueCount, 0);

    return {
      date: todayDay,
      target: DAILY_GOAL_TARGET,
      completedCards,
      completionPercentage: Math.min(
        100,
        Math.round((completedCards / DAILY_GOAL_TARGET) * 100),
      ),
      goalReached,
      cardsDue,
      upcoming,
      streak,
      comeback: comebackFor(todayDay, streak, cardsDue),
      continueAction: await continueActionFor(db, userId, {
        dueGroups,
        sessions,
        progressList,
        goalReached,
        goalRemaining: DAILY_GOAL_TARGET - completedCards,
        now,
      }),
    };
  },

  /** Simple weekly summary for comparing against yourself (Mon–Sun, UTC). */
  async week(db: Database, userId: string, now: Date = new Date()): Promise<WeekSummary> {
    const todayDay = dayKey(now.toISOString());
    const weekStart = mondayOf(todayDay);
    const weekDays = Array.from({ length: 7 }, (_, i) =>
      msToDayKey(dayKeyToMs(weekStart) + i * 86_400_000),
    );

    const [progressList, attempts, sessions] = await Promise.all([
      db.progress.listByUser(userId),
      db.attempts.listByUser(userId),
      db.sessions.listByUser(userId),
    ]);

    const currentStreak = computeStreaks(
      [...collectActivityDays({ progress: progressList, attempts, sessions })],
      todayDay,
    ).current;

    const days: WeekDaySummary[] = weekDays.map((day) => ({
      day,
      active: false,
      cardsTouched: 0,
      quizzes: 0,
      studyMinutes: 0,
    }));
    const byDay = new Map(days.map((entry) => [entry.day, entry]));

    for (const row of progressList) {
      if (!row.lastReviewedAt) continue;
      const entry = byDay.get(dayKey(row.lastReviewedAt));
      if (entry) {
        entry.cardsTouched += 1;
        entry.active = true;
      }
    }

    let quizScore = 0;
    let quizTotal = 0;
    let quizzesCompleted = 0;
    for (const attempt of attempts) {
      const entry = byDay.get(dayKey(attempt.createdAt));
      if (!entry) continue;
      entry.quizzes += 1;
      entry.active = true;
      quizzesCompleted += 1;
      quizScore += attempt.score;
      quizTotal += attempt.total;
    }

    let studyTimeMinutes = 0;
    for (const session of sessions) {
      const entry = byDay.get(dayKey(session.startedAt));
      if (!entry || !session.endedAt) continue;
      const minutes = Math.max(
        0,
        Math.round((Date.parse(session.endedAt) - Date.parse(session.startedAt)) / 60_000),
      );
      entry.studyMinutes += minutes;
      studyTimeMinutes += minutes;
      if (session.cardsSeen > 0) entry.active = true;
    }

    return {
      weekStart,
      studyDays: days.filter((entry) => entry.active).length,
      cardsStudied: days.reduce((sum, entry) => sum + entry.cardsTouched, 0),
      quizzesCompleted,
      quizAccuracy: quizTotal > 0 ? quizScore / quizTotal : null,
      studyTimeMinutes,
      currentStreak,
      days,
    };
  },

  /**
   * Simple study plan: due reviews first, then wrong cards, then new cards,
   * spread over the requested days in daily-goal-sized suggestions.
   * Purely derived from existing data (no new engine); deterministic for a
   * given `now`. Days are UTC calendar days, like the rest of retention.
   */
  async studyPlan(
    db: Database,
    userId: string,
    opts: { days?: number; setIds?: string[] } = {},
    now: Date = new Date(),
  ): Promise<StudyPlan> {
    const days = Math.min(
      Math.max(opts.days ?? 7, STUDY_PLAN_DAYS_MIN),
      STUDY_PLAN_DAYS_MAX,
    );
    const startDay = dayKey(now.toISOString());

    const scope = await planScopeSets(db, userId, opts.setIds);
    const nowIso = now.toISOString();

    // Per-set buckets, most urgent first (stable, deterministic order).
    // Buckets are exclusive — each card is planned exactly once, due first
    // (same due rule as the study queues).
    const buckets: { setId: string; setTitle: string; due: number; wrong: number; fresh: number }[] =
      [];
    for (const set of scope.sets) {
      const [cards, progressList] = await Promise.all([
        db.cards.listBySet(set.id),
        db.progress.listByUserAndSet(userId, set.id),
      ]);
      if (cards.length === 0) continue;
      const byCard = new Map(progressList.map((row) => [row.cardId, row]));
      let due = 0;
      let wrong = 0;
      let fresh = 0;
      for (const card of cards) {
        const row = byCard.get(card.id);
        if (!row) {
          fresh += 1;
        } else if (row.nextReviewAt !== null && row.nextReviewAt <= nowIso) {
          due += 1;
        } else if (row.incorrectCount > 0) {
          wrong += 1;
        }
      }
      buckets.push({ setId: set.id, setTitle: set.title, due, wrong, fresh });
    }
    buckets.sort(
      (a, b) => b.due - a.due || b.wrong - a.wrong || b.fresh - a.fresh || a.setTitle.localeCompare(b.setTitle),
    );

    const totals = {
      sets: buckets.length,
      dueCards: buckets.reduce((sum, bucket) => sum + bucket.due, 0),
      wrongCards: buckets.reduce((sum, bucket) => sum + bucket.wrong, 0),
      newCards: buckets.reduce((sum, bucket) => sum + bucket.fresh, 0),
    };

    // Greedy fill: each day takes up to one daily goal of cards, due first.
    const remaining = buckets.map((bucket) => ({ ...bucket }));
    const plan: StudyPlanDay[] = [];
    for (let offset = 0; offset < days; offset += 1) {
      let capacity = DAILY_GOAL_TARGET;
      const focus: StudyPlanDayFocus[] = [];
      for (const bucket of remaining) {
        if (capacity <= 0) break;
        const take = (action: StudyPlanAction, available: number): number => {
          const n = Math.min(capacity, available);
          if (n > 0) {
            focus.push({ setId: bucket.setId, setTitle: bucket.setTitle, action, cards: n });
            capacity -= n;
          }
          return available - n;
        };
        bucket.due = take('review-due', bucket.due);
        if (capacity <= 0) break;
        bucket.wrong = take('retry-wrong', bucket.wrong);
        if (capacity <= 0) break;
        bucket.fresh = take('study-new', bucket.fresh);
      }
      if (focus.length === 0) break;
      plan.push({ day: msToDayKey(dayKeyToMs(startDay) + offset * 86_400_000), focus });
    }

    const leftover =
      remaining.reduce((sum, bucket) => sum + bucket.due + bucket.wrong + bucket.fresh, 0);
    return {
      days,
      startDay,
      totals,
      setsTruncated: scope.truncated,
      plan,
      note:
        plan.length === 0
          ? 'Nothing due or unstarted in these sets — pick any set to revise, or discover a new one.'
          : leftover > 0
            ? `${leftover} more card${leftover === 1 ? '' : 's'} remain after day ${days}; extend the window or keep a steady daily habit.`
            : null,
    };
  },
};

/** Sets a plan may cover: explicit ids (validated visible) or own+favorited. */
async function planScopeSets(
  db: Database,
  userId: string,
  setIds: string[] | undefined,
): Promise<{ sets: { id: string; title: string }[]; truncated: boolean }> {
  if (setIds && setIds.length > 0) {
    const unique = [...new Set(setIds)];
    const sets = await db.sets.listByIds(unique);
    const byId = new Map(sets.map((set) => [set.id, set]));
    const scoped: { id: string; title: string }[] = [];
    for (const id of unique) {
      const set = byId.get(id);
      if (!set || !canViewSet(set, userId)) {
        throw errors.notFound('Study set not found');
      }
      scoped.push({ id: set.id, title: set.title });
    }
    return { sets: scoped, truncated: false };
  }
  const [ownSets, favorites] = await Promise.all([
    db.sets.listByOwner(userId),
    db.favorites.listByUser(userId),
  ]);
  const favoriteSets = await db.sets.listByIds(favorites.map((favorite) => favorite.setId));
  const seen = new Set<string>();
  const scoped: { id: string; title: string }[] = [];
  for (const set of [...ownSets, ...favoriteSets]) {
    if (seen.has(set.id) || !canViewSet(set, userId)) continue;
    seen.add(set.id);
    scoped.push({ id: set.id, title: set.title });
  }
  return {
    sets: scoped.slice(0, STUDY_PLAN_MAX_SETS),
    truncated: scoped.length > STUDY_PLAN_MAX_SETS,
  };
}

/** Upcoming review buckets restricted to sets the user may study. */
async function upcomingForUser(
  db: Database,
  userId: string,
  progressList: CardProgressRecord[],
  now: Date,
): Promise<UpcomingReviews> {
  const scheduled = progressList.filter((row) => row.nextReviewAt !== null);
  if (scheduled.length === 0) return { dueNow: 0, laterToday: 0, tomorrow: 0, next7Days: 0 };

  const cards = await Promise.all(scheduled.map((row) => db.cards.get(row.cardId)));
  const setIds = [...new Set(cards.filter(Boolean).map((card) => card!.setId))];
  const sets = await db.sets.listByIds(setIds);
  const viewable = new Set(
    sets.filter((set) => canViewSet(set, userId)).map((set) => set.id),
  );
  const cardSet = new Map(cards.filter(Boolean).map((card) => [card!.id, card!.setId]));

  const times = scheduled
    .filter((row) => {
      const setId = cardSet.get(row.cardId);
      return setId !== undefined && viewable.has(setId);
    })
    .map((row) => row.nextReviewAt);
  return bucketUpcoming(times, now);
}

/** Warm, shame-free message for users returning after days away. */
function comebackFor(
  todayDay: string,
  streak: StreakInfo,
  cardsDue: number,
): ComebackInfo | null {
  if (!streak.lastActiveDay) return null;
  const awayDays = diffDays(streak.lastActiveDay, todayDay);
  if (awayDays < COMEBACK_GAP_DAYS) return null;
  return {
    awayDays,
    dueCount: cardsDue,
    message:
      cardsDue > 0
        ? `Welcome back. You have ${cardsDue} card${cardsDue === 1 ? '' : 's'} ready for review.`
        : 'Good to see you again. Continue where you left off.',
  };
}

interface ContinueInput {
  dueGroups: { setId: string; setTitle: string; dueCount: number }[];
  sessions: StudySessionRecord[];
  progressList: CardProgressRecord[];
  goalReached: boolean;
  goalRemaining: number;
  now: Date;
}

/**
 * Deterministic next-action priority: due reviews → unfinished session →
 * recent unfinished set → daily-goal cards → create/discover.
 */
async function continueActionFor(
  db: Database,
  userId: string,
  input: ContinueInput,
): Promise<ContinueAction> {
  if (input.dueGroups.length > 0) {
    const group = input.dueGroups[0]!;
    return { type: 'review', setId: group.setId, setTitle: group.setTitle, dueCount: group.dueCount };
  }

  const activeSession = input.sessions
    .filter(
      (session) =>
        session.endedAt === null &&
        session.setId !== null &&
        input.now.getTime() - Date.parse(session.startedAt) <= ACTIVE_SESSION_WINDOW_MS,
    )
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  if (activeSession?.setId) {
    const set = await db.sets.get(activeSession.setId);
    if (set && canViewSet(set, userId)) {
      return {
        type: 'continue-session',
        sessionId: activeSession.id,
        setId: set.id,
        setTitle: set.title,
      };
    }
  }

  const [ownSets, favorites] = await Promise.all([
    db.sets.listByOwner(userId),
    db.favorites.listByUser(userId),
  ]);
  const favoriteSets = await db.sets.listByIds(favorites.map((favorite) => favorite.setId));
  const candidates = [...ownSets, ...favoriteSets].filter((set) => canViewSet(set, userId));

  const progressByCard = new Map(input.progressList.map((row) => [row.cardId, row]));
  for (const set of candidates.slice(0, 10)) {
    const cards = await db.cards.listBySet(set.id);
    if (cards.length === 0) continue;
    const learned = cards.filter((card) => progressByCard.has(card.id)).length;
    if (learned < cards.length) {
      return { type: 'study-set', setId: set.id, setTitle: set.title, remaining: cards.length - learned };
    }
  }

  if (!input.goalReached && candidates.length > 0) {
    const set = candidates[0]!;
    return { type: 'daily-goal', setId: set.id, setTitle: set.title, remaining: input.goalRemaining };
  }

  if (candidates.length === 0) return { type: 'create-set' };
  return { type: 'discover' };
}
