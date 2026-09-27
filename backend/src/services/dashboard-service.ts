/**
 * Dashboard service — "What should I do now?" answered in one query set
 * (spec §6 Dashboard, §22 north star).
 */
import type { Database } from '../lib/db/repository.js';
import { DEFAULT_TIMEZONE } from '../lib/timezone.js';
import { progressService } from './progress-service.js';
import { retentionService } from './retention-service.js';
import { studyService } from './study-service.js';
import { buildSetSummaries } from './set-view.js';

export const dashboardService = {
  async get(
    db: Database,
    userId: string,
    displayName: string,
    timeZone: string = DEFAULT_TIMEZONE,
  ) {
    const [dueGroups, stats, ownSets, favorites, today] = await Promise.all([
      studyService.dueGroups(db, userId),
      progressService.stats(db, userId, new Date(), timeZone),
      db.sets.listByOwner(userId),
      db.favorites.listByUser(userId),
      retentionService.today(db, userId, new Date(), timeZone),
    ]);

    const favoriteSets = await db.sets.listByIds(favorites.map((favorite) => favorite.setId));
    const allSets = [...ownSets, ...favoriteSets];
    const summaries = await buildSetSummaries(db, allSets);

    // "Continue learning": the most recently updated set with due cards,
    // else the most recently updated set overall.
    const dueSetIds = new Set(dueGroups.map((group) => group.setId));
    const sorted = summaries.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const continueSet =
      sorted.find((summary) => dueSetIds.has(summary.id)) ??
      (summaries.length > 0 ? sorted[0]! : null);

    return {
      greetingName: displayName.split(/\s+/)[0] ?? displayName,
      cardsDue: dueGroups.reduce((sum, group) => sum + group.dueCount, 0),
      streakDays: stats.streakDays,
      cardsStudied: stats.cardsStudied,
      quizAccuracy: stats.quizAccuracy,
      recentSets: sorted.slice(0, 6),
      dueGroups: dueGroups.slice(0, 6),
      subjectProgress: stats.subjectProgress.slice(0, 5),
      continueSet,
      today,
    };
  },
};
