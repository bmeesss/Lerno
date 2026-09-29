/**
 * Shared, read-only loaders for the Study Pack services.
 *
 * Everything that needs "the state of a pack for this student" — the pack
 * service, the recommendation engine, sessions, the planner and the progress
 * overview — loads it through here, so a pack's concepts, mastery, attempts and
 * due cards are always interpreted the same way (one engine, no copies).
 *
 * Kept free of other services on purpose: it only depends on the repository,
 * the pure rules and the DTO mappers, which lets every service import it
 * without import cycles.
 */
import type { Database } from '../lib/db/repository.js';
import type {
  CardProgressRecord,
  CardRecord,
  ConceptMasteryRecord,
  ConceptRecord,
  PracticeAttemptRecord,
  PracticeQuestionRecord,
  StudyPackRecord,
  StudyPackSourceRecord,
  StudySetRecord,
  TestAttemptRecord,
} from '../lib/db/types.js';
import { dto } from '../lib/dto.js';
import { errors } from '../lib/errors.js';
import { DEFAULT_TIMEZONE } from '../lib/timezone.js';
import {
  daysUntil,
  isWeakConcept,
  masteryFromRecord,
  packMasteryPercent,
  recommendNextAction,
  STRONG_MASTERY_THRESHOLD,
  type PackStats,
} from './study-pack-rules.js';

/** Whether the caller may see this pack (public, or owned). */
export function canViewPack(pack: StudyPackRecord, userId: string | null): boolean {
  return pack.visibility === 'public' || (userId !== null && pack.ownerId === userId);
}

/** Owner-only guard used by every write operation. */
export async function requireOwnedPack(
  db: Database,
  userId: string,
  packId: string,
): Promise<StudyPackRecord> {
  const pack = await db.packs.get(packId);
  if (!pack || pack.ownerId !== userId) throw errors.notFound('Study pack not found');
  return pack;
}

export async function requireVisiblePack(
  db: Database,
  userId: string | null,
  packId: string,
): Promise<StudyPackRecord> {
  const pack = await db.packs.get(packId);
  if (!pack || !canViewPack(pack, userId)) throw errors.notFound('Study pack not found');
  return pack;
}

export interface PackContextData {
  pack: StudyPackRecord;
  sources: StudyPackSourceRecord[];
  concepts: ConceptRecord[];
  questions: PracticeQuestionRecord[];
  cards: CardRecord[];
  set: StudySetRecord | null;
}

export async function loadPackContext(db: Database, pack: StudyPackRecord): Promise<PackContextData> {
  const [sources, concepts, questions, set] = await Promise.all([
    db.packSources.listByPack(pack.id),
    db.concepts.listByPack(pack.id),
    db.practiceQuestions.listByPack(pack.id),
    pack.legacySetId ? db.sets.get(pack.legacySetId) : Promise.resolve(null),
  ]);
  const cards = set ? await db.cards.listBySet(set.id) : [];
  return { pack, sources, concepts, questions, cards, set };
}

export interface PackLearningRows {
  progress: CardProgressRecord[];
  masteryRows: ConceptMasteryRecord[];
  attempts: PracticeAttemptRecord[];
  testAttempts: TestAttemptRecord[];
  /** When the student last worked in a study session of this pack (Learn has no attempts). */
  sessionActivity?: string[];
}

/** Statistics shared by the detail view, the overview and the recommendation. */
export async function loadPackProgress(
  db: Database,
  userId: string | null,
  context: PackContextData,
  rows?: PackLearningRows,
) {
  const { pack, concepts, questions, cards, set } = context;
  let loadedRows: PackLearningRows;
  if (rows) {
    loadedRows = rows;
  } else if (userId) {
    const [progress, masteryRows, attempts, testAttempts, sessions] = await Promise.all([
      set ? db.progress.listByUserAndSet(userId, set.id) : Promise.resolve([] as CardProgressRecord[]),
      db.conceptMastery.listByUserAndPack(userId, pack.id),
      db.practiceAttempts.listByUserAndPack(userId, pack.id),
      db.testAttempts.listByUserAndPack(userId, pack.id),
      db.learningSessions.listByUser(userId, { packId: pack.id, limit: 20 }),
    ]);
    loadedRows = {
      progress,
      masteryRows,
      attempts,
      testAttempts,
      sessionActivity: sessions.filter((session) => session.answeredCount > 0).map((session) => session.lastActivityAt),
    };
  } else {
    loadedRows = { progress: [], masteryRows: [], attempts: [], testAttempts: [] };
  }
  const { progress, masteryRows, attempts, testAttempts } = loadedRows;
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

  const graded = attempts.length;
  const accuracy =
    graded > 0
      ? (attempts.filter((attempt) => attempt.verdict === 'correct').length +
          attempts.filter((attempt) => attempt.verdict === 'partial').length * 0.5) /
        graded
      : null;

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
    ...(loadedRows.sessionActivity ?? []),
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
  learningConcepts: number;
  masteredConcepts: number;
  dueCards: number;
  lastStudiedAt: string | null;
  cardsReviewed: number;
  practiceAnswers: number;
  testsCompleted: number;
}

/** Days until the exam in the student's own calendar (never off by one at midnight). */
export function examDaysLeft(
  pack: StudyPackRecord,
  now: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): number | null {
  return pack.examDate ? daysUntil(pack.examDate, now, timeZone) : null;
}

export interface PackSummarySnapshot {
  pack: StudyPackRecord;
  context: PackContextData;
  progress: Awaited<ReturnType<typeof loadPackProgress>>;
  summary: ReturnType<typeof dto.studyPackSummary>;
}

export function summarizePack(
  pack: StudyPackRecord,
  context: PackContextData,
  progress: Awaited<ReturnType<typeof loadPackProgress>>,
  now: Date,
  timeZone: string = DEFAULT_TIMEZONE,
) {
  return dto.studyPackSummary(pack, {
    sources: context.sources.length,
    flashcards: context.cards.length,
    concepts: context.concepts.length,
    practiceQuestions: context.questions.length,
    masteryPercent: progress.masteryPercent,
    weakConcepts: progress.stats.weakConcepts.length,
    learningConcepts: progress.conceptStates.filter(
      (entry) => entry.state.attempts > 0 && entry.state.mastery >= 0.3 && entry.state.mastery < 0.85,
    ).length,
    masteredConcepts: progress.conceptStates.filter(
      (entry) => entry.state.attempts > 0 && entry.state.mastery >= 0.85,
    ).length,
    dueCards: progress.dueCards,
    lastStudiedAt: progress.activity.slice().sort().at(-1) ?? null,
    cardsReviewed: progress.progress.length,
    practiceAnswers: progress.graded,
    testsCompleted: progress.testAttempts.length,
    examDaysLeft: examDaysLeft(pack, now, timeZone),
  });
}

export function groupRows<T>(rows: T[], keyOf: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }
  return grouped;
}

/** Load each pack's learning state once so recommendations reuse the same snapshot. */
export async function loadPackSnapshots(
  db: Database,
  userId: string | null,
  packs: StudyPackRecord[],
  now: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): Promise<PackSummarySnapshot[]> {
  if (packs.length === 0) return [];
  const packIds = packs.map((pack) => pack.id);
  const setIds = [...new Set(packs.flatMap((pack) => pack.legacySetId ? [pack.legacySetId] : []))];
  const [
    sources,
    concepts,
    questions,
    cards,
    sets,
    progressRows,
    masteryRows,
    attempts,
    testAttempts,
    sessionStats,
  ] = await Promise.all([
    db.packSources.listByPacks(packIds),
    db.concepts.listByPacks(packIds),
    db.practiceQuestions.listByPacks(packIds),
    db.cards.listBySets(setIds),
    db.sets.listByIds(setIds),
    userId ? db.progress.listByUser(userId) : Promise.resolve([]),
    userId ? db.conceptMastery.listByUser(userId) : Promise.resolve([]),
    userId ? db.practiceAttempts.listByUser(userId) : Promise.resolve([]),
    userId ? db.testAttempts.listByUser(userId) : Promise.resolve([]),
    userId ? db.learningSessions.statsByUser(userId) : Promise.resolve([]),
  ]);

  const setById = new Map(sets.map((set) => [set.id, set]));
  const cardsBySet = groupRows(cards, (card) => card.setId);
  const progressByCard = new Map(progressRows.map((row) => [row.cardId, row]));
  const masteryByConcept = new Map(masteryRows.map((row) => [row.conceptId, row]));
  const sourcesByPack = groupRows(sources, (source) => source.packId);
  const conceptsByPack = groupRows(concepts, (concept) => concept.packId);
  const questionsByPack = groupRows(questions, (question) => question.packId);
  const attemptsByPack = groupRows(attempts, (attempt) => attempt.packId);
  const testsByPack = groupRows(testAttempts, (attempt) => attempt.packId);
  const sessionsByPack = groupRows(
    sessionStats.filter((stat) => stat.answeredCount > 0),
    (stat) => stat.packId,
  );

  return Promise.all(packs.map(async (pack) => {
    const set = pack.legacySetId ? (setById.get(pack.legacySetId) ?? null) : null;
    const packCards = set ? (cardsBySet.get(set.id) ?? []) : [];
    const context: PackContextData = {
      pack,
      sources: sourcesByPack.get(pack.id) ?? [],
      concepts: conceptsByPack.get(pack.id) ?? [],
      questions: questionsByPack.get(pack.id) ?? [],
      cards: packCards,
      set,
    };
    const conceptIds = new Set(context.concepts.map((concept) => concept.id));
    const rows: PackLearningRows = {
      progress: packCards.flatMap((card) => {
        const row = progressByCard.get(card.id);
        return row ? [row] : [];
      }),
      masteryRows: [...conceptIds].flatMap((conceptId) => {
        const row = masteryByConcept.get(conceptId);
        return row ? [row] : [];
      }),
      attempts: attemptsByPack.get(pack.id) ?? [],
      testAttempts: testsByPack.get(pack.id) ?? [],
      sessionActivity: (sessionsByPack.get(pack.id) ?? []).map((stat) => stat.lastActivityAt),
    };
    const progress = await loadPackProgress(db, userId, context, rows);
    return { pack, context, progress, summary: summarizePack(pack, context, progress, now, timeZone) };
  }));
}

/** Summary DTOs for a list of packs (one pass per collection). */
export async function buildPackSummaries(
  db: Database,
  userId: string | null,
  packs: StudyPackRecord[],
  timeZone: string = DEFAULT_TIMEZONE,
) {
  if (packs.length === 0) return [];
  return (await loadPackSnapshots(db, userId, packs, new Date(), timeZone)).map(
    (snapshot) => snapshot.summary,
  );
}
