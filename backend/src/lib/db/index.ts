/**
 * Database factory.
 *
 * Production: Supabase-backed repository bound to the caller's JWT so Postgres
 * row-level security applies (spec §13). Admin operations use a service-role
 * repository after an explicit admin role check in the backend.
 *
 * Development data mode: shared in-memory store (see memory.ts).
 */
import { isSupabaseConfigured } from '../../config.js';
import { createMemoryDatabase, createMemoryState, type MemoryState } from './memory.js';
import { createSupabaseAdminDatabase, createSupabaseDatabase } from './supabase.js';
import type { Database } from './repository.js';

export type { Database } from './repository.js';
export * from './types.js';

let sharedMemoryState: MemoryState | null = null;

/** Singleton memory state shared with the dev auth provider. */
export function getMemoryState(): MemoryState {
  if (!sharedMemoryState) sharedMemoryState = createMemoryState();
  return sharedMemoryState;
}

/** Database bound to the given user access token (RLS applies). */
export function createDatabase(auth?: { accessToken?: string }): Database {
  if (isSupabaseConfigured) {
    return createSupabaseDatabase(auth?.accessToken ?? null);
  }
  return createMemoryDatabase(getMemoryState());
}

/** Service-role database for trusted admin contexts only (after role checks). */
export function createAdminDatabase(): Database {
  if (isSupabaseConfigured) {
    return createSupabaseAdminDatabase();
  }
  return createMemoryDatabase(getMemoryState());
}

/** Cheap probe for GET /api/health. */
export async function pingDatabase(): Promise<void> {
  await createDatabase().ping();
}
