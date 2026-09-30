/**
 * Mastery service — the one place where evidence about a concept turns into a
 * new mastery state, and where those states are summarised into daily
 * snapshots.
 *
 * It wraps the pure PR #13 rules (`applyVerdict`, `applyRating`) instead of
 * adding a second model: every study mode (Learn, Practice, Review, Test and the
 * classic endpoints) feeds `MasteryOutcome`s through `record()`, so the same
 * numbers appear everywhere. A whole session is one read plus one batched
 * upsert, never a request per answer.
 *
 * Nothing in here calls AI: mastery is arithmetic on graded answers and ratings.
 */
import type { Database } from '../lib/db/repository.js';
import type {
  AnswerVerdict,
  ConceptMasteryUpsert,
  ConceptRecord,
  MasterySnapshotRecord,
  SelfRating,
} from '../lib/db/types.js';
import { DEFAULT_TIMEZONE } from '../lib/timezone.js';
import {
  addDaysIso,
  applyRating,
  applyVerdict,
  emptyMastery,
  isStrongConcept,
  isWeakConcept,
  masteryFromRecord,
  packMasteryPercent,
  todayIso,
  type MasteryState,
} from './study-pack-rules.js';

export type MasteryEvidence =
  { kind: 'verdict'; verdict: AnswerVerdict } | { kind: 'rating'; rating: SelfRating };

/** One piece of evidence about one concept, at a point in time. */
export interface MasteryOutcome {
  conceptId: string;
  evidence: MasteryEvidence;
  at: Date;
}

export interface AppliedOutcome extends MasteryOutcome {
  before: MasteryState;
  after: MasteryState;
}

/** Row shape for `concept_mastery` (mastery is stored as 0..1). */
export function toMasteryUpsert(
  userId: string,
  conceptId: string,
  state: MasteryState,
): ConceptMasteryUpsert {
  return {
    userId,
    conceptId,
    mastery: state.mastery,
    confidence: state.confidence,
    attempts: state.attempts,
    correctCount: state.correctCount,
    incorrectCount: state.incorrectCount,
    lastPracticedAt: state.lastPracticedAt,
    nextReviewAt: state.nextReviewAt,
  };
}

export function percentOf(state: Pick<MasteryState, 'mastery'>): number {
  return Math.round(state.mastery * 100);
}

/**
 * Applies outcomes in order. Several outcomes for one concept chain: the second
 * one starts from the state the first one produced, exactly as if they had been
 * submitted one by one.
 */
export function foldOutcomes(
  start: ReadonlyMap<string, MasteryState>,
  outcomes: MasteryOutcome[],
): { applied: AppliedOutcome[]; final: Map<string, MasteryState> } {
  const final = new Map(start);
  const applied: AppliedOutcome[] = [];
  for (const outcome of outcomes) {
    const before = final.get(outcome.conceptId) ?? emptyMastery();
    const after =
      outcome.evidence.kind === 'verdict'
        ? applyVerdict(before, outcome.evidence.verdict, outcome.at)
        : applyRating(before, outcome.evidence.rating, outcome.at);
    final.set(outcome.conceptId, after);
    applied.push({ ...outcome, before, after });
  }
  return { applied, final };
}

export interface MasterySummary {
  conceptsTotal: number;
  masteryPercent: number;
  weakConcepts: number;
  masteredConcepts: number;
}

/** Same definitions as the pack summary: weak < 30% after practice, mastered ≥ 85%. */
export function summarizeMastery(
  concepts: Pick<ConceptRecord, 'id'>[],
  states: ReadonlyMap<string, MasteryState>,
): MasterySummary {
  const values = concepts.map((concept) => states.get(concept.id) ?? emptyMastery());
  return {
    conceptsTotal: concepts.length,
    masteryPercent: packMasteryPercent(
      concepts.length,
      values.map((value) => value.mastery),
    ),
    weakConcepts: values.filter(isWeakConcept).length,
    masteredConcepts: values.filter(isStrongConcept).length,
  };
}

/* --------------------------------- trends --------------------------------- */

/** A trend line is only drawn from this many distinct days of real data. */
export const MIN_TREND_DAYS = 3;
/** Changes smaller than this many points read as "steady", not up or down. */
export const TREND_STEADY_BAND = 2;
const TREND_WINDOW_DAYS = 30;

export interface TrendPoint {
  day: string;
  masteryPercent: number;
}

export interface MasteryTrend {
  /** True only with at least `MIN_TREND_DAYS` distinct days of data. */
  hasEnoughData: boolean;
  daysRecorded: number;
  minDays: number;
  /** Empty unless `hasEnoughData`: the UI never draws a line from too little data. */
  points: TrendPoint[];
  /** Last minus first point (percentage points); null without enough data. */
  changePercent: number | null;
  direction: 'up' | 'down' | 'steady' | null;
}

/**
 * Builds the honest trend for one pack from its daily snapshots. `live` is
 * today's current value (computed, not stored) so the latest point always
 * matches the number shown next to it.
 */
export function buildMasteryTrend(
  snapshots: Pick<MasterySnapshotRecord, 'day' | 'masteryPercent'>[],
  options: { today: string; live?: number | null; windowDays?: number },
): MasteryTrend {
  const windowStart = addDaysIso(options.today, -(options.windowDays ?? TREND_WINDOW_DAYS));
  const byDay = new Map<string, number>();
  for (const snapshot of snapshots) {
    if (snapshot.day >= windowStart && snapshot.day <= options.today) {
      byDay.set(snapshot.day, snapshot.masteryPercent);
    }
  }
  if (options.live !== undefined && options.live !== null && byDay.size > 0) {
    byDay.set(options.today, options.live);
  }
  const points = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, masteryPercent]) => ({ day, masteryPercent }));
  const hasEnoughData = points.length >= MIN_TREND_DAYS;
  if (!hasEnoughData) {
    return {
      hasEnoughData: false,
      daysRecorded: points.length,
      minDays: MIN_TREND_DAYS,
      points: [],
      changePercent: null,
      direction: null,
    };
  }
  const changePercent = points[points.length - 1]!.masteryPercent - points[0]!.masteryPercent;
  return {
    hasEnoughData: true,
    daysRecorded: points.length,
    minDays: MIN_TREND_DAYS,
    points,
    changePercent,
    direction:
      changePercent >= TREND_STEADY_BAND
        ? 'up'
        : changePercent <= -TREND_STEADY_BAND
          ? 'down'
          : 'steady',
  };
}

/** Recent change per pack from two or more real data points (null otherwise). */
export function recentChange(
  snapshots: Pick<MasterySnapshotRecord, 'day' | 'masteryPercent'>[],
  options: { today: string; live?: number | null; windowDays: number },
): number | null {
  const start = addDaysIso(options.today, -options.windowDays);
  const inWindow = snapshots
    .filter((snapshot) => snapshot.day >= start && snapshot.day <= options.today)
    .sort((a, b) => a.day.localeCompare(b.day));
  const points = inWindow.map((snapshot) => snapshot.masteryPercent);
  if (options.live !== undefined && options.live !== null && points.length > 0) {
    if (inWindow.at(-1)?.day === options.today) points[points.length - 1] = options.live;
    else points.push(options.live);
  }
  if (points.length < 2) return null;
  return points[points.length - 1]! - points[0]!;
}

/* --------------------------------- service -------------------------------- */

export const masteryService = {
  /** Current mastery states of one pack's concepts (one query). */
  async loadStates(
    db: Database,
    userId: string,
    packId: string,
  ): Promise<Map<string, MasteryState>> {
    const rows = await db.conceptMastery.listByUserAndPack(userId, packId);
    return new Map(rows.map((row) => [row.conceptId, masteryFromRecord(row)]));
  },

  /**
   * Turns evidence into stored mastery: fold the outcomes over the current
   * states and write every touched concept with one batched upsert.
   * `states` may be passed by callers that already loaded them.
   */
  async record(
    db: Database,
    userId: string,
    packId: string,
    outcomes: MasteryOutcome[],
    states?: ReadonlyMap<string, MasteryState>,
  ): Promise<{ applied: AppliedOutcome[]; final: Map<string, MasteryState> }> {
    if (outcomes.length === 0) {
      return { applied: [], final: new Map(states ?? []) };
    }
    const start = states ?? (await this.loadStates(db, userId, packId));
    const { applied, final } = foldOutcomes(start, outcomes);
    const touched = [...new Set(applied.map((entry) => entry.conceptId))];
    await db.conceptMastery.upsertMany(
      touched.map((conceptId) => toMasteryUpsert(userId, conceptId, final.get(conceptId)!)),
    );
    return { applied, final };
  },

  /**
   * Stores today's mastery for the given packs (one row per pack and local
   * day; re-running the same day overwrites it). Packs without concepts are
   * skipped: there is nothing to chart yet.
   */
  async recordSnapshots(
    db: Database,
    userId: string,
    packIds: string[],
    now: Date,
    timeZone: string = DEFAULT_TIMEZONE,
  ): Promise<MasterySnapshotRecord[]> {
    const unique = [...new Set(packIds)];
    if (unique.length === 0) return [];
    const [concepts, masteryRows] = await Promise.all([
      db.concepts.listByPacks(unique),
      db.conceptMastery.listByUser(userId),
    ]);
    const states = new Map(masteryRows.map((row) => [row.conceptId, masteryFromRecord(row)]));
    const day = todayIso(now, timeZone);
    const rows = unique.flatMap((packId) => {
      const packConcepts = concepts.filter((concept) => concept.packId === packId);
      if (packConcepts.length === 0) return [];
      return [{ userId, packId, day, ...summarizeMastery(packConcepts, states) }];
    });
    return rows.length > 0 ? db.masterySnapshots.upsertMany(rows) : [];
  },
};
