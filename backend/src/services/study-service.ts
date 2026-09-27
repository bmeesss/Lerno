/**
 * Study service — flashcard review flow, practice queues and study sessions
 * (spec §6). Scheduling decisions come exclusively from scheduling-service.
 */
import type { Database } from '../lib/db/repository.js';
import type { CardRecord } from '../lib/db/types.js';
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

async function requireVisibleSet(db: Database, userId: string | null, setId: string) {
  const set = await db.sets.get(setId);
  if (!set || !canViewSet(set, userId)) throw errors.notFound('Study set not found');
  return set;
}

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
    const cards = await db.cards.listBySet(setId);

    if (!userId) {
      return {
        setId,
        title: set.title,
        cards: cards.map((card) => ({ card: dto.card(card), reason: 'new' as const })),
      };
    }

    const progressList = await db.progress.listByUserAndSet(userId, setId);
    const byCard = new Map(progressList.map((progress) => [progress.cardId, progress]));
    const nowIso = new Date().toISOString();

    const due: PracticeCard[] = [];
    const incorrect: PracticeCard[] = [];
    const difficult: PracticeCard[] = [];
    const fresh: PracticeCard[] = [];

    for (const card of cards) {
      const progress = byCard.get(card.id);
      if (!progress) {
        fresh.push({ card: dto.card(card), reason: 'new' });
        continue;
      }
      const failedBefore = progress.incorrectCount > 0;
      const isDue = progress.nextReviewAt !== null && progress.nextReviewAt <= nowIso;
      const isDiff = isDifficult(progress.ease, progress.incorrectCount);

      if (isDiff) {
        difficult.push({ card: dto.card(card), reason: 'difficult' });
      } else if (isDue && failedBefore) {
        incorrect.push({ card: dto.card(card), reason: 'incorrect' });
      } else if (isDue) {
        due.push({ card: dto.card(card), reason: 'due' });
      } else if (failedBefore) {
        incorrect.push({ card: dto.card(card), reason: 'incorrect' });
      } else {
        fresh.push({ card: dto.card(card), reason: 'new' });
      }
    }

    // Interleave the buckets so one category cannot dominate the session.
    const cards_ = interleave([due, incorrect, difficult, fresh]);
    return { setId, title: set.title, cards: cards_ };
  },

  /** Starts a study session (server-timed, used for study-time stats). */
  async startSession(db: Database, userId: string, setId: string | null) {
    if (setId) await requireVisibleSet(db, userId, setId);
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
  async dueGroups(db: Database, userId: string) {
    const nowIso = new Date().toISOString();
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

    return [...grouped.values()]
      .map((entry) => {
        const set = setById.get(entry.setId);
        return {
          setId: entry.setId,
          setTitle: set?.title ?? 'Study set',
          subjectName: set?.subjectName ?? null,
          dueCount: entry.dueCount,
          nextReviewAt: entry.nextReviewAt,
        };
      })
      .sort((a, b) => (a.nextReviewAt ?? '').localeCompare(b.nextReviewAt ?? ''));
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
