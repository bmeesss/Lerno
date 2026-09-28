/**
 * Fixed-window counter store for `express-rate-limit`.
 *
 * Why not the built-in `MemoryStore`? Because this one is deliberately:
 *
 * - **Synchronous and atomic.** `increment()` reads-and-bumps in one go, so
 *   concurrent requests can never both observe the same pre-increment value
 *   (no lost updates, no race that lets a burst slip through).
 * - **Bounded in memory.** A hard cap on tracked keys plus periodic sweeps
 *   keep an IP-spoofing client from growing the map without limit.
 * - **Testable.** `resetAll()` gives deterministic tests without timers.
 *
 * Single-process only (Render free tier runs one instance) — the same
 * assumption the previous in-memory store made.
 */
import type { ClientRateLimitInfo, IncrementResponse, Options, Store } from 'express-rate-limit';

interface Window {
  totalHits: number;
  resetTime: Date;
}

export interface FixedWindowStoreOptions {
  /** Max distinct keys tracked before the oldest are evicted (memory bound). */
  maxKeys?: number;
}

export class FixedWindowStore implements Store {
  /** Keys counted here cannot collide with another process's keys. */
  readonly localKeys = true;

  private readonly windows = new Map<string, Window>();
  private windowMs: number;
  private readonly maxKeys: number;
  private timer: NodeJS.Timeout | undefined;

  constructor(windowMs: number, options: FixedWindowStoreOptions = {}) {
    this.windowMs = windowMs;
    this.maxKeys = options.maxKeys ?? 10_000;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.sweep(), this.windowMs);
    // Do not keep the process alive for a cache sweep.
    this.timer.unref?.();
  }

  get(key: string): ClientRateLimitInfo | undefined {
    const entry = this.windows.get(key);
    if (!entry) return undefined;
    if (entry.resetTime.getTime() <= Date.now()) {
      this.windows.delete(key);
      return undefined;
    }
    return { totalHits: entry.totalHits, resetTime: entry.resetTime };
  }

  /** Atomic read-and-increment: no `await` before the counter is updated. */
  increment(key: string): IncrementResponse {
    const now = Date.now();
    const existing = this.windows.get(key);

    let entry: Window;
    if (existing && existing.resetTime.getTime() > now) {
      entry = existing;
      entry.totalHits += 1;
      // Refresh insertion order so eviction prefers idle keys.
      this.windows.delete(key);
      this.windows.set(key, entry);
    } else {
      entry = { totalHits: 1, resetTime: new Date(now + this.windowMs) };
      this.windows.set(key, entry);
      this.evictIfNeeded();
    }

    return { totalHits: entry.totalHits, resetTime: entry.resetTime };
  }

  decrement(key: string): void {
    const entry = this.windows.get(key);
    if (entry && entry.totalHits > 0) entry.totalHits -= 1;
  }

  resetKey(key: string): void {
    this.windows.delete(key);
  }

  resetAll(): void {
    this.windows.clear();
  }

  shutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.windows.clear();
  }

  /** Number of keys currently tracked (tests + observability). */
  get size(): number {
    return this.windows.size;
  }

  /** Drops expired windows, then the oldest keys if the cap is exceeded. */
  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.windows) {
      if (entry.resetTime.getTime() <= now) this.windows.delete(key);
    }
    this.evictIfNeeded();
  }

  private evictIfNeeded(): void {
    if (this.windows.size <= this.maxKeys) return;
    const excess = this.windows.size - this.maxKeys;
    let removed = 0;
    // Map iteration order is insertion order: oldest keys come first.
    for (const key of this.windows.keys()) {
      if (removed >= excess) break;
      this.windows.delete(key);
      removed += 1;
    }
  }
}
