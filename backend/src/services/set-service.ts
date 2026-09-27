/**
 * Study-set service — sets + cards CRUD with ownership/visibility enforcement
 * (spec §6, §8, §13). Business rules live here, not in route handlers.
 */
import { randomUUID } from 'node:crypto';
import type { Database } from '../lib/db/repository.js';
import type { CardRecord, StudySetRecord } from '../lib/db/types.js';
import { dto } from '../lib/dto.js';
import { errors } from '../lib/errors.js';
import { subjectService } from './subject-service.js';
import { buildSetSummaries, type SetSummaryDto } from './set-view.js';
import type { CreateSetBody, UpdateSetBody } from '../validators/set.validators.js';

const MAX_CARDS_PER_SET = 500;

function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || 'set'}-${randomUUID().slice(0, 8)}`;
}

/** Whether the caller may see this set (public, or owned). */
export function canViewSet(set: StudySetRecord, userId: string | null): boolean {
  return set.visibility === 'public' || (userId !== null && set.ownerId === userId);
}

export const setService = {
  async listMine(db: Database, userId: string): Promise<SetSummaryDto[]> {
    const sets = await db.sets.listByOwner(userId);
    return buildSetSummaries(db, sets);
  },

  async create(db: Database, userId: string, input: CreateSetBody) {
    let subjectName: string | null = null;
    if (input.subjectId) {
      subjectName = await subjectService.requireOwned(db, userId, input.subjectId);
    }

    const record = await db.sets.create({
      ownerId: userId,
      subjectId: input.subjectId ?? null,
      subjectName,
      title: input.title,
      slug: slugify(input.title),
      description: input.description,
      level: input.level,
      visibility: input.visibility,
      tags: input.tags,
    });

    let cards: CardRecord[] = [];
    if (input.cards && input.cards.length > 0) {
      cards = await db.cards.createMany(
        record.id,
        input.cards.map((card, index) => ({ ...card, position: index })),
      );
    }

    const summaries = await buildSetSummaries(db, [record]);
    return {
      ...summaries[0]!,
      isOwner: true,
      favorited: false,
      cards: cards.map(dto.card),
    };
  },

  /**
   * Set detail with cards. Owners see their sets (any visibility); anyone else
   * only sees public sets. Private sets are 404 for non-owners (spec §13).
   */
  async getDetail(db: Database, userId: string | null, setId: string) {
    const set = await db.sets.get(setId);
    if (!set || !canViewSet(set, userId)) throw errors.notFound('Study set not found');

    const cards = await db.cards.listBySet(setId);
    const [summaries, favorited] = await Promise.all([
      buildSetSummaries(db, [set]),
      userId ? db.favorites.has(userId, setId) : Promise.resolve(false),
    ]);

    return {
      ...summaries[0]!,
      isOwner: userId !== null && set.ownerId === userId,
      favorited,
      cards: cards.map(dto.card),
    };
  },

  async update(db: Database, userId: string, setId: string, patch: UpdateSetBody) {
    const set = await db.sets.get(setId);
    if (!set || set.ownerId !== userId) throw errors.notFound('Study set not found');

    let subjectName: string | null | undefined;
    if (patch.subjectId !== undefined) {
      subjectName = patch.subjectId
        ? await subjectService.requireOwned(db, userId, patch.subjectId)
        : null;
    }

    const updated = await db.sets.update(setId, {
      ...patch,
      ...(patch.subjectId !== undefined ? { subjectName } : {}),
    });

    const cardCount = await db.cards.countBySets([setId]);
    const author = await db.profiles.get(userId);
    return {
      ...dto.setSummary(updated, {
        cardCount: cardCount[setId] ?? 0,
        authorName: author?.displayName ?? 'Lerno student',
      }),
      isOwner: true,
    };
  },

  async remove(db: Database, userId: string, setId: string): Promise<void> {
    const set = await db.sets.get(setId);
    if (!set || set.ownerId !== userId) throw errors.notFound('Study set not found');
    await db.sets.delete(setId);
  },

  // ----- cards -----

  async listCards(db: Database, userId: string | null, setId: string) {
    const set = await db.sets.get(setId);
    if (!set || !canViewSet(set, userId)) throw errors.notFound('Study set not found');
    const cards = await db.cards.listBySet(setId);
    return cards.map(dto.card);
  },

  async addCards(
    db: Database,
    userId: string,
    setId: string,
    cards: { question: string; answer: string }[],
  ) {
    const set = await db.sets.get(setId);
    if (!set || set.ownerId !== userId) throw errors.notFound('Study set not found');

    const existing = await db.cards.listBySet(setId);
    if (existing.length + cards.length > MAX_CARDS_PER_SET) {
      throw errors.validation(`A set can hold at most ${MAX_CARDS_PER_SET} cards`);
    }

    const created = await db.cards.createMany(
      setId,
      cards.map((card, index) => ({ ...card, position: existing.length + index })),
    );
    await db.sets.update(setId, {}); // touch updated_at
    return created.map(dto.card);
  },

  async updateCard(
    db: Database,
    userId: string,
    setId: string,
    cardId: string,
    patch: { question?: string; answer?: string },
  ) {
    const set = await db.sets.get(setId);
    if (!set || set.ownerId !== userId) throw errors.notFound('Study set not found');
    const card = await db.cards.get(cardId);
    if (!card || card.setId !== setId) throw errors.notFound('Card not found');
    return dto.card(await db.cards.update(cardId, patch));
  },

  async removeCard(db: Database, userId: string, setId: string, cardId: string): Promise<void> {
    const set = await db.sets.get(setId);
    if (!set || set.ownerId !== userId) throw errors.notFound('Study set not found');
    const card = await db.cards.get(cardId);
    if (!card || card.setId !== setId) throw errors.notFound('Card not found');
    await db.cards.delete(cardId);
  },
};
