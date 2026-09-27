import type { Database } from '../lib/db/repository.js';
import { dto } from '../lib/dto.js';
import { errors } from '../lib/errors.js';
import { buildSetSummaries } from './set-view.js';

export const profileService = {
  async getOwn(db: Database, userId: string) {
    const profile = await db.profiles.get(userId);
    if (!profile) throw errors.notFound('Profile not found');
    return dto.profile(profile);
  },

  async update(
    db: Database,
    userId: string,
    patch: { displayName?: string; avatarUrl?: string | null },
  ) {
    const existing = await db.profiles.get(userId);
    if (!existing) throw errors.notFound('Profile not found');
    const updated = await db.profiles.update(userId, patch);
    return dto.profile(updated);
  },

  /** Public profile: display name, avatar, public sets and basic stats. */
  async getPublic(db: Database, userId: string) {
    const profile = await db.profiles.get(userId);
    if (!profile) throw errors.notFound('Profile not found');

    const publicSets = await db.sets.listPublicByOwner(userId);
    const summaries = await buildSetSummaries(db, publicSets);
    const attempts = await db.attempts.listByUser(userId);
    const totalAnswers = attempts.reduce((sum, attempt) => sum + attempt.total, 0);
    const totalCorrect = attempts.reduce((sum, attempt) => sum + attempt.score, 0);

    return {
      profile: dto.profile(profile),
      publicSets: summaries,
      stats: {
        publicSetCount: summaries.length,
        quizAttempts: attempts.length,
        quizAccuracy: totalAnswers > 0 ? totalCorrect / totalAnswers : null,
      },
    };
  },
};
