/**
 * Discovery service — public study-set search and facets (spec §6 Discover).
 * Only public sets are ever returned here.
 */
import type { Database } from '../lib/db/repository.js';
import type { SetFilter } from '../lib/db/types.js';
import { buildSetSummaries } from './set-view.js';
import type { DiscoverQuery } from '../validators/discover.validators.js';

export const discoverService = {
  async search(db: Database, query: DiscoverQuery) {
    const filter: SetFilter = {
      q: query.q,
      subject: query.subject,
      level: query.level,
      tag: query.tag,
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    };

    const [sets, total] = await Promise.all([
      db.sets.listPublic(filter),
      db.sets.countPublic(filter),
    ]);

    return {
      items: await buildSetSummaries(db, sets),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  },

  /**
   * Dashboard suggestions: recent public sets the user doesn't own and hasn't
   * favorited yet. Only public sets are ever candidates.
   */
  async suggestions(db: Database, userId: string, limit = 3) {
    const [candidates, favorites] = await Promise.all([
      // Over-fetch: owned and favorited sets are filtered out below.
      db.sets.listPublic({ limit: limit + 50, offset: 0 }),
      db.favorites.listByUser(userId),
    ]);
    const favorited = new Set(favorites.map((favorite) => favorite.setId));
    const fresh = candidates
      .filter((set) => set.ownerId !== userId && !favorited.has(set.id))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
    return buildSetSummaries(db, fresh);
  },

  /** Filter facets derived from public sets (for the discover filter UI). */
  async facets(db: Database) {
    const sets = await db.sets.listPublic({ limit: 1000, offset: 0 });

    const subjects = new Set<string>();
    const levels = new Set<string>();
    const tags = new Set<string>();
    for (const set of sets) {
      if (set.subjectName) subjects.add(set.subjectName);
      if (set.level) levels.add(set.level);
      for (const tag of set.tags) tags.add(tag);
    }

    return {
      subjects: [...subjects].sort((a, b) => a.localeCompare(b)),
      levels: [...levels].sort((a, b) => a.localeCompare(b)),
      tags: [...tags].sort((a, b) => a.localeCompare(b)),
    };
  },
};
