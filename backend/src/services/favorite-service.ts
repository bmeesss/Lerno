import type { Database } from '../lib/db/repository.js';
import { errors } from '../lib/errors.js';
import { canViewSet } from './set-service.js';
import { buildSetSummaries } from './set-view.js';

export const favoriteService = {
  async add(db: Database, userId: string, setId: string): Promise<void> {
    const set = await db.sets.get(setId);
    // Favorites only apply to public sets (own sets live under "My sets").
    if (!set || !canViewSet(set, userId) || set.visibility !== 'public') {
      throw errors.notFound('Study set not found');
    }
    await db.favorites.add(userId, setId);
  },

  async remove(db: Database, userId: string, setId: string): Promise<void> {
    await db.favorites.remove(userId, setId);
  },

  async list(db: Database, userId: string) {
    const favorites = await db.favorites.listByUser(userId);
    if (favorites.length === 0) return [];
    const sets = await db.sets.listByIds(favorites.map((favorite) => favorite.setId));
    const summaries = await buildSetSummaries(db, sets);
    const byId = new Map(summaries.map((summary) => [summary.id, summary]));
    // Preserve favorite recency order
    return favorites
      .map((favorite) => byId.get(favorite.setId))
      .filter((summary): summary is NonNullable<typeof summary> => Boolean(summary));
  },
};
