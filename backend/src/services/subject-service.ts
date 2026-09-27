import type { Database } from '../lib/db/repository.js';
import { dto } from '../lib/dto.js';
import { errors } from '../lib/errors.js';

export const subjectService = {
  async list(db: Database, userId: string) {
    const subjects = await db.subjects.listByOwner(userId);
    const counts = await db.subjects.setCounts(subjects.map((subject) => subject.id));
    return subjects.map((subject) => dto.subject(subject, counts[subject.id] ?? 0));
  },

  async create(db: Database, userId: string, name: string) {
    const subject = await db.subjects.create({ ownerId: userId, name });
    return dto.subject(subject, 0);
  },

  async rename(db: Database, userId: string, subjectId: string, name: string) {
    const subject = await db.subjects.get(subjectId);
    if (!subject || subject.ownerId !== userId) throw errors.notFound('Subject not found');
    const updated = await db.subjects.update(subjectId, { name });

    // Keep denormalized subject_name on sets in sync.
    const referencing = await db.subjects.setsReferencing(subjectId);
    for (const set of referencing) {
      await db.sets.update(set.id, { subjectName: name });
    }

    const counts = await db.subjects.setCounts([subjectId]);
    return dto.subject(updated, counts[subjectId] ?? 0);
  },

  async remove(db: Database, userId: string, subjectId: string) {
    const subject = await db.subjects.get(subjectId);
    if (!subject || subject.ownerId !== userId) throw errors.notFound('Subject not found');

    // Sets survive: detach from the subject (FK is ON DELETE SET NULL).
    const referencing = await db.subjects.setsReferencing(subjectId);
    for (const set of referencing) {
      await db.sets.update(set.id, { subjectId: null, subjectName: null });
    }
    await db.subjects.delete(subjectId);
  },

  /** Ensures the subject exists and belongs to the user; returns its name. */
  async requireOwned(db: Database, userId: string, subjectId: string): Promise<string> {
    const subject = await db.subjects.get(subjectId);
    if (!subject || subject.ownerId !== userId) throw errors.notFound('Subject not found');
    return subject.name;
  },
};
