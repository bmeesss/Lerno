/**
 * Study service — flashcard review flow, practice queues and study sessions
 * (spec §6). Scheduling decisions come exclusively from scheduling-service.
 */
import type { Database } from '../lib/db/repository.js';
import type { CardRecord, StudySetRecord } from '../lib/db/types.js';
import { dto } from '../lib/dto.js';
import { errors } from '../lib/errors.js';
import { canViewSet } from './set-service.js';
import { isDifficult, scheduleReview } from './scheduling-service.js';

export interface PracticeCard {
  card: ReturnType<typeof dto.card>;
  reason: 'due' | 'incorrect' | 'difficult' | 'new';
}

export interface PracticeQueue {
  setId: string;
  title: string;
  cards: PracticeCard[];
}

type QueueReason = PracticeCard['reason'];

interface ClassifiedCard extends PracticeCard {
  /** True when the card's scheduled review time has passed. */
  isDue: boolean;
}

/** Study-priority rank: due → incorrect → difficult → new (Phase 5 §5). */
const REASON_RANK: Record<QueueReason, number> = {
  due: 0,
  incorrect: 1,
  difficult: 2,
  new: 3,
};

async function requireVisibleSet(db: Database, userId: string | null, setId: string) {
  const set = await db.sets.get(setId);
  if (!set || !canViewSet(set, userId)) throw errors.notFound('Study set not found');
  return set;
}

/**
 * Shared card classification: a single pass over the set's cards producing
 * reason-tagged entries. Both queues build on this so the "due / incorrect /
 * difficult / new" definitions live in exactly one place.
 */
async function classifyCards(
  db: Database,
  userId: string | null,
  set: StudySetRecord,
): Promise<{ title: string; entries: ClassifiedCard[] }> {
  const cards = await db.cards.listBySet(set.id);

  if (!userId) {
    return {
      title: set.title,
      entries: cards.map((card) => ({
        card: dto.card(card),
        reason: 'new' as const,
        isDue: false,
      })),
    };
  }

  const progressList = await db.progress.listByUserAndSet(userId, set.id);
  const byCard = new Map(progressList.map((progress) => [progress.cardId, progress]));
  const nowIso = new Date().toISOString();

  const entries: ClassifiedCard[] = [];
  for (const card of cards) {
    const progress = byCard.get(card.id);
    if (!progress) {
      entries.push({ card: dto.card(card), reason: 'new', isDue: false });
      continue;
    }
    const failedBefore = progress.incorrectCount > 0;
    const isDue = progress.nextReviewAt !== null && progress.nextReviewAt <= nowIso;
    const isDiff = isDifficult(progress.ease, progress.incorrectCount);

    let reason: QueueReason;
    if (isDiff) {
      reason = 'difficult';
    } else if (isDue && failedBefore) {
      reason = 'incorrect';
    } else if (isDue) {
      reason = 'due';
    } else if (failedBefore) {
      reason = 'incorrect';
    } else {
      reason = 'new';
    }
    entries.push({ card: dto.card(card), reason, isDue });
  }

  return { title: set.title, entries };
}

export interface WrongCardEntry {
  cardId: string;
  question: string;
  answer: string;
  position: number;
  setId: string;
  setTitle: string;
  incorrectCount: number;
  correctCount: number;
  lastReviewedAt: string | null;
}

/** Maximum wrong cards returned in one call (AI-friendly, bounded). */
const MAX_WRONG_CARDS = 50;

export const studyService = {
  /** Records one flashcard review and schedules the next one (spec §7). */
  async review(
    db: Database,
    userId: string,
    input: { setId: string; cardId: string; result: 'correct' | 'incorrect' },
  ) {
    await requireVisibleSet(db, userId, input.setId);

    const card = await db.cards.get(input.cardId);
    if (!card || card.setId !== input.setId) throw errors.notFound('Card not found');

    const existing = await db.progress.get(userId, input.cardId);
    const scheduled = scheduleReview(
      {
        repetitionCount: existing?.repetitionCount ?? 0,
        ease: existing?.ease ?? null,
        correctCount: existing?.correctCount ?? 0,
        incorrectCount: existing?.incorrectCount ?? 0,
      },
      input.result,
    );

    const progress = await db.progress.upsert({
      userId,
      cardId: input.cardId,
      repetitionCount: scheduled.repetitionCount,
      ease: scheduled.ease,
      lastReviewedAt: scheduled.lastReviewedAt,
      nextReviewAt: scheduled.nextReviewAt,
      correctCount: scheduled.correctCount,
      incorrectCount: scheduled.incorrectCount,
    });

    return { progress: dto.progress(progress), requeued: scheduled.requeued };
  },

  /**
   * Practice queue: a mix of due, incorrect, difficult and new cards
   * (spec §6). Guests (no userId) simply get the set's cards as "new".
   */
  async practiceQueue(db: Database, userId: string | null, setId: string): Promise<PracticeQueue> {
    const set = await requireVisibleSet(db, userId, setId);
    const { title, entries } = await classifyCards(db, userId, set);

    const buckets: Record<QueueReason, PracticeCard[]> = {
      due: [],
      incorrect: [],
      difficult: [],
      new: [],
    };
    for (const entry of entries) {
      buckets[entry.reason].push({ card: entry.card, reason: entry.reason });
    }

    // Interleave the buckets so one category cannot dominate the session.
    const cards = interleave([buckets.due, buckets.incorrect, buckets.difficult, buckets.new]);
    return { setId, title, cards };
  },

  /**
   * Flashcard study queue in strict scheduling priority: due cards first,
   * then previously incorrect, difficult and new cards (Phase 5 §5).
   * Only cards the caller may study are included.
   */
  async studyQueue(db: Database, userId: string | null, setId: string): Promise<PracticeQueue> {
    const set = await requireVisibleSet(db, userId, setId);
    const { title, entries } = await classifyCards(db, userId, set);

    const sorted = entries
      .slice()
      .sort(
        (a, b) =>
          Number(b.isDue) - Number(a.isDue) ||
          REASON_RANK[a.reason] - REASON_RANK[b.reason] ||
          a.card.position - b.card.position,
      );
    return {
      setId,
      title,
      cards: sorted.map((entry) => ({ card: entry.card, reason: entry.reason })),
    };
  },

  /**
   * Cards the user answered incorrectly, most recently reviewed first.
   * Derived purely from existing progress rows; cards from sets the user
   * can no longer study are skipped. Same visibility rules as the queues.
   */
  async wrongCards(
    db: Database,
    userId: string,
    opts: { setId?: string; limit?: number } = {},
  ): Promise<{ total: number; cards: WrongCardEntry[] }> {
    if (opts.setId) await requireVisibleSet(db, userId, opts.setId);
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), MAX_WRONG_CARDS);

    const progressList = opts.setId
      ? await db.progress.listByUserAndSet(userId, opts.setId)
      : await db.progress.listByUser(userId);
    const wrong = progressList
      .filter((row) => row.incorrectCount > 0)
      .sort((a, b) => (b.lastReviewedAt ?? '').localeCompare(a.lastReviewedAt ?? ''));

    const cards = await Promise.all(wrong.map((row) => db.cards.get(row.cardId)));
    const setIds = [...new Set(cards.filter(Boolean).map((card) => card!.setId))];
    const sets = await db.sets.listByIds(setIds);
    const setById = new Map(sets.map((set) => [set.id, set]));
    const cardById = new Map(cards.filter(Boolean).map((card) => [card!.id, card!]));

    const entries: WrongCardEntry[] = [];
    for (const row of wrong) {
      const card = cardById.get(row.cardId);
      const set = card ? setById.get(card.setId) : undefined;
      if (!card || !set || !canViewSet(set, userId)) continue;
      entries.push({
        cardId: card.id,
        question: card.question,
        answer: card.answer,
        position: card.position,
        setId: set.id,
        setTitle: set.title,
        incorrectCount: row.incorrectCount,
        correctCount: row.correctCount,
        lastReviewedAt: row.lastReviewedAt,
      });
    }
    return { total: entries.length, cards: entries.slice(0, limit) };
  },

  /** Starts a study session (server-timed, used for study-time stats). */
  async startSession(db: Database, userId: string, setId: string | null) {    if (setId) await requireVisibleSet(db, userId, setId);
    const session = await db.sessions.create({
      userId,
      setId,
      startedAt: new Date().toISOString(),
    });
    return dto.session(session);
  },

  async endSession(db: Database, userId: string, sessionId: string, cardsSeen: number) {
    const sessions = await db.sessions.listByUser(userId);
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) throw errors.notFound('Session not found');
    const ended = await db.sessions.update(sessionId, {
      endedAt: new Date().toISOString(),
      cardsSeen,
    });
    return dto.session(ended);
  },

  /** Cards currently due, grouped by set (spec §6 review page). */
  async dueGroups(db: Database, userId: string, now: Date = new Date()) {
    const nowIso = now.toISOString();
    const due = await db.progress.listDue(userId, nowIso);
    if (due.length === 0) return [];

    const cardIds = [...new Set(due.map((progress) => progress.cardId))];
    const cards = await Promise.all(cardIds.map((cardId) => db.cards.get(cardId)));
    const setIds = [...new Set(cards.filter(Boolean).map((card) => card!.setId))];
    const sets = await db.sets.listByIds(setIds);
    const setById = new Map(sets.map((set) => [set.id, set]));

    const grouped = new Map<
      string,
      { setId: string; dueCount: number; nextReviewAt: string | null }
    >();
    for (const progress of due) {
      const card = cards.find((c) => c?.id === progress.cardId);
      if (!card) continue;
      const entry = grouped.get(card.setId) ?? {
        setId: card.setId,
        dueCount: 0,
        nextReviewAt: progress.nextReviewAt,
      };
      entry.dueCount += 1;
      if (
        progress.nextReviewAt &&
        (!entry.nextReviewAt || progress.nextReviewAt < entry.nextReviewAt)
      ) {
        entry.nextReviewAt = progress.nextReviewAt;
      }
      grouped.set(card.setId, entry);
    }

    const groups: {
      setId: string;
      setTitle: string;
      subjectName: string | null;
      dueCount: number;
      nextReviewAt: string | null;
    }[] = [];
    for (const entry of grouped.values()) {
      const set = setById.get(entry.setId);
      // Skip sets the user can no longer study (deleted, or a public set
      // that was privatized after they studied it).
      if (!set || !canViewSet(set, userId)) continue;
      groups.push({
        setId: entry.setId,
        setTitle: set.title,
        subjectName: set.subjectName,
        dueCount: entry.dueCount,
        nextReviewAt: entry.nextReviewAt,
      });
    }
    return groups.sort((a, b) => (a.nextReviewAt ?? '').localeCompare(b.nextReviewAt ?? ''));
  },
};

/** Round-robin merge of card buckets. */
function interleave(buckets: PracticeCard[][]): PracticeCard[] {
  const result: PracticeCard[] = [];
  const max = Math.max(...buckets.map((bucket) => bucket.length), 0);
  for (let i = 0; i < max; i += 1) {
    for (const bucket of buckets) {
      if (bucket[i]) result.push(bucket[i]!);
    }
  }
  return result;
}

export type { CardRecord };
