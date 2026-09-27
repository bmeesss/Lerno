/**
 * Admin service — moderation actions and system metrics (spec §6 Admin).
 *
 * Every method runs only after requireAdmin has verified the caller's role.
 * `createAdminDatabase()` (service-role) is used here for cross-account
 * operations that RLS deliberately blocks for regular users — this is the
 * trusted backend/admin context described in spec §13.
 */
import { createAdminDatabase } from '../lib/db/index.js';
import type { Database } from '../lib/db/repository.js';
import { dto } from '../lib/dto.js';
import { errors } from '../lib/errors.js';
import type {
  AdminListQuery,
  ModerateSetBody,
  SetRoleBody,
} from '../validators/report.validators.js';

function adminDb(): Database {
  return createAdminDatabase();
}

export const adminService = {
  async metrics() {
    const db = adminDb();
    const [users, publicSets, totalSets, openReports, cards, quizAttempts] = await Promise.all([
      db.authUsers.count(),
      db.sets.countPublic({ limit: 0, offset: 0 }),
      db.sets.countAll(),
      db.reports.countOpen(),
      db.cards.countAll(),
      db.attempts.countAll(),
    ]);

    return {
      users,
      publicSets,
      totalSets,
      openReports,
      cards,
      quizAttempts,
    };
  },

  async listUsers(query: AdminListQuery) {
    const db = adminDb();
    const limit = query.pageSize;
    const offset = (query.page - 1) * query.pageSize;
    const users = await db.authUsers.list(limit, offset);
    return {
      items: users.map((user) => ({
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        createdAt: user.createdAt,
      })),
      page: query.page,
      pageSize: query.pageSize,
    };
  },

  async setRole(userId: string, body: SetRoleBody) {
    await adminDb().authUsers.setRole(userId, body.role);
    return { ok: true };
  },

  async deleteUser(userId: string) {
    await adminDb().authUsers.delete(userId);
    return { ok: true };
  },

  /** Moderation action on a public set: unpublish (takedown) or restore. */
  async moderateSet(setId: string, body: ModerateSetBody) {
    const db = adminDb();
    const set = await db.sets.get(setId);
    if (!set) throw errors.notFound('Study set not found');
    const updated = await db.sets.update(setId, {
      visibility: body.action === 'unpublish' ? 'private' : 'public',
    });
    return {
      id: updated.id,
      title: updated.title,
      visibility: updated.visibility,
    };
  },

  async listPublicSets(query: AdminListQuery) {
    const db = adminDb();
    const filter = { limit: query.pageSize, offset: (query.page - 1) * query.pageSize };
    const [sets, total] = await Promise.all([
      db.sets.listPublic(filter),
      db.sets.countPublic(filter),
    ]);
    const summaries = await Promise.all(
      sets.map(async (set) => {
        const counts = await db.cards.countBySets([set.id]);
        const owner = await db.profiles.get(set.ownerId);
        return dto.setSummary(set, {
          cardCount: counts[set.id] ?? 0,
          authorName: owner?.displayName ?? 'Unknown',
        });
      }),
    );
    return {
      items: summaries,
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  },
};
