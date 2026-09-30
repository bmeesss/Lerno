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
import { config } from '../config.js';
import type { Database } from '../lib/db/repository.js';
import type {
  AnswerVerdict,
  CardRecord,
  PracticeQuestionRecord,
  StudyPackRecord,
  StudySetRecord,
} from '../lib/db/types.js';
import { dto } from '../lib/dto.js';
import { errors } from '../lib/errors.js';
import { DEFAULT_TIMEZONE } from '../lib/timezone.js';
import { buildSetContext } from './ai-context.js';
import { estimateStudyTime } from './study-time.js';
import {
  buildPackSummaries,
  canViewPack,
  examDaysLeft,
  loadPackContext,
  loadPackProgress,
  loadPackSnapshots,
  requireOwnedPack,
  requireVisiblePack,
} from './pack-data.js';
import { resolveTimeZone } from './retention-service.js';
import { setService, canViewSet } from './set-service.js';
import { subjectService } from './subject-service.js';
import { sourceExcerptFor } from './learn-content.js';
import { masteryService, percentOf, type AppliedOutcome } from './mastery-service.js';
import {
  buildQuestionHistory,
  selectTestQuestions,
  testQuestionCount,
} from './recommendation-service.js';
import { sessionTitle } from './session-model.js';
import { toNormalizedSource } from './source-normalize.js';
import { studyPlanService } from './study-plan-service.js';
import {
  gradeAnswer,
  isConceptDue,
  isWeakConcept,
  learnReason,
  masteryFromRecord,
  matchConcept,
  rankLearnCandidates,
  STRONG_MASTERY_THRESHOLD,
  type ConceptRating,
  type RecommendedAction,
} from './study-pack-rules.js';
import type { CreatePackBody, CreateTestBody } from '../validators/study-pack.validators.js';

export { canViewPack };

const MAX_CARDS_PER_SET = 500;
const MAX_PRACTICE_QUESTIONS = 300;

function setSourceContext(set: StudySetRecord, cards: CardRecord[]) {
  const context = buildSetContext(set, cards);
  return context.text;
}

export const studyPackService = {
  canView: canViewPack,

  /** All packs of the signed-in student, newest activity first. */
  async list(db: Database, userId: string) {
    const [packs, timeZone] = await Promise.all([
      db.packs.listByOwner(userId),
      resolveTimeZone(db, userId),
    ]);
    return buildPackSummaries(db, userId, packs, timeZone);
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
    const [plan, tests, timeZone] = await Promise.all([
      db.studyPlans.getByPack(pack.id),
      db.tests.listByPack(pack.id),
      userId ? resolveTimeZone(db, userId) : Promise.resolve(DEFAULT_TIMEZONE),
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
      examDaysLeft: examDaysLeft(pack, now, timeZone),
      summary: pack.summary,
      summarySourceId: pack.summarySourceId,
      summaryUpdatedAt: pack.summaryUpdatedAt,
      /** Source-grounded analysis (difficulty, exam topics, conflicts). */
      analysis: pack.analysis,
      /**
       * Whether Lerno AI can generate content right now. Shown as a calm
       * notice instead of an error: the pack and its material always work.
       */
      aiAvailable: Boolean(config.groqApiKey),
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
      /** Transparent, rule-based study time estimate (no AI involved). */
      estimatedStudyTime: estimateStudyTime({
        concepts: context.concepts.length,
        flashcards: context.cards.length,
        practiceQuestions: context.questions.length,
        sourceCharacters: context.sources.reduce(
          (total, source) => total + source.characterCount,
          0,
        ),
        difficulty: pack.analysis?.difficulty ?? null,
      }),
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
    // The exam date drives the plan: keep it in step with the new date.
    if (patch.examDate !== undefined && patch.examDate !== pack.examDate) {
      await studyPlanService.onExamDateChanged(db, userId, updated);
    }
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
    const [summary] = await buildPackSummaries(db, userId, [updated], await resolveTimeZone(db, userId));
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
      | {
          target: 'concepts';
          concepts: {
            name: string;
            explanation: string;
            /** Per-item provenance (multi-source packs); falls back to `sourceId`. */
            sourceId?: string | null;
            refLabel?: string | null;
            importance?: number | null;
            difficulty?: 'easy' | 'medium' | 'hard' | null;
          }[];
          sourceId: string | null;
        }
      | {
          target: 'flashcards';
          cards: {
            front: string;
            back: string;
            sourceId?: string | null;
            conceptId?: string | null;
          }[];
          sourceId: string | null;
        }
      | {
          target: 'practice';
          questions: {
            questionType: PracticeQuestionRecord['questionType'];
            prompt: string;
            correctAnswer: string;
            options: string[] | null;
            explanation: string;
            sourceId?: string | null;
            conceptId?: string | null;
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
          sourceId: concept.sourceId ?? input.sourceId,
          origin: 'ai' as const,
          position: concepts.length + index,
          refLabel: concept.refLabel ?? null,
          importance: concept.importance ?? null,
          difficulty: concept.difficulty ?? null,
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
          sourceId: card.sourceId ?? input.sourceId,
          conceptId:
            card.conceptId ?? matchConcept(`${card.front} ${card.back}`, concepts)?.id ?? null,
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
          question.conceptId ??
          matchConcept(`${question.prompt} ${question.correctAnswer}`, concepts)?.id ??
          null,
        sourceId: question.sourceId ?? input.sourceId,
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
    input: { questionId: string; answer: string; responseTimeMs?: number },
  ) {
    const pack = await requireVisiblePack(db, userId, packId);
    const question = await db.practiceQuestions.get(input.questionId);
    if (!question || question.packId !== pack.id) throw errors.notFound('Practice question not found');

    const graded = gradeAnswer(question, input.answer);
    const concept = question.conceptId ? await db.concepts.get(question.conceptId) : null;
    let applied: AppliedOutcome | null = null;
    if (userId && concept) {
      const previous = await db.conceptMastery.get(userId, concept.id);
      const recorded = await masteryService.record(
        db,
        userId,
        pack.id,
        [{ conceptId: concept.id, evidence: { kind: 'verdict', verdict: graded.verdict }, at: new Date() }],
        new Map([[concept.id, masteryFromRecord(previous)]]),
      );
      applied = recorded.applied[0] ?? null;
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
      await db.learningEvents.create({
        userId,
        packId: pack.id,
        conceptId: concept?.id ?? null,
        questionId: question.id,
        eventType: 'practice',
        isCorrect: graded.verdict === 'partial' ? null : graded.verdict === 'correct',
        responseTimeMs: input.responseTimeMs ?? null,
        metadata: { verdict: graded.verdict },
      });
    }

    const source = question.sourceId ? await db.packSources.get(question.sourceId) : null;
    return {
      questionId: question.id,
      verdict: graded.verdict,
      correctAnswer: question.correctAnswer,
      explanation: question.explanation,
      concept: concept ? { id: concept.id, name: concept.name } : null,
      previousMasteryPercent: applied ? percentOf(applied.before) : null,
      conceptMasteryPercent: applied ? percentOf(applied.after) : null,
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
    const [progress, seenItems] = await Promise.all([
      loadPackProgress(db, userId, context),
      db.learningSessionItems.listSeenByUserAndPack(userId, pack.id),
    ]);
    const selected = selectTestQuestions({
      questions: context.questions,
      weakConceptIds: new Set(progress.stats.weakConcepts.map((concept) => concept.id)),
      history: buildQuestionHistory({
        attempts: progress.attempts,
        testAttempts: progress.testAttempts,
        seenItems,
      }),
      count: testQuestionCount(input.mode, context.questions.length),
    });

    const { test } = await db.tests.createTest({
      packId: pack.id,
      ownerId: userId,
      title: sessionTitle('test', input.mode, pack.title),
      mode: input.mode,
      questionIds: selected.map((question) => question.id),
    });

    const conceptNames = new Map(context.concepts.map((concept) => [concept.id, concept.name]));
    return {
      test: {
        id: test.id,
        title: test.title,
        mode: test.mode,
        questionCount: test.questionCount,
        createdAt: test.createdAt,
      },
      // A test never shows the answer or the explanation before it is submitted.
      questions: selected.map((question) => ({
        ...dto.testQuestion(question),
        conceptName: question.conceptId ? (conceptNames.get(question.conceptId) ?? null) : null,
      })),
    };
  },

  /** Grades a stored test, stores the attempt and updates concept mastery. */
  async submitTest(
    db: Database,
    userId: string,
    packId: string,
    testId: string,
    input: { answers: { questionId: string; answer: string; responseTimeMs?: number }[] },
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

    const answersGiven = new Map(input.answers.map((answer) => [answer.questionId, answer]));
    const now = new Date();

    const graded = testQuestions.flatMap((row) => {
      const question = questionById.get(row.questionId);
      if (!question) return [];
      const given = answersGiven.get(question.id);
      const answer = given?.answer ?? '';
      const verdict: AnswerVerdict = answer ? gradeAnswer(question, answer).verdict : 'incorrect';
      const concept = question.conceptId ? (conceptById.get(question.conceptId) ?? null) : null;
      return [{ question, answer, verdict, concept, responseTimeMs: given ? (given.responseTimeMs ?? null) : null }];
    });

    // One read and one batched write for the whole test.
    const outcomes = graded.flatMap((entry) =>
      entry.concept
        ? [{ conceptId: entry.concept.id, evidence: { kind: 'verdict' as const, verdict: entry.verdict }, at: now }]
        : [],
    );
    const { applied, final } = await masteryService.record(db, userId, pack.id, outcomes);
    let appliedIndex = 0;

    let score = 0;
    let correctCount = 0;
    let partialCount = 0;
    let incorrectCount = 0;
    const touchedConcepts = new Set<string>();
    const results = graded.map((entry) => {
      if (entry.verdict === 'correct') {
        score += 1;
        correctCount += 1;
      } else if (entry.verdict === 'partial') {
        score += 0.5;
        partialCount += 1;
      } else {
        incorrectCount += 1;
      }
      let previousMasteryPercent: number | null = null;
      let masteryPercent: number | null = null;
      if (entry.concept) {
        touchedConcepts.add(entry.concept.id);
        const step = applied[appliedIndex++]!;
        previousMasteryPercent = percentOf(step.before);
        masteryPercent = percentOf(step.after);
      }
      return {
        questionId: entry.question.id,
        prompt: entry.question.prompt,
        questionType: entry.question.questionType,
        yourAnswer: entry.answer,
        correctAnswer: entry.question.correctAnswer,
        options: entry.question.options,
        verdict: entry.verdict,
        explanation: entry.question.explanation,
        conceptId: entry.concept?.id ?? null,
        conceptName: entry.concept?.name ?? null,
        previousMasteryPercent,
        conceptMasteryPercent: masteryPercent,
      };
    });

    await db.learningEvents.createMany(
      graded.map((entry) => ({
        userId,
        packId: pack.id,
        conceptId: entry.concept?.id ?? null,
        questionId: entry.question.id,
        eventType: 'test' as const,
        isCorrect: entry.verdict === 'partial' ? null : entry.verdict === 'correct',
        responseTimeMs: entry.responseTimeMs,
        metadata: { verdict: entry.verdict, testId: test.id },
      })),
    );

    const strongConceptIds: string[] = [];
    const weakConceptIds: string[] = [];
    for (const conceptId of touchedConcepts) {
      const state = final.get(conceptId);
      if (!state) continue;
      if (isWeakConcept(state)) weakConceptIds.push(conceptId);
      if (state.mastery >= STRONG_MASTERY_THRESHOLD) strongConceptIds.push(conceptId);
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

  /**
   * "Show source": the passage of the student's own material a concept comes
   * from. Plain text lookup — no AI, and only for packs the student may see.
   */
  async conceptSource(db: Database, userId: string | null, packId: string, conceptId: string) {
    const pack = await requireVisiblePack(db, userId, packId);
    const concept = await db.concepts.get(conceptId);
    if (!concept || concept.packId !== pack.id) throw errors.notFound('Concept not found');
    const sources = await db.packSources.listByPack(pack.id);
    const source =
      sources.find((entry) => entry.id === concept.sourceId) ??
      sources.find((entry) => (entry.content ?? '').trim().length > 0) ??
      null;
    if (!source || !(source.content ?? '').trim()) {
      return { concept: { id: concept.id, name: concept.name }, source: null, excerpt: null };
    }
    const normalized = toNormalizedSource(source);
    return {
      concept: { id: concept.id, name: concept.name },
      source: { id: source.id, title: source.title, kind: source.kind },
      excerpt: sourceExcerptFor(concept, normalized),
    };
  },

  /* ---------------------------- learn + mastery ---------------------------- */

  /** Picks one concept from the live mastery state; each response re-ranks the queue. */
  async nextLearnConcept(
    db: Database,
    userId: string,
    packId: string,
    excludedIds: string[] = [],
    focusConceptId?: string,
  ) {
    const pack = await requireVisiblePack(db, userId, packId);
    const [context, masteryRows] = await Promise.all([
      loadPackContext(db, pack),
      db.conceptMastery.listByUserAndPack(userId, pack.id),
    ]);
    const masteryById = new Map(masteryRows.map((row) => [row.conceptId, row]));
    const ranked = rankLearnCandidates(
      context.concepts.map((concept) => ({ concept, state: masteryFromRecord(masteryById.get(concept.id) ?? null) })),
      excludedIds,
    );
    const selected = excludedIds.length === 0 && focusConceptId
      ? ranked.find((candidate) => candidate.concept.id === focusConceptId) ?? ranked[0]
      : ranked[0];
    if (!selected) return { concept: null, remaining: 0, reason: null };

    if (excludedIds.length === 0) {
      await db.learningEvents.create({
        userId,
        packId: pack.id,
        conceptId: selected.concept.id,
        eventType: 'learn',
        metadata: { sessionStarted: true },
      });
    }

    const reason = learnReason(selected.state);

    return {
      concept: {
        id: selected.concept.id,
        name: selected.concept.name,
        explanation: selected.concept.explanation,
        position: selected.concept.position,
        masteryPercent: Math.round(selected.state.mastery * 100),
        confidencePercent: Math.round(selected.state.confidence * 100),
        attempts: selected.state.attempts,
        lastPracticedAt: selected.state.lastPracticedAt,
        cardCount: context.cards.filter((card) => card.conceptId === selected.concept.id).length,
        questionCount: context.questions.filter((question) => question.conceptId === selected.concept.id).length,
      },
      remaining: ranked.length,
      reason,
    };
  },

  /** Learn mode: one self-rating for one concept, stored as mastery. */
  async rateConcept(
    db: Database,
    userId: string,
    packId: string,
    conceptId: string,
    rating: ConceptRating,
    responseTimeMs?: number,
  ) {
    const pack = await requireVisiblePack(db, userId, packId);
    const concept = await db.concepts.get(conceptId);
    if (!concept || concept.packId !== pack.id) throw errors.notFound('Concept not found');

    const previous = await db.conceptMastery.get(userId, concept.id);
    const recorded = await masteryService.record(
      db,
      userId,
      pack.id,
      [{ conceptId: concept.id, evidence: { kind: 'rating', rating }, at: new Date() }],
      new Map([[concept.id, masteryFromRecord(previous)]]),
    );
    const next = recorded.applied[0]!.after;
    await db.learningEvents.create({
      userId,
      packId: pack.id,
      conceptId: concept.id,
      eventType: 'self_rating',
      isCorrect: rating === 'good' || rating === 'easy' ? true : rating === 'again' ? false : null,
      responseTimeMs: responseTimeMs ?? null,
      metadata: { rating },
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
    return studyPlanService.currentPlan(db, userId, pack);
  },

  /**
   * Generates (or regenerates) the study plan for a pack. Deterministic and
   * exam-date driven (see study-plan-service), so it also works without AI.
   */
  async createPlan(
    db: Database,
    userId: string,
    packId: string,
    input: { days?: number; minutesPerDay?: number } = {},
  ) {
    const pack = await requireOwnedPack(db, userId, packId);
    return studyPlanService.build(db, userId, pack, input);
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

    const snapshots = await loadPackSnapshots(db, userId, packs, new Date(), await resolveTimeZone(db, userId));
    const summaries = snapshots.map((snapshot) => snapshot.summary);
    const weakConcepts = snapshots
      .filter((snapshot) => snapshot.summary.weakConcepts > 0)
      .map((snapshot) => ({
        packId: snapshot.pack.id,
        packTitle: snapshot.pack.title,
        weakConcepts: snapshot.summary.weakConcepts,
        masteryPercent: snapshot.summary.masteryPercent,
      }))
      .sort((a, b) => a.masteryPercent - b.masteryPercent);
    const conceptsDue = snapshots.reduce(
      (total, snapshot) =>
        total + snapshot.progress.conceptStates.filter((entry) => isConceptDue(entry.state)).length,
      0,
    );
    const testsToReview = snapshots.reduce(
      (total, snapshot) =>
        total + snapshot.progress.testAttempts.filter((attempt) => attempt.weakConceptIds.length > 0).length,
      0,
    );

    return {
      cardsDue: [...dueByPack.values()].reduce((total, entry) => total + entry.dueCount, 0),
      conceptsDue,
      testsToReview,
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
    return studyPlanService.today(db, userId, now);
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
