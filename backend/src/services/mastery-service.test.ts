import { describe, expect, it } from 'vitest';
import { createMemoryDatabase, createMemoryState } from '../lib/db/memory.js';
import {
  buildMasteryTrend,
  foldOutcomes,
  masteryService,
  MIN_TREND_DAYS,
  recentChange,
  summarizeMastery,
  toMasteryUpsert,
} from './mastery-service.js';
import { seedPack } from './pack-fixtures.js';
import { applyRating, applyVerdict, emptyMastery, type MasteryState } from './study-pack-rules.js';

const NOW = new Date('2026-09-29T12:00:00.000Z');

describe('foldOutcomes', () => {
  it('uses the PR #13 rules: a verdict and a rating produce exactly what the rules produce', () => {
    const start = new Map<string, MasteryState>();
    const { applied, final } = foldOutcomes(start, [
      { conceptId: 'a', evidence: { kind: 'verdict', verdict: 'correct' }, at: NOW },
      { conceptId: 'b', evidence: { kind: 'rating', rating: 'good' }, at: NOW },
    ]);
    expect(applied[0]!.after).toEqual(applyVerdict(emptyMastery(), 'correct', NOW));
    expect(applied[1]!.after).toEqual(applyRating(emptyMastery(), 'good', NOW));
    expect(final.get('a')).toEqual(applied[0]!.after);
  });

  it('chains several outcomes for one concept, each starting from the previous result', () => {
    const { applied, final } = foldOutcomes(new Map(), [
      { conceptId: 'a', evidence: { kind: 'verdict', verdict: 'correct' }, at: NOW },
      { conceptId: 'a', evidence: { kind: 'verdict', verdict: 'correct' }, at: NOW },
      { conceptId: 'a', evidence: { kind: 'verdict', verdict: 'incorrect' }, at: NOW },
    ]);
    expect(applied[1]!.before).toEqual(applied[0]!.after);
    expect(applied[2]!.before).toEqual(applied[1]!.after);
    expect(final.get('a')!.attempts).toBe(3);
    // 0 → 0.2 → 0.4 → 0.25
    expect(applied.map((entry) => entry.after.mastery)).toEqual([0.2, 0.4, 0.25]);
  });

  it('does not touch the states it was given', () => {
    const start = new Map([['a', { ...emptyMastery(), mastery: 0.5, attempts: 2 }]]);
    foldOutcomes(start, [{ conceptId: 'a', evidence: { kind: 'rating', rating: 'easy' }, at: NOW }]);
    expect(start.get('a')!.mastery).toBe(0.5);
  });
});

describe('summarizeMastery', () => {
  it('counts weak (practised and under 30%) and mastered (85% and up) concepts', () => {
    const states = new Map<string, MasteryState>([
      ['weak', { ...emptyMastery(), mastery: 0.2, attempts: 3 }],
      ['ok', { ...emptyMastery(), mastery: 0.5, attempts: 2 }],
      ['done', { ...emptyMastery(), mastery: 0.9, attempts: 4 }],
    ]);
    const summary = summarizeMastery(
      [{ id: 'weak' }, { id: 'ok' }, { id: 'done' }, { id: 'new' }],
      states,
    );
    expect(summary).toMatchObject({ conceptsTotal: 4, weakConcepts: 1, masteredConcepts: 1 });
    // (0.2 + 0.5 + 0.9 + 0) / 4 = 40%
    expect(summary.masteryPercent).toBe(40);
  });
});

describe('mastery trend', () => {
  const snapshot = (day: string, masteryPercent: number) => ({ day, masteryPercent });

  it('draws no line from fewer than three real days of data', () => {
    const none = buildMasteryTrend([], { today: '2026-09-29', live: 40 });
    expect(none).toMatchObject({ hasEnoughData: false, daysRecorded: 0, points: [], changePercent: null });

    const two = buildMasteryTrend(
      [snapshot('2026-09-27', 20), snapshot('2026-09-28', 30)],
      { today: '2026-09-29' },
    );
    expect(two.hasEnoughData).toBe(false);
    expect(two.points).toEqual([]);
    expect(two.daysRecorded).toBe(2);
    expect(two.minDays).toBe(MIN_TREND_DAYS);
  });

  it('reports the change once there are three days, counting today as a live point', () => {
    const trend = buildMasteryTrend(
      [snapshot('2026-09-27', 20), snapshot('2026-09-28', 35)],
      { today: '2026-09-29', live: 50 },
    );
    expect(trend.hasEnoughData).toBe(true);
    expect(trend.points.map((point) => point.masteryPercent)).toEqual([20, 35, 50]);
    expect(trend.changePercent).toBe(30);
    expect(trend.direction).toBe('up');
  });

  it('never invents a first point: a live value alone is not history', () => {
    const trend = buildMasteryTrend([], { today: '2026-09-29', live: 80 });
    expect(trend.daysRecorded).toBe(0);
  });

  it('calls small changes steady and ignores snapshots older than the window', () => {
    const steady = buildMasteryTrend(
      [snapshot('2026-09-25', 50), snapshot('2026-09-27', 51), snapshot('2026-09-29', 51)],
      { today: '2026-09-29' },
    );
    expect(steady.direction).toBe('steady');

    const old = buildMasteryTrend(
      [snapshot('2026-06-01', 5), snapshot('2026-06-02', 6), snapshot('2026-06-03', 7)],
      { today: '2026-09-29' },
    );
    expect(old.hasEnoughData).toBe(false);
  });

  it('recentChange needs two real points and prefers the live value for today', () => {
    expect(recentChange([], { today: '2026-09-29', live: 60, windowDays: 14 })).toBeNull();
    expect(recentChange([snapshot('2026-09-20', 40)], { today: '2026-09-29', windowDays: 14 })).toBeNull();
    expect(
      recentChange([snapshot('2026-09-20', 40)], { today: '2026-09-29', live: 61, windowDays: 14 }),
    ).toBe(21);
    expect(
      recentChange([snapshot('2026-09-10', 10), snapshot('2026-09-27', 40)], {
        today: '2026-09-29',
        windowDays: 14,
      }),
    ).toBeNull();
  });
});

describe('masteryService', () => {
  it('stores a whole session with one batched upsert and returns before/after per outcome', async () => {
    const db = createMemoryDatabase(createMemoryState());
    const { pack, concepts } = await seedPack(db, 'u1', {
      title: 'Biology',
      concepts: [{ name: 'Osmosis' }, { name: 'Diffusion' }],
    });
    const [osmosis, diffusion] = concepts as [(typeof concepts)[0], (typeof concepts)[0]];

    const { applied } = await masteryService.record(db, 'u1', pack.id, [
      { conceptId: osmosis.id, evidence: { kind: 'verdict', verdict: 'correct' }, at: NOW },
      { conceptId: osmosis.id, evidence: { kind: 'verdict', verdict: 'incorrect' }, at: NOW },
      { conceptId: diffusion.id, evidence: { kind: 'rating', rating: 'easy' }, at: NOW },
    ]);
    expect(applied).toHaveLength(3);

    const rows = await db.conceptMastery.listByUserAndPack('u1', pack.id);
    expect(rows).toHaveLength(2);
    const stored = new Map(rows.map((row) => [row.conceptId, row]));
    expect(stored.get(osmosis.id)!.attempts).toBe(2);
    expect(stored.get(osmosis.id)!.mastery).toBe(0.05);
    expect(stored.get(diffusion.id)!.mastery).toBe(0.25);
  });

  it('writes nothing for an empty session', async () => {
    const db = createMemoryDatabase(createMemoryState());
    const { pack } = await seedPack(db, 'u1', { title: 'Biology', concepts: [{ name: 'Osmosis' }] });
    const result = await masteryService.record(db, 'u1', pack.id, []);
    expect(result.applied).toEqual([]);
    expect(await db.conceptMastery.listByUserAndPack('u1', pack.id)).toEqual([]);
  });

  it("keeps each student's mastery separate", async () => {
    const db = createMemoryDatabase(createMemoryState());
    const { pack, concepts } = await seedPack(db, 'owner', {
      title: 'Biology',
      concepts: [{ name: 'Osmosis' }],
    });
    await masteryService.record(db, 'alice', pack.id, [
      { conceptId: concepts[0]!.id, evidence: { kind: 'verdict', verdict: 'correct' }, at: NOW },
    ]);
    const bob = await masteryService.loadStates(db, 'bob', pack.id);
    expect(bob.size).toBe(0);
    const alice = await masteryService.loadStates(db, 'alice', pack.id);
    expect(alice.get(concepts[0]!.id)!.mastery).toBe(0.2);
  });

  it('records one snapshot per pack and day and overwrites the same day', async () => {
    const db = createMemoryDatabase(createMemoryState());
    const { pack, concepts } = await seedPack(db, 'u1', {
      title: 'Biology',
      concepts: [{ name: 'Osmosis' }, { name: 'Diffusion' }],
    });
    await masteryService.record(db, 'u1', pack.id, [
      { conceptId: concepts[0]!.id, evidence: { kind: 'rating', rating: 'easy' }, at: NOW },
    ]);
    await masteryService.recordSnapshots(db, 'u1', [pack.id], NOW);
    await masteryService.record(db, 'u1', pack.id, [
      { conceptId: concepts[1]!.id, evidence: { kind: 'rating', rating: 'easy' }, at: NOW },
    ]);
    await masteryService.recordSnapshots(db, 'u1', [pack.id, pack.id], NOW);

    const rows = await db.masterySnapshots.listByUser('u1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ day: '2026-09-29', conceptsTotal: 2, masteryPercent: 25 });
  });

  it("stamps the snapshot with the student's local day", async () => {
    const db = createMemoryDatabase(createMemoryState());
    const { pack } = await seedPack(db, 'u1', { title: 'Biology', concepts: [{ name: 'Osmosis' }] });
    const lateUtc = new Date('2026-09-29T23:30:00.000Z');
    await masteryService.recordSnapshots(db, 'u1', [pack.id], lateUtc, 'Europe/Amsterdam');
    const rows = await db.masterySnapshots.listByUser('u1');
    expect(rows.map((row) => row.day)).toEqual(['2026-09-30']);
  });

  it('skips packs without concepts instead of storing an empty point', async () => {
    const db = createMemoryDatabase(createMemoryState());
    const { pack } = await seedPack(db, 'u1', { title: 'Empty', concepts: [] });
    expect(await masteryService.recordSnapshots(db, 'u1', [pack.id], NOW)).toEqual([]);
  });

  it('maps a state to a mastery row', () => {
    const row = toMasteryUpsert('u1', 'c1', { ...emptyMastery(), mastery: 0.4, attempts: 2 });
    expect(row).toMatchObject({ userId: 'u1', conceptId: 'c1', mastery: 0.4, attempts: 2 });
  });
});
