/**
 * Progress service — aggregate study statistics (spec §6 "Progress").
 * Honest numbers only: cards studied, accuracy, study time, streaks.
 */
import type { Database } from '../lib/db/repository.js';

function dayKey(iso: string): string {
  return iso.slice(0, 10); // UTC day
}

/**
 * Consecutive days with study activity ending today (or yesterday).
 * Activity = a card review or a study session that day.
 */
export function computeStreakDays(activityIsoDates: string[]): number {
  const days = new Set(activityIsoDates.map(dayKey));
  if (days.size === 0) return 0;

  const today = new Date();
  const cursor = new Date(today.getTime());
  if (!days.has(dayKey(cursor.toISOString()))) {
    // Streak survives until the end of the next day: accept yesterday's activity.
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    if (!days.has(dayKey(cursor.toISOString()))) return 0;
  }

  let streak = 0;
  while (days.has(dayKey(cursor.toISOString()))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

export interface SubjectProgressRow {
  subjectId: string | null;
  subjectName: string;
  totalCards: number;
  learnedCards: number;
  dueCards: number;
  accuracy: number | null;
}

export interface SetProgressRow extends SubjectProgressRow {
  setId: string;
  setTitle: string;
}

export const progressService = {
  async stats(db: Database, userId: string) {
    const [progressList, attempts, sessions, sets] = await Promise.all([
      db.progress.listByUser(userId),
      db.attempts.listByUser(userId),
      db.sessions.listByUser(userId),
      db.sets.listByOwner(userId),
    ]);

    const nowIso = new Date().toISOString();
    const cardsStudied = progressList.length;
    const totalCorrect = progressList.reduce((sum, p) => sum + p.correctCount, 0);
    const totalAnswers = progressList.reduce(
      (sum, p) => sum + p.correctCount + p.incorrectCount,
      0,
    );
    const quizTotal = attempts.reduce((sum, a) => sum + a.total, 0);
    const quizScore = attempts.reduce((sum, a) => sum + a.score, 0);

    const studyTimeMs = sessions.reduce((sum, session) => {
      if (!session.endedAt) return sum;
      const end = Date.parse(session.endedAt);
      const start = Date.parse(session.startedAt);
      return sum + Math.max(0, end - start);
    }, 0);

    const activity = [
      ...progressList
        .map((p) => p.lastReviewedAt)
        .filter((value): value is string => Boolean(value)),
      ...sessions.map((s) => s.startedAt),
    ];
    const streakDays = computeStreakDays(activity);

    // Per-set + per-subject rollups from the user's sets + progress
    const allSetIds = new Set(sets.map((set) => set.id));
    const favoriteIds = await db.favorites.listByUser(userId);
    const favoriteSets = await db.sets.listByIds(favoriteIds.map((f) => f.setId));
    for (const set of favoriteSets) allSetIds.add(set.id);

    const setRecords = await db.sets.listByIds([...allSetIds]);
    const cardCounts = await db.cards.countBySets(setRecords.map((set) => set.id));

    const progressByCard = new Map(progressList.map((p) => [p.cardId, p]));
    const setRows: SetProgressRow[] = [];
    const subjectRollup = new Map<
      string,
      {
        subjectId: string | null;
        subjectName: string;
        totalCards: number;
        learnedCards: number;
        dueCards: number;
        correct: number;
        answers: number;
      }
    >();

    for (const set of setRecords) {
      const cards = await db.cards.listBySet(set.id);
      let learned = 0;
      let due = 0;
      let correct = 0;
      let answers = 0;
      for (const card of cards) {
        const progress = progressByCard.get(card.id);
        if (!progress) continue;
        learned += 1;
        if (progress.nextReviewAt && progress.nextReviewAt <= nowIso) due += 1;
        correct += progress.correctCount;
        answers += progress.correctCount + progress.incorrectCount;
      }
      const totalCards = cardCounts[set.id] ?? cards.length;
      setRows.push({
        setId: set.id,
        setTitle: set.title,
        subjectId: set.subjectId,
        subjectName: set.subjectName ?? 'No subject',
        totalCards,
        learnedCards: learned,
        dueCards: due,
        accuracy: answers > 0 ? correct / answers : null,
      });

      const key = set.subjectId ?? 'none';
      const rollup = subjectRollup.get(key) ?? {
        subjectId: set.subjectId,
        subjectName: set.subjectName ?? 'No subject',
        totalCards: 0,
        learnedCards: 0,
        dueCards: 0,
        correct: 0,
        answers: 0,
      };
      rollup.totalCards += totalCards;
      rollup.learnedCards += learned;
      rollup.dueCards += due;
      rollup.correct += correct;
      rollup.answers += answers;
      subjectRollup.set(key, rollup);
    }

    const subjectProgress: SubjectProgressRow[] = [...subjectRollup.values()].map((row) => ({
      subjectId: row.subjectId,
      subjectName: row.subjectName,
      totalCards: row.totalCards,
      learnedCards: row.learnedCards,
      dueCards: row.dueCards,
      accuracy: row.answers > 0 ? row.correct / row.answers : null,
    }));

    return {
      cardsStudied,
      quizAttempts: attempts.length,
      accuracy: totalAnswers > 0 ? totalCorrect / totalAnswers : null,
      quizAccuracy: quizTotal > 0 ? quizScore / quizTotal : null,
      studyTimeMinutes: Math.round(studyTimeMs / 60_000),
      streakDays,
      subjectProgress,
      setProgress: setRows,
    };
  },
};
