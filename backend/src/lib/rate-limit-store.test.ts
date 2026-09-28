import { describe, expect, it } from 'vitest';
import { FixedWindowStore } from './rate-limit-store.js';

describe('FixedWindowStore', () => {
  it('counts hits and reports a reset time', () => {
    const store = new FixedWindowStore(60_000);
    store.init({ windowMs: 60_000 } as never);

    const first = store.increment('user:1');
    expect(first.totalHits).toBe(1);
    expect(first.resetTime).toBeInstanceOf(Date);

    expect(store.increment('user:1').totalHits).toBe(2);
    expect(store.get('user:1')).toEqual({ totalHits: 2, resetTime: first.resetTime });
    store.shutdown();
  });

  it('counts keys independently', () => {
    const store = new FixedWindowStore(60_000);
    store.init({ windowMs: 60_000 } as never);

    store.increment('user:a');
    store.increment('user:b');
    store.increment('user:b');

    expect(store.get('user:a')?.totalHits).toBe(1);
    expect(store.get('user:b')?.totalHits).toBe(2);
    store.shutdown();
  });

  it('never loses an increment when many hits land at once (no race)', () => {
    const store = new FixedWindowStore(60_000);
    store.init({ windowMs: 60_000 } as never);

    // 200 interleaved hits for the same key must all be counted.
    const totals = Array.from({ length: 200 }, () => store.increment('burst').totalHits);
    expect(totals.at(-1)).toBe(200);
    expect(new Set(totals).size).toBe(200);
    store.shutdown();
  });

  it('resets a window after it expires', () => {
    const store = new FixedWindowStore(50);
    store.init({ windowMs: 50 } as never);

    store.increment('user:1');
    const ready = new Promise((resolve) => setTimeout(resolve, 70));
    return ready.then(() => {
      expect(store.get('user:1')).toBeUndefined();
      expect(store.increment('user:1').totalHits).toBe(1);
      store.shutdown();
    });
  });

  it('supports decrement and resetKey', () => {
    const store = new FixedWindowStore(60_000);
    store.init({ windowMs: 60_000 } as never);

    store.increment('user:1');
    store.increment('user:1');
    store.decrement('user:1');
    expect(store.get('user:1')?.totalHits).toBe(1);

    store.resetKey('user:1');
    expect(store.get('user:1')).toBeUndefined();

    store.decrement('never-seen');
    store.shutdown();
  });

  it('bounds memory by evicting the oldest keys', () => {
    const store = new FixedWindowStore(60_000, { maxKeys: 3 });
    store.init({ windowMs: 60_000 } as never);

    for (const key of ['a', 'b', 'c', 'd', 'e']) store.increment(key);

    expect(store.size).toBe(3);
    // Oldest keys ('a', 'b') are gone; newest survive.
    expect(store.get('a')).toBeUndefined();
    expect(store.get('e')?.totalHits).toBe(1);
    store.shutdown();
  });

  it('clears everything on resetAll', () => {
    const store = new FixedWindowStore(60_000);
    store.init({ windowMs: 60_000 } as never);

    store.increment('a');
    store.resetAll();
    expect(store.size).toBe(0);
    store.shutdown();
  });
});
