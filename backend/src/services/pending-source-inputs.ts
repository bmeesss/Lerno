/**
 * Pending source inputs — the in-memory, short-lived handover between "the
 * student uploaded a file" and "the pipeline extracted it".
 *
 * Why this exists: retrying an extraction stage must not force the student to
 * upload the same 20 MB recording again (requirement: "Niet iedere keer de
 * volledige source opnieuw uploaden"). The bytes stay in memory, bounded and for
 * a short time only:
 *
 *   - never written to disk, never logged, never sent anywhere except the
 *     extractor (and the transcription API for audio)
 *   - hard cap on entry count and total bytes, so one account cannot exhaust RAM
 *   - TTL per entry; after that a retry of the *extraction* asks for a new upload
 *     while every AI stage still works from the already stored text
 *
 * Losing this store can therefore never lose study material: the extracted text
 * lives on the source row in the database.
 */
import type { PackSourceKind } from '../lib/source-model.js';

export interface PendingFileInput {
  kind: Extract<PackSourceKind, 'pdf' | 'powerpoint' | 'image' | 'audio'>;
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

export interface PendingYouTubeInput {
  kind: 'youtube';
  url: string;
  transcript: string | null;
}

export type PendingSourceInput = PendingFileInput | PendingYouTubeInput;

export const PENDING_TTL_MS = 30 * 60 * 1000;
export const MAX_PENDING_ENTRIES = 20;
export const MAX_PENDING_BYTES = 40 * 1024 * 1024;

interface Entry {
  input: PendingSourceInput;
  bytes: number;
  storedAt: number;
}

const entries = new Map<string, Entry>();

function bytesOf(input: PendingSourceInput): number {
  return input.kind === 'youtube' ? 0 : input.buffer.byteLength;
}

function totalBytes(): number {
  let total = 0;
  for (const entry of entries.values()) total += entry.bytes;
  return total;
}

/** Drops expired entries and, if needed, the oldest ones to stay in budget. */
function sweep(): void {
  const cutoff = Date.now() - PENDING_TTL_MS;
  for (const [id, entry] of [...entries]) {
    if (entry.storedAt < cutoff) entries.delete(id);
  }
  while (entries.size > MAX_PENDING_ENTRIES || totalBytes() > MAX_PENDING_BYTES) {
    const oldest = [...entries.entries()].sort((a, b) => a[1].storedAt - b[1].storedAt)[0];
    if (!oldest) break;
    entries.delete(oldest[0]);
  }
}

export const pendingSourceInputs = {
  /** Stores the upload for one source id (replacing an earlier attempt). */
  set(sourceId: string, input: PendingSourceInput): void {
    entries.delete(sourceId);
    sweep();
    entries.set(sourceId, { input, bytes: bytesOf(input), storedAt: Date.now() });
    sweep();
  },

  get(sourceId: string): PendingSourceInput | null {
    const entry = entries.get(sourceId);
    if (!entry) return null;
    if (entry.storedAt < Date.now() - PENDING_TTL_MS) {
      entries.delete(sourceId);
      return null;
    }
    return entry.input;
  },

  /** True when a retry can run without a new upload. */
  has(sourceId: string): boolean {
    return this.get(sourceId) !== null;
  },

  delete(sourceId: string): void {
    entries.delete(sourceId);
  },

  /** Test helper: real entries live in process memory only. */
  clear(): void {
    entries.clear();
  },

  /** Bounded state for tests/diagnostics (never contains bytes). */
  stats(): { entries: number; bytes: number } {
    return { entries: entries.size, bytes: totalBytes() };
  },
};
