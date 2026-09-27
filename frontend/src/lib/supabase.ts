/**
 * Minimal Supabase client for OAuth consent (Phase 7.5).
 *
 * The app talks to the Lerno backend for everything; this client exists only
 * for the OAuth authorization UI, which must call Supabase Auth's
 * `auth.oauth.*` methods directly. It is configured only when the public
 * Supabase env vars are set (personal test env / production) and is loaded
 * exclusively by the lazily-imported consent page.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getAccessToken, getRefreshToken, setTokens } from './api';
import { config } from './config';

let cached: SupabaseClient | null = null;

export function isSupabaseOAuthConfigured(): boolean {
  return config.supabaseUrl !== '' && config.supabaseAnonKey !== '';
}

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseOAuthConfigured()) return null;
  if (!cached) {
    cached = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

/**
 * Attaches the current Lerno session to the Supabase client. Lerno access
 * tokens are Supabase-issued in production, so the OAuth methods accept them.
 * Returns false when there is no usable session (caller shows a login hint).
 */
export async function attachLernoSession(client: SupabaseClient): Promise<boolean> {
  const accessToken = getAccessToken();
  const refreshToken = getRefreshToken();
  if (!accessToken || !refreshToken) return false;
  const { data, error } = await client.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (error || !data.session) return false;
  // setSession can refresh an expired access token and rotate the refresh
  // token. Keep the website session in sync, or the next consent/REST request
  // would reuse a stale refresh token and could log the student out.
  if (data.session.access_token !== accessToken || data.session.refresh_token !== refreshToken) {
    setTokens(data.session.access_token, data.session.refresh_token);
  }
  return true;
}
