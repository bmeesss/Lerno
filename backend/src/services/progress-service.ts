/**
 * Progress service — aggregate study statistics (spec §6 "Progress").
 * Honest numbers only: cards studied, accuracy, study time, streaks.
 */
import type { Database } from '../lib/db/repository.js';
import { collectActivityDays, computeStreaks, dayKey } from './retention-service.js';

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
  async stats(db: Database, userId: string, now: Date = new Date()) {
    const [progressList, attempts, sessions, sets] = await Promise.all([
      db.progress.listByUser(userId),
      db.attempts.listByUser(userId),
      db.sessions.listByUser(userId),
      db.sets.listByOwner(userId),
    ]);

    const nowIso = now.toISOString();
    const cardsStudied = progressList.length;
    const totalCorrect = progressList.reduce((sum, p) => sum + p.correctCount, 0);
    const totalIncorrect = progressList.reduce((sum, p) => sum + p.incorrectCount, 0);
    const totalAnswers = totalCorrect + totalIncorrect;
    const dueCards = progressList.filter(
      (p) => p.nextReviewAt !== null && p.nextReviewAt <= nowIso,
    ).length;
    const quizTotal = attempts.reduce((sum, a) => sum + a.total, 0);
    const quizScore = attempts.reduce((sum, a) => sum + a.score, 0);

    const studyTimeMs = sessions.reduce((sum, session) => {
      if (!session.endedAt) return sum;
      const end = Date.parse(session.endedAt);
      const start = Date.parse(session.startedAt);
      return sum + Math.max(0, end - start);
    }, 0);

    const streak = computeStreaks(
      [...collectActivityDays({ progress: progressList, attempts, sessions })],
      dayKey(nowIso),
    );

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
      correctAnswers: totalCorrect,
      incorrectAnswers: totalIncorrect,
      dueCards,
      quizAttempts: attempts.length,
      accuracy: totalAnswers > 0 ? totalCorrect / totalAnswers : null,
      quizAccuracy: quizTotal > 0 ? quizScore / quizTotal : null,
      studyTimeMinutes: Math.round(studyTimeMs / 60_000),
      streakDays: streak.current,
      longestStreak: streak.longest,
      lastActiveDay: streak.lastActiveDay,
      subjectProgress,
      setProgress: setRows,
    };
  },
};
