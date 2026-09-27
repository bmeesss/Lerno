import { isSupabaseConfigured } from '../../config.js';
import { getMemoryState } from '../db/index.js';
import { createDevAuthProvider } from './dev-auth.js';
import { createSupabaseAuthProvider } from './supabase-auth.js';
import type { AuthProvider } from './types.js';

export type {
  AuthIdentity,
  AuthProvider,
  SignInResult,
  SignUpResult,
  AuthTokens,
} from './types.js';

let cached: AuthProvider | null = null;

export function getAuthProvider(): AuthProvider {
  if (!cached) {
    cached = isSupabaseConfigured
      ? createSupabaseAuthProvider()
      : createDevAuthProvider(getMemoryState());
  }
  return cached;
}
