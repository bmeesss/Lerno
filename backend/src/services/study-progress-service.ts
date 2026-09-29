/**
 * Study progress — what the student has really done, built only from stored
 * data: sessions, attempts, card progress, daily mastery snapshots.
 *
 * Nothing here is estimated to look better than it is:
 *  - the streak counts days with a *completed* study session (or a finished
 *    flashcard session), never merely opening the app;
 *  - a trend needs at least three real days of snapshots, otherwise the API says
 *    so and the UI shows an honest empty state instead of a line;
 *  - totals use the exact counters, not the capped list queries.
 */
import type { Database } from '../lib/db/repository.js';
import type {
  LearningSessionRecord,
  LearningSessionStat,
  StudySessionRecord,
} from '../lib/db/types.js';
import { errors } from '../lib/errors.js';
import { dayKeyInZone } from '../lib/timezone.js';
import {
  buildMasteryTrend,
  MIN_TREND_DAYS,
  recentChange,
  type MasteryTrend,
} from './mastery-service.js';
import { examDaysLeft, loadPackSnapshots, type PackSummarySnapshot } from './pack-data.js';
import {
  bestTaskForPack,
  collectRecentMistakes,
  rankTasks,
  type RecommendationContext,
} from './recommendation-service.js';
import { computeStreaks, resolveTimeZone } from './retention-service.js';
import { isResumable, sessionLabel, toResumeCard } from './session-model.js';
import { addDaysIso, todayIso } from './study-pack-rules.js';

/* ---------------------------------- streak --------------------------------- */

export interface StudyStreak {
  current: number;
  longest: number;
  lastActiveDay: string | null;
  /** True once a real session was completed today (the streak is safe until tomorrow). */
  todayDone: boolean;
}

/** A finished flashcard session counts, but only if it showed at least one card. */
export function collectStudyDays(
  input: { sessions: LearningSessionStat[]; flashcardSessions: StudySessionRecord[] },
  timeZone: string,
): Set<string> {
  const days = new Set<string>();
  for (const session of input.sessions) {
    if (session.status === 'completed' && session.completedAt && session.answeredCount > 0) {
      days.add(dayKeyInZone(session.completedAt, timeZone));
    }
  }
  for (const session of input.flashcardSessions) {
    if (session.endedAt && session.cardsSeen > 0) days.add(dayKeyInZone(session.endedAt, timeZone));
  }
  return days;
}

export function buildStudyStreak(days: Set<string>, today: string): StudyStreak {
  const streak = computeStreaks([...days], today);
  return { ...streak, todayDone: days.has(today) };
}

/** Flashcard sessions have no idle tracking: cap one at half an hour. */
const FLASHCARD_SESSION_CAP_SECONDS = 30 * 60;

export function flashcardSessionSeconds(session: StudySessionRecord): number {
  if (!session.endedAt || session.cardsSeen <= 0) return 0;
  const seconds = (Date.parse(session.endedAt) - Date.parse(session.startedAt)) / 1000;
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.min(Math.round(seconds), FLASHCARD_SESSION_CAP_SECONDS);
}

/* --------------------------------- overview -------------------------------- */

const RECENT_WINDOW_DAYS = 14;
const TREND_WINDOW_DAYS = 30;

export interface ConceptImprovement {
  conceptId: string;
  name: string;
  beforePercent: number;
  afterPercent: number;
  changePercent: number;
}

/**
 * Net change per concept over a set of completed sessions: from where it stood
 * before the first session that touched it to where the last one left it.
 */
export function collectImprovedConcepts(
  sessions: Pick<LearningSessionRecord, 'completedAt' | 'result'>[],
  minimumChange = 5,
): ConceptImprovement[] {
  const ordered = sessions
    .filter((session) => session.result && session.completedAt)
    .sort((a, b) => (a.completedAt ?? '').localeCompare(b.completedAt ?? ''));
  const byConcept = new Map<string, ConceptImprovement>();
  for (const session of ordered) {
    for (const change of session.result!.concepts) {
      const existing = byConcept.get(change.conceptId);
      byConcept.set(change.conceptId, {
        conceptId: change.conceptId,
        name: change.name,
        beforePercent: existing?.beforePercent ?? change.beforePercent,
        afterPercent: change.afterPercent,
        changePercent: change.afterPercent - (existing?.beforePercent ?? change.beforePercent),
      });
    }
  }
  return [...byConcept.values()]
    .filter((entry) => entry.changePercent >= minimumChange)
    .sort((a, b) => b.changePercent - a.changePercent || a.name.localeCompare(b.name))
    .slice(0, 5);
}

export interface PackProgressRow {
  packId: string;
  title: string;
  subjectId: string | null;
  subjectName: string | null;
  masteryPercent: number;
  conceptsTotal: number;
  trend: MasteryTrend;
  weakConcepts: { id: string; name: string; masteryPercent: number }[];
  strongConcepts: { id: string; name: string; masteryPercent: number }[];
  dueCards: number;
  lastActivityAt: string | null;
  sessionsCompleted: number;
  questionsAnswered: number;
  /** Distinct days in the last 7 with a completed session in this pack. */
  activeDaysLast7: number;
  examDate: string | null;
  examDaysLeft: number | null;
}

function conceptLine(entry: PackSummarySnapshot['progress']['conceptStates'][number]) {
  return {
    id: entry.concept.id,
    name: entry.concept.name,
    masteryPercent: Math.round(entry.state.mastery * 100),
  };
}

export const studyProgressService = {
  async streak(db: Database, userId: string, now: Date, timeZone: string): Promise<StudyStreak> {
    const [sessions, flashcardSessions] = await Promise.all([
      db.learningSessions.statsByUser(userId),
      db.sessions.listByUser(userId),
    ]);
    return buildStudyStreak(
      collectStudyDays({ sessions, flashcardSessions }, timeZone),
      todayIso(now, timeZone),
    );
  },

  /** Everything the Progress page shows, in one request. */
  async overview(db: Database, userId: string, now: Date = new Date()) {
    const timeZone = await resolveTimeZone(db, userId);
    const today = todayIso(now, timeZone);
    const packs = await db.packs.listByOwner(userId);
    const recentSince = new Date(now.getTime() - RECENT_WINDOW_DAYS * 86_400_000).toISOString();

    const [
      snapshots,
      sessionStats,
      flashcardSessions,
      practiceCount,
      testTotals,
      cardProgress,
      snapshotRows,
      recentSessions,
    ] = await Promise.all([
      loadPackSnapshots(db, userId, packs, now, timeZone),
      db.learningSessions.statsByUser(userId),
      db.sessions.listByUser(userId),
      db.practiceAttempts.countByUser(userId),
      db.testAttempts.totalsByUser(userId),
      db.progress.listByUser(userId),
      db.masterySnapshots.listByUser(userId, addDaysIso(today, -TREND_WINDOW_DAYS)),
      db.learningSessions.listByUser(userId, {
        statuses: ['completed'],
        since: recentSince,
        limit: 100,
      }),
    ]);

    const studyDays = collectStudyDays({ sessions: sessionStats, flashcardSessions }, timeZone);
    const streak = buildStudyStreak(studyDays, today);

    const studySeconds =
      sessionStats.reduce((sum, stat) => sum + stat.durationSeconds, 0) +
      flashcardSessions.reduce((sum, session) => sum + flashcardSessionSeconds(session), 0);
    const cardsReviewed = cardProgress.reduce(
      (sum, row) => sum + row.correctCount + row.incorrectCount,
      0,
    );
    const questionsAnswered = practiceCount + testTotals.answers;
    const sessionsCompleted = sessionStats.filter((stat) => stat.status === 'completed').length;

    const conceptsTotal = snapshots.reduce((sum, snapshot) => sum + snapshot.summary.concepts, 0);
    const conceptsMastered = snapshots.reduce(
      (sum, snapshot) => sum + snapshot.summary.masteredConcepts,
      0,
    );
    const conceptsWeak = snapshots.reduce(
      (sum, snapshot) => sum + snapshot.summary.weakConcepts,
      0,
    );
    const masteryPercent =
      conceptsTotal > 0
        ? Math.round(
            snapshots.reduce(
              (sum, snapshot) => sum + snapshot.summary.masteryPercent * snapshot.summary.concepts,
              0,
            ) / conceptsTotal,
          )
        : null;

    const last7Start = addDaysIso(today, -6);
    const packRows: PackProgressRow[] = snapshots.map((snapshot) => {
      const { pack, progress, summary } = snapshot;
      const packSnapshots = snapshotRows.filter((row) => row.packId === pack.id);
      const mine = sessionStats.filter((stat) => stat.packId === pack.id);
      const activeDays = new Set(
        mine
          .filter(
            (stat) => stat.status === 'completed' && stat.completedAt && stat.answeredCount > 0,
          )
          .map((stat) => dayKeyInZone(stat.completedAt!, timeZone))
          .filter((day) => day >= last7Start && day <= today),
      );
      return {
        packId: pack.id,
        title: pack.title,
        subjectId: pack.subjectId,
        subjectName: pack.subjectName,
        masteryPercent: summary.masteryPercent,
        conceptsTotal: summary.concepts,
        trend: buildMasteryTrend(packSnapshots, { today, live: summary.masteryPercent }),
        weakConcepts: progress.conceptStates
          .filter((entry) => entry.weak)
          .sort((a, b) => a.state.mastery - b.state.mastery)
          .slice(0, 5)
          .map(conceptLine),
        strongConcepts: progress.conceptStates
          .filter((entry) => entry.strong)
          .sort((a, b) => b.state.mastery - a.state.mastery)
          .slice(0, 5)
          .map(conceptLine),
        dueCards: summary.dueCards,
        lastActivityAt: summary.lastStudiedAt,
        sessionsCompleted: mine.filter((stat) => stat.status === 'completed').length,
        questionsAnswered:
          progress.graded + progress.testAttempts.reduce((sum, attempt) => sum + attempt.total, 0),
        activeDaysLast7: activeDays.size,
        examDate: pack.examDate,
        examDaysLeft: examDaysLeft(pack, now, timeZone),
      };
    });

    // Recent improvement: average change of the packs that have two or more real data points.
    const changes = snapshots.flatMap((snapshot) => {
      const change = recentChange(
        snapshotRows.filter((row) => row.packId === snapshot.pack.id),
        { today, live: snapshot.summary.masteryPercent, windowDays: RECENT_WINDOW_DAYS },
      );
      return change === null ? [] : [{ change, weight: Math.max(1, snapshot.summary.concepts) }];
    });
    const totalWeight = changes.reduce((sum, entry) => sum + entry.weight, 0);
    const recentImprovement =
      changes.length > 0
        ? {
            changePercent: Math.round(
              changes.reduce((sum, entry) => sum + entry.change * entry.weight, 0) / totalWeight,
            ),
            windowDays: RECENT_WINDOW_DAYS,
            packs: changes.length,
          }
        : null;

    return {
      today,
      timeZone,
      hasActivity:
        studySeconds > 0 || questionsAnswered > 0 || cardsReviewed > 0 || sessionsCompleted > 0,
      overall: {
        masteryPercent,
        conceptsTotal,
        conceptsMastered,
        conceptsWeak,
        studySeconds,
        studyMinutes: Math.round(studySeconds / 60),
        questionsAnswered,
        cardsReviewed,
        testsCompleted: testTotals.attempts,
        sessionsCompleted,
        recentImprovement,
        improvedConcepts: collectImprovedConcepts(recentSessions),
      },
      trendMinDays: MIN_TREND_DAYS,
      streak,
      packs: packRows,
    };
  },

  /**
   * One subject: its packs with mastery, due work, weak concepts, recent
   * activity, exams and the single best next step from the same engine as Today.
   */
  async subjectOverview(db: Database, userId: string, subjectId: string, now: Date = new Date()) {
    const subject = await db.subjects.get(subjectId);
    if (!subject || subject.ownerId !== userId) throw errors.notFound('Subject not found');

    const timeZone = await resolveTimeZone(db, userId);
    const packs = (await db.packs.listByOwner(userId)).filter(
      (pack) => pack.subjectId === subjectId,
    );
    const [snapshots, openSessions, flashcardSessions, recentSessions] = await Promise.all([
      loadPackSnapshots(db, userId, packs, now, timeZone),
      db.learningSessions.listByUser(userId, { statuses: ['not_started', 'active'], limit: 50 }),
      db.sessions.listByUser(userId),
      db.learningSessions.listByUser(userId, { statuses: ['completed'], limit: 60 }),
    ]);

    const ctx: RecommendationContext = {
      now,
      timeZone,
      recentMistakes: collectRecentMistakes(snapshots, now),
      openSessions,
      openFlashcardSessions: flashcardSessions.filter((session) => !session.endedAt),
    };

    const packById = new Map(packs.map((pack) => [pack.id, pack]));
    const rows = snapshots.map((snapshot) => {
      const { pack, progress, summary } = snapshot;
      const resumable = openSessions
        .filter((session) => session.packId === pack.id && isResumable(session, now))
        .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))[0];
      return {
        packId: pack.id,
        title: pack.title,
        masteryPercent: summary.masteryPercent,
        concepts: summary.concepts,
        dueCards: summary.dueCards,
        weakConcepts: progress.conceptStates
          .filter((entry) => entry.weak)
          .sort((a, b) => a.state.mastery - b.state.mastery)
          .slice(0, 5)
          .map(conceptLine),
        lastStudiedAt: summary.lastStudiedAt,
        examDate: pack.examDate,
        examDaysLeft: summary.examDaysLeft,
        next: bestTaskForPack(snapshot, ctx),
        resume: resumable ? toResumeCard(resumable, pack) : null,
      };
    });

    const conceptTotal = rows.reduce((sum, row) => sum + row.concepts, 0);
    const recentActivity = recentSessions
      .filter((session) => packById.has(session.packId))
      .slice(0, 5)
      .map((session) => ({
        sessionId: session.id,
        packId: session.packId,
        label: sessionLabel(session, packById.get(session.packId)!.title),
        type: session.type,
        completedAt: session.completedAt,
        percent: session.result?.percent ?? null,
        answered: session.answeredCount,
      }));

    // The subject's CTA comes from the same engine as Today, over just this subject's packs.
    const ranked = rankTasks(snapshots, ctx);
    const next = ranked[0] && ranked[0].type !== 'add-material' ? ranked[0] : null;

    return {
      subject: { id: subject.id, name: subject.name },
      totals: {
        packs: rows.length,
        concepts: conceptTotal,
        masteryPercent:
          conceptTotal > 0
            ? Math.round(
                rows.reduce((sum, row) => sum + row.masteryPercent * row.concepts, 0) /
                  conceptTotal,
              )
            : null,
        dueCards: rows.reduce((sum, row) => sum + row.dueCards, 0),
        weakConcepts: rows.reduce((sum, row) => sum + row.weakConcepts.length, 0),
      },
      packs: rows,
      exams: rows
        .filter((row) => row.examDate !== null && (row.examDaysLeft ?? -1) >= 0)
        .map((row) => ({
          packId: row.packId,
          title: row.title,
          examDate: row.examDate,
          daysLeft: row.examDaysLeft,
        }))
        .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0)),
      recentActivity,
      next,
    };
  },
};
