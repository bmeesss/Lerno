/**
 * Study Pack service — the learning engine that ties material, concepts,
 * practice, tests, review and mastery together.
 *
 * Design rules:
 *  - A Study Pack always points at a classic study_sets row (`legacySetId`) that
 *    holds the flashcards, so the existing study/progress/quiz flows keep
 *    working unchanged (no destructive migration, no duplicate logic).
 *  - Visibility follows the existing set rules exactly: owner, or anyone for a
 *    public pack. Write operations are owner-only.
 *  - AI produces previews; this service only stores content after an explicit
 *    student confirmation, and only appends — never silently overwrites.
 *  - Grading and mastery live in `study-pack-rules.ts` (pure, testable).
 */
import type { Database } from '../lib/db/repository.js';
import type {
  AnswerVerdict,
  CardRecord,
  ConceptRecord,
  PracticeQuestionRecord,
  StudyPackRecord,
  StudyPackSourceRecord,
  StudySetRecord,
} from '../lib/db/types.js';
import { dto } from '../lib/dto.js';
import { errors } from '../lib/errors.js';
import { buildSetContext } from './ai-context.js';
import { setService, canViewSet } from './set-service.js';
import { subjectService } from './subject-service.js';
import {
  applyRating,
  applyVerdict,
  buildStudyPlan,
  daysUntil,
  gradeAnswer,
  isWeakConcept,
  masteryFromRecord,
  matchConcept,
  packMasteryPercent,
  recommendNextAction,
  STRONG_MASTERY_THRESHOLD,
  todayIso,
  type ConceptRating,
  type PackStats,
  type RecommendedAction,
} from './study-pack-rules.js';
import type { CreatePackBody, CreateTestBody } from '../validators/study-pack.validators.js';

const MAX_CARDS_PER_SET = 500;
const MAX_PRACTICE_QUESTIONS = 300;
const EXAM_QUESTION_CAP = 25;

/** Whether the caller may see this pack (public, or owned). */
export function canViewPack(pack: StudyPackRecord, userId: string | null): boolean {
  return pack.visibility === 'public' || (userId !== null && pack.ownerId === userId);
}

/** Owner-only guard used by every write operation. */
async function requireOwnedPack(
  db: Database,
  userId: string,
  packId: string,
): Promise<StudyPackRecord> {
  const pack = await db.packs.get(packId);
  if (!pack || pack.ownerId !== userId) throw errors.notFound('Study pack not found');
  return pack;
}

async function requireVisiblePack(
  db: Database,
  userId: string | null,
  packId: string,
): Promise<StudyPackRecord> {
  const pack = await db.packs.get(packId);
  if (!pack || !canViewPack(pack, userId)) throw errors.notFound('Study pack not found');
  return pack;
}

interface PackContextData {
  pack: StudyPackRecord;
  sources: StudyPackSourceRecord[];
  concepts: ConceptRecord[];
  questions: PracticeQuestionRecord[];
  cards: CardRecord[];
  set: StudySetRecord | null;
}

async function loadPackContext(db: Database, pack: StudyPackRecord): Promise<PackContextData> {
  const [sources, concepts, questions, set] = await Promise.all([
    db.packSources.listByPack(pack.id),
    db.concepts.listByPack(pack.id),
    db.practiceQuestions.listByPack(pack.id),
    pack.legacySetId ? db.sets.get(pack.legacySetId) : Promise.resolve(null),
  ]);
  const cards = set ? await db.cards.listBySet(set.id) : [];
  return { pack, sources, concepts, questions, cards, set };
}

/** Statistics shared by the detail view, the overview and the recommendation. */
async function loadPackProgress(db: Database, userId: string | null, context: PackContextData) {
  const { pack, concepts, questions, cards, set } = context;
  const progress = userId && set ? await db.progress.listByUserAndSet(userId, set.id) : [];
  const masteryRows = userId ? await db.conceptMastery.listByUserAndPack(userId, pack.id) : [];
  const masteryByConcept = new Map(masteryRows.map((row) => [row.conceptId, row]));
  const nowIso = new Date().toISOString();

  const conceptStates = concepts.map((concept) => {
    const state = masteryFromRecord(masteryByConcept.get(concept.id) ?? null);
    return { concept, state, weak: isWeakConcept(state), strong: state.mastery >= STRONG_MASTERY_THRESHOLD && state.attempts > 0 };
  });

  const weakConcepts = conceptStates
    .filter((entry) => entry.weak)
    .sort((a, b) => a.state.mastery - b.state.mastery || b.state.attempts - a.state.attempts);

  const unlearned = conceptStates.filter((entry) => entry.state.attempts === 0).length;

  const attempts = userId ? await db.practiceAttempts.listByUserAndPack(userId, pack.id) : [];
  const graded = attempts.length;
  const accuracy =
    graded > 0
      ? (attempts.filter((attempt) => attempt.verdict === 'correct').length +
          attempts.filter((attempt) => attempt.verdict === 'partial').length * 0.5) /
        graded
      : null;

  const testAttempts = userId ? await db.testAttempts.listByUserAndPack(userId, pack.id) : [];
  const dueCards = progress.filter(
    (row) => row.nextReviewAt !== null && row.nextReviewAt <= nowIso,
  ).length;

  const masteryPercent = packMasteryPercent(
    concepts.length,
    conceptStates.map((entry) => entry.state.mastery),
  );

  const activity = [
    ...progress.map((row) => row.lastReviewedAt),
    ...attempts.map((attempt) => attempt.createdAt),
    ...testAttempts.map((attempt) => attempt.createdAt),
  ].filter((value): value is string => Boolean(value));

  const stats: PackStats = {
    readySources: context.sources.filter((source) => source.status === 'ready').length,
    totalSources: context.sources.length,
    concepts: concepts.length,
    flashcards: cards.length,
    practiceQuestions: questions.length,
    dueCards,
    weakConcepts: weakConcepts.map((entry) => ({
      id: entry.concept.id,
      name: entry.concept.name,
    })),
    unlearnedConcepts: unlearned,
    accuracy,
  };

  return {
    conceptStates,
    masteryByConcept,
    progress,
    attempts,
    testAttempts,
    graded,
    accuracy,
    dueCards,
    masteryPercent,
    activity,
    stats,
    recommended: recommendNextAction(stats),
  };
}

export interface PackSummaryExtras {
  sources: number;
  flashcards: number;
  concepts: number;
  practiceQuestions: number;
  masteryPercent: number;
  weakConcepts: number;
  dueCards: number;
}

function examDaysLeft(pack: StudyPackRecord, now: Date): number | null {
  return pack.examDate ? daysUntil(pack.examDate, now) : null;
}

/** Summary DTOs for a list of packs (one pass per collection). */
async function buildPackSummaries(db: Database, userId: string | null, packs: StudyPackRecord[]) {
  if (packs.length === 0) return [];
  const now = new Date();
  return Promise.all(
    packs.map(async (pack) => {
      const context = await loadPackContext(db, pack);
      const progress = await loadPackProgress(db, userId, context);
      return dto.studyPackSummary(pack, {
        sources: context.sources.length,
        flashcards: context.cards.length,
        concepts: context.concepts.length,
        practiceQuestions: context.questions.length,
        masteryPercent: progress.masteryPercent,
        weakConcepts: progress.stats.weakConcepts.length,
        dueCards: progress.dueCards,
        examDaysLeft: examDaysLeft(pack, now),
      });
    }),
  );
}

function setSourceContext(set: StudySetRecord, cards: CardRecord[]) {
  const context = buildSetContext(set, cards);
  return context.text;
}

export const studyPackService = {
  canView: canViewPack,

  /** All packs of the signed-in student, newest activity first. */
  async list(db: Database, userId: string) {
    const packs = await db.packs.listByOwner(userId);
    return buildPackSummaries(db, userId, packs);
  },

  /**
   * Creates a Study Pack. A pack always owns (or reuses) a classic study set,
   * so flashcards, study queue and spaced repetition work immediately.
   */
  async create(db: Database, userId: string, input: CreatePackBody) {
    let subjectName: string | null = null;
    if (input.subjectId) {
      subjectName = await subjectService.requireOwned(db, userId, input.subjectId);
    }

    // 1. Resolve the flashcard set: reuse an existing set when the student
    //    imports one (keeping their progress), otherwise create a fresh set.
    let set: StudySetRecord | null = null;
    if (input.source?.type === 'set') {
      const existing = await db.sets.get(input.source.setId);
      if (!existing || !canViewSet(existing, userId)) throw errors.notFound('Study set not found');
      const alreadyLinked = await db.packs.getByLegacySetId(existing.id);
      if (alreadyLinked) {
        throw errors.conflict('This study set is already part of a study pack');
      }
      set = existing;
    } else {
      const created = await setService.create(db, userId, {
        title: input.title,
        subjectId: input.subjectId ?? null,
        level: input.level,
        description: input.description,
        visibility: input.visibility,
        tags: [],
        cards: input.cards ?? [],
      });
      set = await db.sets.get(created.id);
      if (!set) throw errors.internal('The study pack could not be created');
    }

    // 2. Create the pack itself, linked to that set.
    const pack = await db.packs.create({
      ownerId: userId,
      subjectId: input.subjectId ?? null,
      subjectName,
      title: input.title,
      description: input.description,
      level: input.level,
      visibility: input.visibility,
      examDate: input.examDate ?? null,
      legacySetId: set.id,
      ownsLegacySet: input.source?.type === 'set' ? false : true,
    });

    // 3. Register the material as the pack's first source (provenance).
    if (input.source) {
      const source = input.source;
      if (source.type === 'set') {
        const cards = await db.cards.listBySet(set.id);
        await db.packSources.create({
          packId: pack.id,
          ownerId: userId,
          kind: 'set',
          title: source.title ?? set.title,
          status: 'ready',
          content: setSourceContext(set, cards),
          characterCount: cards.length,
          pageCount: null,
          failureReason: null,
          legacySetId: set.id,
          origin: 'imported',
        });
      } else {
        await db.packSources.create({
          packId: pack.id,
          ownerId: userId,
          kind: source.type,
          title: source.title,
          status: 'ready',
          content: source.text,
          characterCount: source.text.length,
          pageCount: source.type === 'pdf' ? (source.pageCount ?? null) : null,
          failureReason: null,
          legacySetId: null,
          origin: 'user',
        });
      }
    }

    return studyPackService.detail(db, userId, pack.id);
  },

  /**
   * Full pack detail: everything the Study Pack page needs in one request
   * (counts, progress, mastery, sources, concepts, plan, recommendation).
   */
  async detail(db: Database, userId: string | null, packId: string) {
    const pack = await requireVisiblePack(db, userId, packId);
    const context = await loadPackContext(db, pack);
    const progress = await loadPackProgress(db, userId, context);
    const now = new Date();
    const [plan, tests] = await Promise.all([
      db.studyPlans.getByPack(pack.id),
      db.tests.listByPack(pack.id),
    ]);

    const cardsByConcept = new Map<string, number>();
    for (const card of context.cards) {
      if (!card.conceptId) continue;
      cardsByConcept.set(card.conceptId, (cardsByConcept.get(card.conceptId) ?? 0) + 1);
    }
    const questionsByConcept = new Map<string, number>();
    for (const question of context.questions) {
      if (!question.conceptId) continue;
      questionsByConcept.set(question.conceptId, (questionsByConcept.get(question.conceptId) ?? 0) + 1);
    }
    const sourceTitles = new Map(context.sources.map((source) => [source.id, source.title]));

    const lastActivityAt =
      progress.activity.sort().at(-1) ?? pack.updatedAt;

    return {
      id: pack.id,
      ownerId: pack.ownerId,
      isOwner: userId !== null && pack.ownerId === userId,
      title: pack.title,
      description: pack.description,
      subjectId: pack.subjectId,
      subjectName: pack.subjectName,
      level: pack.level,
      visibility: pack.visibility,
      examDate: pack.examDate,
      examDaysLeft: examDaysLeft(pack, now),
      summary: pack.summary,
      summarySourceId: pack.summarySourceId,
      summaryUpdatedAt: pack.summaryUpdatedAt,
      legacySetId: pack.legacySetId,
      schoolMethod:
        pack.method || pack.publisher || pack.methodEdition || pack.methodChapter
          ? {
              publisher: pack.publisher,
              method: pack.method,
              edition: pack.methodEdition,
              chapter: pack.methodChapter,
            }
          : null,
      createdAt: pack.createdAt,
      updatedAt: pack.updatedAt,
      counts: {
        sources: context.sources.length,
        readySources: progress.stats.readySources,
        flashcards: context.cards.length,
        concepts: context.concepts.length,
        practiceQuestions: context.questions.length,
        tests: tests.length,
      },
      progress: {
        masteryPercent: progress.masteryPercent,
        dueCards: progress.dueCards,
        studiedCards: progress.progress.length,
        totalCards: context.cards.length,
        practiceAnswers: progress.graded,
        practiceAccuracy: progress.accuracy,
        testAttempts: progress.testAttempts.length,
        bestTestScorePercent:
          progress.testAttempts.length > 0
            ? Math.round(
                Math.max(
                  ...progress.testAttempts.map((attempt) =>
                    attempt.total > 0 ? (attempt.score / attempt.total) * 100 : 0,
                  ),
                ),
              )
            : null,
        weakConcepts: progress.stats.weakConcepts,
        strongConcepts: progress.conceptStates
          .filter((entry) => entry.strong)
          .map((entry) => ({ id: entry.concept.id, name: entry.concept.name })),
        lastActivityAt,
      },
      recommended: progress.recommended,
      sources: context.sources.map(dto.packSource),
      concepts: context.concepts.map((concept) =>
        dto.concept(concept, {
          sourceTitle: concept.sourceId ? (sourceTitles.get(concept.sourceId) ?? null) : null,
          masteryPercent: Math.round(
            masteryFromRecord(progress.masteryByConcept.get(concept.id) ?? null).mastery * 100,
          ),
          attempts: progress.masteryByConcept.get(concept.id)?.attempts ?? 0,
          cardCount: cardsByConcept.get(concept.id) ?? 0,
          questionCount: questionsByConcept.get(concept.id) ?? 0,
        }),
      ),
      studyPlan: plan ? dto.studyPlan(plan) : null,
      tests: tests.slice(0, 10).map((test) => ({
        id: test.id,
        title: test.title,
        mode: test.mode,
        questionCount: test.questionCount,
        createdAt: test.createdAt,
      })),
      recentAttempts: progress.testAttempts.slice(0, 5).map((attempt) =>
        dto.testAttempt(attempt, { packTitle: pack.title }),
      ),
    };
  },

  async update(db: Database, userId: string, packId: string, patch: Parameters<typeof db.packs.update>[1]) {
    const pack = await requireOwnedPack(db, userId, packId);
    let subjectName: string | null | undefined;
    if (patch.subjectId !== undefined) {
      subjectName = patch.subjectId ? await subjectService.requireOwned(db, userId, patch.subjectId) : null;
    }
    const updated = await db.packs.update(pack.id, {
      ...patch,
      ...(patch.subjectId !== undefined ? { subjectName } : {}),
    });
    // Keep the linked set's metadata in sync so both views agree.
    if (updated.legacySetId && (patch.title || patch.description || patch.level || patch.visibility)) {
      await db.sets.update(updated.legacySetId, {
        ...(patch.title ? { title: patch.title } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.level !== undefined ? { level: patch.level } : {}),
        ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
        ...(patch.subjectId !== undefined ? { subjectId: patch.subjectId, subjectName } : {}),
      });
    }
    const [summary] = await buildPackSummaries(db, userId, [updated]);
    return summary;
  },

  /** Deletes a pack. Sets created by the pack go with it; imported sets stay. */
  async remove(db: Database, userId: string, packId: string): Promise<void> {
    const pack = await requireOwnedPack(db, userId, packId);
    await db.packs.delete(pack.id);
    if (pack.legacySetId && pack.ownsLegacySet) {
      await db.sets.delete(pack.legacySetId);
    }
  },

  /* --------------------------------- sources -------------------------------- */

  async listSources(db: Database, userId: string | null, packId: string) {
    const pack = await requireVisiblePack(db, userId, packId);
    const sources = await db.packSources.listByPack(pack.id);
    return sources.map(dto.packSource);
  },

  /**
   * Adds material to a pack: pasted text, an extracted PDF, or an existing
   * Lerno set. Future source kinds (PowerPoint, YouTube, image, audio) are
   * rejected honestly until their adapters exist.
   */
  async addSource(
    db: Database,
    userId: string,
    packId: string,
    input: {
      type: 'text' | 'pdf' | 'set';
      title: string;
      text?: string;
      pageCount?: number;
      setId?: string;
    },
  ) {
    const pack = await requireOwnedPack(db, userId, packId);

    if (input.type === 'set') {
      const existing = await db.sets.get(input.setId!);
      if (!existing || !canViewSet(existing, userId)) throw errors.notFound('Study set not found');
      const cards = await db.cards.listBySet(existing.id);
      const characters = cards.reduce(
        (total, card) => total + card.question.length + card.answer.length,
        0,
      );
      const source = await db.packSources.create({
        packId: pack.id,
        ownerId: userId,
        kind: 'set',
        title: input.title || existing.title,
        status: 'ready',
        content: setSourceContext(existing, cards),
        characterCount: characters,
        pageCount: null,
        failureReason: null,
        legacySetId: existing.id,
        origin: 'imported',
      });
      await db.packs.update(pack.id, {});
      return dto.packSource(source);
    }

    const text = (input.text ?? '').trim();
    if (text.replace(/\s/g, '').length < 20) {
      throw errors.validation('Add at least 20 readable characters of study material.');
    }
    const source = await db.packSources.create({
      packId: pack.id,
      ownerId: userId,
      kind: input.type,
      title: input.title,
      status: 'ready',
      content: text,
      characterCount: text.length,
      pageCount: input.type === 'pdf' ? (input.pageCount ?? null) : null,
      failureReason: null,
      legacySetId: null,
      origin: 'user',
    });
    await db.packs.update(pack.id, {});
    return dto.packSource(source);
  },

  async removeSource(db: Database, userId: string, packId: string, sourceId: string): Promise<void> {
    const pack = await requireOwnedPack(db, userId, packId);
    const source = await db.packSources.get(sourceId);
    if (!source || source.packId !== pack.id) throw errors.notFound('Source not found');
    await db.packSources.delete(sourceId);
  },

  /* -------------------------------- concepts ------------------------------- */

  async createConcept(
    db: Database,
    userId: string,
    packId: string,
    input: { name: string; explanation: string },
  ) {
    const pack = await requireOwnedPack(db, userId, packId);
    const existing = await db.concepts.listByPack(pack.id);
    const [created] = await db.concepts.createMany(pack.id, [
      {
        name: input.name,
        explanation: input.explanation,
        sourceId: null,
        origin: 'user',
        position: existing.length,
      },
    ]);
    return dto.concept(created!, {
      sourceTitle: null,
      masteryPercent: 0,
      attempts: 0,
      cardCount: 0,
      questionCount: 0,
    });
  },

  async updateConcept(
    db: Database,
    userId: string,
    packId: string,
    conceptId: string,
    patch: { name?: string; explanation?: string },
  ) {
    const pack = await requireOwnedPack(db, userId, packId);
    const concept = await db.concepts.get(conceptId);
    if (!concept || concept.packId !== pack.id) throw errors.notFound('Concept not found');
    return dto.concept(await db.concepts.update(conceptId, patch), {
      sourceTitle: null,
      masteryPercent: 0,
      attempts: 0,
      cardCount: 0,
      questionCount: 0,
    });
  },

  async removeConcept(db: Database, userId: string, packId: string, conceptId: string): Promise<void> {
    const pack = await requireOwnedPack(db, userId, packId);
    const concept = await db.concepts.get(conceptId);
    if (!concept || concept.packId !== pack.id) throw errors.notFound('Concept not found');
    // Cards and questions keep existing: only their concept link is cleared.
    await db.concepts.detachFromCards(conceptId);
    await db.concepts.delete(conceptId);
  },

  /**
   * Stores student-confirmed content (the editable AI preview) in the pack.
   * Always additive: existing concepts, cards and questions are never replaced.
   */
  async applyContent(
    db: Database,
    userId: string,
    packId: string,
    input:
      | { target: 'summary'; summary: string; sourceId: string | null }
      | { target: 'concepts'; concepts: { name: string; explanation: string }[]; sourceId: string | null }
      | { target: 'flashcards'; cards: { front: string; back: string }[]; sourceId: string | null }
      | {
          target: 'practice';
          questions: {
            questionType: PracticeQuestionRecord['questionType'];
            prompt: string;
            correctAnswer: string;
            options: string[] | null;
            explanation: string;
          }[];
          sourceId: string | null;
        },
  ) {
    const pack = await requireOwnedPack(db, userId, packId);

    if (input.target === 'summary') {
      const updated = await db.packs.update(pack.id, {
        summary: input.summary,
        summarySourceId: input.sourceId,
        summaryUpdatedAt: new Date().toISOString(),
      });
      return { summary: updated.summary, summarySourceId: updated.summarySourceId };
    }

    const concepts = await db.concepts.listByPack(pack.id);

    if (input.target === 'concepts') {
      const existingNames = new Set(concepts.map((concept) => concept.name.trim().toLowerCase()));
      const fresh = input.concepts.filter((concept) => {
        const key = concept.name.trim().toLowerCase();
        if (!key || existingNames.has(key)) return false;
        existingNames.add(key);
        return true;
      });
      const created = await db.concepts.createMany(
        pack.id,
        fresh.map((concept, index) => ({
          name: concept.name,
          explanation: concept.explanation,
          sourceId: input.sourceId,
          origin: 'ai' as const,
          position: concepts.length + index,
        })),
      );
      // Link unassigned cards to the concepts they belong to (best effort).
      const all = [...concepts, ...created];
      const cards = await studyPackService.listCardsForPack(db, pack);
      for (const card of cards) {
        if (card.conceptId) continue;
        const match = matchConcept(`${card.question} ${card.answer}`, all);
        if (match) await db.cards.update(card.id, { conceptId: match.id });
      }
      await db.packs.update(pack.id, {});
      return {
        added: created.length,
        skipped: input.concepts.length - created.length,
        concepts: created.map((concept) =>
          dto.concept(concept, {
            sourceTitle: null,
            masteryPercent: 0,
            attempts: 0,
            cardCount: 0,
            questionCount: 0,
          }),
        ),
      };
    }

    if (input.target === 'flashcards') {
      const set = await studyPackService.ensurePackSet(db, pack, userId);
      const existingCards = await db.cards.listBySet(set.id);
      if (existingCards.length + input.cards.length > MAX_CARDS_PER_SET) {
        throw errors.validation(`A study pack can hold at most ${MAX_CARDS_PER_SET} flashcards`);
      }
      const created = await db.cards.createMany(
        set.id,
        input.cards.map((card, index) => ({
          question: card.front,
          answer: card.back,
          position: existingCards.length + index,
          sourceId: input.sourceId,
          conceptId: matchConcept(`${card.front} ${card.back}`, concepts)?.id ?? null,
        })),
      );
      await db.quizzes.deleteQuestionsBySet(set.id);
      await db.packs.update(pack.id, {});
      return { added: created.length, cards: created.map(dto.card) };
    }

    // practice questions
    const existing = await db.practiceQuestions.listByPack(pack.id);
    if (existing.length + input.questions.length > MAX_PRACTICE_QUESTIONS) {
      throw errors.validation(
        `A study pack can hold at most ${MAX_PRACTICE_QUESTIONS} practice questions`,
      );
    }
    const created = await db.practiceQuestions.createMany(
      pack.id,
      input.questions.map((question, index) => ({
        conceptId:
          matchConcept(`${question.prompt} ${question.correctAnswer}`, concepts)?.id ?? null,
        sourceId: input.sourceId,
        prompt: question.prompt,
        questionType: question.questionType,
        correctAnswer: question.correctAnswer,
        options: question.options,
        explanation: question.explanation,
        origin: 'ai' as const,
        position: existing.length + index,
      })),
    );
    await db.packs.update(pack.id, {});
    return { added: created.length, questions: created.map((question) => dto.practiceQuestion(question, true)) };
  },

  /** Every card of the pack's linked set (empty when the pack has no set). */
  async listCardsForPack(db: Database, pack: StudyPackRecord): Promise<CardRecord[]> {
    if (!pack.legacySetId) return [];
    return db.cards.listBySet(pack.legacySetId);
  },

  /** Returns the pack's flashcard set, creating one if it was deleted. */
  async ensurePackSet(db: Database, pack: StudyPackRecord, userId: string): Promise<StudySetRecord> {
    if (pack.legacySetId) {
      const existing = await db.sets.get(pack.legacySetId);
      if (existing) return existing;
    }
    const created = await setService.create(db, userId, {
      title: pack.title,
      subjectId: pack.subjectId,
      level: pack.level,
      description: pack.description,
      visibility: pack.visibility,
      tags: [],
    });
    const set = await db.sets.get(created.id);
    if (!set) throw errors.internal('The study pack flashcards could not be stored');
    await db.packs.update(pack.id, {});
    return set;
  },

  /* -------------------------------- practice ------------------------------- */

  /**
   * Practice queue: questions on weak concepts first, then unseen questions,
   * then everything already answered correctly. Answers stay on the server.
   */
  async practiceQueue(
    db: Database,
    userId: string | null,
    packId: string,
    options: { conceptId?: string; limit?: number } = {},
  ) {
    const pack = await requireVisiblePack(db, userId, packId);
    const context = await loadPackContext(db, pack);
    const progress = await loadPackProgress(db, userId, context);
    const limit = Math.min(Math.max(options.limit ?? 12, 1), 50);

    const weakIds = new Set(progress.stats.weakConcepts.map((concept) => concept.id));
    const lastVerdict = new Map<string, AnswerVerdict>();
    for (const attempt of progress.attempts) {
      if (!lastVerdict.has(attempt.questionId)) lastVerdict.set(attempt.questionId, attempt.verdict);
    }

    const filtered = options.conceptId
      ? context.questions.filter((question) => question.conceptId === options.conceptId)
      : context.questions;

    const ranked = filtered
      .map((question) => {
        const verdict = lastVerdict.get(question.id);
        const rank = question.conceptId && weakIds.has(question.conceptId) ? 0 : verdict === undefined ? 1 : verdict === 'correct' ? 3 : 2;
        return { question, rank };
      })
      .sort((a, b) => a.rank - b.rank || a.question.position - b.question.position);

    // Round-robin across types so one format cannot dominate a session.
    const byType = new Map<string, PracticeQuestionRecord[]>();
    for (const entry of ranked) {
      const list = byType.get(entry.question.questionType) ?? [];
      list.push(entry.question);
      byType.set(entry.question.questionType, list);
    }
    const buckets = [...byType.values()];
    const questions: PracticeQuestionRecord[] = [];
    for (let index = 0; questions.length < limit && index < MAX_PRACTICE_QUESTIONS; index += 1) {
      let added = false;
      for (const bucket of buckets) {
        if (bucket[index] && questions.length < limit) {
          questions.push(bucket[index]!);
          added = true;
        }
      }
      if (!added) break;
    }

    const conceptNames = new Map(context.concepts.map((concept) => [concept.id, concept.name]));
    const sourceTitles = new Map(context.sources.map((source) => [source.id, source.title]));

    return {
      packId: pack.id,
      packTitle: pack.title,
      setId: pack.legacySetId,
      total: filtered.length,
      questions: questions.map((question) => ({
        ...dto.practiceQuestion(question),
        conceptName: question.conceptId ? (conceptNames.get(question.conceptId) ?? null) : null,
        sourceTitle: question.sourceId ? (sourceTitles.get(question.sourceId) ?? null) : null,
      })),
    };
  },

  /** Grades one practice answer, stores it and updates concept mastery. */
  async gradePractice(
    db: Database,
    userId: string | null,
    packId: string,
    input: { questionId: string; answer: string },
  ) {
    const pack = await requireVisiblePack(db, userId, packId);
    const question = await db.practiceQuestions.get(input.questionId);
    if (!question || question.packId !== pack.id) throw errors.notFound('Practice question not found');

    const graded = gradeAnswer(question, input.answer);
    const concept = question.conceptId ? await db.concepts.get(question.conceptId) : null;
    const previous = concept && userId ? await db.conceptMastery.get(userId, concept.id) : null;
    const next = applyVerdict(masteryFromRecord(previous), graded.verdict, new Date());

    if (userId && concept) {
      await db.conceptMastery.upsert({
        userId,
        conceptId: concept.id,
        mastery: next.mastery,
        attempts: next.attempts,
        correctCount: next.correctCount,
        incorrectCount: next.incorrectCount,
        lastPracticedAt: next.lastPracticedAt,
      });
    }
    if (userId) {
      await db.practiceAttempts.create({
        userId,
        packId: pack.id,
        questionId: question.id,
        conceptId: question.conceptId,
        answer: graded.normalized,
        verdict: graded.verdict,
      });
    }

    const source = question.sourceId ? await db.packSources.get(question.sourceId) : null;
    return {
      questionId: question.id,
      verdict: graded.verdict,
      correctAnswer: question.correctAnswer,
      explanation: question.explanation,
      concept: concept ? { id: concept.id, name: concept.name } : null,
      conceptMasteryPercent: userId ? Math.round(next.mastery * 100) : null,
      sourceTitle: source?.title ?? null,
    };
  },

  /* ---------------------------------- tests -------------------------------- */

  /** Builds a stored test from the pack's practice questions. */
  async createTest(db: Database, userId: string, packId: string, input: CreateTestBody) {
    const pack = await requireOwnedPack(db, userId, packId);
    const context = await loadPackContext(db, pack);
    if (context.questions.length < 3) {
      throw errors.validation('Add at least three practice questions before making a test');
    }
    const progress = await loadPackProgress(db, userId, context);
    const requested =
      input.mode === 'quick10' ? 10 : input.mode === 'quick20' ? 20 : Math.min(EXAM_QUESTION_CAP, Math.max(10, context.questions.length));
    const count = Math.min(requested, context.questions.length);

    const weakIds = new Set(progress.stats.weakConcepts.map((concept) => concept.id));
    const groups = new Map<string, PracticeQuestionRecord[]>();
    for (const question of context.questions) {
      const key = question.conceptId ?? `unassigned-${question.id}`;
      const list = groups.get(key) ?? [];
      list.push(question);
      groups.set(key, list);
    }
    // Weak concepts first so the test keeps testing what is not mastered yet.
    const orderedGroups = [...groups.entries()].sort(([a], [b]) => {
      const aWeak = weakIds.has(a) ? 0 : 1;
      const bWeak = weakIds.has(b) ? 0 : 1;
      return aWeak - bWeak;
    });

    const selected: PracticeQuestionRecord[] = [];
    for (let index = 0; selected.length < count; index += 1) {
      let added = false;
      for (const [, list] of orderedGroups) {
        if (list[index] && selected.length < count) {
          selected.push(list[index]!);
          added = true;
        }
      }
      if (!added) break;
    }

    const title =
      input.mode === 'exam'
        ? `Exam simulation · ${pack.title}`
        : `Practice test · ${pack.title}`;
    const { test } = await db.tests.createTest({
      packId: pack.id,
      ownerId: userId,
      title,
      mode: input.mode,
      questionIds: selected.map((question) => question.id),
    });

    return {
      test: {
        id: test.id,
        title: test.title,
        mode: test.mode,
        questionCount: test.questionCount,
        createdAt: test.createdAt,
      },
      questions: selected.map((question) => ({
        ...dto.practiceQuestion(question),
        conceptName: question.conceptId
          ? (context.concepts.find((concept) => concept.id === question.conceptId)?.name ?? null)
          : null,
      })),
    };
  },

  /** Grades a stored test, stores the attempt and updates concept mastery. */
  async submitTest(
    db: Database,
    userId: string,
    packId: string,
    testId: string,
    input: { answers: { questionId: string; answer: string }[] },
  ) {
    const pack = await requireOwnedPack(db, userId, packId);
    const test = await db.tests.get(testId);
    if (!test || test.packId !== pack.id) throw errors.notFound('Test not found');
    const testQuestions = await db.tests.listQuestions(test.id);
    const questions = await db.practiceQuestions.listByIds(
      testQuestions.map((row) => row.questionId),
    );
    const questionById = new Map(questions.map((question) => [question.id, question]));
    const concepts = await db.concepts.listByPack(pack.id);
    const conceptById = new Map(concepts.map((concept) => [concept.id, concept]));

    const answersGiven = new Map(input.answers.map((answer) => [answer.questionId, answer.answer]));
    const now = new Date();
    const results = [];
    let score = 0;
    let correctCount = 0;
    let partialCount = 0;
    let incorrectCount = 0;
    const touchedConcepts = new Set<string>();

    for (const row of testQuestions) {
      const question = questionById.get(row.questionId);
      if (!question) continue;
      const answer = answersGiven.get(question.id) ?? '';
      const graded = answer ? gradeAnswer(question, answer) : { verdict: 'incorrect' as const, normalized: '' };
      if (graded.verdict === 'correct') {
        score += 1;
        correctCount += 1;
      } else if (graded.verdict === 'partial') {
        score += 0.5;
        partialCount += 1;
      } else {
        incorrectCount += 1;
      }

      const concept = question.conceptId ? (conceptById.get(question.conceptId) ?? null) : null;
      let masteryPercent: number | null = null;
      if (concept) {
        touchedConcepts.add(concept.id);
        const previous = await db.conceptMastery.get(userId, concept.id);
        const next = applyVerdict(masteryFromRecord(previous), graded.verdict, now);
        await db.conceptMastery.upsert({
          userId,
          conceptId: concept.id,
          mastery: next.mastery,
          attempts: next.attempts,
          correctCount: next.correctCount,
          incorrectCount: next.incorrectCount,
          lastPracticedAt: next.lastPracticedAt,
        });
        masteryPercent = Math.round(next.mastery * 100);
      }

      results.push({
        questionId: question.id,
        prompt: question.prompt,
        questionType: question.questionType,
        yourAnswer: answer,
        correctAnswer: question.correctAnswer,
        options: question.options,
        verdict: graded.verdict,
        explanation: question.explanation,
        conceptId: concept?.id ?? null,
        conceptName: concept?.name ?? null,
        conceptMasteryPercent: masteryPercent,
      });
    }

    const strongConceptIds: string[] = [];
    const weakConceptIds: string[] = [];
    for (const conceptId of touchedConcepts) {
      const mastery = await db.conceptMastery.get(userId, conceptId);
      if (!mastery) continue;
      if (isWeakConcept(masteryFromRecord(mastery))) weakConceptIds.push(conceptId);
      if (mastery.mastery >= STRONG_MASTERY_THRESHOLD) strongConceptIds.push(conceptId);
    }

    const attempt = await db.testAttempts.create({
      testId: test.id,
      packId: pack.id,
      userId,
      score,
      total: results.length,
      correctCount,
      partialCount,
      incorrectCount,
      answers: results.map((result) => ({
        questionId: result.questionId,
        prompt: result.prompt,
        questionType: result.questionType,
        yourAnswer: result.yourAnswer,
        correctAnswer: result.correctAnswer,
        verdict: result.verdict,
        explanation: result.explanation,
        conceptId: result.conceptId,
        conceptName: result.conceptName,
      })),
      strongConceptIds,
      weakConceptIds,
    });
    await db.packs.update(pack.id, {});

    const context = await loadPackContext(db, pack);
    const progress = await loadPackProgress(db, userId, context);

    return {
      attempt: dto.testAttempt(attempt, { packTitle: pack.title }),
      accuracy: results.length > 0 ? Math.round((score / results.length) * 100) : 0,
      results,
      strongConcepts: strongConceptIds.map((id) => ({
        id,
        name: conceptById.get(id)?.name ?? '',
      })),
      weakConcepts: weakConceptIds.map((id) => ({
        id,
        name: conceptById.get(id)?.name ?? '',
      })),
      recommended: progress.recommended,
    };
  },

  async listTests(db: Database, userId: string, packId: string) {
    const pack = await requireOwnedPack(db, userId, packId);
    const [tests, attempts] = await Promise.all([
      db.tests.listByPack(pack.id),
      db.testAttempts.listByUserAndPack(userId, pack.id),
    ]);
    return {
      tests: tests.map((test) => ({
        id: test.id,
        title: test.title,
        mode: test.mode,
        questionCount: test.questionCount,
        createdAt: test.createdAt,
      })),
      attempts: attempts.map((attempt) => dto.testAttempt(attempt, { packTitle: pack.title })),
    };
  },

  /* ---------------------------- learn + mastery ---------------------------- */

  /** Learn mode: one self-rating for one concept, stored as mastery. */
  async rateConcept(
    db: Database,
    userId: string,
    packId: string,
    conceptId: string,
    rating: ConceptRating,
  ) {
    const pack = await requireVisiblePack(db, userId, packId);
    const concept = await db.concepts.get(conceptId);
    if (!concept || concept.packId !== pack.id) throw errors.notFound('Concept not found');

    const previous = await db.conceptMastery.get(userId, concept.id);
    const next = applyRating(masteryFromRecord(previous), rating, new Date());
    await db.conceptMastery.upsert({
      userId,
      conceptId: concept.id,
      mastery: next.mastery,
      attempts: next.attempts,
      correctCount: next.correctCount,
      incorrectCount: next.incorrectCount,
      lastPracticedAt: next.lastPracticedAt,
    });

    return {
      conceptId: concept.id,
      masteryPercent: Math.round(next.mastery * 100),
      attempts: next.attempts,
      weak: isWeakConcept(next),
    };
  },

  /* --------------------------------- progress ------------------------------ */

  async progressOverview(db: Database, userId: string | null, packId: string) {
    const pack = await requireVisiblePack(db, userId, packId);
    const context = await loadPackContext(db, pack);
    const progress = await loadPackProgress(db, userId, context);
    const sources = new Map(context.sources.map((source) => [source.id, source.title]));

    return {
      packId: pack.id,
      masteryPercent: progress.masteryPercent,
      dueCards: progress.dueCards,
      studiedCards: progress.progress.length,
      totalCards: context.cards.length,
      practiceAnswers: progress.graded,
      practiceAccuracy: progress.accuracy,
      testAttempts: progress.testAttempts.map((attempt) =>
        dto.testAttempt(attempt, { packTitle: pack.title }),
      ),
      weakConcepts: progress.conceptStates
        .filter((entry) => entry.weak)
        .sort((a, b) => a.state.mastery - b.state.mastery)
        .map((entry) => ({
          id: entry.concept.id,
          name: entry.concept.name,
          masteryPercent: Math.round(entry.state.mastery * 100),
          attempts: entry.state.attempts,
          sourceTitle: entry.concept.sourceId ? (sources.get(entry.concept.sourceId) ?? null) : null,
        })),
      strongConcepts: progress.conceptStates
        .filter((entry) => entry.strong)
        .map((entry) => ({
          id: entry.concept.id,
          name: entry.concept.name,
          masteryPercent: Math.round(entry.state.mastery * 100),
        })),
      concepts: progress.conceptStates.map((entry) => ({
        id: entry.concept.id,
        name: entry.concept.name,
        masteryPercent: Math.round(entry.state.mastery * 100),
        attempts: entry.state.attempts,
        lastPracticedAt: entry.state.lastPracticedAt,
      })),
      recommended: progress.recommended,
    };
  },

  /* ----------------------------------- plan -------------------------------- */

  async getPlan(db: Database, userId: string | null, packId: string) {
    const pack = await requireVisiblePack(db, userId, packId);
    const plan = await db.studyPlans.getByPack(pack.id);
    return plan ? dto.studyPlan(plan) : null;
  },

  /**
   * Generates (or regenerates) the study plan for a pack. Deterministic and
   * exam-date driven, so it also works without AI configured.
   */
  async createPlan(
    db: Database,
    userId: string,
    packId: string,
    input: { days?: number; minutesPerDay?: number } = {},
  ) {
    const pack = await requireOwnedPack(db, userId, packId);
    const context = await loadPackContext(db, pack);
    const progress = await loadPackProgress(db, userId, context);
    const today = todayIso(new Date());
    const days = Math.min(
      Math.max(input.days ?? (pack.examDate ? Math.max(1, daysUntil(pack.examDate, new Date())) : 7), 1),
      60,
    );
    const plan = buildStudyPlan({
      title: pack.title,
      days,
      minutesPerDay: input.minutesPerDay ?? 30,
      conceptCount: context.concepts.length,
      cardCount: context.cards.length,
      questionCount: context.questions.length,
      dueCards: progress.dueCards,
      weakConceptNames: progress.stats.weakConcepts.map((concept) => concept.name),
      startDay: today,
    });
    const saved = await db.studyPlans.upsert({
      packId: pack.id,
      ownerId: userId,
      examDate: pack.examDate,
      overview: plan.overview,
      sessions: plan.sessions,
    });
    return dto.studyPlan(saved);
  },

  /* ------------------------------- dashboards ------------------------------ */

  /**
   * Study Pack aware review overview: cards due, weak concepts and the packs
   * that actually need attention — one intelligent next action, not a list.
   */
  async reviewSummary(db: Database, userId: string) {
    const [packs, dueGroups] = await Promise.all([
      db.packs.listByOwner(userId),
      db.progress.listDue(userId, new Date().toISOString()),
    ]);

    const cards = await Promise.all(
      [...new Set(dueGroups.map((row) => row.cardId))].map((cardId) => db.cards.get(cardId)),
    );
    const setIds = [...new Set(cards.filter(Boolean).map((card) => card!.setId))];
    const sets = await db.sets.listByIds(setIds);
    const setById = new Map(sets.map((set) => [set.id, set]));
    const packBySetId = new Map<string, StudyPackRecord>();
    for (const setId of setIds) {
      const pack = await db.packs.getByLegacySetId(setId);
      if (pack) packBySetId.set(setId, pack);
    }

    const dueByPack = new Map<
      string,
      { packId: string | null; title: string; dueCount: number; nextReviewAt: string | null }
    >();
    for (const row of dueGroups) {
      const card = cards.find((entry) => entry?.id === row.cardId);
      if (!card) continue;
      const set = setById.get(card.setId);
      if (!set || !canViewSet(set, userId)) continue;
      const pack = packBySetId.get(set.id);
      const key = pack?.id ?? set.id;
      const entry = dueByPack.get(key) ?? {
        packId: pack?.id ?? null,
        title: pack?.title ?? set.title,
        dueCount: 0,
        nextReviewAt: row.nextReviewAt,
      };
      entry.dueCount += 1;
      if (row.nextReviewAt && (!entry.nextReviewAt || row.nextReviewAt < entry.nextReviewAt)) {
        entry.nextReviewAt = row.nextReviewAt;
      }
      dueByPack.set(key, entry);
    }

    const summaries = await buildPackSummaries(db, userId, packs);
    const weakConcepts = summaries
      .flatMap((summary) => {
        const pack = packs.find((entry) => entry.id === summary.id)!;
        return { summary, pack };
      })
      .filter((entry) => entry.summary.weakConcepts > 0)
      .map((entry) => ({
        packId: entry.pack.id,
        packTitle: entry.pack.title,
        weakConcepts: entry.summary.weakConcepts,
        masteryPercent: entry.summary.masteryPercent,
      }))
      .sort((a, b) => a.masteryPercent - b.masteryPercent);

    return {
      cardsDue: [...dueByPack.values()].reduce((total, entry) => total + entry.dueCount, 0),
      packsNeedingReview: [...dueByPack.values()].sort((a, b) => b.dueCount - a.dueCount),
      weakConceptPacks: weakConcepts,
      weakConceptCount: weakConcepts.reduce((total, entry) => total + entry.weakConcepts, 0),
      packs: summaries,
    };
  },

  /**
   * "What should I study today?" — the My Study home payload: concrete tasks,
   * exam deadlines and the packs in flight.
   */
  async today(db: Database, userId: string, now: Date = new Date()) {
    const packs = await db.packs.listByOwner(userId);
    const summaries = await buildPackSummaries(db, userId, packs);
    const summaryById = new Map(summaries.map((summary) => [summary.id, summary]));

    const exams = await db.packs.listUpcomingExams(userId, todayIso(now));
    const examSummary = exams.map((pack) => {
      const summary = summaryById.get(pack.id);
      return {
        packId: pack.id,
        title: pack.title,
        examDate: pack.examDate,
        daysLeft: pack.examDate ? daysUntil(pack.examDate, now) : null,
        masteryPercent: summary?.masteryPercent ?? 0,
        weakConcepts: summary?.weakConcepts ?? 0,
        dueCards: summary?.dueCards ?? 0,
      };
    });

    const tasks: {
      type: 'review' | 'learn' | 'practice' | 'test' | 'add-material';
      label: string;
      description: string;
      packId: string | null;
      conceptId: string | null;
      conceptName: string | null;
    }[] = [];

    const totalDue = summaries.reduce((total, summary) => total + summary.dueCards, 0);
    if (totalDue > 0) {
      const first = summaries
        .filter((summary) => summary.dueCards > 0)
        .sort((a, b) => b.dueCards - a.dueCards)[0]!;
      tasks.push({
        type: 'review',
        label: `Review ${totalDue} card${totalDue === 1 ? '' : 's'}`,
        description: `Spaced repetition says they are ready. Start with ${first.title}.`,
        packId: first.id,
        conceptId: null,
        conceptName: null,
      });
    }

    for (const summary of summaries) {
      if (tasks.length >= 4) break;
      const pack = packs.find((entry) => entry.id === summary.id)!;
      const context = await loadPackContext(db, pack);
      const progress = await loadPackProgress(db, userId, context);
      const action: RecommendedAction = progress.recommended;
      if (action.type === 'learn' || action.type === 'practice') {
        tasks.push({
          type: action.type,
          label: action.label,
          description: `${pack.title} · ${action.description}`,
          packId: pack.id,
          conceptId: action.conceptId,
          conceptName: action.conceptName,
        });
      }
    }

    if (tasks.length === 0 && summaries.length === 0) {
      tasks.push({
        type: 'add-material',
        label: 'Add study material',
        description: 'Upload notes or a PDF and Lerno builds a study pack for you.',
        packId: null,
        conceptId: null,
        conceptName: null,
      });
    }

    return {
      date: todayIso(now),
      tasks,
      exams: examSummary,
      totalDue,
      packs: summaries.slice(0, 6),
    };
  },
};

/**
 * Loads everything an AI task may see for a pack: the caller must own it, and
 * only the pack's own sources/concepts/content are returned (bounded later by
 * the context builder). Exported so the generation layer never touches the
 * database by itself.
 */
export async function loadPackAiInput(db: Database, userId: string, packId: string) {
  const pack = await requireOwnedPack(db, userId, packId);
  const context = await loadPackContext(db, pack);
  return {
    pack,
    sources: context.sources,
    concepts: context.concepts,
    cards: context.cards,
    questions: context.questions,
  };
}

export type PackDetailDto = Awaited<ReturnType<typeof studyPackService.detail>>;
export type PackSummaryDto = Awaited<ReturnType<typeof studyPackService.list>>[number];
export type { RecommendedAction };
